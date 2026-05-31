// ═══════════════════════════════════════════════════════════════════════════
// SERVICE SOS MODE
// ═══════════════════════════════════════════════════════════════════════════
// Logique métier principale du Mode SOS
// Gestion des sessions, heartbeats, escalade et résolution
// ═══════════════════════════════════════════════════════════════════════════

import mongoose from "mongoose";
import SosSessionModel, {
  ISosSession,
  ISosParticipant,
  SosParticipantStatus,
} from "../models/sosSession";
import SosContactModel, { ISosContact } from "../models/sosContact";
import SosEventModel, { SosEventType } from "../models/sosEvent";
import { vonageService } from "./vonageService";
import { createNotification } from "./notificationService";
import { webSocketService } from "./webSocketService";
import { auditService } from "./auditService";
import { notifyAllAdmins } from "./adminNotificationService";
import { decrypt } from "../utils/masterEncryptionUtils";
import UserModel from "../models/users";
import { logger } from "./loggerService";
import { sendEmail } from "./emailService";
import RedisConnectionPool from "../config/redisPool";
import type Redis from "ioredis";
import type { Cluster } from "ioredis";

// Create child logger for sos service
const sosLogger = logger.child({ service: "sos" });

// Always serialize via serializeUserForApi before returning user data
// Helper interne : déchiffre un champ utilisateur populé en tolérant les cas où
// `userId` n'a PAS été populé (ObjectId brut) ou où le champ est absent.
// Évite que `decrypt(session.userId.name)` crash quand le populate manque.
function safeDecryptUserField(
  populatedUser: unknown,
  field: "name" | "surname" | "email",
): string | null {
  if (!populatedUser || typeof populatedUser !== "object") {
    return null;
  }
  const value = (populatedUser as Record<string, unknown>)[field];
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  // Format AES-256-GCM : iv:authTag:encrypted
  if (value.split(":").length !== 3) {
    return value;
  }
  try {
    return decrypt(value);
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 1 BROADCAST THROTTLE (1 push par session / 30 min)
// ═══════════════════════════════════════════════════════════════════════════
// Empêche un re-broadcast lors d'une re-escalade de la même session SOS.
// Storage : Redis (clé `sos:stage1:{sessionId}`). Fallback in-memory.
// ═══════════════════════════════════════════════════════════════════════════

const SOS_STAGE1_THROTTLE_TTL_SECONDS = 30 * 60; // 30 min

interface Stage1ThrottleStore {
  setIfAbsent(sessionId: string, ttlSeconds: number): Promise<boolean>;
}

class RedisStage1ThrottleStore implements Stage1ThrottleStore {
  constructor(private client: Redis | Cluster) {}
  async setIfAbsent(sessionId: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(
      `sos:stage1:${sessionId}`,
      "1",
      "EX",
      ttlSeconds,
      "NX",
    );
    return result === "OK";
  }
}

class InMemoryStage1ThrottleStore implements Stage1ThrottleStore {
  private map = new Map<string, NodeJS.Timeout>();
  async setIfAbsent(sessionId: string, ttlSeconds: number): Promise<boolean> {
    if (this.map.has(sessionId)) return false;
    const timer = setTimeout(() => {
      this.map.delete(sessionId);
    }, ttlSeconds * 1000);
    if (typeof timer.unref === "function") timer.unref();
    this.map.set(sessionId, timer);
    return true;
  }
}

let stage1ThrottleStore: Stage1ThrottleStore | null = null;

function getStage1ThrottleStore(): Stage1ThrottleStore {
  if (stage1ThrottleStore) return stage1ThrottleStore;
  try {
    stage1ThrottleStore = new RedisStage1ThrottleStore(
      RedisConnectionPool.getPublisher(),
    );
    sosLogger.debug("[stage1-throttle] Store: Redis");
  } catch {
    stage1ThrottleStore = new InMemoryStage1ThrottleStore();
    sosLogger.warn(
      "[stage1-throttle] Redis indisponible — fallback in-memory (non partagé entre instances)",
    );
  }
  return stage1ThrottleStore;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════════════════════

const HEARTBEAT_EXTENSION_MINUTES = 15; // Prolongation par heartbeat
const STAGE_1_DELAY_MINUTES = 60; // Délai avant stage 1 (après expiration) — 1h
const STAGE_2_DELAY_MINUTES = 120; // Délai avant stage 2 (après expiration) — 2h
const MIN_DURATION_MINUTES = 1; // Durée minimale
const MAX_DURATION_MINUTES = 480; // Durée maximale (8h)

// Détection de surface et reconnexion
const SURFACE_DISTANCE_THRESHOLD_METERS = 200; // Seuil de déplacement pour suggestion surface
const RECONNECTION_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes de connexion stable
const MIN_HEARTBEATS_FOR_RECONNECTION = 5; // Minimum de heartbeats pour considérer une reconnexion

// ═══════════════════════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════════════════════

interface SessionContactOverride {
  permanentContactIds?: string[]; // IDs des contacts permanents à utiliser
  additionalContacts?: Array<{
    // Contacts supplémentaires temporaires
    name: string;
    phone: string;
    relationship?: string;
  }>;
}

interface ActivateSessionParams {
  userId: string;
  expectedDuration: number; // En minutes
  note?: string;
  lat?: number;
  lng?: number;
  accuracy?: number;
  siteName?: string;
  zone?: string;
  depth?: number;
  sessionContacts?: SessionContactOverride; // Override des contacts pour cette session
  participantIds?: string[]; // Array of user IDs to add as participants (group session)
}

interface HeartbeatParams {
  userId: string;
  sessionId?: string; // Optionnel, prend la session active si absent
  lat?: number;
  lng?: number;
  accuracy?: number;
}

interface ExtendParams {
  userId: string;
  sessionId?: string;
  additionalMinutes: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════════════════

class SosService {
  // ─── UTILITAIRES PRIVÉS ────────────────────────────────────────────

  /**
   * Calculer la distance entre deux points GPS (formule de Haversine)
   * Retourne la distance en mètres
   */
  private calculateDistance(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): number {
    const R = 6371e3; // Rayon de la terre en mètres
    const toRad = (deg: number) => deg * (Math.PI / 180);
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Envoyer une notification SOS critique avec retry
   * SAFETY-CRITICAL: Pour les notifications d'escalade SOS
   * Retry 3 fois avec délai de 2 secondes entre chaque tentative
   * @returns true si au moins une tentative a réussi, false si toutes ont échoué
   */
  private async sendSosNotificationWithRetry(params: {
    userId: string;
    title: string;
    message: string;
    type: string;
    data: any;
    maxRetries?: number;
  }): Promise<boolean> {
    const { userId, title, message, type, data, maxRetries = 3 } = params;
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const sessionId = data.sosSessionId?.toString() || "unknown";

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await createNotification(
          userObjectId,
          type as any,
          title,
          message,
          data,
        );

        sosLogger.info("SOS notification sent successfully", {
          userId,
          sessionId,
          attempt,
          type,
        });

        return true;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        sosLogger.warn(
          `[SOS-CRITICAL] Failed to send escalation notification (attempt ${attempt}/${maxRetries})`,
          {
            userId,
            sessionId,
            attempt,
            type,
            error: lastError.message,
          },
        );

        // Attendre 2 secondes avant de réessayer (sauf pour la dernière tentative)
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    }

    // Toutes les tentatives ont échoué
    sosLogger.error(
      `[SOS-CRITICAL] All notification attempts failed after ${maxRetries} retries`,
      {
        userId,
        sessionId,
        type,
        title,
        error: lastError?.message || "Unknown error",
      },
    );

    return false;
  }

  /**
   * Sanitiser un contact pour l'admin
   * Admin : accès complet aux données des contacts d'urgence
   * Le numéro de téléphone est nécessaire pour contacter les proches en cas d'urgence réelle
   */
  private sanitizeContactForAdmin(contact: any): any {
    // Admin : accès complet aux données des contacts d'urgence
    // Le numéro de téléphone est nécessaire pour contacter les proches en cas d'urgence réelle
    return contact;
  }

  /**
   * Envoyer une notification WebSocket avec gestion d'erreur
   * SAFETY-CRITICAL: Pour les notifications d'escalade SOS
   * Ne lève pas d'exception - log uniquement
   */
  private sendSosWebSocketNotification(
    userId: string,
    notification: any,
    context: { sessionId: string; stage: number },
  ): void {
    try {
      webSocketService.sendNotificationToUser(userId, notification);

      sosLogger.info("SOS WebSocket notification sent", {
        userId,
        sessionId: context.sessionId,
        stage: context.stage,
        notificationType: notification.type,
      });
    } catch (error) {
      sosLogger.error(`[SOS-CRITICAL] Failed to send WebSocket notification`, {
        userId,
        sessionId: context.sessionId,
        stage: context.stage,
        notificationType: notification.type,
        error: error instanceof Error ? error.message : String(error),
      });
      // Ne pas lever l'exception - l'escalade doit continuer
    }
  }

  // ─── ACTIVATION ────────────────────────────────────────────────────

  /**
   * Activer une nouvelle session SOS
   * L'utilisateur DOIT avoir une connexion réseau (avant d'aller sous terre)
   * Support des sessions de groupe avec participantIds
   */
  async activateSession(params: ActivateSessionParams): Promise<ISosSession> {
    const {
      userId,
      expectedDuration,
      note,
      lat,
      lng,
      accuracy,
      siteName,
      zone,
      depth,
      sessionContacts,
      participantIds,
    } = params;
    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Collecter tous les IDs de participants (créateur + participants ajoutés)
    const allParticipantIds = [userId];
    if (participantIds && participantIds.length > 0) {
      allParticipantIds.push(...participantIds);
    }

    // Vérifier qu'aucun des participants n'a déjà une session active
    const participantObjectIds = allParticipantIds.map(
      (id) => new mongoose.Types.ObjectId(id),
    );

    // Valider la durée avant d'ouvrir la transaction
    if (
      expectedDuration < MIN_DURATION_MINUTES ||
      expectedDuration > MAX_DURATION_MINUTES
    ) {
      throw new Error("INVALID_DURATION");
    }

    // Gérer les contacts de session (override) — validation hors transaction
    let useDefaultContacts = true;
    const sessionContactIds: mongoose.Types.ObjectId[] = [];

    if (sessionContacts) {
      useDefaultContacts = false;

      // Valider qu'au moins un contact sera alerté
      const hasPermanentContacts =
        sessionContacts.permanentContactIds &&
        sessionContacts.permanentContactIds.length > 0;
      const hasAdditionalContacts =
        sessionContacts.additionalContacts &&
        sessionContacts.additionalContacts.length > 0;

      if (!hasPermanentContacts && !hasAdditionalContacts) {
        throw new Error("NO_EMERGENCY_CONTACTS");
      }

      // Valider les contacts supplémentaires temporaires
      if (hasAdditionalContacts) {
        for (const additionalContact of sessionContacts.additionalContacts ||
          []) {
          // Validation format téléphone
          if (!/^\+[1-9]\d{6,14}$/.test(additionalContact.phone)) {
            throw new Error("INVALID_PHONE_FORMAT");
          }
        }
      }
    }

    // Transaction : vérification session existante + création session + contacts temporaires
    const mongoSession = await mongoose.startSession();
    mongoSession.startTransaction();
    let session: InstanceType<typeof SosSessionModel>;
    let expiresAt: Date;
    let participants: ISosParticipant[];
    try {
      // Vérifier qu'aucun participant n'a déjà une session active (dans la transaction)
      const existingSessions = await SosSessionModel.find({
        status: { $in: ["ACTIVE", "EXPIRED", "ESCALATING"] },
        participants: {
          $elemMatch: {
            userId: { $in: participantObjectIds },
            status: { $ne: "LEFT" },
          },
        },
      })
        .lean()
        .session(mongoSession);

      if (existingSessions.length > 0) {
        throw new Error("SESSION_ALREADY_ACTIVE");
      }

      // Vérifier que les participants existent dans la base de données
      if (participantIds && participantIds.length > 0) {
        const participantUsers = await UserModel.find({
          _id: {
            $in: participantIds.map((id) => new mongoose.Types.ObjectId(id)),
          },
        })
          .select("_id")
          .lean()
          .session(mongoSession);

        if (participantUsers.length !== participantIds.length) {
          throw new Error("INVALID_PARTICIPANT_IDS");
        }
      }

      if (sessionContacts) {
        const hasPermanentContacts =
          sessionContacts.permanentContactIds &&
          sessionContacts.permanentContactIds.length > 0;

        // Ajouter les contacts permanents sélectionnés
        if (hasPermanentContacts) {
          // Vérifier que les contacts permanents existent et appartiennent à l'utilisateur
          const permanentContacts = await SosContactModel.find({
            _id: {
              $in: (sessionContacts.permanentContactIds || []).map(
                (id) => new mongoose.Types.ObjectId(id),
              ),
            },
            userId: userObjectId,
            sessionId: { $exists: false }, // Uniquement les contacts permanents
            deletedAt: null, // Exclure les contacts soft-deleted
          })
            .select("_id")
            .lean()
            .session(mongoSession);

          if (
            permanentContacts.length !==
            (sessionContacts.permanentContactIds || []).length
          ) {
            throw new Error("INVALID_CONTACT_IDS");
          }

          sessionContactIds.push(
            ...permanentContacts.map((c) => c._id as mongoose.Types.ObjectId),
          );
        }
      } else {
        // Mode par défaut : vérifier qu'au moins UN participant a des contacts d'urgence
        let hasEmergencyContacts = false;

        for (const participantId of allParticipantIds) {
          const contactCount = await SosContactModel.countDocuments({
            userId: new mongoose.Types.ObjectId(participantId),
            sessionId: { $exists: false },
            deletedAt: null, // Exclure les contacts soft-deleted
          }).session(mongoSession);
          if (contactCount > 0) {
            hasEmergencyContacts = true;
            break;
          }
        }

        if (!hasEmergencyContacts) {
          throw new Error("NO_EMERGENCY_CONTACTS");
        }
      }

      // Calculer la date d'expiration
      const now = new Date();
      expiresAt = new Date(now.getTime() + expectedDuration * 60 * 1000);

      // Créer les participants
      participants = allParticipantIds.map((participantId) => ({
        userId: new mongoose.Types.ObjectId(participantId),
        joinedAt: now,
        leftAt: null,
        status: "ACTIVE" as SosParticipantStatus,
        currentStage: -1,
        stage0TriggeredAt: null,
        stage1TriggeredAt: null,
        stage2TriggeredAt: null,
        lastHeartbeatAt: null,
        lastKnownLat: lat,
        lastKnownLng: lng,
        lastKnownAccuracy: accuracy,
        consecutiveHeartbeats: 0,
        firstReconnectionAt: null,
        surfaceDetectionSent: false,
        reconnectionDetectionSent: false,
      }));

      // Créer la session
      session = new SosSessionModel({
        userId: userObjectId,
        status: "ACTIVE",
        currentStage: -1,
        activatedAt: now,
        expectedDuration,
        expiresAt,
        lastKnownLat: lat,
        lastKnownLng: lng,
        lastKnownAccuracy: accuracy,
        entryLat: lat,
        entryLng: lng,
        note,
        siteName,
        zone,
        depth,
        heartbeatCount: 0,
        extensionCount: 0,
        consecutiveHeartbeats: 0,
        surfaceDetectionSent: false,
        reconnectionDetectionSent: false,
        useDefaultContacts,
        sessionContactIds:
          sessionContactIds.length > 0 ? sessionContactIds : undefined,
        participants,
      });
      await session.save({ session: mongoSession });

      // Créer les contacts supplémentaires temporaires maintenant qu'on a un sessionId
      if (
        sessionContacts?.additionalContacts &&
        sessionContacts.additionalContacts.length > 0
      ) {
        for (const additionalContact of sessionContacts.additionalContacts) {
          const tempContact = new SosContactModel({
            userId: userObjectId,
            sessionId: session._id,
            name: additionalContact.name,
            phone: additionalContact.phone,
            relationship: additionalContact.relationship,
            isDefault: false,
          });

          await tempContact.save({ session: mongoSession });
          sessionContactIds.push(tempContact._id as mongoose.Types.ObjectId);
        }

        // Mettre à jour la session avec tous les IDs de contacts
        session.sessionContactIds = sessionContactIds;
        await session.save({ session: mongoSession });
      }

      await mongoSession.commitTransaction();
    } catch (err) {
      await mongoSession.abortTransaction();
      throw err;
    } finally {
      mongoSession.endSession();
    }

    // Récupérer le nom du créateur pour les notifications
    const creator = await UserModel.findById(userObjectId).lean();
    const creatorName = creator ? decrypt(creator.name) : "Un utilisateur";

    // Notifier les participants ajoutés (tous sauf le créateur)
    if (participantIds && participantIds.length > 0) {
      for (const participantId of participantIds) {
        try {
          // Push notification
          await createNotification(
            new mongoose.Types.ObjectId(participantId),
            "sos_alert",
            "🆘 Tu as été ajouté à une session SOS",
            `${creatorName} t'a ajouté à une session SOS de groupe.`,
            {
              sosSessionId: session._id,
            },
          );

          // WebSocket notification
          webSocketService.sendNotificationToUser(participantId, {
            type: "sos_participant_added",
            sessionId: (session._id as mongoose.Types.ObjectId).toString(),
            creatorName,
            creatorId: userId,
            message: `Tu as été ajouté à une session SOS par ${creatorName}`,
          });

          // Logger l'événement
          await this.logEvent(
            session._id as mongoose.Types.ObjectId,
            participantId,
            "PARTICIPANT_ADDED",
            {
              addedBy: userId,
              creatorName,
            },
          );

          sosLogger.info("Participant added to SOS session", {
            participantId,
            sessionId: session._id?.toString(),
            addedBy: userId,
          });
        } catch (error) {
          sosLogger.error("Failed to notify participant", {
            participantId,
            sessionId: session._id?.toString(),
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    // Logger l'événement
    await this.logEvent(
      session._id as mongoose.Types.ObjectId,
      userId,
      "ACTIVATED",
      {
        expectedDuration,
        expiresAt,
        useDefaultContacts,
        contactCount: sessionContactIds.length || undefined,
      },
    );

    // Audit
    await auditService.log({
      userId,
      action: "SOS_SESSION_ACTIVATED",
      level: "info",
      details: {
        sessionId: session._id,
        expectedDuration,
        expiresAt,
        useDefaultContacts,
      },
    });

    sosLogger.info("SOS session activated", {
      userId,
      sessionId: session._id?.toString(),
      expectedDuration,
      expiresAt,
      useDefaultContacts,
      contactCount: sessionContactIds.length || undefined,
      participantCount: participants.length,
    });

    return session;
  }

  // ─── HEARTBEAT ─────────────────────────────────────────────────────

  /**
   * Recevoir un signe de vie (heartbeat)
   * Prolonge le timer de +15 minutes
   * Support des sessions de groupe - met à jour uniquement le participant appelant
   */
  async heartbeat(params: HeartbeatParams): Promise<ISosSession> {
    const { userId, sessionId, lat, lng, accuracy } = params;
    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Trouver la session active où l'utilisateur est participant
    const session = sessionId
      ? await SosSessionModel.findOne({
          _id: new mongoose.Types.ObjectId(sessionId),
          status: { $in: ["ACTIVE", "EXPIRED", "ESCALATING"] },
          participants: {
            $elemMatch: {
              userId: userObjectId,
              status: { $ne: "LEFT" },
            },
          },
        })
      : await SosSessionModel.findOne({
          status: { $in: ["ACTIVE", "EXPIRED", "ESCALATING"] },
          participants: {
            $elemMatch: {
              userId: userObjectId,
              status: { $ne: "LEFT" },
            },
          },
        });

    if (!session) {
      throw new Error("NO_ACTIVE_SESSION");
    }

    // Trouver le participant dans le tableau
    const participant = session.participants.find(
      (p) => p.userId.toString() === userId && p.status !== "LEFT",
    );

    if (!participant) {
      throw new Error("NO_ACTIVE_SESSION");
    }

    const now = new Date();

    // Mettre à jour les données du participant
    participant.lastHeartbeatAt = now;
    if (lat !== undefined) participant.lastKnownLat = lat;
    if (lng !== undefined) participant.lastKnownLng = lng;
    if (accuracy !== undefined) participant.lastKnownAccuracy = accuracy;

    // Si le participant était en escalade, le remettre en ACTIVE
    if (
      participant.status === "ESCALATING" ||
      participant.status === "DISCONNECTED"
    ) {
      participant.status = "ACTIVE";
      participant.currentStage = -1;
      sosLogger.info("Participant reactivated after heartbeat", {
        userId,
        sessionId: session._id?.toString(),
      });
    }

    // ─── DÉTECTION GPS DE SURFACE (par participant) ───
    if (
      lat !== undefined &&
      lng !== undefined &&
      session.entryLat &&
      session.entryLng &&
      !participant.surfaceDetectionSent
    ) {
      const distance = this.calculateDistance(
        session.entryLat,
        session.entryLng,
        lat,
        lng,
      );
      if (distance > SURFACE_DISTANCE_THRESHOLD_METERS) {
        participant.surfaceDetectionSent = true;

        // Envoyer suggestion via WebSocket + push
        webSocketService.sendNotificationToUser(userId, {
          type: "sos_surface_detected",
          sessionId: (session._id as mongoose.Types.ObjectId).toString(),
          message:
            "Tu sembles t'être déplacé significativement. Es-tu en surface ?",
          distance: Math.round(distance),
        });

        // Push notification
        try {
          await createNotification(
            new mongoose.Types.ObjectId(userId),
            "sos_surface_detected",
            "Déplacement détecté",
            "Tu sembles t'être déplacé significativement. Es-tu en surface ?",
            {
              sosSessionId: session._id as mongoose.Types.ObjectId,
            },
          );
        } catch (error) {
          sosLogger.error("Failed to send surface detection notification", {
            userId,
            sessionId: session._id?.toString(),
            error: error instanceof Error ? error.message : String(error),
          });
        }

        await this.logEvent(
          session._id as mongoose.Types.ObjectId,
          userId,
          "SURFACE_DETECTED",
          {
            distance: Math.round(distance),
            entryLat: session.entryLat,
            entryLng: session.entryLng,
            currentLat: lat,
            currentLng: lng,
          },
        );

        sosLogger.info("Surface detected for participant", {
          userId,
          sessionId: session._id?.toString(),
          distance: Math.round(distance),
        });
      }
    }

    // ─── DÉTECTION DE RECONNEXION PROLONGÉE (par participant) ───
    participant.consecutiveHeartbeats += 1;

    if (!participant.firstReconnectionAt) {
      participant.firstReconnectionAt = now;
    }

    if (!participant.reconnectionDetectionSent) {
      const timeSinceFirstReconnection =
        now.getTime() - participant.firstReconnectionAt.getTime();
      if (
        timeSinceFirstReconnection >= RECONNECTION_THRESHOLD_MS &&
        participant.consecutiveHeartbeats >= MIN_HEARTBEATS_FOR_RECONNECTION
      ) {
        participant.reconnectionDetectionSent = true;

        webSocketService.sendNotificationToUser(userId, {
          type: "sos_reconnection_detected",
          sessionId: (session._id as mongoose.Types.ObjectId).toString(),
          message:
            "Tu sembles avoir une connexion stable depuis plus de 5 minutes. Désactiver le Mode SOS ?",
          connectedSince: participant.firstReconnectionAt,
          heartbeatCount: participant.consecutiveHeartbeats,
        });

        // Push notification
        try {
          await createNotification(
            new mongoose.Types.ObjectId(userId),
            "sos_reconnection_detected",
            "Connexion stable détectée",
            "Tu sembles avoir une connexion stable depuis plus de 5 minutes. Désactiver le Mode SOS ?",
            {
              sosSessionId: session._id as mongoose.Types.ObjectId,
            },
          );
        } catch (error) {
          sosLogger.error(
            "Failed to send reconnection detection notification",
            {
              userId,
              sessionId: session._id?.toString(),
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }

        await this.logEvent(
          session._id as mongoose.Types.ObjectId,
          userId,
          "RECONNECTION_DETECTED",
          {
            connectedSince: participant.firstReconnectionAt,
            consecutiveHeartbeats: participant.consecutiveHeartbeats,
          },
        );

        sosLogger.info("Reconnection detected for participant", {
          userId,
          sessionId: session._id?.toString(),
          connectedSince: participant.firstReconnectionAt,
          heartbeatCount: participant.consecutiveHeartbeats,
        });
      }
    }

    // Calculer le nouveau expiresAt :
    // On prend le MAX entre l'expiration actuelle et (now + HEARTBEAT_EXTENSION_MINUTES)
    // afin de ne jamais réduire un timer initialement long (ex: 4h) lors des premiers heartbeats.
    const heartbeatFloor = new Date(
      now.getTime() + HEARTBEAT_EXTENSION_MINUTES * 60 * 1000,
    );
    const currentExpiresAt = new Date(session.expiresAt); // cast défensif string→Date
    sosLogger.debug("[DEBUG-HEARTBEAT] Calcul expiresAt", {
      userId,
      sessionId: session._id?.toString(),
      nowMs: now.getTime(),
      heartbeatFloorMs: heartbeatFloor.getTime(),
      currentExpiresAtMs: currentExpiresAt.getTime(),
      heartbeatFloorISO: heartbeatFloor.toISOString(),
      currentExpiresAtISO: currentExpiresAt.toISOString(),
      willUpdate: heartbeatFloor > currentExpiresAt,
    });
    if (heartbeatFloor > currentExpiresAt) {
      session.expiresAt = heartbeatFloor;
    }

    // Session-level fields (backward compat)
    session.lastHeartbeatAt = now;
    session.heartbeatCount += 1;
    if (lat !== undefined) session.lastKnownLat = lat;
    if (lng !== undefined) session.lastKnownLng = lng;
    if (accuracy !== undefined) session.lastKnownAccuracy = accuracy;

    await session.save();

    // Logger l'événement
    await this.logEvent(
      session._id as mongoose.Types.ObjectId,
      userId,
      "HEARTBEAT",
      {
        newExpiresAt: session.expiresAt,
        heartbeatCount: session.heartbeatCount,
        lat,
        lng,
      },
    );

    sosLogger.info("Heartbeat received", {
      userId,
      sessionId: session._id?.toString(),
      newExpiresAt: session.expiresAt,
      heartbeatCount: session.heartbeatCount,
    });

    return session;
  }

  // ─── EXTENSION MANUELLE ────────────────────────────────────────────

  /**
   * Prolonger manuellement le timer
   * Tout participant peut prolonger pour l'ensemble de la session
   */
  async extendSession(params: ExtendParams): Promise<ISosSession> {
    const { userId, sessionId, additionalMinutes } = params;
    const userObjectId = new mongoose.Types.ObjectId(userId);

    if (additionalMinutes < 15 || additionalMinutes > 480) {
      throw new Error("INVALID_EXTENSION_DURATION");
    }

    // Trouver la session où l'utilisateur est participant
    const session = sessionId
      ? await SosSessionModel.findOne({
          _id: new mongoose.Types.ObjectId(sessionId),
          status: { $in: ["ACTIVE", "EXPIRED", "ESCALATING"] },
          participants: {
            $elemMatch: {
              userId: userObjectId,
              status: { $ne: "LEFT" },
            },
          },
        })
      : await SosSessionModel.findOne({
          status: { $in: ["ACTIVE", "EXPIRED", "ESCALATING"] },
          participants: {
            $elemMatch: {
              userId: userObjectId,
              status: { $ne: "LEFT" },
            },
          },
        });

    if (!session) {
      throw new Error("NO_ACTIVE_SESSION");
    }

    const now = new Date();
    const newExpiresAt = new Date(
      Math.max(session.expiresAt.getTime(), now.getTime()) +
        additionalMinutes * 60 * 1000,
    );

    session.expiresAt = newExpiresAt;
    session.extensionCount += 1;

    // Si la session était en escalade ou expirée, remettre tous les participants ESCALATING en ACTIVE
    if (session.status === "ESCALATING" || session.status === "EXPIRED") {
      session.status = "ACTIVE";
      session.currentStage = -1;

      session.participants.forEach((p) => {
        if (p.status === "ESCALATING" || p.status === "DISCONNECTED") {
          p.status = "ACTIVE";
          p.currentStage = -1;
        }
      });
    }

    await session.save();

    // Logger l'événement
    await this.logEvent(
      session._id as mongoose.Types.ObjectId,
      userId,
      "EXTENDED",
      {
        additionalMinutes,
        newExpiresAt,
        extensionCount: session.extensionCount,
      },
    );

    sosLogger.info("SOS session extended", {
      userId,
      sessionId: session._id?.toString(),
      additionalMinutes,
      newExpiresAt,
      extensionCount: session.extensionCount,
    });

    return session;
  }

  // ─── DÉSACTIVATION ─────────────────────────────────────────────────

  /**
   * Désactiver une session SOS (l'utilisateur est en sécurité)
   * Scope "self": quitte uniquement le participant appelant
   * Scope "all": désactive pour tous les participants
   */
  async deactivateSession(
    userId: string,
    sessionId?: string,
    scope: "self" | "all" = "all",
  ): Promise<ISosSession> {
    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Trouver la session où l'utilisateur est participant
    const session = sessionId
      ? await SosSessionModel.findOne({
          _id: new mongoose.Types.ObjectId(sessionId),
          status: { $in: ["ACTIVE", "EXPIRED", "ESCALATING"] },
          participants: {
            $elemMatch: {
              userId: userObjectId,
              status: { $ne: "LEFT" },
            },
          },
        })
      : await SosSessionModel.findOne({
          status: { $in: ["ACTIVE", "EXPIRED", "ESCALATING"] },
          participants: {
            $elemMatch: {
              userId: userObjectId,
              status: { $ne: "LEFT" },
            },
          },
        });

    if (!session) {
      throw new Error("NO_ACTIVE_SESSION");
    }

    const now = new Date();

    // Récupérer les infos de l'utilisateur pour les notifications
    const user = await UserModel.findById(userObjectId).lean();
    const userName = user ? decrypt(user.name) : "Un utilisateur";

    if (scope === "all") {
      const isCreator = session.userId.toString() === userId;
      if (!isCreator) {
        throw new Error("NOT_AUTHORIZED_TO_DEACTIVATE_ALL");
      }
    }

    if (scope === "self") {
      // ─── SCOPE "SELF" : Quitter uniquement soi-même ───

      const participant = session.participants.find(
        (p) => p.userId.toString() === userId && p.status !== "LEFT",
      );

      if (!participant) {
        throw new Error("NO_ACTIVE_SESSION");
      }

      // Marquer le participant comme LEFT
      participant.status = "LEFT";
      participant.leftAt = now;

      // Logger l'événement
      await this.logEvent(
        session._id as mongoose.Types.ObjectId,
        userId,
        "PARTICIPANT_LEFT",
        {
          userName,
          leftAt: now,
        },
      );

      // Vérifier s'il reste des participants actifs
      const remainingActiveParticipants = session.participants.filter(
        (p) => p.status !== "LEFT",
      );

      if (remainingActiveParticipants.length === 0) {
        // C'était le dernier participant → résoudre la session
        session.status = "RESOLVED";
        session.resolvedAt = now;
        session.resolvedBy = "USER";
        session.resolvedByUserId = userObjectId;

        await session.save();

        // Nettoyer les contacts temporaires
        await this.cleanupSessionContacts(session._id.toString());

        sosLogger.info("Session resolved - last participant left", {
          sessionId: session._id?.toString(),
          userId,
        });
      } else {
        // Il reste des participants → session continue
        await session.save();

        // Notifier les autres participants (WS + push)
        for (const otherParticipant of remainingActiveParticipants) {
          const otherUserId = otherParticipant.userId.toString();
          webSocketService.sendNotificationToUser(otherUserId, {
            type: "sos_participant_left",
            sessionId: (session._id as mongoose.Types.ObjectId).toString(),
            userName,
            userId,
            message: `${userName} a quitté la session SOS`,
          });

          // Push notification
          try {
            await createNotification(
              otherParticipant.userId,
              "sos_participant_left",
              "Participant a quitté la session SOS",
              `${userName} a quitté la session SOS.`,
              {
                sosSessionId: session._id as mongoose.Types.ObjectId,
                senderId: new mongoose.Types.ObjectId(userId),
              },
            );
          } catch (error) {
            sosLogger.error("Failed to send participant left notification", {
              otherUserId,
              sessionId: session._id?.toString(),
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        sosLogger.info("Participant left SOS session", {
          sessionId: session._id?.toString(),
          userId,
          remainingParticipants: remainingActiveParticipants.length,
        });
      }

      // Audit
      await auditService.log({
        userId,
        action: "SOS_SESSION_PARTICIPANT_LEFT",
        level: "info",
        details: {
          sessionId: session._id,
          scope: "self",
          remainingParticipants: remainingActiveParticipants.length,
        },
      });
    } else {
      // ─── SCOPE "ALL" : Désactiver pour tous ───

      // Marquer tous les participants comme LEFT
      session.participants.forEach((p) => {
        if (p.status !== "LEFT") {
          p.status = "LEFT";
          p.leftAt = now;
        }
      });

      // Marquer la session comme résolue
      session.status = "RESOLVED";
      session.resolvedAt = now;
      session.resolvedBy = "USER";
      session.resolvedByUserId = userObjectId;

      await session.save();

      // Nettoyer les contacts temporaires
      await this.cleanupSessionContacts(session._id.toString());

      // Logger l'événement
      await this.logEvent(
        session._id as mongoose.Types.ObjectId,
        userId,
        "SESSION_DEACTIVATED_ALL",
        {
          resolvedBy: "USER",
          userName,
          participantCount: session.participants.length,
        },
      );

      // Notifier tous les autres participants (WS + push)
      for (const participant of session.participants) {
        const participantId = participant.userId.toString();
        if (participantId !== userId) {
          webSocketService.sendNotificationToUser(participantId, {
            type: "sos_session_deactivated_all",
            sessionId: (session._id as mongoose.Types.ObjectId).toString(),
            userName,
            userId,
            message: `La session SOS a été désactivée par ${userName}`,
          });

          // Push notification
          try {
            await createNotification(
              participant.userId,
              "sos_session_cancelled",
              "Session SOS annulée",
              `${userName} a désactivé la session SOS.`,
              {
                sosSessionId: session._id as mongoose.Types.ObjectId,
                senderId: new mongoose.Types.ObjectId(userId),
              },
            );
          } catch (error) {
            sosLogger.error("Failed to send session cancelled notification", {
              participantId,
              sessionId: session._id?.toString(),
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      // Audit
      await auditService.log({
        userId,
        action: "SOS_SESSION_DEACTIVATED",
        level: "info",
        details: {
          sessionId: session._id,
          resolvedBy: "USER",
          scope: "all",
          participantCount: session.participants.length,
        },
      });

      sosLogger.info("SOS session deactivated for all participants", {
        sessionId: session._id?.toString(),
        deactivatedBy: userId,
        participantCount: session.participants.length,
      });
    }

    return session;
  }

  // ─── CONFIRMATION PAR UN CONTACT ───────────────────────────────────

  /**
   * Un autre utilisateur Qvarry confirme que la personne est en sécurité
   * Résout la session pour TOUS les participants (scope "all")
   */
  async confirmSafe(
    sessionId: string,
    confirmerId: string,
  ): Promise<ISosSession> {
    const confirmerObjectId = new mongoose.Types.ObjectId(confirmerId);

    // Vérifier que le confirmeur est un participant actif avant la mise à jour atomique
    const candidate = await SosSessionModel.findOne({
      _id: new mongoose.Types.ObjectId(sessionId),
      status: { $in: ["ACTIVE", "EXPIRED", "ESCALATING"] },
    }).lean();

    if (!candidate) {
      throw new Error("SESSION_NOT_FOUND_OR_NOT_ESCALATING");
    }

    const isActiveParticipant = candidate.participants.some(
      (p) => p.userId.toString() === confirmerId && p.status !== "LEFT",
    );
    if (!isActiveParticipant) {
      throw new Error("NOT_AUTHORIZED_TO_CONFIRM");
    }

    const now = new Date();

    // Mise à jour atomique : résoudre la session et marquer tous les participants comme LEFT
    const session = await SosSessionModel.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(sessionId),
        status: { $in: ["ACTIVE", "EXPIRED", "ESCALATING"] },
      },
      {
        $set: {
          status: "RESOLVED",
          resolvedAt: now,
          resolvedBy: "CONTACT_CONFIRM",
          resolvedByUserId: confirmerObjectId,
          "participants.$[active].status": "LEFT",
          "participants.$[active].leftAt": now,
        },
      },
      {
        new: true,
        arrayFilters: [{ "active.status": { $ne: "LEFT" } }],
      },
    );

    if (!session) {
      throw new Error("SESSION_NOT_FOUND_OR_ALREADY_RESOLVED");
    }

    // Notifier tous les participants que la session est confirmée safe
    for (const participant of session.participants) {
      const participantId = participant.userId.toString();
      try {
        await createNotification(
          participant.userId,
          "sos_confirmed_safe",
          "✅ Session SOS résolue",
          `La session SOS a été confirmée en sécurité.`,
          {
            sosSessionId: session._id as mongoose.Types.ObjectId,
            senderId: new mongoose.Types.ObjectId(confirmerId),
          },
        );
      } catch (error) {
        sosLogger.error("Failed to send confirmSafe notification", {
          participantId,
          sessionId: session._id?.toString(),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Nettoyer les contacts temporaires
    await this.cleanupSessionContacts(session._id.toString());

    // Logger l'événement
    await this.logEvent(
      session._id as mongoose.Types.ObjectId,
      session.userId.toString(),
      "CONTACT_CONFIRMED",
      {
        confirmerId,
        resolvedBy: "CONTACT_CONFIRM",
        participantCount: session.participants.length,
      },
    );

    // Audit
    await auditService.log({
      userId: confirmerId,
      action: "SOS_CONTACT_CONFIRMED_SAFE",
      level: "info",
      details: {
        sessionId: session._id,
        sessionUserId: session.userId,
        participantCount: session.participants.length,
      },
    });

    sosLogger.info("SOS session confirmed safe by contact", {
      sessionId: session._id?.toString(),
      confirmerId,
      participantCount: session.participants.length,
    });

    return session;
  }

  // ─── LECTURE ────────────────────────────────────────────────────────

  /**
   * Obtenir la session active d'un utilisateur
   * Cherche où l'utilisateur est participant et n'a pas LEFT
   */
  async getActiveSession(userId: string): Promise<ISosSession | null> {
    const userObjectId = new mongoose.Types.ObjectId(userId);

    sosLogger.debug("[DEBUG-STATUS] getActiveSession appelé", {
      userId,
      userObjectId: userObjectId.toString(),
    });

    const session = await SosSessionModel.findOne({
      status: { $in: ["ACTIVE", "EXPIRED", "ESCALATING"] },
      participants: {
        $elemMatch: {
          userId: userObjectId,
          status: { $ne: "LEFT" },
        },
      },
    });

    sosLogger.debug("[DEBUG-STATUS] getActiveSession résultat", {
      userId,
      found: session !== null,
      sessionId: session?._id?.toString(),
      sessionStatus: session?.status,
      participantsCount: session?.participants?.length,
    });

    // Debug: si null, chercher sans filtre status pour diagnostic
    if (!session && process.env.NODE_ENV !== "production") {
      const anySession = await SosSessionModel.findOne({
        participants: {
          $elemMatch: {
            userId: userObjectId,
            status: { $ne: "LEFT" },
          },
        },
      }).lean();
      sosLogger.debug("[DEBUG-STATUS] Recherche sans filtre statut", {
        userId,
        found: anySession !== null,
        sessionId: (anySession as any)?._id?.toString(),
        sessionStatus: (anySession as any)?.status,
        participants: (anySession as any)?.participants?.map((p: any) => ({
          userId: p.userId?.toString(),
          status: p.status,
        })),
      });
    }

    return session;
  }

  /**
   * Obtenir l'historique des sessions d'un utilisateur avec statistiques enrichies
   * Inclut les sessions où l'utilisateur est créateur OU participant
   */
  async getSessionHistory(
    userId: string,
    limit: number = 20,
  ): Promise<{
    sessions: any[];
    stats: {
      totalSessions: number;
      totalDuration: number; // Minutes totales passées sous terre
      averageDuration: number; // Durée moyenne en minutes
      longestSession: number; // Plus longue session en minutes
      totalHeartbeats: number; // Total de heartbeats
      escalationRate: number; // % de sessions qui ont atteint l'escalade
      mostVisitedSites: Array<{ siteName: string; count: number }>;
      lastSessionDate: Date | null;
    };
  }> {
    const userObjectId = new mongoose.Types.ObjectId(userId);

    const matchQuery = {
      $or: [{ userId: userObjectId }, { "participants.userId": userObjectId }],
    };

    // Une seule agrégation pour les documents paginés ET les données de stats
    const [facetResult] = await SosSessionModel.aggregate([
      { $match: matchQuery },
      {
        $facet: {
          // Branche 1 : documents paginés complets pour l'affichage
          data: [{ $sort: { createdAt: -1 } }, { $limit: limit }],
          // Branche 2 : champs légers pour les calculs de statistiques
          statsRaw: [
            {
              $project: {
                expectedDuration: 1,
                heartbeatCount: 1,
                status: 1,
                currentStage: 1,
                siteName: 1,
                activatedAt: 1,
                resolvedAt: 1,
              },
            },
          ],
        },
      },
    ]);

    const sessions: any[] = facetResult?.data ?? [];
    const allSessions: any[] = facetResult?.statsRaw ?? [];

    const totalSessions = allSessions.length;

    // Calcul des durées réelles (resolvedAt - activatedAt en minutes)
    const durations = allSessions
      .filter((s) => s.resolvedAt)
      .map((s) => {
        if (!s.resolvedAt) return 0;
        return Math.round(
          (new Date(s.resolvedAt).getTime() -
            new Date(s.activatedAt).getTime()) /
            60000,
        );
      });

    const totalDuration = durations.reduce((sum, d) => sum + d, 0);
    const averageDuration =
      durations.length > 0 ? Math.round(totalDuration / durations.length) : 0;
    const longestSession = durations.length > 0 ? Math.max(...durations) : 0;
    const totalHeartbeats = allSessions.reduce(
      (sum, s) => sum + (s.heartbeatCount || 0),
      0,
    );

    // Taux d'escalade : sessions qui ont atteint ESCALATING / total
    const escalatedSessions = allSessions.filter(
      (s) => s.status === "ESCALATING" || s.currentStage >= 0,
    ).length;
    const escalationRate =
      totalSessions > 0
        ? Math.round((escalatedSessions / totalSessions) * 100)
        : 0;

    // Sites les plus visités
    const siteCounts: Record<string, number> = {};
    allSessions.forEach((s) => {
      if (s.siteName) {
        siteCounts[s.siteName] = (siteCounts[s.siteName] || 0) + 1;
      }
    });
    const mostVisitedSites = Object.entries(siteCounts)
      .map(([siteName, count]) => ({ siteName, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // sessions (branche data) est triée par createdAt desc — prendre la première
    const lastSession = sessions.length > 0 ? sessions[0] : null;

    // Enrichir chaque session avec des données calculées
    const enrichedSessions = sessions.map((session: any) => {
      const actualDuration = session.resolvedAt
        ? Math.round(
            (new Date(session.resolvedAt).getTime() -
              new Date(session.activatedAt).getTime()) /
              60000,
          )
        : null;

      return {
        ...session,
        actualDuration, // Durée réelle en minutes (null si pas encore résolu)
        durationOverrun:
          actualDuration && session.expectedDuration
            ? actualDuration - session.expectedDuration
            : null, // Dépassement en minutes (négatif = sorti en avance)
      };
    });

    return {
      sessions: enrichedSessions,
      stats: {
        totalSessions,
        totalDuration,
        averageDuration,
        longestSession,
        totalHeartbeats,
        escalationRate,
        mostVisitedSites,
        lastSessionDate: lastSession ? lastSession.activatedAt : null,
      },
    };
  }

  /**
   * Obtenir les sessions actives visibles par un utilisateur
   * (sessions en escalade visibles par tous les utilisateurs)
   * Exclut les sessions où l'utilisateur est participant
   */
  async getActiveSessions(userId: string): Promise<any[]> {
    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Pour le MVP, on retourne toutes les sessions en escalade (stage 1+)
    // Exclut les sessions où l'utilisateur est participant
    return SosSessionModel.find({
      status: "ESCALATING",
      currentStage: { $gte: 1 },
      "participants.userId": { $ne: userObjectId },
    })
      .select(
        "-lastKnownLat -lastKnownLng -lastKnownAccuracy -entryLat -entryLng -depth",
      )
      .populate("userId", "name surname")
      .sort({ createdAt: -1 })
      .lean();
  }

  // ─── ESCALADE (appelé par le cron job) ─────────────────────────────

  /**
   * Traiter les sessions expirées et déclencher l'escalade (par participant)
   * Appelé toutes les 60 secondes par le cron job
   */
  async processExpiredSessions(): Promise<void> {
    const now = new Date();

    // Trouver toutes les sessions ACTIVE, EXPIRED ou ESCALATING
    const activeSessions = await SosSessionModel.find({
      status: { $in: ["ACTIVE", "EXPIRED", "ESCALATING"] },
    });

    for (const session of activeSessions) {
      let sessionModified = false;

      // Parcourir tous les participants actifs
      for (const participant of session.participants) {
        if (participant.status === "LEFT") {
          continue; // Ignorer les participants qui ont quitté
        }

        // Vérifier si le heartbeat du participant a expiré
        const heartbeatExpired = participant.lastHeartbeatAt
          ? participant.lastHeartbeatAt.getTime() +
              HEARTBEAT_EXTENSION_MINUTES * 60 * 1000 <
            now.getTime()
          : session.expiresAt.getTime() < now.getTime();

        if (!heartbeatExpired) {
          continue; // Ce participant est encore dans les temps
        }

        // Le heartbeat de ce participant a expiré, vérifier les stages
        if (participant.currentStage === -1) {
          // Stage 0: première expiration
          await this.triggerStage0(session, participant);
          sessionModified = true;
        } else if (participant.currentStage === 0) {
          // Vérifier si 15 minutes se sont écoulées depuis stage 0
          const stage0Threshold = new Date(
            now.getTime() - STAGE_1_DELAY_MINUTES * 60 * 1000,
          );
          if (
            participant.stage0TriggeredAt &&
            participant.stage0TriggeredAt <= stage0Threshold
          ) {
            await this.triggerStage1(session, participant);
            sessionModified = true;
          }
        } else if (participant.currentStage === 1) {
          // Vérifier si 30 minutes se sont écoulées depuis le début de l'escalade (stage 0)
          const stage2Threshold = new Date(
            now.getTime() - STAGE_2_DELAY_MINUTES * 60 * 1000,
          );
          if (
            participant.stage0TriggeredAt &&
            participant.stage0TriggeredAt <= stage2Threshold
          ) {
            await this.triggerStage2(session, participant);
            sessionModified = true;
          }
        }
      }

      // Après avoir traité tous les participants, mettre à jour le statut de la session
      if (sessionModified) {
        const activeParticipants = session.participants.filter(
          (p) => p.status !== "LEFT",
        );
        const escalatingParticipants = activeParticipants.filter(
          (p) => p.status === "ESCALATING" || p.status === "DISCONNECTED",
        );

        if (escalatingParticipants.length > 0) {
          // Définir le currentStage de la session au maximum des stages des participants
          const maxStage = Math.max(
            ...activeParticipants.map((p) => p.currentStage),
          );
          session.currentStage = maxStage;

          // Transition de statut : ACTIVE -> EXPIRED -> ESCALATING
          // EXPIRED = timer expiré, stage 0 (participant déconnecté, alarme locale)
          // ESCALATING = stage 1+ (alerte communauté, SMS contacts)
          if (maxStage === 0 && session.status === "ACTIVE") {
            // Timer vient d'expirer, premier participant en stage 0
            session.status = "EXPIRED";
          } else if (maxStage >= 1) {
            // Au moins un participant a atteint stage 1+, escalade réelle
            session.status = "ESCALATING";
          }

          // Mettre à jour les timestamps de session avec les plus anciennes dates des participants
          const stage0Dates = activeParticipants
            .filter((p) => p.stage0TriggeredAt)
            .map((p) => p.stage0TriggeredAt as Date)
            .map((d) => d.getTime());
          if (stage0Dates.length > 0) {
            session.stage0TriggeredAt = new Date(Math.min(...stage0Dates));
          }

          const stage1Dates = activeParticipants
            .filter((p) => p.stage1TriggeredAt)
            .map((p) => p.stage1TriggeredAt as Date)
            .map((d) => d.getTime());
          if (stage1Dates.length > 0) {
            session.stage1TriggeredAt = new Date(Math.min(...stage1Dates));
          }

          const stage2Dates = activeParticipants
            .filter((p) => p.stage2TriggeredAt)
            .map((p) => p.stage2TriggeredAt as Date)
            .map((d) => d.getTime());
          if (stage2Dates.length > 0) {
            session.stage2TriggeredAt = new Date(Math.min(...stage2Dates));
          }
        }

        await session.save();
      }
    }
  }

  // ─── STAGES D'ESCALADE ─────────────────────────────────────────────

  /**
   * Stage 0: Push notification au participant + alarme locale
   */
  private async triggerStage0(
    session: ISosSession,
    participant: ISosParticipant,
  ): Promise<void> {
    const sessionId = session._id as mongoose.Types.ObjectId;
    const participantUserId = participant.userId.toString();

    // Marquer le participant comme DISCONNECTED
    participant.status = "DISCONNECTED";
    participant.currentStage = 0;
    participant.stage0TriggeredAt = new Date();

    // Envoyer notification push au participant avec retry
    await this.sendSosNotificationWithRetry({
      userId: participantUserId,
      title: "🆘 Alerte SOS - Timer expiré",
      message:
        "Votre timer SOS a expiré ! Donnez un signe de vie ou l'escalade va se déclencher.",
      type: "sos_alert",
      data: {
        sosSessionId: sessionId,
      },
    });

    // Envoyer via WebSocket pour alarme immédiate (avec gestion d'erreur)
    this.sendSosWebSocketNotification(
      participantUserId,
      {
        type: "sos_alarm",
        stage: 0,
        sessionId: sessionId.toString(),
        message: "Timer SOS expiré — Donnez un signe de vie !",
      },
      { sessionId: sessionId.toString(), stage: 0 },
    );

    await this.logEvent(sessionId, participantUserId, "STAGE_CHANGE", {
      stage: 0,
      previousStage: -1,
      participantId: participantUserId,
    });

    sosLogger.info("Stage 0 triggered for participant", {
      sessionId: sessionId.toString(),
      participantId: participantUserId,
    });
  }

  /**
   * Stage 1: Notifier TOUS les utilisateurs Qvarry vérifiés, sans limite
   * géographique (le broadcast n'est plus restreint à un rayon autour de la
   * dernière position connue).
   *
   * Protections appliquées :
   *  1. Filtre `notificationPreferences.community_sos !== false` au niveau
   *     Mongo (perf : évite N appels au notificationService pour rien).
   *  2. Throttle par session (Redis/in-memory) — pas de re-broadcast si
   *     déjà émis dans les 30 dernières minutes.
   */
  private async triggerStage1(
    session: ISosSession,
    participant: ISosParticipant,
  ): Promise<void> {
    const sessionId = session._id as mongoose.Types.ObjectId;
    const participantUserId = participant.userId.toString();

    // Marquer le participant comme ESCALATING
    participant.status = "ESCALATING";
    participant.currentStage = 1;
    participant.stage1TriggeredAt = new Date();

    // Récupérer le nom du participant en danger
    const user = await UserModel.findById(participant.userId).lean();
    const userName = user ? decrypt(user.name) : "Un utilisateur";

    // Envoyer notification WebSocket au participant (rappel) - avec gestion d'erreur
    this.sendSosWebSocketNotification(
      participantUserId,
      {
        type: "sos_alarm",
        stage: 1,
        sessionId: sessionId.toString(),
        message: "Escalade Stage 1 — D'autres utilisateurs sont notifiés !",
      },
      { sessionId: sessionId.toString(), stage: 1 },
    );

    // ─── Protection 3 : throttle par session ──────────────────────────────
    // Si on a déjà broadcasté pour cette session dans les 30 dernières
    // minutes, on skip le re-broadcast (évite double-envoi sur re-escalade).
    let throttleAcquired = true;
    try {
      throttleAcquired = await getStage1ThrottleStore().setIfAbsent(
        sessionId.toString(),
        SOS_STAGE1_THROTTLE_TTL_SECONDS,
      );
    } catch (err) {
      // Fail-open : mieux vaut une notif en double qu'aucune
      sosLogger.warn(
        "[stage1-throttle] Erreur store — fail-open (broadcast effectué)",
        {
          sessionId: sessionId.toString(),
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }

    if (!throttleAcquired) {
      sosLogger.info(
        "Stage 1 broadcast skipped — already broadcast in last 30 min",
        {
          sessionId: sessionId.toString(),
          participantId: participantUserId,
        },
      );
      await this.logEvent(sessionId, participantUserId, "STAGE_CHANGE", {
        stage: 1,
        previousStage: 0,
        userName,
        participantId: participantUserId,
        broadcastSkipped: "throttled_already_broadcast",
      });
      return;
    }

    // ─── Protection : opt-out community_sos (plus de filtre géographique) ──
    // Le broadcast Stage 1 notifie désormais TOUS les utilisateurs Qvarry
    // vérifiés (hors participants de la session), sans limite de rayon. Seul
    // l'opt-out `community_sos` est respecté.
    const baseFilter: Record<string, any> = {
      _id: {
        $nin: session.participants.map((p) => p.userId),
      },
      isVerified: true,
      // Filtre au niveau Mongo : exclure les users ayant explicitement
      // désactivé community_sos (= false). Les users sans champ ou avec true
      // restent inclus.
      "notificationPreferences.community_sos": { $ne: false },
    };

    const allVerifiedUsers = (await UserModel.find(baseFilter)
      .select("_id name")
      .lean()) as Array<{ _id: mongoose.Types.ObjectId; name: string }>;

    sosLogger.info("Stage 1 triggered - notifying all Qvarry users", {
      sessionId: sessionId.toString(),
      participantId: participantUserId,
      notifiedCount: allVerifiedUsers.length,
      protections: {
        geoFilter: false,
        communitySosOptOutFiltered: true,
        sessionThrottleAcquired: throttleAcquired,
      },
    });

    // Envoyer les notifications à chaque utilisateur avec retry (par batches de 50)
    let successCount = 0;
    let failCount = 0;

    const BATCH_SIZE = 50;
    for (let i = 0; i < allVerifiedUsers.length; i += BATCH_SIZE) {
      const batch = allVerifiedUsers.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((targetUser) =>
          this.sendSosNotificationWithRetry({
            userId: targetUser._id.toString(),
            title: "🆘 Alerte SOS",
            message: `${userName} a besoin d'aide ! Consultez la carte SOS.`,
            type: "sos_stage1_alert",
            data: {
              sosSessionId: sessionId,
            },
          }),
        ),
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        const targetUser = batch[j];

        if (result.status === "fulfilled" && result.value) {
          successCount++;
        } else {
          failCount++;
        }

        // WebSocket notification avec gestion d'erreur
        this.sendSosWebSocketNotification(
          targetUser._id.toString(),
          {
            type: "sos_alert_stage1",
            stage: 1,
            sessionId: sessionId.toString(),
            userName,
            participantId: participantUserId,
            message: `${userName} a besoin d'aide ! Consultez la carte SOS.`,
          },
          { sessionId: sessionId.toString(), stage: 1 },
        );
      }
    }

    await this.logEvent(sessionId, participantUserId, "STAGE_CHANGE", {
      stage: 1,
      previousStage: 0,
      userName,
      participantId: participantUserId,
    });

    await this.logEvent(sessionId, participantUserId, "NOTIFICATION_SENT", {
      stage: 1,
      target: "all_users",
      notifiedCount: allVerifiedUsers.length,
      successCount,
      failCount,
      participantId: participantUserId,
    });

    // Notifier les admins (push + email)
    await this.notifyAdmins({
      eventType: "STAGE_1",
      session,
      participantName: userName,
      participantId: participantUserId,
      stage: 1,
      triggeredAt: participant.stage1TriggeredAt ?? new Date(),
    });

    sosLogger.info("Stage 1 completed", {
      sessionId: sessionId.toString(),
      participantId: participantUserId,
      notifiedCount: allVerifiedUsers.length,
      successCount,
      failCount,
    });
  }

  /**
   * Stage 2: Envoyer SMS aux contacts d'urgence de TOUS les participants via Vonage
   */
  private async triggerStage2(
    session: ISosSession,
    participant: ISosParticipant,
  ): Promise<void> {
    const sessionId = session._id as mongoose.Types.ObjectId;
    const participantUserId = participant.userId.toString();

    // Marquer le participant en stage 2
    participant.currentStage = 2;
    participant.stage2TriggeredAt = new Date();

    // Récupérer le nom du participant en danger
    const user = await UserModel.findById(participant.userId).lean();
    const userName = user
      ? `${decrypt(user.name)} ${decrypt(user.surname)}`
      : "Un utilisateur Qvarry";

    // ═══════════════════════════════════════════════════════════════════════════
    // SAFETY-CRITICAL: Vérifier que Vonage est configuré AVANT d'envoyer les SMS
    // ═══════════════════════════════════════════════════════════════════════════
    if (!vonageService.isReady()) {
      sosLogger.error(
        "[SOS-CRITICAL] Stage 2 escalation: Cannot send SMS - Vonage not configured. Emergency contacts will NOT be notified by SMS.",
        {
          sessionId: sessionId.toString(),
          participantId: participantUserId,
          userName,
        },
      );

      // Logger l'événement d'échec critique
      await this.logEvent(sessionId, participantUserId, "SMS_FAILED", {
        stage: 2,
        reason: "VONAGE_NOT_CONFIGURED",
        participantId: participantUserId,
        critical: true,
      });

      // Alarme WebSocket pour notifier l'utilisateur
      webSocketService.sendNotificationToUser(participantUserId, {
        type: "sos_alarm",
        stage: 2,
        sessionId: sessionId.toString(),
        message:
          "ERREUR CRITIQUE: Les SMS d'urgence ne peuvent pas être envoyés (Vonage non configuré) !",
        error: true,
      });

      // Audit critique
      await auditService.log({
        userId: participantUserId,
        action: "SOS_STAGE_2_FAILED_VONAGE_NOT_CONFIGURED",
        level: "critical",
        details: {
          sessionId: sessionId,
          participantId: participantUserId,
          userName,
          reason: "Vonage SMS service not configured",
        },
      });

      // Notifier les admins (P1) — Vonage indispo bloque l'escalade SOS
      try {
        await notifyAllAdmins(
          "admin_sos_failed_sms",
          "🆘 SOS Stage 2 — SMS bloqués",
          `Vonage non configuré : les SMS d'urgence n'ont pas pu être envoyés (sessionId ${sessionId.toString()}).`,
          {
            sessionId: sessionId.toString(),
            participantId: participantUserId,
            reason: "VONAGE_NOT_CONFIGURED",
            dedupKey: `sos-sms-failed:${sessionId.toString()}:vonage_not_configured`,
          },
        );
      } catch (err) {
        sosLogger.warn("Failed to notify admins (admin_sos_failed_sms)", {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      return; // On ne peut pas envoyer les SMS, on arrête ici
    }

    // Récupérer les contacts d'urgence de TOUS les participants de la session
    let allContacts: any[] = [];

    if (session.useDefaultContacts) {
      // Utiliser les contacts permanents de TOUS les participants
      const participantUserIds = session.participants.map((p) => p.userId);
      allContacts = await SosContactModel.find({
        userId: { $in: participantUserIds },
        sessionId: { $exists: false },
        deletedAt: null, // Exclure les contacts soft-deleted
      }).lean();
    } else {
      // Utiliser les contacts sélectionnés pour cette session
      allContacts = await SosContactModel.find({
        _id: { $in: session.sessionContactIds },
        deletedAt: null, // Exclure les contacts soft-deleted
      }).lean();
    }

    if (allContacts.length === 0) {
      sosLogger.error("No emergency contacts for stage 2", {
        sessionId: sessionId.toString(),
        participantId: participantUserId,
      });
      await this.logEvent(sessionId, participantUserId, "SMS_FAILED", {
        stage: 2,
        reason: "NO_CONTACTS",
        participantId: participantUserId,
      });
      return;
    }

    // Dédupliquer les contacts par numéro de téléphone
    const uniqueContactsMap = new Map();
    allContacts.forEach((contact) => {
      if (!uniqueContactsMap.has(contact.phone)) {
        uniqueContactsMap.set(contact.phone, contact);
      }
    });
    const contacts = Array.from(uniqueContactsMap.values());

    // Préparer la localisation depuis le participant
    const location =
      participant.lastKnownLat && participant.lastKnownLng
        ? { lat: participant.lastKnownLat, lng: participant.lastKnownLng }
        : session.lastKnownLat && session.lastKnownLng
          ? { lat: session.lastKnownLat, lng: session.lastKnownLng }
          : undefined;

    // Envoyer les SMS via Vonage
    const smsContacts = contacts.map((c) => ({ name: c.name, phone: c.phone }));
    const results = await vonageService.sendSosAlertToMultiple(
      smsContacts,
      userName,
      session.note,
      location,
    );

    // Logger chaque envoi
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const contact = contacts[i];

      if (result.success) {
        await this.logEvent(sessionId, participantUserId, "SMS_SENT", {
          contactId: contact._id,
          contactName: contact.name,
          messageId: result.messageId,
          participantId: participantUserId,
        });

        // Mettre à jour la date du dernier SMS envoyé
        await SosContactModel.findByIdAndUpdate(contact._id, {
          lastSmsSentAt: new Date(),
        });
      } else {
        await this.logEvent(sessionId, participantUserId, "SMS_FAILED", {
          contactId: contact._id,
          contactName: contact.name,
          error: result.error,
          participantId: participantUserId,
        });
      }
    }

    // Si au moins un SMS a échoué, notifier les admins (P1, dédupliqué par session)
    const failedCount = results.filter((r) => !r.success).length;
    if (failedCount > 0) {
      try {
        await notifyAllAdmins(
          "admin_sos_failed_sms",
          "🆘 SOS Stage 2 — Échec SMS",
          `${failedCount}/${results.length} SMS d'urgence ont échoué via Vonage (sessionId ${sessionId.toString()}).`,
          {
            sessionId: sessionId.toString(),
            participantId: participantUserId,
            failedCount,
            totalCount: results.length,
            dedupKey: `sos-sms-failed:${sessionId.toString()}:batch`,
          },
        );
      } catch (err) {
        sosLogger.warn("Failed to notify admins (admin_sos_failed_sms batch)", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Alarme WebSocket avec gestion d'erreur
    this.sendSosWebSocketNotification(
      participantUserId,
      {
        type: "sos_alarm",
        stage: 2,
        sessionId: sessionId.toString(),
        message: "Escalade Stage 2 — SMS envoyés aux contacts d'urgence !",
      },
      { sessionId: sessionId.toString(), stage: 2 },
    );

    // Push notification pour informer que les SMS ont été envoyés
    try {
      await createNotification(
        new mongoose.Types.ObjectId(participantUserId),
        "sos_sms_triggered",
        "🆘 SMS d'urgence envoyés",
        `Stage 2 — ${results.filter((r) => r.success).length} SMS envoyés à vos contacts d'urgence.`,
        {
          sosSessionId: sessionId,
        },
      );
    } catch (error) {
      sosLogger.error("Failed to send SMS triggered notification", {
        participantUserId,
        sessionId: sessionId.toString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Audit critique
    await auditService.log({
      userId: participantUserId,
      action: "SOS_STAGE_2_SMS_SENT",
      level: "critical",
      details: {
        sessionId: sessionId,
        participantId: participantUserId,
        contactCount: contacts.length,
        successCount: results.filter((r) => r.success).length,
        failCount: results.filter((r) => !r.success).length,
      },
    });

    // Notifier les admins (push + email)
    await this.notifyAdmins({
      eventType: "STAGE_2",
      session,
      participantName: userName,
      participantId: participantUserId,
      stage: 2,
      triggeredAt: participant.stage2TriggeredAt ?? new Date(),
    });

    sosLogger.info("Stage 2 completed - SMS sent to emergency contacts", {
      sessionId: sessionId.toString(),
      participantId: participantUserId,
      contactCount: contacts.length,
      successCount: results.filter((r) => r.success).length,
      failCount: results.filter((r) => !r.success).length,
    });
  }

  // ─── CONTACTS D'URGENCE ────────────────────────────────────────────

  /**
   * Ajouter un contact d'urgence
   */
  async addContact(
    userId: string,
    data: {
      name: string;
      phone: string;
      relationship?: string;
      isDefault?: boolean;
    },
  ): Promise<ISosContact> {
    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Valider le format du numéro de téléphone (E.164)
    if (!/^\+[1-9]\d{6,14}$/.test(data.phone)) {
      throw new Error(
        "Format de numéro de téléphone invalide. Utilisez le format international (ex: +33612345678)",
      );
    }

    // Vérifier le nombre max de contacts (5)
    const count = await SosContactModel.countDocuments({
      userId: userObjectId,
      deletedAt: null, // Ne compter que les contacts actifs
    });
    if (count >= 5) {
      throw new Error("MAX_CONTACTS_REACHED");
    }

    const contact = new SosContactModel({
      userId: userObjectId,
      name: data.name,
      phone: data.phone,
      relationship: data.relationship,
      isDefault: data.isDefault || false,
    });

    await contact.save();

    sosLogger.info("Emergency contact added", {
      userId,
      contactName: data.name,
    });

    return contact;
  }

  /**
   * Lister les contacts d'urgence d'un utilisateur
   */
  async getContacts(userId: string): Promise<any[]> {
    return SosContactModel.find({
      userId: new mongoose.Types.ObjectId(userId),
      deletedAt: null, // Exclure les contacts soft-deleted
    })
      .sort({ isDefault: -1, createdAt: -1 })
      .lean();
  }

  /**
   * Mettre à jour un contact d'urgence
   */
  async updateContact(
    userId: string,
    contactId: string,
    data: Partial<{
      name: string;
      phone: string;
      relationship: string;
      isDefault: boolean;
    }>,
  ): Promise<ISosContact | null> {
    // Valider le format du numéro de téléphone si fourni (E.164)
    if (data.phone && !/^\+[1-9]\d{6,14}$/.test(data.phone)) {
      throw new Error(
        "Format de numéro de téléphone invalide. Utilisez le format international (ex: +33612345678)",
      );
    }

    return SosContactModel.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(contactId),
        userId: new mongoose.Types.ObjectId(userId),
      },
      { $set: data },
      { new: true },
    );
  }

  /**
   * Supprimer un contact d'urgence (soft-delete pour les contacts permanents)
   */
  async deleteContact(userId: string, contactId: string): Promise<boolean> {
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const contactObjectId = new mongoose.Types.ObjectId(contactId);

    // Récupérer le contact pour vérifier s'il est temporaire ou permanent
    const contact = await SosContactModel.findOne({
      _id: contactObjectId,
      userId: userObjectId,
    });

    if (!contact) {
      return false;
    }

    // Si le contact est temporaire (lié à une session), faire un hard-delete
    if (contact.sessionId) {
      const result = await SosContactModel.deleteOne({
        _id: contactObjectId,
        userId: userObjectId,
      });
      return result.deletedCount > 0;
    }

    // Sinon, soft-delete pour les contacts permanents
    const result = await SosContactModel.findOneAndUpdate(
      {
        _id: contactObjectId,
        userId: userObjectId,
        sessionId: { $exists: false }, // Uniquement les contacts permanents
      },
      {
        $set: {
          deletedAt: new Date(),
          version: (contact.version || 1) + 1,
        },
      },
      { new: true },
    );

    return result !== null;
  }

  // ─── MÉTHODES ADMIN ────────────────────────────────────────────────

  /**
   * Helper: enrichir une session avec les infos participants pour l'admin
   * Décrypte les noms, calcule urgence basée sur le pire participant
   */
  private enrichSessionForAdmin(session: any): any {
    const now = new Date();
    const expiresAt = new Date(session.expiresAt);
    const timeRemaining = Math.floor(
      (expiresAt.getTime() - now.getTime()) / 1000,
    );
    const timeSinceExpired = timeRemaining < 0 ? Math.abs(timeRemaining) : null;

    // Calculer le niveau d'urgence basé sur le PIRE participant
    let urgencyLevel = "low";
    const participants = session.participants || [];
    const activeParticipants = participants.filter(
      (p: any) => p.status !== "LEFT",
    );

    if (activeParticipants.length > 0) {
      const worstStage = Math.max(
        ...activeParticipants.map((p: any) => p.currentStage ?? -1),
      );
      const hasEscalating = activeParticipants.some(
        (p: any) => p.status === "ESCALATING" || p.status === "DISCONNECTED",
      );

      if (worstStage >= 2) urgencyLevel = "critical";
      else if (worstStage === 1) urgencyLevel = "high";
      else if (worstStage === 0 || hasEscalating) urgencyLevel = "medium";
    } else if (session.status === "ESCALATING") {
      // Fallback session-level
      if (session.currentStage >= 2) urgencyLevel = "critical";
      else if (session.currentStage === 1) urgencyLevel = "high";
      else urgencyLevel = "medium";
    }

    // Construire l'aperçu des participants avec noms décryptés
    const participantsOverview = participants.map((p: any) => {
      const userInfo =
        p.userId && typeof p.userId === "object" ? p.userId : null;
      return {
        userId: userInfo ? userInfo._id?.toString() : p.userId?.toString(),
        name: userInfo?.name ? decrypt(userInfo.name) : null,
        surname: userInfo?.surname ? decrypt(userInfo.surname) : null,
        email: userInfo?.email ? decrypt(userInfo.email) : null,
        status: p.status,
        currentStage: p.currentStage,
        lastHeartbeatAt: p.lastHeartbeatAt,
        joinedAt: p.joinedAt,
        leftAt: p.leftAt,
        lastKnownLat: p.lastKnownLat ?? null,
        lastKnownLng: p.lastKnownLng ?? null,
        lastKnownAccuracy: p.lastKnownAccuracy ?? null,
      };
    });

    return {
      ...session,
      user:
        session.userId && typeof session.userId === "object"
          ? {
              id: session.userId._id,
              name: safeDecryptUserField(session.userId, "name"),
              surname: safeDecryptUserField(session.userId, "surname"),
            }
          : null,
      participantCount: participants.length,
      isGroupSession: participants.length > 1,
      participantsOverview,
      timeRemaining: Math.max(0, timeRemaining),
      timeSinceExpired,
      urgencyLevel,
    };
  }

  /**
   * Dashboard admin - Vue d'ensemble des sessions SOS
   * Inclut les infos de groupe et les compteurs de participants à risque
   */
  async getAdminDashboard(): Promise<{
    activeSessions: number;
    escalatingSessions: number;
    groupSessions: number;
    totalParticipantsAtRisk: number;
    resolvedToday: number;
    totalSessions24h: number;
    sessions: any[];
  }> {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Compter les sessions actives
    const activeSessions = await SosSessionModel.countDocuments({
      status: "ACTIVE",
    });

    // Compter les sessions en escalade
    const escalatingSessions = await SosSessionModel.countDocuments({
      status: "ESCALATING",
    });

    // Compter les sessions résolues dans les dernières 24h
    const resolvedToday = await SosSessionModel.countDocuments({
      status: "RESOLVED",
      resolvedAt: { $gte: yesterday },
    });

    // Compter toutes les sessions créées dans les dernières 24h
    const totalSessions24h = await SosSessionModel.countDocuments({
      activatedAt: { $gte: yesterday },
    });

    // Récupérer les sessions en cours (ACTIVE + EXPIRED + ESCALATING)
    const sessions = await SosSessionModel.find({
      status: { $in: ["ACTIVE", "EXPIRED", "ESCALATING"] },
    })
      .populate("userId", "name surname email")
      .populate("participants.userId", "name surname email")
      .sort({ status: -1, currentStage: -1, activatedAt: 1 })
      .lean();

    // Compteurs de groupe
    let groupSessions = 0;
    let totalParticipantsAtRisk = 0;

    // Décrypter les noms et enrichir les données
    const enrichedSessions = sessions.map((session: any) => {
      const participants = session.participants || [];
      if (participants.length > 1) groupSessions++;

      // Compter les participants à risque (DISCONNECTED ou ESCALATING)
      participants.forEach((p: any) => {
        if (p.status === "DISCONNECTED" || p.status === "ESCALATING") {
          totalParticipantsAtRisk++;
        }
      });

      return this.enrichSessionForAdmin(session);
    });

    return {
      activeSessions,
      escalatingSessions,
      groupSessions,
      totalParticipantsAtRisk,
      resolvedToday,
      totalSessions24h,
      sessions: enrichedSessions,
    };
  }

  /**
   * Récupérer toutes les sessions actives (admin)
   * Inclut les infos de participants pour chaque session
   */
  async getAllActiveSessions(): Promise<any[]> {
    // Récupérer TOUTES les sessions ACTIVE + EXPIRED + ESCALATING
    const sessions = await SosSessionModel.find({
      status: { $in: ["ACTIVE", "EXPIRED", "ESCALATING"] },
    })
      .populate("userId", "name surname email")
      .populate("participants.userId", "name surname email")
      .sort({ status: -1, currentStage: -1, activatedAt: 1 })
      .lean();

    // Décrypter les noms et enrichir les données
    const enrichedSessions = sessions.map((session: any) =>
      this.enrichSessionForAdmin(session),
    );

    return enrichedSessions;
  }

  /**
   * Annuler/résoudre une session (admin)
   */
  async adminCancelSession(
    sessionId: string,
    adminId: string,
    reason?: string,
  ): Promise<ISosSession> {
    const session = await SosSessionModel.findOne({
      _id: new mongoose.Types.ObjectId(sessionId),
      status: { $in: ["ACTIVE", "EXPIRED", "ESCALATING"] },
    });

    if (!session) {
      throw new Error("SESSION_NOT_FOUND");
    }

    const now = new Date();
    session.status = "RESOLVED";
    session.resolvedAt = now;
    session.resolvedBy = "ADMIN";

    // Marquer tous les participants comme LEFT
    session.participants.forEach((p) => {
      if (p.status !== "LEFT") {
        p.status = "LEFT";
        p.leftAt = now;
      }
    });

    await session.save();

    // Notifier tous les participants que la session a été annulée par un admin
    for (const participant of session.participants) {
      try {
        webSocketService.sendNotificationToUser(participant.userId.toString(), {
          type: "sos_session_cancelled_admin",
          sessionId: (session._id as mongoose.Types.ObjectId).toString(),
          message: "Votre session SOS a été annulée par un administrateur.",
          reason,
        });
      } catch (error) {
        sosLogger.error("Failed to notify participant of admin cancellation", {
          participantId: participant.userId.toString(),
          sessionId: session._id?.toString(),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Nettoyer les contacts temporaires
    await this.cleanupSessionContacts(session._id.toString());

    // Logger l'événement
    await this.logEvent(
      session._id as mongoose.Types.ObjectId,
      session.userId.toString(),
      "RESOLVED",
      {
        resolvedBy: "ADMIN",
        adminId,
        reason,
      },
    );

    // Audit critique
    await auditService.log({
      userId: adminId,
      action: "ADMIN_SOS_SESSION_CANCELLED",
      level: "critical",
      details: {
        sessionId: session._id,
        sessionUserId: session.userId,
        reason,
      },
    });

    sosLogger.info("Admin cancelled SOS session", {
      sessionId,
      adminId,
      reason,
    });

    return session;
  }

  /**
   * Récupérer les détails complets d'une session (admin)
   * Inclut les participants détaillés, contacts de tous les participants, events
   */
  async getSessionDetails(sessionId: string): Promise<any> {
    const session = await SosSessionModel.findById(
      new mongoose.Types.ObjectId(sessionId),
    )
      .populate("userId", "name surname email")
      .populate("participants.userId", "name surname email")
      .lean();

    if (!session) {
      throw new Error("SESSION_NOT_FOUND");
    }

    // Récupérer les événements liés à la session
    const events = await SosEventModel.find({
      sessionId: new mongoose.Types.ObjectId(sessionId),
    })
      .sort({ createdAt: -1 })
      .lean();

    const participants = (session as any).participants || [];
    const participantUserIds = participants
      .map((p: any) => {
        if (p.userId && typeof p.userId === "object") return p.userId._id;
        return p.userId;
      })
      .filter(Boolean);

    // Récupérer les contacts d'urgence de TOUS les participants
    const allContacts = await SosContactModel.find({
      userId: { $in: participantUserIds },
      deletedAt: null, // Exclure les contacts soft-deleted
    })
      .sort({ isDefault: -1, createdAt: -1 })
      .lean();

    // Sanitiser les contacts pour l'admin (masquer les numéros de téléphone)
    const sanitizedContacts = allContacts.map((contact) =>
      this.sanitizeContactForAdmin(contact),
    );

    // Grouper les contacts par participant userId
    const contactsByParticipant: Record<string, any[]> = {};
    const phonesSeen = new Set<string>();
    const deduplicatedContacts: any[] = [];

    sanitizedContacts.forEach((contact: any) => {
      const uid = contact.userId?.toString();
      if (!contactsByParticipant[uid]) contactsByParticipant[uid] = [];
      contactsByParticipant[uid].push(contact);

      // Déduplication par téléphone
      const phone = contact.phone?.toString()?.trim();
      if (phone && !phonesSeen.has(phone)) {
        phonesSeen.add(phone);
        deduplicatedContacts.push(contact);
      }
    });

    // Construire les détails de chaque participant
    const participantsDetails = participants.map((p: any) => {
      const userInfo =
        p.userId && typeof p.userId === "object" ? p.userId : null;
      const uid = userInfo ? userInfo._id?.toString() : p.userId?.toString();
      return {
        userId: uid,
        name: userInfo?.name ? decrypt(userInfo.name) : null,
        surname: userInfo?.surname ? decrypt(userInfo.surname) : null,
        email: userInfo?.email ? decrypt(userInfo.email) : null,
        status: p.status,
        currentStage: p.currentStage,
        joinedAt: p.joinedAt,
        leftAt: p.leftAt,
        lastHeartbeatAt: p.lastHeartbeatAt,
        lastKnownLat: p.lastKnownLat,
        lastKnownLng: p.lastKnownLng,
        lastKnownAccuracy: p.lastKnownAccuracy,
        stage0TriggeredAt: p.stage0TriggeredAt,
        stage1TriggeredAt: p.stage1TriggeredAt,
        stage2TriggeredAt: p.stage2TriggeredAt,
        consecutiveHeartbeats: p.consecutiveHeartbeats,
        surfaceDetectionSent: p.surfaceDetectionSent,
        reconnectionDetectionSent: p.reconnectionDetectionSent,
        contacts: contactsByParticipant[uid || ""] || [],
      };
    });

    // Calculer des métriques utiles
    const now = new Date();
    const expiresAt = new Date(session.expiresAt);
    const timeRemaining = Math.floor(
      (expiresAt.getTime() - now.getTime()) / 1000,
    );
    const timeSinceExpired = timeRemaining < 0 ? Math.abs(timeRemaining) : null;

    // Calculer le niveau d'urgence basé sur le pire participant
    let urgencyLevel = "low";
    const activeParticipants = participants.filter(
      (p: any) => p.status !== "LEFT",
    );
    if (activeParticipants.length > 0) {
      const worstStage = Math.max(
        ...activeParticipants.map((p: any) => p.currentStage ?? -1),
      );
      const hasEscalating = activeParticipants.some(
        (p: any) => p.status === "ESCALATING" || p.status === "DISCONNECTED",
      );
      if (worstStage >= 2) urgencyLevel = "critical";
      else if (worstStage === 1) urgencyLevel = "high";
      else if (worstStage === 0 || hasEscalating) urgencyLevel = "medium";
    } else if (session.status === "ESCALATING") {
      if (session.currentStage >= 2) urgencyLevel = "critical";
      else if (session.currentStage === 1) urgencyLevel = "high";
      else urgencyLevel = "medium";
    }

    return {
      session: {
        ...session,
        user:
          (session as any).userId && typeof (session as any).userId === "object"
            ? {
                id: (session as any).userId._id,
                name: safeDecryptUserField((session as any).userId, "name"),
                surname: safeDecryptUserField(
                  (session as any).userId,
                  "surname",
                ),
                email: safeDecryptUserField((session as any).userId, "email"),
              }
            : null,
        participantCount: participants.length,
        isGroupSession: participants.length > 1,
        timeRemaining: Math.max(0, timeRemaining),
        timeSinceExpired,
        urgencyLevel,
      },
      participantsDetails,
      events,
      contacts: sanitizedContacts,
      deduplicatedContacts,
      contactsByParticipant,
    };
  }

  /**
   * Récupérer l'historique de toutes les sessions (admin)
   * Supporte la recherche par userId comme créateur OU participant
   */
  async getAdminSessionHistory(
    limit: number = 50,
    status?: string,
    userId?: string,
  ): Promise<any[]> {
    const query: any = {};

    if (status) {
      query.status = status;
    }

    if (userId) {
      const userObjectId = new mongoose.Types.ObjectId(userId);
      // Chercher dans userId (créateur) OU dans participants.userId
      query.$or = [
        { userId: userObjectId },
        { "participants.userId": userObjectId },
      ];
    }

    const sessions = await SosSessionModel.find(query)
      .populate("userId", "name surname")
      .populate("participants.userId", "name surname")
      .sort({ createdAt: -1 })
      .limit(Math.min(limit, 100))
      .lean();

    // Décrypter les noms et enrichir avec infos participants
    const enrichedSessions = sessions.map((session: any) => {
      const participants = session.participants || [];
      const participantsOverview = participants.map((p: any) => {
        const userInfo =
          p.userId && typeof p.userId === "object" ? p.userId : null;
        return {
          userId: userInfo ? userInfo._id?.toString() : p.userId?.toString(),
          name: userInfo?.name ? decrypt(userInfo.name) : null,
          surname: userInfo?.surname ? decrypt(userInfo.surname) : null,
          status: p.status,
        };
      });

      return {
        ...session,
        user:
          session.userId && typeof session.userId === "object"
            ? {
                id: session.userId._id,
                name: safeDecryptUserField(session.userId, "name"),
                surname: safeDecryptUserField(session.userId, "surname"),
              }
            : null,
        participantCount: participants.length,
        isGroupSession: participants.length > 1,
        participantsOverview,
      };
    });

    return enrichedSessions;
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * STATISTIQUES ADMIN - RAPPORTS GLOBAUX SOS
   * ═══════════════════════════════════════════════════════════════════════════
   * Agrégation performante via MongoDB pour les rapports admin
   * Analyse des patterns, durées, escalades, SMS et utilisateurs
   */
  async getAdminSosStats(startDate?: Date, endDate?: Date): Promise<any> {
    const startTime = Date.now();

    // ─── CONSTRUCTION DU FILTRE DE DATE ────────────────────────────────
    const dateFilter: any = {};
    if (startDate || endDate) {
      dateFilter.activatedAt = {};
      if (startDate) dateFilter.activatedAt.$gte = startDate;
      if (endDate) dateFilter.activatedAt.$lte = endDate;
    }

    // ─── PÉRIODE ANALYSÉE ──────────────────────────────────────────────
    const period = {
      startDate: startDate || null,
      endDate: endDate || null,
      totalDays:
        startDate && endDate
          ? Math.ceil(
              (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
            )
          : 0,
    };

    // ─── VUE D'ENSEMBLE ────────────────────────────────────────────────
    const overviewPipeline: any[] = [
      { $match: dateFilter },
      {
        $group: {
          _id: null,
          totalSessions: { $sum: 1 },
          activeSessions: {
            $sum: {
              $cond: [{ $eq: ["$status", "ACTIVE"] }, 1, 0],
            },
          },
          escalatingSessions: {
            $sum: {
              $cond: [{ $eq: ["$status", "ESCALATING"] }, 1, 0],
            },
          },
          resolvedSessions: {
            $sum: {
              $cond: [{ $eq: ["$status", "RESOLVED"] }, 1, 0],
            },
          },
          groupSessions: {
            $sum: {
              $cond: [
                { $gt: [{ $size: { $ifNull: ["$participants", []] } }, 1] },
                1,
                0,
              ],
            },
          },
          soloSessions: {
            $sum: {
              $cond: [
                { $lte: [{ $size: { $ifNull: ["$participants", []] } }, 1] },
                1,
                0,
              ],
            },
          },
          totalParticipants: {
            $sum: { $size: { $ifNull: ["$participants", []] } },
          },
          groupParticipantsTotal: {
            $sum: {
              $cond: [
                { $gt: [{ $size: { $ifNull: ["$participants", []] } }, 1] },
                { $size: { $ifNull: ["$participants", []] } },
                0,
              ],
            },
          },
        },
      },
    ];

    const overviewResult = await SosSessionModel.aggregate(overviewPipeline);
    const overviewRaw = overviewResult[0] || {
      totalSessions: 0,
      activeSessions: 0,
      escalatingSessions: 0,
      resolvedSessions: 0,
      groupSessions: 0,
      soloSessions: 0,
      totalParticipants: 0,
      groupParticipantsTotal: 0,
    };
    delete overviewRaw._id;

    const overview = {
      totalSessions: overviewRaw.totalSessions,
      activeSessions: overviewRaw.activeSessions,
      escalatingSessions: overviewRaw.escalatingSessions,
      resolvedSessions: overviewRaw.resolvedSessions,
      groupSessions: overviewRaw.groupSessions,
      soloSessions: overviewRaw.soloSessions,
    };

    // ─── DURÉES (sessions résolues uniquement) ────────────────────────
    const durationsPipeline: any[] = [
      {
        $match: {
          ...dateFilter,
          status: "RESOLVED",
          resolvedAt: { $exists: true },
        },
      },
      {
        $addFields: {
          durationMinutes: {
            $divide: [
              { $subtract: ["$resolvedAt", "$activatedAt"] },
              60000, // Convertir ms en minutes
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          totalDuration: { $sum: "$durationMinutes" },
          avgDuration: { $avg: "$durationMinutes" },
          maxDuration: { $max: "$durationMinutes" },
          minDuration: { $min: "$durationMinutes" },
          allDurations: { $push: "$durationMinutes" },
        },
      },
    ];

    const durationsResult = await SosSessionModel.aggregate(durationsPipeline);

    let durations = {
      totalDuration: 0,
      averageDuration: 0,
      medianDuration: 0,
      longestSession: 0,
      shortestSession: 0,
    };

    if (durationsResult.length > 0) {
      const durData = durationsResult[0];

      // Calcul de la médiane
      const sortedDurations = durData.allDurations.sort(
        (a: number, b: number) => a - b,
      );
      const mid = Math.floor(sortedDurations.length / 2);
      const median =
        sortedDurations.length % 2 === 0
          ? (sortedDurations[mid - 1] + sortedDurations[mid]) / 2
          : sortedDurations[mid];

      durations = {
        totalDuration: Math.round(durData.totalDuration || 0),
        averageDuration: Math.round(durData.avgDuration || 0),
        medianDuration: Math.round(median || 0),
        longestSession: Math.round(durData.maxDuration || 0),
        shortestSession: Math.round(durData.minDuration || 0),
      };
    }

    // ─── ESCALADE ──────────────────────────────────────────────────────
    const escalationPipeline: any[] = [
      { $match: dateFilter },
      {
        $group: {
          _id: null,
          totalSessions: { $sum: 1 },
          escalatedSessions: {
            $sum: {
              $cond: [{ $gte: ["$currentStage", 0] }, 1, 0],
            },
          },
          // Fausses alertes = sessions escaladées puis résolues par USER ou CONTACT_CONFIRM
          falseAlerts: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ["$currentStage", 0] },
                    {
                      $in: ["$resolvedBy", ["USER", "CONTACT_CONFIRM"]],
                    },
                  ],
                },
                1,
                0,
              ],
            },
          },
          stage0Count: {
            $sum: {
              $cond: [{ $gte: ["$currentStage", 0] }, 1, 0],
            },
          },
          stage1Count: {
            $sum: {
              $cond: [{ $gte: ["$currentStage", 1] }, 1, 0],
            },
          },
          stage2Count: {
            $sum: {
              $cond: [{ $eq: ["$currentStage", 2] }, 1, 0],
            },
          },
        },
      },
    ];

    const escalationResult =
      await SosSessionModel.aggregate(escalationPipeline);

    let escalation = {
      escalationRate: 0,
      falseAlertRate: 0,
      stageDistribution: {
        stage0: 0,
        stage1: 0,
        stage2: 0,
      },
    };

    if (escalationResult.length > 0) {
      const escData = escalationResult[0];
      escalation = {
        escalationRate:
          escData.totalSessions > 0
            ? Math.round(
                (escData.escalatedSessions / escData.totalSessions) * 100 * 10,
              ) / 10
            : 0,
        falseAlertRate:
          escData.escalatedSessions > 0
            ? Math.round(
                (escData.falseAlerts / escData.escalatedSessions) * 100 * 10,
              ) / 10
            : 0,
        stageDistribution: {
          stage0: escData.stage0Count || 0,
          stage1: escData.stage1Count || 0,
          stage2: escData.stage2Count || 0,
        },
      };
    }

    // ─── RÉSOLUTION ────────────────────────────────────────────────────
    const resolutionPipeline: any[] = [
      {
        $match: {
          ...dateFilter,
          status: "RESOLVED",
          resolvedBy: { $exists: true },
        },
      },
      {
        $group: {
          _id: "$resolvedBy",
          count: { $sum: 1 },
        },
      },
    ];

    const resolutionResult =
      await SosSessionModel.aggregate(resolutionPipeline);

    const resolution = {
      byUser: 0,
      byHeartbeatAuto: 0,
      byAdmin: 0,
      byContactConfirm: 0,
    };

    resolutionResult.forEach((item: any) => {
      switch (item._id) {
        case "USER":
          resolution.byUser = item.count;
          break;
        case "HEARTBEAT_AUTO":
          resolution.byHeartbeatAuto = item.count;
          break;
        case "ADMIN":
          resolution.byAdmin = item.count;
          break;
        case "CONTACT_CONFIRM":
          resolution.byContactConfirm = item.count;
          break;
      }
    });

    // ─── SMS (via SosEvent) ────────────────────────────────────────────
    const smsPipeline: any[] = [
      {
        $match: {
          type: { $in: ["SMS_SENT", "SMS_FAILED"] },
          ...(dateFilter.activatedAt && { createdAt: dateFilter.activatedAt }),
        },
      },
      {
        $group: {
          _id: "$type",
          count: { $sum: 1 },
        },
      },
    ];

    const smsResult = await SosEventModel.aggregate(smsPipeline);

    const sms = {
      totalSent: 0,
      totalFailed: 0,
      successRate: 0,
    };

    smsResult.forEach((item: any) => {
      if (item._id === "SMS_SENT") sms.totalSent = item.count;
      if (item._id === "SMS_FAILED") sms.totalFailed = item.count;
    });

    const totalSmsAttempts = sms.totalSent + sms.totalFailed;
    sms.successRate =
      totalSmsAttempts > 0
        ? Math.round((sms.totalSent / totalSmsAttempts) * 100 * 10) / 10
        : 0;

    // ─── TOP SITES ─────────────────────────────────────────────────────
    const topSitesPipeline: any[] = [
      {
        $match: {
          ...dateFilter,
          siteName: { $exists: true, $ne: null, $nin: [null, ""] },
          status: "RESOLVED",
          resolvedAt: { $exists: true },
        },
      },
      {
        $addFields: {
          durationMinutes: {
            $divide: [{ $subtract: ["$resolvedAt", "$activatedAt"] }, 60000],
          },
        },
      },
      {
        $group: {
          _id: "$siteName",
          count: { $sum: 1 },
          avgDuration: { $avg: "$durationMinutes" },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
      {
        $project: {
          _id: 0,
          siteName: "$_id",
          count: 1,
          averageDuration: { $round: ["$avgDuration", 0] },
        },
      },
    ];

    const topSites = await SosSessionModel.aggregate(topSitesPipeline);

    // ─── PATTERNS TEMPORELS ────────────────────────────────────────────
    const dayNames = [
      "Dimanche",
      "Lundi",
      "Mardi",
      "Mercredi",
      "Jeudi",
      "Vendredi",
      "Samedi",
    ];

    // Par jour de la semaine
    const byDayPipeline: any[] = [
      { $match: dateFilter },
      {
        $group: {
          _id: { $dayOfWeek: "$activatedAt" }, // 1=dimanche, 7=samedi
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ];

    const byDayResult = await SosSessionModel.aggregate(byDayPipeline);
    const byDayOfWeek = Array.from({ length: 7 }, (_, i) => ({
      day: i,
      dayName: dayNames[i],
      count: 0,
    }));

    byDayResult.forEach((item: any) => {
      const dayIndex = item._id - 1; // MongoDB retourne 1-7, on veut 0-6
      byDayOfWeek[dayIndex].count = item.count;
    });

    // Par heure
    const byHourPipeline: any[] = [
      { $match: dateFilter },
      {
        $group: {
          _id: { $hour: "$activatedAt" },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ];

    const byHourResult = await SosSessionModel.aggregate(byHourPipeline);
    const byHour = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      count: 0,
    }));

    byHourResult.forEach((item: any) => {
      byHour[item._id].count = item.count;
    });

    const patterns = {
      byDayOfWeek,
      byHour,
    };

    // ─── UTILISATEURS ──────────────────────────────────────────────────
    // Compter les sessions par participant (via $unwind sur participants)
    // pour inclure les participations (pas juste les sessions créées)
    const usersPipeline: any[] = [
      { $match: dateFilter },
      { $unwind: { path: "$participants", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: {
            $ifNull: ["$participants.userId", "$userId"],
          },
          sessionCount: { $sum: 1 },
          asCreator: {
            $sum: {
              $cond: [{ $eq: ["$participants.userId", "$userId"] }, 1, 0],
            },
          },
          totalDuration: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$status", "RESOLVED"] },
                    { $ne: ["$resolvedAt", null] },
                  ],
                },
                {
                  $divide: [
                    { $subtract: ["$resolvedAt", "$activatedAt"] },
                    60000,
                  ],
                },
                0,
              ],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          userId: { $toString: "$_id" },
          sessionCount: 1,
          asCreator: 1,
          totalDuration: { $round: ["$totalDuration", 0] },
        },
      },
    ];

    const usersResult = await SosSessionModel.aggregate(usersPipeline);

    const topUsers = usersResult
      .sort((a: any, b: any) => b.sessionCount - a.sessionCount)
      .slice(0, 10);

    const uniqueUsers = usersResult.length;
    const averageSessionsPerUser =
      uniqueUsers > 0
        ? Math.round((overview.totalSessions / uniqueUsers) * 10) / 10
        : 0;

    const users = {
      uniqueUsers,
      topUsers,
      averageSessionsPerUser,
    };

    // ─── HEARTBEATS ────────────────────────────────────────────────────
    const heartbeatsPipeline: any[] = [
      {
        $match: {
          type: "HEARTBEAT",
          ...(dateFilter.activatedAt && { createdAt: dateFilter.activatedAt }),
        },
      },
      {
        $group: {
          _id: null,
          totalHeartbeats: { $sum: 1 },
        },
      },
    ];

    const heartbeatsResult = await SosEventModel.aggregate(heartbeatsPipeline);

    const totalHeartbeats =
      heartbeatsResult.length > 0 ? heartbeatsResult[0].totalHeartbeats : 0;
    const averagePerSession =
      overview.totalSessions > 0
        ? Math.round((totalHeartbeats / overview.totalSessions) * 10) / 10
        : 0;

    const heartbeats = {
      totalHeartbeats,
      averagePerSession,
    };

    // ─── STATISTIQUES DE GROUPE ───────────────────────────────────────
    const groupStatsPipeline: any[] = [
      { $match: dateFilter },
      {
        $addFields: {
          participantCount: { $size: { $ifNull: ["$participants", []] } },
        },
      },
      {
        $match: { participantCount: { $gt: 1 } },
      },
      {
        $group: {
          _id: null,
          totalGroupSessions: { $sum: 1 },
          avgGroupSize: { $avg: "$participantCount" },
          maxGroupSize: { $max: "$participantCount" },
          totalGroupParticipants: { $sum: "$participantCount" },
        },
      },
    ];

    const groupStatsResult =
      await SosSessionModel.aggregate(groupStatsPipeline);

    // Compter le taux d'escalation par participant
    const participantEscalationPipeline: any[] = [
      { $match: dateFilter },
      { $unwind: "$participants" },
      {
        $group: {
          _id: null,
          totalParticipants: { $sum: 1 },
          escalatedParticipants: {
            $sum: {
              $cond: [{ $gte: ["$participants.currentStage", 0] }, 1, 0],
            },
          },
        },
      },
    ];

    const participantEscResult = await SosSessionModel.aggregate(
      participantEscalationPipeline,
    );

    const groupStatsData = groupStatsResult[0] || {
      totalGroupSessions: 0,
      avgGroupSize: 0,
      maxGroupSize: 0,
      totalGroupParticipants: 0,
    };

    const partEscData = participantEscResult[0] || {
      totalParticipants: 0,
      escalatedParticipants: 0,
    };

    const groupStats = {
      totalGroupSessions: groupStatsData.totalGroupSessions,
      totalSoloSessions: overviewRaw.soloSessions,
      averageGroupSize:
        Math.round((groupStatsData.avgGroupSize || 0) * 10) / 10,
      maxGroupSize: groupStatsData.maxGroupSize || 0,
      participantEscalationRate:
        partEscData.totalParticipants > 0
          ? Math.round(
              (partEscData.escalatedParticipants /
                partEscData.totalParticipants) *
                100 *
                10,
            ) / 10
          : 0,
    };

    // ─── RÉSULTAT FINAL ────────────────────────────────────────────────
    const duration = Date.now() - startTime;
    sosLogger.info("Admin SOS stats calculated", {
      durationMs: duration,
      totalSessions: overview.totalSessions,
    });

    return {
      period,
      overview,
      durations,
      escalation,
      resolution,
      sms,
      topSites,
      patterns,
      users,
      heartbeats,
      groupStats,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MÉTHODES ADMIN AVANCÉES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Admin: Forcer un heartbeat pour un participant
   * Prolonge la session et réactive le participant si nécessaire
   */
  async adminHeartbeat(
    sessionId: string,
    userId: string,
    adminId: string,
  ): Promise<ISosSession> {
    const session = await SosSessionModel.findOne({
      _id: new mongoose.Types.ObjectId(sessionId),
      status: { $in: ["ACTIVE", "EXPIRED", "ESCALATING"] },
    });

    if (!session) {
      throw new Error("SESSION_NOT_FOUND");
    }

    const participant = session.participants.find(
      (p) => p.userId.toString() === userId && p.status !== "LEFT",
    );

    if (!participant) {
      throw new Error("PARTICIPANT_NOT_FOUND");
    }

    const now = new Date();

    // Mettre à jour le heartbeat du participant
    participant.lastHeartbeatAt = now;
    participant.consecutiveHeartbeats =
      (participant.consecutiveHeartbeats || 0) + 1;

    // Si participant était déconnecté ou en escalade → réactiver
    if (
      participant.status === "DISCONNECTED" ||
      participant.status === "ESCALATING"
    ) {
      participant.status = "ACTIVE";
      participant.currentStage = -1;

      sosLogger.info("Participant reactivated by admin heartbeat", {
        sessionId: sessionId,
        userId,
        previousStatus: participant.status,
      });
    }

    // Incrémenter le compteur de heartbeats de la session
    session.heartbeatCount = (session.heartbeatCount || 0) + 1;

    // Prolonger l'expiration : MAX(expiresAt actuel, now + HEARTBEAT_EXTENSION_MINUTES)
    // Ne jamais réduire un timer long existant
    const adminHeartbeatFloor = new Date(
      now.getTime() + HEARTBEAT_EXTENSION_MINUTES * 60 * 1000,
    );
    if (adminHeartbeatFloor > session.expiresAt) {
      session.expiresAt = adminHeartbeatFloor;
    }

    // Si session était EXPIRED ou ESCALATING et plus aucun participant en danger → repasser en ACTIVE
    const hasParticipantsInDanger = session.participants.some(
      (p) =>
        p.status !== "LEFT" &&
        (p.status === "DISCONNECTED" || p.status === "ESCALATING"),
    );

    if (
      (session.status === "EXPIRED" || session.status === "ESCALATING") &&
      !hasParticipantsInDanger
    ) {
      session.status = "ACTIVE";
      session.currentStage = -1;

      sosLogger.info("Session reactivated by admin heartbeat", {
        sessionId: sessionId,
        previousStatus: session.status,
      });
    }

    await session.save();

    // Logger l'événement
    await this.logEvent(
      session._id as mongoose.Types.ObjectId,
      userId,
      "HEARTBEAT",
      {
        triggeredBy: "admin",
        adminId,
        consecutiveHeartbeats: participant.consecutiveHeartbeats,
      },
    );

    // Audit critique
    await auditService.log({
      userId: adminId,
      action: "ADMIN_SOS_HEARTBEAT",
      level: "critical",
      details: {
        sessionId: session._id,
        targetUserId: userId,
        consecutiveHeartbeats: participant.consecutiveHeartbeats,
      },
    });

    sosLogger.info("Admin forced heartbeat", {
      sessionId,
      userId,
      adminId,
      consecutiveHeartbeats: participant.consecutiveHeartbeats,
    });

    return session;
  }

  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Admin: Prolonger la durée d'une session
   * Ajoute des minutes supplémentaires à l'expiration
   */
  async adminExtendSession(
    sessionId: string,
    additionalMinutes: number,
    adminId: string,
  ): Promise<ISosSession> {
    const session = await SosSessionModel.findOne({
      _id: new mongoose.Types.ObjectId(sessionId),
      status: { $in: ["ACTIVE", "EXPIRED", "ESCALATING"] },
    });

    if (!session) {
      throw new Error("SESSION_NOT_FOUND");
    }

    // Valider la durée
    if (
      additionalMinutes < MIN_DURATION_MINUTES ||
      additionalMinutes > MAX_DURATION_MINUTES
    ) {
      throw new Error("INVALID_EXTENSION_DURATION");
    }

    const now = new Date();

    // Prolonger l'expiration
    session.expiresAt = new Date(
      session.expiresAt.getTime() + additionalMinutes * 60 * 1000,
    );

    // Incrémenter le compteur d'extensions
    session.extensionCount = (session.extensionCount || 0) + 1;

    // Si session était EXPIRED → repasser en ACTIVE
    if (session.status === "EXPIRED") {
      session.status = "ACTIVE";

      sosLogger.info("Expired session reactivated by admin extension", {
        sessionId: sessionId,
        additionalMinutes,
      });
    }

    await session.save();

    // Logger l'événement
    await this.logEvent(
      session._id as mongoose.Types.ObjectId,
      session.userId.toString(),
      "EXTENDED",
      {
        triggeredBy: "admin",
        adminId,
        additionalMinutes,
        newExpiresAt: session.expiresAt,
      },
    );

    // Audit critique
    await auditService.log({
      userId: adminId,
      action: "ADMIN_SOS_EXTEND_SESSION",
      level: "critical",
      details: {
        sessionId: session._id,
        additionalMinutes,
        newExpiresAt: session.expiresAt,
        extensionCount: session.extensionCount,
      },
    });

    sosLogger.info("Admin extended session", {
      sessionId,
      adminId,
      additionalMinutes,
      extensionCount: session.extensionCount,
    });

    return session;
  }

  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Admin: Forcer l'escalade d'un participant vers un stage spécifique
   * Permet de déclencher manuellement les alertes d'escalade
   */
  async adminForceEscalation(
    sessionId: string,
    userId: string,
    targetStage: number,
    adminId: string,
  ): Promise<ISosSession> {
    const session = await SosSessionModel.findOne({
      _id: new mongoose.Types.ObjectId(sessionId),
      status: { $in: ["ACTIVE", "EXPIRED", "ESCALATING"] },
    });

    if (!session) {
      throw new Error("SESSION_NOT_FOUND");
    }

    const participant = session.participants.find(
      (p) => p.userId.toString() === userId && p.status !== "LEFT",
    );

    if (!participant) {
      throw new Error("PARTICIPANT_NOT_FOUND");
    }

    // Valider le stage cible
    if (![0, 1, 2].includes(targetStage)) {
      throw new Error("INVALID_STAGE");
    }

    // Vérifier que le stage cible est supérieur au stage actuel
    if (targetStage <= (participant.currentStage ?? -1)) {
      throw new Error("STAGE_ALREADY_REACHED");
    }

    // Déclencher l'escalade appropriée
    if (targetStage === 0) {
      await this.triggerStage0(session, participant);
    } else if (targetStage === 1) {
      await this.triggerStage1(session, participant);
    } else if (targetStage === 2) {
      await this.triggerStage2(session, participant);
    }

    // Mettre la session en état ESCALATING
    session.status = "ESCALATING";
    if (targetStage > (session.currentStage ?? -1)) {
      session.currentStage = targetStage;
    }

    await session.save();

    // Logger l'événement
    await this.logEvent(
      session._id as mongoose.Types.ObjectId,
      userId,
      "STAGE_CHANGE",
      {
        triggeredBy: "admin",
        adminId,
        stage: targetStage,
        previousStage: participant.currentStage,
      },
    );

    // Audit critique
    await auditService.log({
      userId: adminId,
      action: "ADMIN_SOS_FORCE_ESCALATION",
      level: "critical",
      details: {
        sessionId: session._id,
        targetUserId: userId,
        targetStage,
        previousStage: participant.currentStage,
      },
    });

    sosLogger.info("Admin forced escalation", {
      sessionId,
      userId,
      targetStage,
      adminId,
    });

    // Notifier les autres admins (push + email) — escalade forcée par un admin
    const targetUser = await UserModel.findById(userId).lean();
    const targetUserName = targetUser
      ? `${decrypt(targetUser.name)} ${decrypt(targetUser.surname)}`
      : "Un utilisateur";

    await this.notifyAdmins({
      eventType: "ADMIN_FORCE_ESCALATION",
      session,
      participantName: targetUserName,
      participantId: userId,
      stage: targetStage,
      triggeredAt: new Date(),
    });

    return session;
  }

  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Admin: Activer une session SOS pour un utilisateur spécifique
   * Contrairement à la méthode mobile, ne vérifie pas les contacts d'urgence
   */
  async adminActivateSession(params: {
    targetUserId: string;
    adminId: string;
    expectedDuration: number;
    note?: string;
    lat?: number;
    lng?: number;
    siteName?: string;
    zone?: string;
    depth?: number;
    participantIds?: string[];
  }): Promise<ISosSession> {
    const {
      targetUserId,
      adminId,
      expectedDuration,
      note,
      lat,
      lng,
      siteName,
      zone,
      depth,
      participantIds,
    } = params;

    // Valider la durée
    if (
      expectedDuration < MIN_DURATION_MINUTES ||
      expectedDuration > MAX_DURATION_MINUTES
    ) {
      throw new Error("INVALID_DURATION");
    }

    const targetUserObjectId = new mongoose.Types.ObjectId(targetUserId);

    // Collecter tous les IDs de participants (créateur + participants ajoutés)
    const allParticipantIds = [targetUserId];
    if (participantIds && participantIds.length > 0) {
      allParticipantIds.push(...participantIds);
    }

    // Vérifier qu'aucun des participants n'a déjà une session active
    const participantObjectIds = allParticipantIds.map(
      (id) => new mongoose.Types.ObjectId(id),
    );

    const mongoSession = await mongoose.startSession();
    mongoSession.startTransaction();

    let session: InstanceType<typeof SosSessionModel>;

    try {
      const existingSessions = await SosSessionModel.find({
        status: { $in: ["ACTIVE", "EXPIRED", "ESCALATING"] },
        participants: {
          $elemMatch: {
            userId: { $in: participantObjectIds },
            status: { $ne: "LEFT" },
          },
        },
      })
        .session(mongoSession)
        .lean();

      if (existingSessions.length > 0) {
        throw new Error("SESSION_ALREADY_ACTIVE");
      }

      // Vérifier que les participants existent dans la base de données
      if (participantIds && participantIds.length > 0) {
        const participantUsers = await UserModel.find({
          _id: {
            $in: participantIds.map((id) => new mongoose.Types.ObjectId(id)),
          },
        })
          .select("_id")
          .session(mongoSession)
          .lean();

        if (participantUsers.length !== participantIds.length) {
          throw new Error("INVALID_PARTICIPANT_IDS");
        }
      }

      // Calculer la date d'expiration
      const now = new Date();
      const expiresAt = new Date(now.getTime() + expectedDuration * 60 * 1000);

      // Créer les participants
      const participants: ISosParticipant[] = allParticipantIds.map(
        (participantId) => ({
          userId: new mongoose.Types.ObjectId(participantId),
          joinedAt: now,
          leftAt: null,
          status: "ACTIVE" as SosParticipantStatus,
          currentStage: -1,
          stage0TriggeredAt: null,
          stage1TriggeredAt: null,
          stage2TriggeredAt: null,
          lastHeartbeatAt: null,
          lastKnownLat: lat,
          lastKnownLng: lng,
          lastKnownAccuracy: undefined,
          consecutiveHeartbeats: 0,
          firstReconnectionAt: null,
          surfaceDetectionSent: false,
          reconnectionDetectionSent: false,
        }),
      );

      // Créer la session (l'admin force l'activation sans vérifier les contacts)
      const newSession = new SosSessionModel({
        userId: targetUserObjectId,
        status: "ACTIVE",
        currentStage: -1,
        activatedAt: now,
        expectedDuration,
        expiresAt,
        lastKnownLat: lat,
        lastKnownLng: lng,
        lastKnownAccuracy: undefined,
        entryLat: lat,
        entryLng: lng,
        note: note || `Session créée par l'administrateur`,
        siteName,
        zone,
        depth,
        heartbeatCount: 0,
        extensionCount: 0,
        consecutiveHeartbeats: 0,
        surfaceDetectionSent: false,
        reconnectionDetectionSent: false,
        useDefaultContacts: true, // Utilisera les contacts par défaut si disponibles
        participants,
      });
      await newSession.save({ session: mongoSession });
      session = newSession;

      await mongoSession.commitTransaction();
    } catch (err) {
      await mongoSession.abortTransaction();
      throw err;
    } finally {
      mongoSession.endSession();
    }

    // Récupérer le nom de l'admin pour les notifications
    const admin = await UserModel.findById(adminId).lean();
    const adminName = admin ? decrypt(admin.name) : "Un administrateur";

    // Notifier TOUS les participants (y compris le créateur)
    for (const participantId of allParticipantIds) {
      try {
        // Push notification
        await createNotification(
          new mongoose.Types.ObjectId(participantId),
          "sos_alert",
          "🆘 Session SOS activée",
          `Une session SOS a été activée pour vous par ${adminName}.`,
          {
            sosSessionId: session._id,
          },
        );

        // WebSocket notification
        webSocketService.sendNotificationToUser(participantId, {
          type: "sos_session_activated_admin",
          sessionId: (session._id as mongoose.Types.ObjectId).toString(),
          adminName,
          adminId,
          message: `Session SOS activée par ${adminName}`,
        });

        // Logger l'événement
        await this.logEvent(
          session._id as mongoose.Types.ObjectId,
          participantId,
          participantId === targetUserId ? "ACTIVATED" : "PARTICIPANT_ADDED",
          {
            triggeredBy: "admin",
            adminId,
            adminName,
          },
        );
      } catch (error) {
        sosLogger.error("Failed to notify participant of admin activation", {
          participantId,
          sessionId: session._id?.toString(),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Audit critique
    await auditService.log({
      userId: adminId,
      action: "ADMIN_SOS_ACTIVATE_SESSION",
      level: "critical",
      details: {
        sessionId: session._id,
        targetUserId,
        expectedDuration,
        participantCount: allParticipantIds.length,
        siteName,
        zone,
      },
    });

    sosLogger.info("Admin activated SOS session", {
      sessionId: session._id?.toString(),
      targetUserId,
      adminId,
      participantCount: allParticipantIds.length,
    });

    return session;
  }

  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Admin: Confirmer la sécurité d'un utilisateur et résoudre sa session
   * Similaire à adminCancelSession mais avec un type de résolution différent
   */
  async adminConfirmSafe(
    sessionId: string,
    adminId: string,
    reason?: string,
  ): Promise<ISosSession> {
    const session = await SosSessionModel.findOne({
      _id: new mongoose.Types.ObjectId(sessionId),
      status: { $in: ["ACTIVE", "EXPIRED", "ESCALATING"] },
    });

    if (!session) {
      throw new Error("SESSION_NOT_FOUND");
    }

    const now = new Date();
    session.status = "RESOLVED";
    session.resolvedAt = now;
    session.resolvedBy = "ADMIN";

    // Marquer tous les participants comme LEFT
    session.participants.forEach((p) => {
      if (p.status !== "LEFT") {
        p.status = "LEFT";
        p.leftAt = now;
      }
    });

    await session.save();

    // Notifier tous les participants que leur sécurité a été confirmée
    for (const participant of session.participants) {
      try {
        webSocketService.sendNotificationToUser(participant.userId.toString(), {
          type: "sos_confirmed_safe_admin",
          sessionId: (session._id as mongoose.Types.ObjectId).toString(),
          message:
            "Votre sécurité a été confirmée par un administrateur. Session terminée.",
          reason,
        });
      } catch (error) {
        sosLogger.error("Failed to notify participant of admin confirmation", {
          participantId: participant.userId.toString(),
          sessionId: session._id?.toString(),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Nettoyer les contacts temporaires
    await this.cleanupSessionContacts(session._id.toString());

    // Logger l'événement
    await this.logEvent(
      session._id as mongoose.Types.ObjectId,
      session.userId.toString(),
      "RESOLVED",
      {
        resolvedBy: "ADMIN_CONFIRM_SAFE",
        adminId,
        reason,
      },
    );

    // Audit critique
    await auditService.log({
      userId: adminId,
      action: "ADMIN_SOS_CONFIRM_SAFE",
      level: "critical",
      details: {
        sessionId: session._id,
        sessionUserId: session.userId,
        reason,
      },
    });

    sosLogger.info("Admin confirmed user safe", {
      sessionId,
      adminId,
      reason,
    });

    return session;
  }

  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Admin: Ajouter un participant à une session existante
   */
  async adminAddParticipant(
    sessionId: string,
    targetUserId: string,
    adminId: string,
  ): Promise<ISosSession> {
    const session = await SosSessionModel.findOne({
      _id: new mongoose.Types.ObjectId(sessionId),
      status: { $in: ["ACTIVE", "EXPIRED", "ESCALATING"] },
    });

    if (!session) {
      throw new Error("SESSION_NOT_FOUND");
    }

    // Vérifier que l'utilisateur cible existe
    const targetUser = await UserModel.findById(targetUserId).lean();
    if (!targetUser) {
      throw new Error("USER_NOT_FOUND");
    }

    // Vérifier que l'utilisateur n'est pas déjà participant actif
    const existingParticipant = session.participants.find(
      (p) => p.userId.toString() === targetUserId && p.status !== "LEFT",
    );

    if (existingParticipant) {
      throw new Error("ALREADY_PARTICIPANT");
    }

    // Vérifier que l'utilisateur n'a pas déjà une autre session active
    const userActiveSession = await SosSessionModel.findOne({
      status: { $in: ["ACTIVE", "EXPIRED", "ESCALATING"] },
      participants: {
        $elemMatch: {
          userId: new mongoose.Types.ObjectId(targetUserId),
          status: { $ne: "LEFT" },
        },
      },
    });

    if (userActiveSession) {
      throw new Error("USER_HAS_ACTIVE_SESSION");
    }

    const now = new Date();

    // Ajouter le nouveau participant
    const newParticipant: ISosParticipant = {
      userId: new mongoose.Types.ObjectId(targetUserId),
      joinedAt: now,
      leftAt: null,
      status: "ACTIVE" as SosParticipantStatus,
      currentStage: -1,
      stage0TriggeredAt: null,
      stage1TriggeredAt: null,
      stage2TriggeredAt: null,
      lastHeartbeatAt: null,
      lastKnownLat: session.lastKnownLat,
      lastKnownLng: session.lastKnownLng,
      lastKnownAccuracy: session.lastKnownAccuracy,
      consecutiveHeartbeats: 0,
      firstReconnectionAt: null,
      surfaceDetectionSent: false,
      reconnectionDetectionSent: false,
    };

    session.participants.push(newParticipant);
    await session.save();

    // Récupérer le nom de l'admin
    const admin = await UserModel.findById(adminId).lean();
    const adminName = admin ? decrypt(admin.name) : "Un administrateur";

    // Notifier le nouveau participant
    try {
      // Push notification
      await createNotification(
        new mongoose.Types.ObjectId(targetUserId),
        "sos_alert",
        "🆘 Tu as été ajouté à une session SOS",
        `${adminName} t'a ajouté à une session SOS.`,
        {
          sosSessionId: session._id,
        },
      );

      // WebSocket notification
      webSocketService.sendNotificationToUser(targetUserId, {
        type: "sos_participant_added",
        sessionId: (session._id as mongoose.Types.ObjectId).toString(),
        adminName,
        adminId,
        message: `Tu as été ajouté à une session SOS par ${adminName}`,
      });

      // Logger l'événement
      await this.logEvent(
        session._id as mongoose.Types.ObjectId,
        targetUserId,
        "PARTICIPANT_ADDED",
        {
          triggeredBy: "admin",
          adminId,
          adminName,
        },
      );
    } catch (error) {
      sosLogger.error("Failed to notify new participant", {
        targetUserId,
        sessionId: session._id?.toString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Audit critique
    await auditService.log({
      userId: adminId,
      action: "ADMIN_SOS_ADD_PARTICIPANT",
      level: "critical",
      details: {
        sessionId: session._id,
        targetUserId,
      },
    });

    sosLogger.info("Admin added participant to session", {
      sessionId,
      targetUserId,
      adminId,
    });

    return session;
  }

  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Admin: Retirer un participant d'une session
   */
  async adminRemoveParticipant(
    sessionId: string,
    targetUserId: string,
    adminId: string,
  ): Promise<ISosSession> {
    const session = await SosSessionModel.findOne({
      _id: new mongoose.Types.ObjectId(sessionId),
      status: { $in: ["ACTIVE", "EXPIRED", "ESCALATING"] },
    });

    if (!session) {
      throw new Error("SESSION_NOT_FOUND");
    }

    const participant = session.participants.find(
      (p) => p.userId.toString() === targetUserId && p.status !== "LEFT",
    );

    if (!participant) {
      throw new Error("PARTICIPANT_NOT_FOUND");
    }

    if (participant.status === "LEFT") {
      throw new Error("PARTICIPANT_ALREADY_LEFT");
    }

    const now = new Date();

    // Marquer le participant comme LEFT
    participant.status = "LEFT";
    participant.leftAt = now;

    // Vérifier si c'était le dernier participant actif
    const activeParticipants = session.participants.filter(
      (p) => p.status !== "LEFT",
    );

    if (activeParticipants.length === 0) {
      // Résoudre la session
      session.status = "RESOLVED";
      session.resolvedAt = now;
      session.resolvedBy = "ADMIN";

      await this.cleanupSessionContacts(session._id.toString());
    }

    await session.save();

    // Récupérer le nom de l'admin
    const admin = await UserModel.findById(adminId).lean();
    const adminName = admin ? decrypt(admin.name) : "Un administrateur";

    // Notifier le participant retiré
    try {
      webSocketService.sendNotificationToUser(targetUserId, {
        type: "sos_participant_removed",
        sessionId: (session._id as mongoose.Types.ObjectId).toString(),
        message: `Tu as été retiré de la session SOS par ${adminName}`,
        adminName,
        adminId,
      });

      // Logger l'événement
      await this.logEvent(
        session._id as mongoose.Types.ObjectId,
        targetUserId,
        "PARTICIPANT_LEFT",
        {
          triggeredBy: "admin",
          adminId,
          adminName,
        },
      );
    } catch (error) {
      sosLogger.error("Failed to notify removed participant", {
        targetUserId,
        sessionId: session._id?.toString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Audit critique
    await auditService.log({
      userId: adminId,
      action: "ADMIN_SOS_REMOVE_PARTICIPANT",
      level: "critical",
      details: {
        sessionId: session._id,
        targetUserId,
        sessionResolved: activeParticipants.length === 0,
      },
    });

    sosLogger.info("Admin removed participant from session", {
      sessionId,
      targetUserId,
      adminId,
      sessionResolved: activeParticipants.length === 0,
    });

    return session;
  }

  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Admin: Déclencher l'envoi de SMS aux contacts d'urgence
   * Envoie des SMS à tous les contacts d'urgence de tous les participants actifs
   */
  async adminTriggerSms(
    sessionId: string,
    adminId: string,
  ): Promise<{ sent: number; failed: number }> {
    const session = await SosSessionModel.findOne({
      _id: new mongoose.Types.ObjectId(sessionId),
      status: { $in: ["ACTIVE", "EXPIRED", "ESCALATING"] },
    });

    if (!session) {
      throw new Error("SESSION_NOT_FOUND");
    }

    // Récupérer tous les participants actifs
    const activeParticipants = session.participants.filter(
      (p) => p.status !== "LEFT",
    );

    if (activeParticipants.length === 0) {
      throw new Error("NO_ACTIVE_PARTICIPANTS");
    }

    const participantUserIds = activeParticipants.map((p) =>
      p.userId.toString(),
    );

    // Récupérer TOUS les contacts d'urgence de tous les participants
    const allContacts = await SosContactModel.find({
      userId: {
        $in: participantUserIds.map((id) => new mongoose.Types.ObjectId(id)),
      },
      deletedAt: null, // Exclure les contacts soft-deleted
    }).lean();

    if (allContacts.length === 0) {
      throw new Error("NO_CONTACTS_FOUND");
    }

    let sent = 0;
    let failed = 0;

    // Envoyer un SMS à chaque contact
    for (const contact of allContacts) {
      try {
        // Récupérer les infos du participant
        const participantUser = await UserModel.findById(contact.userId).lean();
        const participantName = participantUser
          ? `${decrypt(participantUser.name)} ${decrypt(participantUser.surname)}`
          : "Un utilisateur";

        // Construire le message SMS
        const locationStr =
          session.lastKnownLat && session.lastKnownLng
            ? `Localisation: https://maps.google.com/?q=${session.lastKnownLat},${session.lastKnownLng}`
            : "Localisation non disponible";

        const message = `🆘 ALERTE SOS - ${participantName} a besoin d'aide!\n${locationStr}\nSession: ${session._id}`;

        // Envoyer le SMS via Vonage
        await vonageService.sendSosAlert(
          contact.name,
          contact.phone,
          participantName,
          session.note || session.siteName,
          session.lastKnownLat && session.lastKnownLng
            ? { lat: session.lastKnownLat, lng: session.lastKnownLng }
            : undefined,
        );

        sent++;

        // Logger l'événement
        await this.logEvent(
          session._id as mongoose.Types.ObjectId,
          contact.userId.toString(),
          "SMS_SENT",
          {
            triggeredBy: "admin",
            adminId,
            contactName: contact.name,
            contactPhone: "***", // Masquer le numéro dans les logs
          },
        );

        sosLogger.info("Admin triggered SMS sent", {
          sessionId: session._id?.toString(),
          contactName: contact.name,
          participantName,
        });
      } catch (error) {
        failed++;
        sosLogger.error("Failed to send admin triggered SMS", {
          sessionId: session._id?.toString(),
          contactId: contact._id?.toString(),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Audit critique
    await auditService.log({
      userId: adminId,
      action: "ADMIN_SOS_TRIGGER_SMS",
      level: "critical",
      details: {
        sessionId: session._id,
        sent,
        failed,
        totalContacts: allContacts.length,
      },
    });

    sosLogger.info("Admin triggered SMS sending completed", {
      sessionId,
      adminId,
      sent,
      failed,
      total: allContacts.length,
    });

    return { sent, failed };
  }

  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Admin: Envoyer une notification personnalisée à un participant
   */
  async adminSendNotification(
    sessionId: string,
    targetUserId: string,
    message: string,
    adminId: string,
  ): Promise<void> {
    const session = await SosSessionModel.findOne({
      _id: new mongoose.Types.ObjectId(sessionId),
      status: { $in: ["ACTIVE", "EXPIRED", "ESCALATING"] },
    });

    if (!session) {
      throw new Error("SESSION_NOT_FOUND");
    }

    // Vérifier que l'utilisateur est bien participant
    const participant = session.participants.find(
      (p) => p.userId.toString() === targetUserId && p.status !== "LEFT",
    );

    if (!participant) {
      throw new Error("PARTICIPANT_NOT_FOUND");
    }

    // Récupérer le nom de l'admin
    const admin = await UserModel.findById(adminId).lean();
    const adminName = admin ? decrypt(admin.name) : "Un administrateur";

    // Envoyer push notification avec retry
    await this.sendSosNotificationWithRetry({
      userId: targetUserId,
      title: "📢 Message de l'administrateur",
      message: message,
      type: "admin_notification",
      data: {
        sosSessionId: session._id,
        adminId,
        adminName,
      },
    });

    // Envoyer via WebSocket (avec gestion d'erreur)
    this.sendSosWebSocketNotification(
      targetUserId,
      {
        type: "sos_admin_notification",
        sessionId: (session._id as mongoose.Types.ObjectId).toString(),
        message: message,
        adminName,
        adminId,
      },
      { sessionId: sessionId, stage: -1 },
    );

    // Logger l'événement
    await this.logEvent(
      session._id as mongoose.Types.ObjectId,
      targetUserId,
      "NOTIFICATION_SENT",
      {
        adminId,
        adminName,
        message,
      },
    );

    // Audit critique
    await auditService.log({
      userId: adminId,
      action: "ADMIN_SOS_SEND_NOTIFICATION",
      level: "critical",
      details: {
        sessionId: session._id,
        targetUserId,
        message,
      },
    });

    sosLogger.info("Admin sent custom notification", {
      sessionId,
      targetUserId,
      adminId,
      message,
    });
  }

  // ─── UTILITAIRES ───────────────────────────────────────────────────

  // ─── MÉTHODES MOBILES GESTION PARTICIPANTS ──────────────────────────

  /**
   * Mobile: Ajouter un participant à une session déjà active
   * Seul le créateur de la session (session.userId) peut appeler cette méthode.
   * Mêmes vérifications qu'à la création : user existant, pas de session active.
   */
  async addParticipantToSession(
    creatorId: string,
    targetUserId: string,
    sessionId?: string,
  ): Promise<ISosSession> {
    const creatorObjectId = new mongoose.Types.ObjectId(creatorId);

    // Trouver la session active dont le créateur est bien creatorId
    const session = sessionId
      ? await SosSessionModel.findOne({
          _id: new mongoose.Types.ObjectId(sessionId),
          userId: creatorObjectId,
          status: { $in: ["ACTIVE", "EXPIRED", "ESCALATING"] },
        })
      : await SosSessionModel.findOne({
          userId: creatorObjectId,
          status: { $in: ["ACTIVE", "EXPIRED", "ESCALATING"] },
        });

    if (!session) {
      throw new Error("NO_ACTIVE_SESSION");
    }

    // Vérifier que l'utilisateur cible existe
    const targetUser = await UserModel.findById(targetUserId).lean();
    if (!targetUser) {
      throw new Error("INVALID_PARTICIPANT_IDS");
    }

    // Vérifier qu'il n'est pas déjà participant actif
    const existingParticipant = session.participants.find(
      (p) => p.userId.toString() === targetUserId && p.status !== "LEFT",
    );
    if (existingParticipant) {
      throw new Error("ALREADY_PARTICIPANT");
    }

    // Vérifier qu'il n'a pas une autre session active
    const userActiveSession = await SosSessionModel.findOne({
      status: { $in: ["ACTIVE", "EXPIRED", "ESCALATING"] },
      participants: {
        $elemMatch: {
          userId: new mongoose.Types.ObjectId(targetUserId),
          status: { $ne: "LEFT" },
        },
      },
    });
    if (userActiveSession) {
      throw new Error("SESSION_ALREADY_ACTIVE");
    }

    const now = new Date();

    // Ajouter le nouveau participant
    const newParticipant: ISosParticipant = {
      userId: new mongoose.Types.ObjectId(targetUserId),
      joinedAt: now,
      leftAt: null,
      status: "ACTIVE" as SosParticipantStatus,
      currentStage: -1,
      stage0TriggeredAt: null,
      stage1TriggeredAt: null,
      stage2TriggeredAt: null,
      lastHeartbeatAt: null,
      lastKnownLat: session.lastKnownLat,
      lastKnownLng: session.lastKnownLng,
      lastKnownAccuracy: session.lastKnownAccuracy,
      consecutiveHeartbeats: 0,
      firstReconnectionAt: null,
      surfaceDetectionSent: false,
      reconnectionDetectionSent: false,
    };

    session.participants.push(newParticipant);
    await session.save();

    // Récupérer le nom du créateur
    const creator = await UserModel.findById(creatorObjectId).lean();
    const creatorName = creator ? decrypt(creator.name) : "Un utilisateur";

    // Notifier le participant ajouté (push + WebSocket)
    try {
      await createNotification(
        new mongoose.Types.ObjectId(targetUserId),
        "sos_alert",
        "🆘 Tu as été ajouté à une session SOS",
        `${creatorName} t'a ajouté à une session SOS de groupe.`,
        {
          sosSessionId: session._id,
        },
      );

      webSocketService.sendNotificationToUser(targetUserId, {
        type: "sos_participant_added",
        sessionId: (session._id as mongoose.Types.ObjectId).toString(),
        creatorName,
        creatorId,
        message: `Tu as été ajouté à une session SOS par ${creatorName}`,
      });

      await this.logEvent(
        session._id as mongoose.Types.ObjectId,
        targetUserId,
        "PARTICIPANT_ADDED",
        {
          addedBy: creatorId,
          creatorName,
        },
      );
    } catch (error) {
      sosLogger.error("Failed to notify added participant", {
        targetUserId,
        sessionId: session._id?.toString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Audit
    await auditService.log({
      userId: creatorId,
      action: "SOS_PARTICIPANT_ADDED",
      level: "info",
      details: {
        sessionId: session._id,
        targetUserId,
      },
    });

    sosLogger.info("Participant added to SOS session (mobile)", {
      sessionId: session._id?.toString(),
      addedBy: creatorId,
      targetUserId,
    });

    return session;
  }

  /**
   * Mobile: Retirer un participant d'une session active
   * N'importe quel participant actif peut retirer n'importe qui (soi-même inclus).
   * Si c'est le dernier participant → session RESOLVED.
   */
  async removeParticipantFromSession(
    requesterId: string,
    targetUserId: string,
    sessionId?: string,
  ): Promise<ISosSession> {
    const requesterObjectId = new mongoose.Types.ObjectId(requesterId);

    // Trouver la session où le demandeur est participant actif
    const session = sessionId
      ? await SosSessionModel.findOne({
          _id: new mongoose.Types.ObjectId(sessionId),
          status: { $in: ["ACTIVE", "EXPIRED", "ESCALATING"] },
          participants: {
            $elemMatch: {
              userId: requesterObjectId,
              status: { $ne: "LEFT" },
            },
          },
        })
      : await SosSessionModel.findOne({
          status: { $in: ["ACTIVE", "EXPIRED", "ESCALATING"] },
          participants: {
            $elemMatch: {
              userId: requesterObjectId,
              status: { $ne: "LEFT" },
            },
          },
        });

    if (!session) {
      throw new Error("NO_ACTIVE_SESSION");
    }

    // Si le demandeur retire quelqu'un d'autre, vérifier qu'il est le créateur
    if (requesterId !== targetUserId) {
      const isCreator = session.userId.toString() === requesterId;
      if (!isCreator) {
        throw new Error("NOT_AUTHORIZED_TO_REMOVE_PARTICIPANT");
      }
    }

    // Vérifier que la cible est bien un participant actif
    const targetParticipant = session.participants.find(
      (p) => p.userId.toString() === targetUserId && p.status !== "LEFT",
    );
    if (!targetParticipant) {
      throw new Error("PARTICIPANT_NOT_FOUND");
    }

    const now = new Date();

    // Récupérer le nom du demandeur pour les notifications
    const requester = await UserModel.findById(requesterObjectId).lean();
    const requesterName = requester
      ? decrypt(requester.name)
      : "Un utilisateur";

    // Marquer la cible comme LEFT
    targetParticipant.status = "LEFT";
    targetParticipant.leftAt = now;

    // Vérifier s'il reste des participants actifs
    const remainingActive = session.participants.filter(
      (p) => p.status !== "LEFT",
    );

    if (remainingActive.length === 0) {
      // Dernier participant → résoudre la session
      session.status = "RESOLVED";
      session.resolvedAt = now;
      session.resolvedBy = "USER";
      session.resolvedByUserId = requesterObjectId;

      await session.save();
      await this.cleanupSessionContacts(session._id.toString());

      sosLogger.info("Session resolved - last participant removed", {
        sessionId: session._id?.toString(),
        removedBy: requesterId,
        targetUserId,
      });
    } else {
      await session.save();

      // Notifier la cible si elle n'est pas le demandeur
      if (requesterId !== targetUserId) {
        try {
          webSocketService.sendNotificationToUser(targetUserId, {
            type: "sos_participant_removed",
            sessionId: (session._id as mongoose.Types.ObjectId).toString(),
            requesterName,
            requesterId,
            message: `Tu as été retiré de la session SOS par ${requesterName}`,
          });

          await createNotification(
            new mongoose.Types.ObjectId(targetUserId),
            "sos_session_cancelled",
            "Retiré de la session SOS",
            `${requesterName} t'a retiré de la session SOS.`,
            {
              sosSessionId: session._id as mongoose.Types.ObjectId,
              senderId: requesterObjectId,
            },
          );
        } catch (error) {
          sosLogger.error("Failed to notify removed participant (mobile)", {
            targetUserId,
            sessionId: session._id?.toString(),
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Notifier les participants restants
      for (const other of remainingActive) {
        const otherId = other.userId.toString();
        if (otherId === requesterId || otherId === targetUserId) continue;
        try {
          webSocketService.sendNotificationToUser(otherId, {
            type: "sos_participant_left",
            sessionId: (session._id as mongoose.Types.ObjectId).toString(),
            // `userId` = champ canonique attendu par le client (WsSosParticipantLeft) :
            // c'est lui qui permet aux autres membres de retirer le participant de
            // leur liste. `removedUserId` conservé pour le contexte (qui/par qui).
            userId: targetUserId,
            removedUserId: targetUserId,
            removedBy: requesterId,
            requesterName,
            message: `Un participant a été retiré de la session SOS`,
          });
        } catch (error) {
          sosLogger.error("Failed to notify other participant of removal", {
            otherId,
            sessionId: session._id?.toString(),
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    await this.logEvent(
      session._id as mongoose.Types.ObjectId,
      targetUserId,
      "PARTICIPANT_LEFT",
      {
        removedBy: requesterId,
        requesterName,
        leftAt: now,
      },
    );

    await auditService.log({
      userId: requesterId,
      action: "SOS_PARTICIPANT_REMOVED",
      level: "info",
      details: {
        sessionId: session._id,
        targetUserId,
        sessionResolved: remainingActive.length === 0,
      },
    });

    sosLogger.info("Participant removed from SOS session (mobile)", {
      sessionId: session._id?.toString(),
      removedBy: requesterId,
      targetUserId,
      sessionResolved: remainingActive.length === 0,
    });

    return session;
  }

  /**
   * Notifier tous les admins par push et email lors d'un événement SOS critique
   * Appelé sur : triggerStage1, triggerStage2, adminForceEscalation
   */
  private async notifyAdmins(params: {
    eventType: "STAGE_1" | "STAGE_2" | "ADMIN_FORCE_ESCALATION";
    session: ISosSession;
    participantName: string;
    participantId: string;
    stage: number;
    triggeredAt: Date;
  }): Promise<void> {
    const {
      eventType,
      session,
      participantName,
      participantId,
      stage,
      triggeredAt,
    } = params;
    const sessionId = (session._id as mongoose.Types.ObjectId).toString();

    const eventLabels: Record<string, string> = {
      STAGE_1: "🆘 SOS Stage 1 — Alerte diffusée à la communauté",
      STAGE_2: "🆘 SOS Stage 2 — SMS d'urgence envoyés",
      ADMIN_FORCE_ESCALATION: "🆘 SOS — Escalade forcée par un administrateur",
    };

    const stageLabels: Record<number, string> = {
      1: "Stage 1 — Alerte communauté",
      2: "Stage 2 — SMS contacts d'urgence",
    };

    const eventLabel = eventLabels[eventType] || "🆘 Alerte SOS critique";
    const stageLabel = stageLabels[stage] || `Stage ${stage}`;

    try {
      // Récupérer tous les admins actifs et validés
      const admins = await UserModel.find({
        is_admin: true,
        is_blocked: false,
      })
        .select("_id name email")
        .lean();

      if (admins.length === 0) {
        sosLogger.warn("No admins found for SOS alert notification", {
          sessionId,
        });
        return;
      }

      const adminIds = admins.map((a) => a._id.toString());
      const adminPanelLink = `${process.env.FRONTEND_URL}/admin/sos/sessions/${sessionId}`;
      const triggeredAtStr = triggeredAt.toLocaleString("fr-FR", {
        timeZone: "Europe/Paris",
      });

      // ── PUSH NOTIFICATIONS (batch) ───────────────────────────────────
      try {
        for (const adminId of adminIds) {
          await createNotification(
            new mongoose.Types.ObjectId(adminId),
            "sos_alert",
            eventLabel,
            `${participantName} — ${stageLabel}`,
            {
              sosSessionId: session._id as mongoose.Types.ObjectId,
            },
          );
        }
      } catch (pushError) {
        sosLogger.error(
          "[SOS-CRITICAL] Failed to send admin push notifications",
          {
            sessionId,
            eventType,
            error:
              pushError instanceof Error
                ? pushError.message
                : String(pushError),
          },
        );
      }

      // ── EMAILS (un par admin) ────────────────────────────────────────
      for (const admin of admins) {
        try {
          const adminName = decrypt(admin.name);
          const adminEmail = decrypt((admin as any).email);

          await sendEmail({
            to: adminEmail,
            subject: `${eventLabel} - QVARRY`,
            template: "sos-admin-alert",
            variables: {
              ADMIN_NAME: adminName,
              EVENT_TYPE: eventType,
              EVENT_LABEL: eventLabel,
              SESSION_ID: sessionId,
              PARTICIPANT_NAME: participantName,
              PARTICIPANT_ID: participantId,
              STAGE: String(stage),
              STAGE_LABEL: stageLabel,
              TRIGGERED_AT: triggeredAtStr,
              SITE_NAME: session.siteName || "",
              ADMIN_PANEL_LINK: adminPanelLink,
            },
          });
        } catch (emailError) {
          sosLogger.error("[SOS-CRITICAL] Failed to send admin email", {
            adminId: admin._id.toString(),
            sessionId,
            eventType,
            error:
              emailError instanceof Error
                ? emailError.message
                : String(emailError),
          });
        }
      }

      sosLogger.info("Admin SOS alert sent", {
        sessionId,
        eventType,
        stage,
        adminCount: admins.length,
      });
    } catch (error) {
      sosLogger.error("[SOS-CRITICAL] notifyAdmins failed", {
        sessionId,
        eventType,
        error: error instanceof Error ? error.message : String(error),
      });
      // Ne pas lever l'exception — l'escalade doit continuer quoi qu'il arrive
    }
  }

  /**
   * Nettoyer les contacts temporaires d'une session (override)
   * Appelé quand une session est résolue ou annulée
   */
  private async cleanupSessionContacts(sessionId: string): Promise<void> {
    try {
      const result = await SosContactModel.deleteMany({
        sessionId: new mongoose.Types.ObjectId(sessionId),
      });

      if (result.deletedCount > 0) {
        sosLogger.info("Session contacts cleaned up", {
          sessionId,
          deletedCount: result.deletedCount,
        });
      }
    } catch (error) {
      sosLogger.error("Failed to cleanup session contacts", {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Logger un événement SOS
   */
  private async logEvent(
    sessionId: mongoose.Types.ObjectId,
    userId: string,
    type: SosEventType,
    metadata?: Record<string, any>,
  ): Promise<void> {
    try {
      await new SosEventModel({
        sessionId,
        userId: new mongoose.Types.ObjectId(userId),
        type,
        metadata,
        createdAt: new Date(),
      }).save();
    } catch (error) {
      sosLogger.error("Failed to log SOS event", {
        sessionId: sessionId.toString(),
        userId,
        type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

// Export singleton
export const sosService = new SosService();
