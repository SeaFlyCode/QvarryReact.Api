import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import jwt from "jsonwebtoken";
import url from "url";
import {
  sendMessage,
  getMessages,
  markMessageAsRead,
  replyToMessage,
  editMessage,
  deleteMessage,
} from "../controllers/messagesControllers";
import { decrypt as decryptCommunication } from "../utils/communicationEncryptionUtils";
import ConversationModel from "../models/conversations";
import { redisSessionService } from "./redisSessionService";

interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  conversationId?: string;
  isAlive?: boolean;
  messageCount?: number;
  messageCountResetTime?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION SÉCURITÉ WEBSOCKET
// ═══════════════════════════════════════════════════════════════════════════

const NODE_ENV = process.env.NODE_ENV || "development";
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3001";

// WS-004: Origins autorisées pour WebSocket
const ALLOWED_WS_ORIGINS =
  NODE_ENV === "production"
    ? [CLIENT_URL]
    : [
        "http://localhost:3000",
        "http://localhost:3001",
        "https://localhost:3000",
        "https://localhost:3001",
        CLIENT_URL,
      ];

// WS-003: Rate limiting par message
const MAX_MESSAGES_PER_MINUTE = 60;
const MESSAGE_RATE_LIMIT_WINDOW_MS = 60 * 1000;

// ═══════════════════════════════════════════════════════════════════════════
// RATE LIMITING POUR WEBSOCKET (CONNEXIONS)
// ═══════════════════════════════════════════════════════════════════════════

interface ConnectionAttempt {
  count: number;
  firstAttempt: Date;
  blockedUntil?: Date;
}

const connectionAttempts = new Map<string, ConnectionAttempt>();
const MAX_CONNECTIONS_PER_MINUTE = 10;
const BLOCK_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const MAX_TRACKED_IPS = 10000; // CRIT-08: Limite du nombre d'IPs trackées pour éviter une fuite mémoire

/**
 * Vérifie si une IP peut se connecter (rate limiting)
 */
function canConnect(ip: string): { allowed: boolean; reason?: string } {
  const now = new Date();

  // CRIT-08: Protection mémoire — limiter le nombre d'IPs trackées
  if (
    connectionAttempts.size >= MAX_TRACKED_IPS &&
    !connectionAttempts.has(ip)
  ) {
    // Purger les entrées non bloquées les plus anciennes
    for (const [trackedIp, attempt] of connectionAttempts.entries()) {
      if (!attempt.blockedUntil || attempt.blockedUntil < now) {
        connectionAttempts.delete(trackedIp);
      }
      if (connectionAttempts.size < MAX_TRACKED_IPS * 0.8) break;
    }
  }

  const attempt = connectionAttempts.get(ip);

  if (!attempt) {
    connectionAttempts.set(ip, { count: 1, firstAttempt: now });
    return { allowed: true };
  }

  // Si bloqué
  if (attempt.blockedUntil && attempt.blockedUntil > now) {
    const remainingMinutes = Math.ceil(
      (attempt.blockedUntil.getTime() - now.getTime()) / 60000,
    );
    return {
      allowed: false,
      reason: `Trop de tentatives de connexion. Réessayez dans ${remainingMinutes} minute(s).`,
    };
  }

  // Réinitialiser si plus d'une minute s'est écoulée
  const timeSinceFirst = now.getTime() - attempt.firstAttempt.getTime();
  if (timeSinceFirst > 60000) {
    connectionAttempts.set(ip, { count: 1, firstAttempt: now });
    return { allowed: true };
  }

  // Incrémenter le compteur
  attempt.count++;

  if (attempt.count > MAX_CONNECTIONS_PER_MINUTE) {
    attempt.blockedUntil = new Date(now.getTime() + BLOCK_DURATION_MS);
    connectionAttempts.set(ip, attempt);
    console.warn(
      `🚫 [WS RATE LIMIT] IP ${ip} bloquée pour ${BLOCK_DURATION_MS / 60000} minutes (${attempt.count} tentatives)`,
    );
    return {
      allowed: false,
      reason: `Trop de tentatives de connexion. Bloqué pour ${BLOCK_DURATION_MS / 60000} minutes.`,
    };
  }

  connectionAttempts.set(ip, attempt);
  return { allowed: true };
}

// Nettoyage périodique des tentatives anciennes
setInterval(
  () => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    for (const [ip, attempt] of connectionAttempts.entries()) {
      if (
        attempt.firstAttempt < oneHourAgo &&
        (!attempt.blockedUntil || attempt.blockedUntil < now)
      ) {
        connectionAttempts.delete(ip);
      }
    }
  },
  60 * 60 * 1000,
); // Toutes les heures

class WebSocketService {
  private notificationsWss: WebSocketServer | null = null;
  private messagesWss: WebSocketServer | null = null;
  private clients: Map<string, Set<AuthenticatedWebSocket>> = new Map();
  private messageClients: Map<
    string,
    Map<string, Set<AuthenticatedWebSocket>>
  > = new Map(); // userId -> conversationId -> clients

