/**
 * Mocks partagés pour les tests
 * Fournit des factories pour créer des mocks d'objets Express et d'utilisateurs
 */

import { Request, Response, NextFunction } from "express";
import { IUser } from "../../models/users";

// ════════════════════════════════════════════════════════
// 🌐 Mocks Express
// ════════════════════════════════════════════════════════

/**
 * Crée un mock d'objet Request Express
 */
export function mockRequest(
  options: {
    body?: any;
    params?: any;
    query?: any;
    headers?: any;
    cookies?: any;
    user?: any;
    ip?: string;
    method?: string;
    url?: string;
    path?: string;
  } = {},
): Partial<Request> {
  const req: Partial<Request> = {
    body: options.body || {},
    params: options.params || {},
    query: options.query || {},
    headers: options.headers || {},
    cookies: options.cookies || {},
    user: options.user,
    ip: options.ip || "127.0.0.1",
    method: options.method || "GET",
    url: options.url || "/",
    path: options.path || "/",
    get: jest.fn((header: string) => {
      const headerMap: Record<string, string> = {
        "user-agent": "jest-test-agent",
        host: "localhost:3000",
        ...options.headers,
      };
      return headerMap[header.toLowerCase()];
    }),
  };

  return req;
}

/**
 * Crée un mock d'objet Response Express
 */
export function mockResponse(): Partial<Response> {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    cookie: jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis(),
    redirect: jest.fn().mockReturnThis(),
    render: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
    sendStatus: jest.fn().mockReturnThis(),
  };

  return res;
}

/**
 * Crée un mock de NextFunction
 */
export function mockNext(): NextFunction {
  return jest.fn() as NextFunction;
}

// ════════════════════════════════════════════════════════
// 👤 Mocks Utilisateurs
// ════════════════════════════════════════════════════════

/**
 * Crée un mock d'utilisateur avec des valeurs par défaut
 */
export function mockUser(overrides: Partial<IUser> = {}): Partial<IUser> {
  const defaultUser: Partial<IUser> = {
    _id: "507f1f77bcf86cd799439011",
    name: "John",
    surname: "Doe",
    pseudo: "johndoe",
    showPseudo: false,
    email: "john.doe@test.com",
    emailHash: "hashedemail@test.com",
    password: "$2b$10$mockedHashedPassword",
    password_history: [],
    ip_creation: "127.0.0.1",
    ip_last_connection: "127.0.0.1",
    creation_date: new Date("2024-01-01"),
    last_connection: new Date(),
    is_admin: false,
    is_blocked: false,
    contact_code: 123456,
    reset_password_token: "",
    reset_password_expires: new Date(),
    is_verified: true,
    is_auth: true,
    is_admin_validated: true,
    gdpr_consent: true,
    gdpr_consent_date: new Date("2024-01-01"),
    gdpr_consent_version: "1.0",
    two_factor_enabled: false,
    login_notifications_enabled: true,
  };

  return {
    ...defaultUser,
    ...overrides,
  };
}

/**
 * Crée un mock d'utilisateur admin
 */
export function mockAdminUser(overrides: Partial<IUser> = {}): Partial<IUser> {
  return mockUser({
    name: "Admin",
    surname: "User",
    pseudo: "admin",
    email: "admin@test.com",
    is_admin: true,
    contact_code: 999999,
    ...overrides,
  });
}

/**
 * Crée un mock d'utilisateur bloqué
 */
export function mockBlockedUser(
  overrides: Partial<IUser> = {},
): Partial<IUser> {
  return mockUser({
    name: "Blocked",
    surname: "User",
    email: "blocked@test.com",
    is_blocked: true,
    blocked_at: new Date(),
    blocked_reason: "Test blocking reason",
    ...overrides,
  });
}

/**
 * Crée un mock d'utilisateur non vérifié
 */
export function mockUnverifiedUser(
  overrides: Partial<IUser> = {},
): Partial<IUser> {
  return mockUser({
    name: "Unverified",
    surname: "User",
    email: "unverified@test.com",
    is_verified: false,
    is_admin_validated: false,
    email_verification_token: "test-verification-token",
    email_verification_code: "123456",
    email_verification_expires: new Date(Date.now() + 24 * 60 * 60 * 1000), // +24h
    ...overrides,
  });
}

/**
 * Crée un mock d'utilisateur avec 2FA activé
 */
export function mockUser2FA(overrides: Partial<IUser> = {}): Partial<IUser> {
  return mockUser({
    name: "TwoFA",
    surname: "User",
    email: "2fa@test.com",
    two_factor_enabled: true,
    two_factor_secret: "encrypted-secret",
    two_factor_confirmed_at: new Date(),
    two_factor_recovery_codes: [
      "$2b$10$mockedRecoveryCode1",
      "$2b$10$mockedRecoveryCode2",
    ],
    ...overrides,
  });
}

// ════════════════════════════════════════════════════════
// 🔐 Mocks JWT
// ════════════════════════════════════════════════════════

/**
 * Crée un mock de payload JWT
 */
