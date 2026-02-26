/**
 * Configuration globale pour Jest
 * Ce fichier est exécuté avant tous les tests
 */

import "@jest/globals";

// ════════════════════════════════════════════════════════
// 📦 Configuration de l'environnement de test
// ════════════════════════════════════════════════════════

process.env.NODE_ENV = "test";

// Variables d'environnement requises pour les tests
process.env.JWT_SECRET =
  "test-jwt-secret-key-for-unit-tests-only-do-not-use-in-production";
process.env.JWT_REFRESH_SECRET =
  "test-jwt-refresh-secret-key-for-unit-tests-only";
process.env.JWT_EXPIRES_IN = "15m";
process.env.JWT_REFRESH_EXPIRES_IN = "7d";

// Clé de chiffrement master (32 bytes = 64 hex chars)
process.env.ENCRYPTION_KEY_MASTER =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// Clé HMAC pour les emails (32 bytes = 64 hex chars)
process.env.EMAIL_HMAC_KEY =
  "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

// Base de données de test
process.env.DB_CONN_STRING = "mongodb://localhost:27017/qvarry-test";
process.env.DB_NAME = "qvarry-test";

// Redis de test
process.env.REDIS_HOST = "localhost";
process.env.REDIS_PORT = "6379";
process.env.REDIS_PASSWORD = "";

// Configuration email (désactivé en test)
process.env.EMAIL_HOST = "smtp.test.com";
process.env.EMAIL_PORT = "587";
process.env.EMAIL_USER = "test@test.com";
process.env.EMAIL_PASSWORD = "test-password";
process.env.EMAIL_FROM = "noreply@test.com";

// Configuration serveur
process.env.PORT = "3001";
process.env.FRONTEND_URL = "http://localhost:3000";
process.env.CORS_ORIGIN = "http://localhost:3000";

// Désactiver les logs pendant les tests (sauf si DEBUG est activé)
if (!process.env.DEBUG) {
  process.env.LOG_LEVEL = "silent";
}

// ════════════════════════════════════════════════════════
// 🔇 Mock du service de logging
// ════════════════════════════════════════════════════════

jest.mock("../services/loggerService", () => {
  const mockLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    http: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    critical: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };

  return {
    __esModule: true,
    default: mockLogger,
    logger: mockLogger,
    sanitizeLogData: jest.fn((data) => data),
    httpLogFormat: ":method :url :status",
    httpLogStream: {
      write: jest.fn(),
    },
  };
});

// ════════════════════════════════════════════════════════
// 🗄️ Mock de Mongoose
// ════════════════════════════════════════════════════════

jest.mock("mongoose", () => {
  const actualMongoose = jest.requireActual("mongoose");

  // Mock de la connexion
  const mockConnect = jest.fn().mockResolvedValue({
    connection: {
      readyState: 1,
      db: {
        databaseName: "qvarry-test",
      },
    },
  });

  const mockDisconnect = jest.fn().mockResolvedValue(undefined);

  return {
    ...actualMongoose,
    connect: mockConnect,
    disconnect: mockDisconnect,
    connection: {
      ...actualMongoose.connection,
      readyState: 1,
      close: jest.fn().mockResolvedValue(undefined),
    },
  };
});

// ════════════════════════════════════════════════════════
// 🔴 Mock de Redis (ioredis)
// ════════════════════════════════════════════════════════

jest.mock("ioredis", () => {
  const mockRedisClient = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue("OK"),
    setex: jest.fn().mockResolvedValue("OK"),
    del: jest.fn().mockResolvedValue(1),
    exists: jest.fn().mockResolvedValue(0),
    expire: jest.fn().mockResolvedValue(1),
    ttl: jest.fn().mockResolvedValue(-1),
    keys: jest.fn().mockResolvedValue([]),
    flushdb: jest.fn().mockResolvedValue("OK"),
    flushall: jest.fn().mockResolvedValue("OK"),
    quit: jest.fn().mockResolvedValue("OK"),
    disconnect: jest.fn(),
    on: jest.fn(),
    once: jest.fn(),
    ping: jest.fn().mockResolvedValue("PONG"),
    status: "ready",
  };

  return jest.fn(() => mockRedisClient);
});

// ════════════════════════════════════════════════════════
// 📧 Mock de Nodemailer
// ════════════════════════════════════════════════════════

jest.mock("nodemailer", () => ({
  createTransport: jest.fn().mockReturnValue({
    sendMail: jest.fn().mockResolvedValue({
      messageId: "test-message-id",
      accepted: ["test@test.com"],
      rejected: [],
    }),
    verify: jest.fn().mockResolvedValue(true),
  }),
}));

// ════════════════════════════════════════════════════════
// 🔐 Mock de bcrypt (pour accélérer les tests)
// ════════════════════════════════════════════════════════

jest.mock("bcrypt", () => ({
  hash: jest.fn().mockResolvedValue("$2b$10$mockedHashedPassword"),
  compare: jest.fn().mockResolvedValue(true),
  genSalt: jest.fn().mockResolvedValue("$2b$10$mockedSalt"),
  hashSync: jest.fn().mockReturnValue("$2b$10$mockedHashedPassword"),
  compareSync: jest.fn().mockReturnValue(true),
}));

// ════════════════════════════════════════════════════════
// 🧹 Nettoyage après tous les tests
// ════════════════════════════════════════════════════════

afterAll(async () => {
  // Fermer les connexions ouvertes
  jest.clearAllMocks();
  jest.restoreAllMocks();

  // Attendre un peu pour que les connexions se ferment proprement
  await new Promise((resolve) => setTimeout(resolve, 100));
});

// ════════════════════════════════════════════════════════
// 🔄 Réinitialisation avant chaque test
// ════════════════════════════════════════════════════════

beforeEach(() => {
  jest.clearAllMocks();
});

// ════════════════════════════════════════════════════════
// 📊 Configuration globale Jest
// ════════════════════════════════════════════════════════

// Augmenter le timeout global si nécessaire
jest.setTimeout(10000);

// Suppression des warnings inutiles
const originalWarn = console.warn;
const originalError = console.error;

beforeAll(() => {
  console.warn = jest.fn((message) => {
    // Filtrer certains warnings connus pendant les tests
    if (
      typeof message === "string" &&
      (message.includes("deprecated") ||
        message.includes("ExperimentalWarning"))
    ) {
      return;
    }
    originalWarn(message);
  });

  console.error = jest.fn((message) => {
    // Filtrer certaines erreurs connues pendant les tests
    if (
      typeof message === "string" &&
      (message.includes("Warning: ReactDOM.render") ||
        message.includes("Not implemented: HTMLFormElement"))
    ) {
      return;
    }
    originalError(message);
  });
});

afterAll(() => {
  console.warn = originalWarn;
  console.error = originalError;
});

// ════════════════════════════════════════════════════════
// ✅ Configuration terminée
// ════════════════════════════════════════════════════════

console.log("🧪 Test environment configured successfully");