  /**
   * Initialiser le serveur WebSocket
   */
  initialize(server: Server): void {
    // WebSocket pour les notifications (noServer: true pour gérer manuellement l'upgrade)
    this.notificationsWss = new WebSocketServer({ noServer: true });

    // WebSocket pour les messages
    this.messagesWss = new WebSocketServer({ noServer: true });

    console.log(
      "🔌 WebSocket Server initialized on paths: /ws/notifications and /ws/messages",
    );

    // Gérer manuellement l'upgrade HTTP vers WebSocket
    server.on("upgrade", (request, socket, head) => {
      const parsedUrl = url.parse(request.url || "", true);
      const pathname = parsedUrl.pathname;

      // WS-007: Masquer le token dans les logs pour éviter le token leakage
      const safeUrl =
        pathname +
        (parsedUrl.query.conv ? `?conv=${parsedUrl.query.conv}` : "");
      console.log(`🔄 [WebSocket] Upgrade request pour: ${safeUrl}`);

      // WS-004: Validation CORS pour WebSocket
      const origin = request.headers.origin;
      if (origin && !ALLOWED_WS_ORIGINS.includes(origin)) {
        console.error(`❌ [WebSocket] Origin non autorisée: ${origin}`);
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }

      if (pathname === "/ws/notifications") {
        console.log("📡 [WebSocket] Redirection vers /ws/notifications");
        this.notificationsWss?.handleUpgrade(request, socket, head, (ws) => {
          this.notificationsWss?.emit("connection", ws, request);
        });
      } else if (pathname === "/ws/messages") {
        console.log("📡 [WebSocket] Redirection vers /ws/messages");
        this.messagesWss?.handleUpgrade(request, socket, head, (ws) => {
          this.messagesWss?.emit("connection", ws, request);
        });
      } else {
        console.error(
          `❌ [WebSocket] Chemin inconnu: ${pathname}, connexion rejetée`,
        );
        socket.destroy();
      }
    });

    this.notificationsWss.on(
      "connection",
      this.handleNotificationConnection.bind(this),
    );
    this.messagesWss.on("connection", this.handleMessageConnection.bind(this));

    // Heartbeat pour les notifications
    const notificationInterval = setInterval(() => {
      this.notificationsWss?.clients.forEach((ws: WebSocket) => {
        const client = ws as AuthenticatedWebSocket;
        if (client.isAlive === false) {
          console.log(
            `💔 [WS-Notifications] Client ${client.userId} non réactif, fermeture`,
          );
          return client.terminate();
        }
        client.isAlive = false;
        client.ping();
      });
    }, 30000);

    // Heartbeat pour les messages
    const messageInterval = setInterval(() => {
      this.messagesWss?.clients.forEach((ws: WebSocket) => {
        const client = ws as AuthenticatedWebSocket;
        if (client.isAlive === false) {
          console.log(
            `💔 [WS-Messages] Client ${client.userId} non réactif, fermeture`,
          );
          return client.terminate();
        }
        client.isAlive = false;
        client.ping();
      });
    }, 30000);

    this.notificationsWss.on("close", () => {
      clearInterval(notificationInterval);
    });

    this.messagesWss.on("close", () => {
      clearInterval(messageInterval);
    });
  }

