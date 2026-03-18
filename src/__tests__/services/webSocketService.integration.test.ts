/**
 * Tests d'intégration WebSocket — webSocketService
 *
 * Ces tests démarrent un vrai serveur HTTP + WebSocketService.initialize()
 * et utilisent de vrais clients `ws` (pas mockés) pour couvrir les scénarios
 * end-to-end du service.
 *
 * Les services externes (DB, Redis, messageOperationsService) sont mockés
 * localement — le mock global de setup.ts est bypassé via jest.unmock.
 *
 * Note technique: jest.config.ts utilise resetMocks: true, ce qui remet les
 * jest.fn() à vide avant chaque test. On réinitialise les implémentations
 * dans beforeEach via jest.requireMock().
 */

// ─── Bypass du mock global setup.ts (doit être avant tout import) ─────────────
jest.unmock("../../services/webSocketService");

// ─── Mocks locaux ─────────────────────────────────────────────────────────────
// Helper pour créer un faux objet "Query Mongoose" supportant .lean()
const makeFakeQuery = (resolvedValue: unknown) => ({
  lean: jest.fn().mockResolvedValue(resolvedValue),
});

jest.mock("../../models/conversations", () => ({
  default: {
    findOne: jest.fn(),
    findById: jest.fn(),
  },
}));

jest.mock("../../services/redisSessionService", () => ({
  redisSessionService: {
    consumeWsToken: jest.fn(),
  },
}));

jest.mock("../../services/messageOperationsService", () => ({
  createMessageOp: jest.fn(),
  getMessagesOp: jest.fn(),
  markMessageAsReadOp: jest.fn(),
  replyToMessageOp: jest.fn(),
  editMessageOp: jest.fn(),
  deleteMessageOp: jest.fn(),
}));

jest.mock("../../utils/masterEncryptionUtils", () => ({
  decrypt: jest.fn((v: string) => v),
}));

jest.mock("../../models/users", () => ({
  default: { findById: jest.fn().mockResolvedValue(null) },
}));