export function mockJwtPayload(overrides: any = {}) {
  return {
    userId: "507f1f77bcf86cd799439011",
    email: "john.doe@test.com",
    is_admin: false,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60 * 15, // +15 minutes
    ...overrides,
  };
}

/**
 * Crée un mock de token JWT
 */
export function mockJwtToken(): string {
  return "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1MDdmMWY3N2JjZjg2Y2Q3OTk0MzkwMTEiLCJlbWFpbCI6ImpvaG4uZG9lQHRlc3QuY29tIiwiaXNfYWRtaW4iOmZhbHNlLCJpYXQiOjE2MzAwMDAwMDAsImV4cCI6MTYzMDAwMDkwMH0.test-signature";
}

/**
 * Crée un mock de refresh token
 */
export function mockRefreshToken(): string {
  return "refresh-token-mock-" + Math.random().toString(36).substring(2);
}

// ════════════════════════════════════════════════════════
// 🗄️ Mocks MongoDB
// ════════════════════════════════════════════════════════

/**
 * Crée un mock de document Mongoose
 */
export function mockMongooseDocument<T>(data: Partial<T>): any {
  return {
    ...data,
    _id: data._id || "507f1f77bcf86cd799439011",
    save: jest.fn().mockResolvedValue(data),
    remove: jest.fn().mockResolvedValue(data),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    toObject: jest.fn().mockReturnValue(data),
    toJSON: jest.fn().mockReturnValue(data),
  };
}

/**
 * Crée un mock de modèle Mongoose
 */
export function mockMongooseModel<T>() {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    updateOne: jest.fn(),
    updateMany: jest.fn(),
    deleteOne: jest.fn(),
    deleteMany: jest.fn(),
    countDocuments: jest.fn(),
    exists: jest.fn(),
    save: jest.fn(),
  };
}

// ════════════════════════════════════════════════════════
// 🔴 Mocks Redis
// ════════════════════════════════════════════════════════

/**
 * Crée un mock de client Redis
 */
export function mockRedisClient() {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue("OK"),
    setex: jest.fn().mockResolvedValue("OK"),
    del: jest.fn().mockResolvedValue(1),
    exists: jest.fn().mockResolvedValue(0),
    expire: jest.fn().mockResolvedValue(1),
    ttl: jest.fn().mockResolvedValue(-1),
    keys: jest.fn().mockResolvedValue([]),
    flushdb: jest.fn().mockResolvedValue("OK"),
    quit: jest.fn().mockResolvedValue("OK"),
    disconnect: jest.fn(),
    on: jest.fn(),
    ping: jest.fn().mockResolvedValue("PONG"),
  };
}

// ════════════════════════════════════════════════════════
// 📧 Mocks Email
// ════════════════════════════════════════════════════════

/**
 * Crée un mock de transporter Nodemailer
 */
export function mockEmailTransporter() {
  return {
    sendMail: jest.fn().mockResolvedValue({
      messageId: "test-message-id-" + Date.now(),
      accepted: ["test@test.com"],
      rejected: [],
      response: "250 Message accepted",
    }),
    verify: jest.fn().mockResolvedValue(true),
  };
}

// ════════════════════════════════════════════════════════
// 🌐 Mocks WebSocket
// ════════════════════════════════════════════════════════

/**
 * Crée un mock de WebSocket client
 */
export function mockWebSocket() {
  return {
    send: jest.fn(),
    close: jest.fn(),
    on: jest.fn(),
    once: jest.fn(),
    emit: jest.fn(),
    readyState: 1, // OPEN
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
  };
}

/**
 * Crée un mock de WebSocket Server
 */
export function mockWebSocketServer() {
  return {
    clients: new Set(),
    on: jest.fn(),
    emit: jest.fn(),
    close: jest.fn(),
    handleUpgrade: jest.fn(),
  };
}

// ════════════════════════════════════════════════════════
// 🛠️ Utilitaires de test
// ════════════════════════════════════════════════════════

/**
 * Attend un certain délai (pour les tests asynchrones)
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Crée un mock de Date.now() qui retourne une valeur fixe
 */
export function mockDateNow(timestamp: number) {
  const originalDateNow = Date.now;
  Date.now = jest.fn(() => timestamp);
  return () => {
    Date.now = originalDateNow;
  };
}

/**
 * Réinitialise tous les mocks
 */
export function resetAllMocks() {
  jest.clearAllMocks();
  jest.resetAllMocks();
}

// ════════════════════════════════════════════════════════
// 📊 Exports
// ════════════════════════════════════════════════════════

export default {
  mockRequest,
  mockResponse,
  mockNext,
  mockUser,
  mockAdminUser,
  mockBlockedUser,
  mockUnverifiedUser,
  mockUser2FA,
  mockJwtPayload,
  mockJwtToken,
  mockRefreshToken,
  mockMongooseDocument,
  mockMongooseModel,
  mockRedisClient,
  mockEmailTransporter,
  mockWebSocket,
  mockWebSocketServer,
  wait,
  mockDateNow,
  resetAllMocks,
};