  /**
   * Gérer une nouvelle connexion WebSocket pour les notifications
   */
  private async handleNotificationConnection(
    ws: WebSocket,
    request: any,
  ): Promise<void> {
    const client = ws as AuthenticatedWebSocket;
    client.isAlive = true;

    // Vérifier le rate limiting par IP
    const ip = request.socket.remoteAddress || "unknown";
    const rateLimitCheck = canConnect(ip);

    if (!rateLimitCheck.allowed) {
      console.warn(
        `⚠️ [WS-Notifications] Connexion refusée pour ${ip}: ${rateLimitCheck.reason}`,
      );
      client.close(4029, rateLimitCheck.reason);
      return;
    }

    // Heartbeat
    client.on("pong", () => {
      client.isAlive = true;
    });

    // Extraire le token du query string
    const query = url.parse(request.url, true).query;
    const token = query.token as string;

    if (!token) {
      console.error("❌ [WS-Notifications] Connexion refusée : pas de token");
      client.close(4001, "Authentication required");
      return;
    }

    try {
      // Vérifier le token JWT
      if (!process.env.JWT_SECRET) {
        console.error("❌ [SECURITY] JWT_SECRET non défini");
        throw new Error("Configuration de sécurité manquante");
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET) as {
        id: string;
        type?: string;
        jti?: string;
      };

      // WS-008: Vérifier que le token est bien de type 'websocket'
      if (decoded.type !== "websocket") {
        console.error(
          '❌ [WS-Notifications] Token invalide: type attendu "websocket"',
        );
        client.close(4002, "Invalid token type");
        return;
      }

      // AUTH-004 CORRIGÉ: Vérifier que le token est à usage unique
      if (decoded.jti) {
        const isTokenValid = await redisSessionService.consumeWsToken(
          decoded.jti,
        );
        if (!isTokenValid) {
          console.error(
            `❌ [WS-Notifications] Token déjà utilisé (jti: ${decoded.jti.substring(0, 8)}...)`,
          );
          client.close(4003, "Token already used");
          return;
        }
        console.log(
          `✅ [WS-Notifications] Token à usage unique validé (jti: ${decoded.jti.substring(0, 8)}...)`,
        );
      }

      client.userId = decoded.id;

      // Ajouter le client à la map
      if (!this.clients.has(client.userId)) {
        this.clients.set(client.userId, new Set());
      }
      this.clients.get(client.userId)!.add(client);

      console.log(`✅ [WS-Notifications] Client connecté : ${client.userId}`);

      // Envoyer un message de confirmation
      client.send(
        JSON.stringify({
          type: "connected",
          message: "WebSocket notifications connecté avec succès",
          userId: client.userId,
        }),
      );

      // Gérer la fermeture
      client.on("close", () => {
        if (client.userId) {
          const userClients = this.clients.get(client.userId);
          if (userClients) {
            userClients.delete(client);
            if (userClients.size === 0) {
              this.clients.delete(client.userId);
            }
          }
          console.log(
            `👋 [WS-Notifications] Client déconnecté : ${client.userId}`,
          );
        }
      });
    } catch (error) {
      console.error("❌ [WS-Notifications] Token invalide:", error);
      client.close(4002, "Invalid token");
    }
  }