jest.mock("../../utils/logUtils", () => ({
  anonymizeIp: jest.fn((ip: string) => ip),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────
import * as http from "http";
import WebSocket from "ws";
import jwt from "jsonwebtoken";

// ─── Configuration ────────────────────────────────────────────────────────────
const TEST_JWT_SECRET = "test-jwt-secret";
process.env.JWT_SECRET = TEST_JWT_SECRET;
process.env.NODE_ENV = "test";
process.env.CLIENT_URL = "http://localhost:3001";
process.env.WS_HEARTBEAT_INTERVAL_MS = "60000";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Génère un JWT de test pour WebSocket
 */
function makeWsToken(
  overrides: Partial<{
    id: string;
    type: string;
    wsType: string;
    jti: string | null;
  }> = {},
): string {
  const { jti: jtiOverride, ...rest } = overrides;

  const basePayload: Record<string, unknown> = {
    id: "user-id",
    type: "websocket",
    wsType: "notifications",
    jti: `jti-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ...rest,
  };

  // jti=null → pas de champ jti dans le token (cas "JTI manquant")
  if (jtiOverride === null) {
    delete basePayload.jti;
  } else if (jtiOverride !== undefined) {
    basePayload.jti = jtiOverride;
  }

  return jwt.sign(basePayload, TEST_JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: "5m",
  });
}

/**
 * Attend un message WebSocket avec timeout
 */
function waitForMessage(ws: WebSocket, timeout = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`waitForMessage: timeout après ${timeout}ms`)),
      timeout,
    );
    ws.once("message", (data) => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(data.toString()));
      } catch {
        resolve(data.toString());
      }
    });
  });
}

/**
 * Attend la fermeture d'une socket avec timeout
 */
function waitForClose(
  ws: WebSocket,
  timeout = 4000,
): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`waitForClose: timeout après ${timeout}ms`)),
      timeout,
    );
    ws.once("close", (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
  });
}

/**
 * Ouvre une connexion WebSocket et attend l'événement "open"
 */
async function openWs(
  url: string,
  origin = "http://localhost:3001",
): Promise<WebSocket> {
  const ws = new WebSocket(url, { headers: { origin } });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  return ws;
}

/**
 * Connecte un client au canal notifications et envoie le message d'auth
 */
async function connectNotificationClient(
  port: number,
  tokenOverrides: Parameters<typeof makeWsToken>[0] = {},
): Promise<WebSocket> {
  const ws = await openWs(`ws://127.0.0.1:${port}/ws/notifications`);
  const token = makeWsToken({ wsType: "notifications", ...tokenOverrides });
  ws.send(JSON.stringify({ type: "auth", token }));
  return ws;
}

/**
 * Connecte un client au canal messages et envoie le message d'auth
 */
async function connectMessageClient(
  port: number,
  convId: string,
  tokenOverrides: Parameters<typeof makeWsToken>[0] = {},
): Promise<WebSocket> {
  const ws = await openWs(`ws://127.0.0.1:${port}/ws/messages?conv=${convId}`);
  const token = makeWsToken({ wsType: "messages", ...tokenOverrides });
  ws.send(JSON.stringify({ type: "auth", token }));
  return ws;
}

/**
 * Ferme proprement les clients et le serveur
 */
async function closeAll(
  server: http.Server | null,
  clients: WebSocket[],
): Promise<void> {
  for (const ws of clients) {
    if (
      ws.readyState === WebSocket.OPEN ||
      ws.readyState === WebSocket.CONNECTING
    ) {
      ws.close();
      await new Promise<void>((resolve) => {
        ws.once("close", resolve);
        setTimeout(resolve, 200);
      });
    }
  }
  if (server) {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      setTimeout(resolve, 300);
    });
  }
}

/**
 * Démarre un serveur HTTP sur un port aléatoire et initialise WebSocketService
 */
async function createTestServer(): Promise<{
  server: http.Server;
  port: number;
}> {
  const { webSocketService } = require("../../services/webSocketService");
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  webSocketService.initialize(server);
  const { port } = server.address() as { port: number };
  return { server, port };
}

/**
 * Retourne les mocks avec leurs implémentations réinitialisées
 * (nécessaire car resetMocks: true dans jest.config.ts)
 */
function setupMockDefaults(): void {
  const ConversationMock = jest.requireMock(
    "../../models/conversations",
  ).default;
  const redisMock = jest.requireMock(
    "../../services/redisSessionService",
  ).redisSessionService;

  const fakeConversation = {
    _id: "conv-id",
    participants: [{ userId: "user-id" }],
  };

  // findOne et findById retournent un objet "Query Mongoose" qui supporte .lean()
  (ConversationMock.findOne as jest.Mock).mockReturnValue(
    makeFakeQuery(fakeConversation),
  );
  (ConversationMock.findById as jest.Mock).mockReturnValue(
    makeFakeQuery(fakeConversation),
  );
  (redisMock.consumeWsToken as jest.Mock).mockResolvedValue(true);
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION GLOBALE
// ─────────────────────────────────────────────────────────────────────────────

jest.setTimeout(12000);

beforeEach(() => {
  setupMockDefaults();
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Canal Notifications — Auth lifecycle
// ═══════════════════════════════════════════════════════════════════════════════

describe("Canal Notifications — Auth lifecycle", () => {
  let server: http.Server;
  let port: number;
  const clients: WebSocket[] = [];

  beforeEach(async () => {
    clients.length = 0;
    ({ server, port } = await createTestServer());
  });

  afterEach(async () => {
    await closeAll(server, clients);
  });

  it("connect → auth avec token valide → reçoit 'connected'", async () => {
    // Arrange
    const ws = await connectNotificationClient(port);
    clients.push(ws);

    // Act
    const msg = await waitForMessage(ws, 3000);

    // Assert
    expect(msg.type).toBe("connected");
    expect(msg.userId).toBe("user-id");
  });

  it("connect → auth timeout (5s) → connexion fermée avec code 4001", async () => {
    // Arrange : connexion sans envoyer de message d'auth
    const ws = await openWs(`ws://127.0.0.1:${port}/ws/notifications`);
    clients.push(ws);

    // Act : le service ferme après 5s de silence
    const { code } = await waitForClose(ws, 7500);

    // Assert
    expect(code).toBe(4001);
  }, 10000);

  it("connect → auth avec token invalide (mauvaise signature) → fermé avec code 4002", async () => {
    // Arrange
    const ws = await openWs(`ws://127.0.0.1:${port}/ws/notifications`);
    clients.push(ws);

    const badToken = jwt.sign(
      {
        id: "user-id",
        type: "websocket",
        wsType: "notifications",
        jti: "bad-jti",
      },
      "wrong-secret",
      { algorithm: "HS256" },
    );

    // Act
    ws.send(JSON.stringify({ type: "auth", token: badToken }));
    const { code } = await waitForClose(ws, 3000);

    // Assert
    expect(code).toBe(4002);
  });

  it("connect → auth avec token sans JTI → fermé avec code 4002", async () => {
    // Arrange
    const ws = await openWs(`ws://127.0.0.1:${port}/ws/notifications`);
    clients.push(ws);

    const tokenNoJti = jwt.sign(
      { id: "user-id", type: "websocket", wsType: "notifications" },
      TEST_JWT_SECRET,
      { algorithm: "HS256" },
    );

    // Act
    ws.send(JSON.stringify({ type: "auth", token: tokenNoJti }));
    const { code } = await waitForClose(ws, 3000);

    // Assert
    expect(code).toBe(4002);
  });

  it("connect → auth avec token déjà utilisé (consumeWsToken retourne false) → fermé avec code 4003", async () => {
    // Arrange : forcer le rejet du token
    const redisMock = jest.requireMock(
      "../../services/redisSessionService",
    ).redisSessionService;
    (redisMock.consumeWsToken as jest.Mock).mockResolvedValueOnce(false);

    const ws = await openWs(`ws://127.0.0.1:${port}/ws/notifications`);
    clients.push(ws);

    // Act
    ws.send(
      JSON.stringify({
        type: "auth",
        token: makeWsToken({ wsType: "notifications" }),
      }),
    );
    const { code } = await waitForClose(ws, 3000);

    // Assert
    expect(code).toBe(4003);
  });

  it("connect → message après auth → reçoit erreur CHANNEL_READONLY", async () => {
    // Arrange : s'authentifier d'abord
    const ws = await connectNotificationClient(port);
    clients.push(ws);
    const connMsg = await waitForMessage(ws, 3000);
    expect(connMsg.type).toBe("connected");

    // Act : envoyer un message sur le canal lecture seule
    ws.send(JSON.stringify({ type: "ping" }));

    // Assert
    const response = await waitForMessage(ws, 3000);
    expect(response.type).toBe("error");
    expect(response.code).toBe("CHANNEL_READONLY");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Canal Messages — Auth lifecycle
// ═══════════════════════════════════════════════════════════════════════════════

describe("Canal Messages — Auth lifecycle", () => {
  let server: http.Server;
  let port: number;
  const clients: WebSocket[] = [];

  beforeEach(async () => {
    clients.length = 0;
    ({ server, port } = await createTestServer());
  });

  afterEach(async () => {
    await closeAll(server, clients);
  });

  it("connect sans ?conv= → fermé avec code 4001", async () => {
    // Arrange : connexion sans paramètre conv
    const ws = await openWs(`ws://127.0.0.1:${port}/ws/messages`);
    clients.push(ws);

    // Act & Assert
    const { code } = await waitForClose(ws, 3000);
    expect(code).toBe(4001);
  });

  it("connect → auth avec token valide + participant → reçoit 'connected'", async () => {
    // Debug: vérifier que le mock findOne fonctionne correctement
    const ConversationMock = jest.requireMock("../../models/conversations").default;
    const queryObj = ConversationMock.findOne({ _id: "conv-id" });
    const debugResult = await queryObj.lean();
    console.log("[DEBUG] findOne().lean() result:", JSON.stringify(debugResult));

    // Debug: vérifier consumeWsToken
    const redisMock = jest.requireMock("../../services/redisSessionService").redisSessionService;
    console.log("[DEBUG] consumeWsToken mock:", typeof redisMock.consumeWsToken, redisMock.consumeWsToken.getMockImplementation?.()?.toString().slice(0, 50));
    const tokenResult = await redisMock.consumeWsToken("test-jti");
    console.log("[DEBUG] consumeWsToken result:", tokenResult);

    // Debug: JWT
    const testToken = makeWsToken({ wsType: "messages" });
    const decoded = require("jsonwebtoken").decode(testToken);
    console.log("[DEBUG] token payload:", JSON.stringify(decoded));
    console.log("[DEBUG] JWT_SECRET:", process.env.JWT_SECRET);

    // Arrange & Act
    const ws = await connectMessageClient(port, "conv-id");
    clients.push(ws);

    // Écouter fermeture pour debug
    ws.on("close", (code, reason) => {
      console.log("[DEBUG] WS closed with code:", code, "reason:", reason.toString());
    });

    const msg = await waitForMessage(ws, 3000);

    // Assert
    expect(msg.type).toBe("connected");
    expect(msg.userId).toBe("user-id");
    expect(msg.conversationId).toBe("conv-id");
  it("connect → auth avec wsType='notifications' sur canal messages → fermé avec code 4002", async () => {
    // Arrange : mauvais wsType pour le canal messages
    const ws = await openWs(`ws://127.0.0.1:${port}/ws/messages?conv=conv-id`);
    clients.push(ws);

    // Act : token wsType=notifications envoyé sur le canal messages
    const token = makeWsToken({ wsType: "notifications" });
    ws.send(JSON.stringify({ type: "auth", token }));

    const { code } = await waitForClose(ws, 3000);

    // Assert
    expect(code).toBe(4002);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. CORS
// ═══════════════════════════════════════════════════════════════════════════════

describe("CORS", () => {
  let server: http.Server;
  let port: number;
  const clients: WebSocket[] = [];

  beforeEach(async () => {
    clients.length = 0;
    ({ server, port } = await createTestServer());
  });

  afterEach(async () => {
    await closeAll(server, clients);
  });

  it("connect avec origin interdite → socket détruit (connexion refusée)", async () => {
    // Arrange : origin non autorisée
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/notifications`, {
      headers: { origin: "http://evil.attacker.com" },
    });

    // Act & Assert : error ou close immédiat, jamais OPEN
    const result = await new Promise<"error" | "close">((resolve) => {
      ws.once("error", () => resolve("error"));
      ws.once("close", () => resolve("close"));
      setTimeout(() => resolve("close"), 3000);
    });

    expect(["error", "close"]).toContain(result);
    expect(ws.readyState).not.toBe(WebSocket.OPEN);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Rate limiting connexion
// ═══════════════════════════════════════════════════════════════════════════════

describe("Rate limiting connexion", () => {
  it("11 connexions rapides depuis même IP → 11ème refusée avec code 4029", async () => {
    // Arrange : serveur dédié (IP counter vierge)
    const { server, port } = await createTestServer();
    const allClients: WebSocket[] = [];

    try {
      // Act : 11 connexions simultanées (limite = 10 par minute)
      const connectionPromises = Array.from(
        { length: 11 },
        () =>
          new Promise<WebSocket>((resolve, reject) => {
            const ws = new WebSocket(
              `ws://127.0.0.1:${port}/ws/notifications`,
              { headers: { origin: "http://localhost:3001" } },
            );
            ws.once("open", () => resolve(ws));
            ws.once("error", reject);
          }),
      );

      const allWs = await Promise.all(connectionPromises);
      allClients.push(...allWs);

      // La 11ème (index 10) doit être close(4029)
      const lastWs = allWs[10];
      const { code } = await waitForClose(lastWs, 3000);

      // Assert
      expect(code).toBe(4029);
    } finally {
      await closeAll(server, allClients);
    }
  }, 12000);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Validation messages (canal messages, après authentification)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Validation messages (après authentification)", () => {
  let server: http.Server;
  let port: number;
  const clients: WebSocket[] = [];

  beforeEach(async () => {
    clients.length = 0;
    ({ server, port } = await createTestServer());
  });

  afterEach(async () => {
    await closeAll(server, clients);
  });

  /**
   * Helper : connecte + authentifie un client messages
   * et consomme le message "connected"
   */
  async function getAuthenticatedMsgClient(): Promise<WebSocket> {
    const ws = await connectMessageClient(port, "conv-id");
    clients.push(ws);
    const msg = await waitForMessage(ws, 3000);
    expect(msg.type).toBe("connected");
    return ws;
  }

  it("envoyer { type: 'message' } sans content → reçoit VALIDATION_ERROR ou INVALID_CONTENT", async () => {
    // Arrange
    const ws = await getAuthenticatedMsgClient();

    // Act
    ws.send(JSON.stringify({ type: "message" }));

    // Assert : validation manuelle → INVALID_CONTENT, Zod → VALIDATION_ERROR
    const response = await waitForMessage(ws, 3000);
    expect(response.type).toBe("error");
    expect(["VALIDATION_ERROR", "INVALID_CONTENT"]).toContain(response.code);
  });

  it("envoyer { type: 'editMessage', messageId: 'x' } sans content → reçoit VALIDATION_ERROR ou INVALID_CONTENT", async () => {
    // Arrange
    const ws = await getAuthenticatedMsgClient();

    // Act
    ws.send(JSON.stringify({ type: "editMessage", messageId: "x" }));

    // Assert
    const response = await waitForMessage(ws, 3000);
    expect(response.type).toBe("error");
    expect(["VALIDATION_ERROR", "INVALID_CONTENT"]).toContain(response.code);
  });

  it("envoyer { type: 'deleteMessage' } sans messageId → reçoit VALIDATION_ERROR ou INVALID_FIELD", async () => {
    // Arrange
    const ws = await getAuthenticatedMsgClient();

    // Act
    ws.send(JSON.stringify({ type: "deleteMessage" }));

    // Assert : validation manuelle → INVALID_FIELD, Zod → VALIDATION_ERROR
    const response = await waitForMessage(ws, 3000);
    expect(response.type).toBe("error");
    expect(["VALIDATION_ERROR", "INVALID_FIELD"]).toContain(response.code);
  });

  it("envoyer type inconnu → reçoit INVALID_MESSAGE_TYPE", async () => {
    // Arrange
    const ws = await getAuthenticatedMsgClient();

    // Act
    ws.send(JSON.stringify({ type: "unknownType", data: "test" }));

    // Assert
    const response = await waitForMessage(ws, 3000);
    expect(response.type).toBe("error");
    expect(response.code).toBe("INVALID_MESSAGE_TYPE");
  });
});