  /**
   * Gérer une nouvelle connexion WebSocket pour les messages
   */
  private async handleMessageConnection(
    ws: WebSocket,
    request: any,
  ): Promise<void> {
    const client = ws as AuthenticatedWebSocket;
    client.isAlive = true;
    client.messageCount = 0;
    client.messageCountResetTime = Date.now();

    // Vérifier le rate limiting par IP
    const ip = request.socket.remoteAddress || "unknown";
    const rateLimitCheck = canConnect(ip);

    if (!rateLimitCheck.allowed) {
      console.warn(
        `⚠️ [WS-Messages] Connexion refusée pour ${ip}: ${rateLimitCheck.reason}`,
      );
      client.close(4029, rateLimitCheck.reason);
      return;
    }

    // Heartbeat
    client.on("pong", () => {
      client.isAlive = true;
    });

    // Extraire le token et les paramètres du query string
    const query = url.parse(request.url, true).query;
    const token = query.token as string;
    const conversationId = query.conv as string;
    const userId = query.user as string;

    if (!token || !conversationId || !userId) {
      console.error(
        "❌ [WS-Messages] Connexion refusée : paramètres manquants (token, conv, user)",
      );
      client.close(4001, "Missing parameters");
      return;
    }

    try {
      // Vérifier le token JWT
      if (!process.env.JWT_SECRET) {
        console.error("❌ [SECURITY] JWT_SECRET non défini");
        throw new Error("Configuration de sécurité manquante");
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET) as {
        id: string;
        type?: string;
        jti?: string;
      };

      // WS-008: Vérifier que le token est bien de type 'websocket'
      if (decoded.type !== "websocket") {
        console.error(
          '❌ [WS-Messages] Token invalide: type attendu "websocket"',
        );
        client.close(4002, "Invalid token type");
        return;
      }

      // AUTH-004 CORRIGÉ: Vérifier que le token est à usage unique
      if (decoded.jti) {
        const isTokenValid = await redisSessionService.consumeWsToken(
          decoded.jti,
        );
        if (!isTokenValid) {
          console.error(
            `❌ [WS-Messages] Token déjà utilisé (jti: ${decoded.jti.substring(0, 8)}...)`,
          );
          client.close(4003, "Token already used");
          return;
        }
        console.log(
          `✅ [WS-Messages] Token à usage unique validé (jti: ${decoded.jti.substring(0, 8)}...)`,
        );
      }

      // Vérifier que l'userId du token correspond à celui de la requête
      if (decoded.id !== userId) {
        console.error("❌ [WS-Messages] Token/userId mismatch");
        client.close(4002, "Token mismatch");
        return;
      }

      client.userId = decoded.id;
      client.conversationId = conversationId;

      // WS-001: Vérifier que l'utilisateur est bien participant de la conversation
      // Note: participants est un tableau de sous-documents avec userId, pas de simples ObjectIds
      const conversation = await ConversationModel.findOne({
        _id: conversationId,
        "participants.userId": client.userId,
      }).lean();

      if (!conversation) {
        console.error(
          `❌ [WS-Messages] Accès refusé: ${client.userId} n'est pas participant de la conversation ${conversationId}`,
        );
        client.close(4003, "Not a participant");
        return;
      }

      // Ajouter le client à la map des messages (par conversation)
      if (!this.messageClients.has(client.userId)) {
        this.messageClients.set(client.userId, new Map());
      }
      const userConversations = this.messageClients.get(client.userId)!;
      if (!userConversations.has(conversationId)) {
        userConversations.set(conversationId, new Set());
      }
      userConversations.get(conversationId)!.add(client);

      console.log(
        `✅ [WS-Messages] Client connecté : ${client.userId} pour conversation ${conversationId}`,
      );

      // Envoyer un message de confirmation
      client.send(
        JSON.stringify({
          type: "connected",
          message: "WebSocket messages connecté avec succès",
          userId: client.userId,
          conversationId: conversationId,
        }),
      );

      // Gérer les messages entrants
      client.on("message", async (message: Buffer) => {
        try {
          // WS-003: Rate limiting par message
          const now = Date.now();
          if (
            now - (client.messageCountResetTime || 0) >
            MESSAGE_RATE_LIMIT_WINDOW_MS
          ) {
            client.messageCount = 0;
            client.messageCountResetTime = now;
          }

          client.messageCount = (client.messageCount || 0) + 1;

          if (client.messageCount > MAX_MESSAGES_PER_MINUTE) {
            console.warn(
              `⚠️ [WS-Messages] Rate limit atteint pour ${client.userId} (${client.messageCount} msg/min)`,
            );
            client.send(
              JSON.stringify({
                type: "error",
                code: "RATE_LIMIT_EXCEEDED",
                message: "Trop de messages envoyés. Veuillez ralentir.",
              }),
            );
            return;
          }

          // Limite de taille des messages (WS-005 préventif)
          const MAX_MESSAGE_SIZE = 64 * 1024; // 64KB
          if (message.length > MAX_MESSAGE_SIZE) {
            console.warn(
              `⚠️ [WS-Messages] Message trop volumineux de ${client.userId} (${message.length} bytes)`,
            );
            client.send(
              JSON.stringify({
                type: "error",
                code: "MESSAGE_TOO_LARGE",
                message: "Message trop volumineux",
              }),
            );
            return;
          }

          let data: any;
          try {
            data = JSON.parse(message.toString());
          } catch (parseError) {
            console.warn(`⚠️ [WS-Messages] JSON invalide de ${client.userId}`);
            client.send(
              JSON.stringify({
                type: "error",
                code: "INVALID_JSON",
                message: "Format JSON invalide",
              }),
            );
            return;
          }

          // WS-006: Validation de schéma - types de message autorisés
          const ALLOWED_MESSAGE_TYPES = [
            "message",
            "getMessages",
            "markMessageAsRead",
            "replyToMessage",
            "editMessage",
            "deleteMessage",
          ];
          if (
            !data ||
            typeof data !== "object" ||
            !data.type ||
            !ALLOWED_MESSAGE_TYPES.includes(data.type)
          ) {
            console.warn(
              `⚠️ [WS-Messages] Type de message invalide de ${client.userId}: ${data?.type}`,
            );
            client.send(
              JSON.stringify({
                type: "error",
                code: "INVALID_MESSAGE_TYPE",
                message: "Type de message non supporté",
              }),
            );
            return;
          }

          // WS-006: Validation des champs selon le type
          if (
            data.type === "message" &&
            (!data.content ||
              typeof data.content !== "string" ||
              data.content.length > 10000)
          ) {
            client.send(
              JSON.stringify({
                type: "error",
                code: "INVALID_CONTENT",
                message: "Contenu du message invalide ou trop long",
              }),
            );
            return;
          }

          // WS-001 CORRIGÉ: Vérification de participation à CHAQUE message
          // Cela empêche un utilisateur retiré d'une conversation de continuer à envoyer des messages
          const currentConversation = await ConversationModel.findOne({
            _id: conversationId,
            "participants.userId": client.userId,
          }).lean();

          if (!currentConversation) {
            console.warn(
              `⚠️ [WS-Messages] Accès révoqué: ${client.userId} n'est plus participant de ${conversationId}`,
            );
            client.send(
              JSON.stringify({
                type: "error",
                code: "ACCESS_REVOKED",
                message: "Vous n'êtes plus participant de cette conversation",
              }),
            );
            // Fermer la connexion car l'utilisateur n'a plus accès
            client.close(4003, "Access revoked");
            return;
          }

          console.log(
            `📩 [WS-Messages] Message reçu de ${client.userId} dans conversation ${conversationId}:`,
            data.type,
          );

          // Utilisation de toute la logique du messagesController
          if (data.type === "message") {
            // Envoi d'un message
            const fakeReq: any = {
              user: { id: client.userId },
              body: {
                conversationId: conversationId,
                content: data.content,
                type: data.messageType || "text",
                metadata: data.metadata || undefined,
              },
            };
            const fakeRes: any = {
              status: (code: number) => ({
                json: (obj: any) => {
                  if (code === 201 && obj.messageId) {
                    // Récupérer le message complet depuis la base
                    import("../models/messages").then(
                      async ({ default: Message }) => {
                        const fullMsg = await Message.findById(
                          obj.messageId,
                        ).lean();
                        if (
                          fullMsg &&
                          typeof fullMsg === "object" &&
                          "_id" in fullMsg
                        ) {
                          // S'assurer que le champ _id est bien présent et sous forme de string
                          (fullMsg as any)._id = String((fullMsg as any)._id);
                          // Déchiffrement du contenu avant envoi WebSocket
                          if (fullMsg.content) {
                            fullMsg.content = decryptCommunication(
                              fullMsg.content,
                            );
                          }
                          // Renommer le champ type du message pour éviter la collision
                          const messageType = fullMsg.type;
                          delete (fullMsg as any).type;
                          this.broadcastToConversation(conversationId, {
                            type: "new_message",
                            messageType: messageType,
                            ...fullMsg,
                          });
                        }
                      },
                    );
                  } else {
                    client.send(
                      JSON.stringify({ type: "error", details: obj }),
                    );
                  }
                },
              }),
            };
            await sendMessage(fakeReq, fakeRes);
          } else if (data.type === "getMessages") {
            // Récupération des messages
            const fakeReq: any = {
              user: { id: client.userId },
              params: { conversationId: conversationId },
              query: data.query || {},
            };
            const fakeRes: any = {
              status: (code: number) => ({
                json: (obj: any) => {
                  client.send(JSON.stringify({ type: "messages", ...obj }));
                },
              }),
            };
            await getMessages(fakeReq, fakeRes);
          } else if (data.type === "markMessageAsRead") {
            // Marquer un message comme lu
            const fakeReq: any = {
              user: { id: client.userId },
              body: {
                messageId: data.messageId,
                conversationId: conversationId,
              },
            };
            const fakeRes: any = {
              status: (code: number) => ({
                json: (obj: any) => {
                  client.send(JSON.stringify({ type: "message_read", ...obj }));
                },
              }),
            };
            await markMessageAsRead(fakeReq, fakeRes);
          } else if (data.type === "replyToMessage") {
            // Répondre à un message
            const fakeReq: any = {
              user: { id: client.userId },
              body: {
                conversationId: conversationId,
                messageId: data.messageId,
                content: data.content,
              },
            };
            const fakeRes: any = {
              status: (code: number) => ({
                json: (obj: any) => {
                  client.send(
                    JSON.stringify({ type: "message_reply", ...obj }),
                  );
                },
              }),
            };
            await replyToMessage(fakeReq, fakeRes);
          } else if (data.type === "editMessage") {
            // Modifier un message
            const fakeReq: any = {
              user: { id: client.userId },
              body: {
                messageId: data.messageId,
                content: data.content,
              },
            };
            const fakeRes: any = {
              status: (code: number) => ({
                json: (obj: any) => {
                  client.send(
                    JSON.stringify({ type: "message_edited", ...obj }),
                  );
                },
              }),
            };
            await editMessage(fakeReq, fakeRes);
          } else if (data.type === "deleteMessage") {
            // Supprimer un message
            const fakeReq: any = {
              user: { id: client.userId },
              body: {
                messageId: data.messageId,
              },
            };
            const fakeRes: any = {
              status: (code: number) => ({
                json: (obj: any) => {
                  client.send(
                    JSON.stringify({ type: "message_deleted", ...obj }),
                  );
                },
              }),
            };
            await deleteMessage(fakeReq, fakeRes);
          } else {
            client.send(
              JSON.stringify({
                type: "error",
                details: "Type de message non supporté",
              }),
            );
          }
        } catch (error) {
          console.error("[WS-Messages] Erreur parsing message:", error);
        }
      });

      // Gérer la fermeture
      client.on("close", () => {
        if (client.userId) {
          const userConversations = this.messageClients.get(client.userId);
          if (userConversations) {
            const conversationClients = userConversations.get(conversationId);
            if (conversationClients) {
              conversationClients.delete(client);
              if (conversationClients.size === 0) {
                userConversations.delete(conversationId);
              }
            }
            if (userConversations.size === 0) {
              this.messageClients.delete(client.userId);
            }
          }
          console.log(
            `👋 [WS-Messages] Client déconnecté : ${client.userId} de conversation ${conversationId}`,
          );
        }
      });
    } catch (error) {
      console.error("❌ [WS-Messages] Token invalide:", error);
      client.close(4002, "Invalid token");
    }
  }

  /**
   * Diffuser un message à tous les participants d'une conversation
   * WS-002: Ne diffuse qu'aux clients qui ont été validés comme participants
   * lors de leur connexion (voir WS-001 dans handleMessageConnection)
   */
  private broadcastToConversation(
    conversationId: string,
    message: any,
    excludeUserId?: string,
  ): void {
    let totalSent = 0;
    const notifiedUsers: string[] = [];

    this.messageClients.forEach((userConversations, userId) => {
      if (excludeUserId && userId === excludeUserId) return;

      const conversationClients = userConversations.get(conversationId);
      if (conversationClients) {
        conversationClients.forEach((client) => {
          // WS-002: Double vérification - le client doit avoir le bon conversationId
          if (
            client.readyState === WebSocket.OPEN &&
            client.conversationId === conversationId
          ) {
            client.send(JSON.stringify(message));
            totalSent++;
            notifiedUsers.push(userId);
            console.log(
              `📤 [WS-Messages] Message diffusé à userId=${userId} (conversation=${conversationId})`,
            );
          }
        });
      }
    });
    console.log(
      `📊 [WS-Messages] Message diffusé à ${totalSent} client(s) pour conversation ${conversationId}`,
    );

    // Notifier TOUS les participants de la conversation via le WebSocket de notifications
    // pour qu'ils puissent mettre à jour leur liste de conversations
    if (message.type === "new_message") {
      this.notifyConversationUpdate(conversationId, message, excludeUserId);
    }
  }

  /**
   * Notifier tous les participants d'une conversation qu'il y a eu une mise à jour
   * Utilisé pour mettre à jour la liste des conversations en temps réel
   */
  async notifyConversationUpdate(
    conversationId: string,
    message: any,
    excludeUserId?: string,
  ): Promise<void> {
    try {
      // Récupérer tous les participants de la conversation
      const Conversation = (await import("../models/conversations")).default;
      const conversation = await Conversation.findById(conversationId).lean();

      if (!conversation) return;

      const participantIds = conversation.participants
        .map((p: any) => p.userId.toString())
        .filter((id: string) => id !== excludeUserId);

      // Récupérer le nom d'affichage de l'expéditeur
      let senderName = "Un utilisateur";
      if (message.senderId) {
        try {
          const { decrypt } = await import("../utils/masterEncryptionUtils");
          const User = (await import("../models/users")).default;
          const sender = await User.findById(message.senderId)
            .select("name surname pseudo showPseudo")
            .lean();

          if (sender) {
            // Si showPseudo est activé et pseudo existe, utiliser le pseudo
            if ((sender as any).showPseudo && (sender as any).pseudo) {
              try {
                senderName = decrypt((sender as any).pseudo);
              } catch {
                // Fallback sur le prénom
                senderName = decrypt((sender as any).name);
              }
            } else {
              // Utiliser le prénom
              senderName = decrypt((sender as any).name);
            }
          }
        } catch (e) {
          console.error("[WS] Erreur récupération nom expéditeur:", e);
        }
      }

      // Envoyer une notification de mise à jour à chaque participant connecté au WS notifications
      // Note: On n'utilise PAS sendNotificationToUser car il ajoute type: 'notification'
      // qui serait écrasé par notre type: 'conversation_update'
      participantIds.forEach((userId: string) => {
        const userClients = this.clients.get(userId);

        if (!userClients || userClients.size === 0) {
          console.log(
            `⚠️ [WS] Aucun client connecté pour l'utilisateur ${userId}`,
          );
          return;
        }

        const updateMessage = JSON.stringify({
          type: "conversation_update",
          conversationId,
          lastMessage: message.content,
          senderId: message.senderId,
          senderName: senderName,
          createdAt: message.createdAt,
          incrementUnread: userId !== message.senderId,
        });

        userClients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(updateMessage);
            console.log(`📤 [WS] conversation_update envoyée à ${userId}`);
          }
        });
      });

      console.log(
        `📊 [WS-Notifications] Mise à jour conversation ${conversationId} envoyée à ${participantIds.length} participant(s)`,
      );
    } catch (error) {
      console.error(
        "[WS-Notifications] Erreur lors de la notification de mise à jour:",
        error,
      );
    }
  }

  /**
   * Envoyer un message à un utilisateur dans une conversation spécifique
   */
  sendMessageToUserInConversation(
    userId: string,
    conversationId: string,
    message: any,
  ): void {
    const userConversations = this.messageClients.get(userId);
    if (!userConversations) {
      console.log(`⚠️ [WS-Messages] Utilisateur ${userId} non connecté`);
      return;
    }

    const conversationClients = userConversations.get(conversationId);
    if (!conversationClients || conversationClients.size === 0) {
      console.log(
        `⚠️ [WS-Messages] Utilisateur ${userId} non connecté à la conversation ${conversationId}`,
      );
      return;
    }

    const messageStr = JSON.stringify({
      type: "message",
      ...message,
    });

    conversationClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageStr);
        console.log(
          `📤 [WS-Messages] Message envoyé à ${userId} dans conversation ${conversationId}`,
        );
      }
    });
  }

  /**
   * Envoyer une notification à un utilisateur spécifique
   */
  sendNotificationToUser(userId: string, notification: any): void {
    const userClients = this.clients.get(userId);

    if (!userClients || userClients.size === 0) {
      console.log(`⚠️ [WS] Aucun client connecté pour l'utilisateur ${userId}`);
      return;
    }

    const message = JSON.stringify({
      type: "notification",
      ...notification,
    });

    userClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
        console.log(`📤 [WS] Notification envoyée à ${userId}`);
      }
    });
  }

  /**
   * Envoyer une notification à plusieurs utilisateurs
   */
  sendNotificationToUsers(userIds: string[], notification: any): void {
    userIds.forEach((userId) => {
      this.sendNotificationToUser(userId, notification);
    });
  }

  /**
   * Notifier qu'une notification a été lue
   */
  notifyNotificationRead(userId: string, notificationId: string): void {
    this.sendNotificationToUser(userId, {
      type: "notification_read",
      notificationId,
    });
  }

  /**
   * Notifier que des messages ont été lus dans une conversation
   * @param conversationId - ID de la conversation
   * @param readByUserId - ID de l'utilisateur qui a lu les messages
   * @param messageIds - IDs des messages lus
   * @param participantUserIds - IDs des participants à notifier
   */
  notifyMessagesRead(
    conversationId: string,
    readByUserId: string,
    messageIds: string[],
    participantUserIds: string[],
  ): void {
    console.log(
      `👁️ [WS] Notifying messages read in ${conversationId} by ${readByUserId}`,
    );

    const message = JSON.stringify({
      type: "message_read",
      conversationId,
      userId: readByUserId,
      messageIds,
    });

    // Envoyer à tous les autres participants
    for (const userId of participantUserIds) {
      if (userId === readByUserId) continue; // Ne pas notifier l'utilisateur qui a lu

      const userClients = this.clients.get(userId);
      if (!userClients || userClients.size === 0) continue;

      userClients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
          console.log(`📤 [WS] message_read envoyé à ${userId}`);
        }
      });
    }
  }

  /**
   * Obtenir le nombre de clients connectés (notifications + messages)
   */
  getConnectedClientsCount(): number {
    const notificationCount = this.notificationsWss?.clients.size || 0;
    const messageCount = this.messagesWss?.clients.size || 0;
    return notificationCount + messageCount;
  }

  /**
   * Obtenir le nombre d'utilisateurs connectés (notifications)
   */
  getConnectedUsersCount(): number {
    return this.clients.size;
  }

  /**
   * Vérifier si un utilisateur est connecté
   */
  isUserConnected(userId: string): boolean {
    const userClients = this.clients.get(userId);
    return userClients !== undefined && userClients.size > 0;
  }

  /**
   * Vérifier si un utilisateur est connecté à une conversation spécifique (WebSocket messages)
   */
  isUserConnectedToConversation(
    userId: string,
    conversationId: string,
  ): boolean {
    const userConversations = this.messageClients.get(userId);
    if (!userConversations) {
      console.log(
        `🔍 [WS] isUserConnectedToConversation(${userId}, ${conversationId}): false (pas de conversations)`,
      );
      return false;
    }

    const conversationClients = userConversations.get(conversationId);
    if (!conversationClients || conversationClients.size === 0) {
      console.log(
        `🔍 [WS] isUserConnectedToConversation(${userId}, ${conversationId}): false (pas de clients pour cette conv)`,
      );
      return false;
    }

    // Vérifier qu'au moins un client est vraiment connecté
    let openCount = 0;
    for (const client of conversationClients) {
      if (client.readyState === WebSocket.OPEN) {
        openCount++;
      }
    }

    const isConnected = openCount > 0;
    console.log(
      `🔍 [WS] isUserConnectedToConversation(${userId}, ${conversationId}): ${isConnected} (${openCount} clients ouverts sur ${conversationClients.size})`,
    );
    return isConnected;
  }

  /**
   * Notifier les utilisateurs d'une nouvelle conversation créée
   * @param participantIds - IDs des participants à notifier
   * @param conversation - Données de la conversation
   * @param creatorId - ID du créateur (ne sera pas notifié)
   */
  notifyNewConversation(
    participantIds: string[],
    conversation: any,
    creatorId: string,
  ): void {
    console.log(
      `📬 [WS] Notification nouvelle conversation ${conversation._id} aux participants`,
    );

    const message = JSON.stringify({
      type: "new_conversation",
      conversation: {
        _id: conversation._id,
        name: conversation.name,
        isGroup: conversation.isGroup,
        creatorId: conversation.creatorId,
        participants: conversation.participants,
        lastMessage: conversation.lastMessage,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      },
    });

    for (const userId of participantIds) {
      // Ne pas notifier le créateur (il a déjà la conversation)
      if (userId === creatorId) continue;

      const userClients = this.clients.get(userId);
      if (!userClients || userClients.size === 0) {
        console.log(
          `⚠️ [WS] Utilisateur ${userId} non connecté pour new_conversation`,
        );
        continue;
      }

      userClients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
          console.log(`📤 [WS] new_conversation envoyé à ${userId}`);
        }
      });
    }
  }

  /**
   * Notifier les participants qu'un groupe a été supprimé
   * @param conversationId - ID du groupe supprimé
   * @param participantIds - IDs des participants à notifier
   * @param deletedByUserId - ID de l'admin qui a supprimé (ne sera pas notifié)
   */
  notifyGroupDeleted(
    conversationId: string,
    participantIds: string[],
    deletedByUserId: string,
  ): void {
    console.log(
      `🗑️ [WS] Notification suppression groupe ${conversationId} aux participants`,
    );

    const message = JSON.stringify({
      type: "group_deleted",
      conversationId,
    });

    for (const odId of participantIds) {
      // Ne pas notifier celui qui a supprimé
      if (odId === deletedByUserId) continue;

      const userClients = this.clients.get(odId);
      if (!userClients || userClients.size === 0) continue;

      userClients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
          console.log(`📤 [WS] group_deleted envoyé à ${odId}`);
        }
      });
    }
  }

  /**
   * Notifier les participants d'une mise à jour du groupe (membres, rôles, nom)
   * @param conversationId - ID du groupe
   * @param participantIds - IDs des participants à notifier
   * @param updateType - Type de mise à jour ('member_added', 'member_removed', 'role_changed', 'name_changed')
   * @param data - Données de la mise à jour
   */
  notifyGroupUpdate(
    conversationId: string,
    participantIds: string[],
    updateType: string,
    data: any,
  ): void {
    console.log(
      `🔄 [WS] Notification mise à jour groupe ${conversationId}: ${updateType}`,
    );

    const message = JSON.stringify({
      type: "group_update",
      conversationId,
      updateType,
      ...data,
    });

    for (const odId of participantIds) {
      const userClients = this.clients.get(odId);
      if (!userClients || userClients.size === 0) continue;

      userClients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
          console.log(`📤 [WS] group_update (${updateType}) envoyé à ${odId}`);
        }
      });
    }
  }

  /**
   * Notifier un membre qu'il a été retiré d'un groupe
   * Le groupe disparaîtra immédiatement de son écran
   * RÉVOCATION TEMPS RÉEL: Ferme aussi les connexions WebSocket messages pour cette conversation
   * @param conversationId - ID du groupe
   * @param removedUserId - ID de l'utilisateur retiré
   */
  notifyMemberRemoved(conversationId: string, removedUserId: string): void {
    console.log(
      `👋 [WS] Notification membre retiré: ${removedUserId} du groupe ${conversationId}`,
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // RÉVOCATION TEMPS RÉEL: Fermer les connexions WebSocket messages pour cette conversation
    // ═══════════════════════════════════════════════════════════════════════════
    const userMessageConversations = this.messageClients.get(removedUserId);
    if (userMessageConversations) {
      const conversationClients = userMessageConversations.get(conversationId);
      if (conversationClients) {
        conversationClients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            // Envoyer un message d'erreur avant de fermer
            client.send(
              JSON.stringify({
                type: "error",
                code: "ACCESS_REVOKED",
                message: "Vous avez été retiré de cette conversation",
              }),
            );
            // Fermer la connexion avec le code 4003 (Access revoked)
            client.close(4003, "Access revoked - removed from conversation");
            console.log(
              `🔒 [WS] Connexion messages fermée pour ${removedUserId} (conversation ${conversationId})`,
            );
          }
        });
        // Nettoyer la map
        userMessageConversations.delete(conversationId);
        if (userMessageConversations.size === 0) {
          this.messageClients.delete(removedUserId);
        }
      }
    }

    // Envoyer la notification via WebSocket notifications
    const userClients = this.clients.get(removedUserId);
    if (!userClients || userClients.size === 0) {
      console.log(
        `⚠️ [WS] Utilisateur ${removedUserId} non connecté pour member_removed`,
      );
      return;
    }

    const message = JSON.stringify({
      type: "member_removed",
      conversationId,
    });

    userClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
        console.log(`📤 [WS] member_removed envoyé à ${removedUserId}`);
      }
    });
  }

  /**
   * Notifier tous les participants qu'un groupe a changé de nom
   * @param conversationId - ID du groupe
   * @param newName - Nouveau nom du groupe
   * @param participantIds - IDs des participants à notifier
   */
  notifyGroupNameChanged(
    conversationId: string,
    newName: string,
    participantIds: string[],
  ): void {
    console.log(
      `✏️ [WS] Notification changement de nom groupe ${conversationId}: "${newName}"`,
    );

    const message = JSON.stringify({
      type: "group_name_changed",
      conversationId,
      newName,
    });

    for (const odId of participantIds) {
      const userClients = this.clients.get(odId);
      if (!userClients || userClients.size === 0) continue;

      userClients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
          console.log(`📤 [WS] group_name_changed envoyé à ${odId}`);
        }
      });
    }
  }
}

// Export d'une instance singleton
export const webSocketService = new WebSocketService();
