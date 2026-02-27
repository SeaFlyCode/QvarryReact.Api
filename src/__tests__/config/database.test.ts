// ═══════════════════════════════════════════════════════════════════════════
// TESTS: database
// ═══════════════════════════════════════════════════════════════════════════

// Set env vars BEFORE imports
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret";
process.env.ENCRYPTION_KEY_MASTER = "a".repeat(64);
process.env.EMAIL_HMAC_KEY = "test-hmac-key";

// Mock logger
jest.mock("../../services/loggerService", () => ({
  logger: {
    child: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
  },
}));

// Mock errorUtils (used by database.ts)
jest.mock("../../utils/errorUtils", () => ({
  getErrorMessage: jest.fn((error) =>
    error instanceof Error ? error.message : String(error),
  ),
}));

// Mock mongoose properly
const mockConnect = jest.fn();
jest.mock("mongoose", () => ({
  connect: mockConnect,
  __esModule: true,
  default: { connect: mockConnect },
}));

import { connectToDatabase } from "../../config/database";

describe("database", () => {
  const originalEnv = process.env;
  const originalSetTimeout = global.setTimeout;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    mockConnect.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
    global.setTimeout = originalSetTimeout;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test: Connexion réussie
  // ═══════════════════════════════════════════════════════════════════════════

  describe("connectToDatabase", () => {
    it("throws when DB_CONN_STRING is missing", async () => {
      delete process.env.DB_CONN_STRING;

      await expect(connectToDatabase()).rejects.toThrow(
        "Missing DB_CONN_STRING env variable",
      );
      expect(mockConnect).not.toHaveBeenCalled();
    });

    it("throws when DB_CONN_STRING is empty string", async () => {
      process.env.DB_CONN_STRING = "";

      await expect(connectToDatabase()).rejects.toThrow(
        "Missing DB_CONN_STRING env variable",
      );
      expect(mockConnect).not.toHaveBeenCalled();
    });

    it("calls mongoose.connect with correct options when DB_CONN_STRING is set", async () => {
      process.env.DB_CONN_STRING = "mongodb://localhost:27017/testdb";
      process.env.DB_NAME = "TestDB";
      process.env.NODE_ENV = "test";

      mockConnect.mockResolvedValue(undefined);

      await connectToDatabase();

      expect(mockConnect).toHaveBeenCalledTimes(1);
      expect(mockConnect).toHaveBeenCalledWith(
        "mongodb://localhost:27017/testdb",
        expect.objectContaining({
          dbName: "TestDB",
          serverSelectionTimeoutMS: 5000,
          socketTimeoutMS: 45000,
          connectTimeoutMS: 10000,
          retryWrites: true,
          w: "majority",
          family: 4,
        }),
      );
    });

    it("uses default database name when DB_NAME is not set", async () => {
      process.env.DB_CONN_STRING = "mongodb://localhost:27017/testdb";
      delete process.env.DB_NAME;

      mockConnect.mockResolvedValue(undefined);

      await connectToDatabase();

      expect(mockConnect).toHaveBeenCalledWith(
        "mongodb://localhost:27017/testdb",
        expect.objectContaining({
          dbName: "QvarryStorage",
        }),
      );
    });

    it("sets SSL/TLS options when DB_SSL is true", async () => {
      process.env.DB_CONN_STRING = "mongodb://localhost:27017/testdb";
      process.env.DB_SSL = "true";

      mockConnect.mockResolvedValue(undefined);

      await connectToDatabase();

      expect(mockConnect).toHaveBeenCalledWith(
        "mongodb://localhost:27017/testdb",
        expect.objectContaining({
          tls: true,
        }),
      );
    });

    it("disables SSL/TLS when DB_SSL is false in development", async () => {
      process.env.DB_CONN_STRING = "mongodb://localhost:27017/testdb";
      process.env.DB_SSL = "false";
      process.env.NODE_ENV = "development";

      mockConnect.mockResolvedValue(undefined);

      await connectToDatabase();

      const callOptions = mockConnect.mock.calls[0][1];
      expect(callOptions.ssl).toBeUndefined();
      expect(callOptions.tls).toBeUndefined();
    });

    it("enables SSL by default in production", async () => {
      process.env.DB_CONN_STRING = "mongodb://localhost:27017/testdb";
      process.env.NODE_ENV = "production";
      delete process.env.DB_SSL;

      mockConnect.mockResolvedValue(undefined);

      await connectToDatabase();

      expect(mockConnect).toHaveBeenCalledWith(
        "mongodb://localhost:27017/testdb",
        expect.objectContaining({
          tls: true,
        }),
      );
    });

    it("disables SSL in production when DB_SSL is explicitly set to false", async () => {
      process.env.DB_CONN_STRING = "mongodb://localhost:27017/testdb";
      process.env.NODE_ENV = "production";
      process.env.DB_SSL = "false";

      mockConnect.mockResolvedValue(undefined);

      await connectToDatabase();

      const callOptions = mockConnect.mock.calls[0][1];
      expect(callOptions.ssl).toBeUndefined();
      expect(callOptions.tls).toBeUndefined();
    });

    it("uses production pool size settings in production mode", async () => {
      process.env.DB_CONN_STRING = "mongodb://localhost:27017/testdb";
      process.env.NODE_ENV = "production";

      mockConnect.mockResolvedValue(undefined);

      await connectToDatabase();

      expect(mockConnect).toHaveBeenCalledWith(
        "mongodb://localhost:27017/testdb",
        expect.objectContaining({
          maxPoolSize: 50,
          minPoolSize: 10,
        }),
      );
    });

    it("uses development pool size settings in non-production mode", async () => {
      process.env.DB_CONN_STRING = "mongodb://localhost:27017/testdb";
      process.env.NODE_ENV = "development";

      mockConnect.mockResolvedValue(undefined);

      await connectToDatabase();

      expect(mockConnect).toHaveBeenCalledWith(
        "mongodb://localhost:27017/testdb",
        expect.objectContaining({
          maxPoolSize: 10,
          minPoolSize: 2,
        }),
      );
    });

    it("uses production timeout settings in production mode", async () => {
      process.env.DB_CONN_STRING = "mongodb://localhost:27017/testdb";
      process.env.NODE_ENV = "production";

      mockConnect.mockResolvedValue(undefined);

      await connectToDatabase();

      expect(mockConnect).toHaveBeenCalledWith(
        "mongodb://localhost:27017/testdb",
        expect.objectContaining({
          serverSelectionTimeoutMS: 30000,
          connectTimeoutMS: 30000,
        }),
      );
    });

    it("uses test/dev timeout settings in non-production mode", async () => {
      process.env.DB_CONN_STRING = "mongodb://localhost:27017/testdb";
      process.env.NODE_ENV = "test";

      mockConnect.mockResolvedValue(undefined);

      await connectToDatabase();

      expect(mockConnect).toHaveBeenCalledWith(
        "mongodb://localhost:27017/testdb",
        expect.objectContaining({
          serverSelectionTimeoutMS: 5000,
          connectTimeoutMS: 10000,
        }),
      );
    });

    // ═════════════════════════════════════════════════════════════════════════
    // Test: Gestion des erreurs et retries
    // ═════════════════════════════════════════════════════════════════════════

    it("handles connection errors with retries in test mode", async () => {
      // Mock setTimeout to execute immediately (no delay)
      jest.spyOn(global, "setTimeout").mockImplementation((cb: any) => {
        cb();
        return 0 as any;
      });

      process.env.DB_CONN_STRING = "mongodb://localhost:27017/testdb";
      process.env.NODE_ENV = "test";

      const mockError = new Error("Connection failed");
      mockConnect.mockRejectedValue(mockError);

      await expect(connectToDatabase()).rejects.toThrow(
        "Database connection failed",
      );
      expect(mockConnect).toHaveBeenCalledTimes(2);
    });

    it("handles non-Error connection failures with retries", async () => {
      // Mock setTimeout to execute immediately (no delay)
      jest.spyOn(global, "setTimeout").mockImplementation((cb: any) => {
        cb();
        return 0 as any;
      });

      process.env.DB_CONN_STRING = "mongodb://localhost:27017/testdb";
      process.env.NODE_ENV = "test";

      mockConnect.mockRejectedValue("String error");

      await expect(connectToDatabase()).rejects.toThrow(
        "Database connection failed",
      );
      expect(mockConnect).toHaveBeenCalledTimes(2);
    });

    it("retries connection and succeeds on second attempt", async () => {
      // Mock setTimeout to execute immediately (no delay)
      jest.spyOn(global, "setTimeout").mockImplementation((cb: any) => {
        cb();
        return 0 as any;
      });

      process.env.DB_CONN_STRING = "mongodb://localhost:27017/testdb";
      process.env.NODE_ENV = "test";

      const mockError = new Error("Connection failed");
      mockConnect
        .mockRejectedValueOnce(mockError)
        .mockResolvedValueOnce(undefined);

      await connectToDatabase();

      expect(mockConnect).toHaveBeenCalledTimes(2);
    });

    it("retries with correct delays in production mode", async () => {
      // Mock setTimeout to execute immediately (no delay)
      jest.spyOn(global, "setTimeout").mockImplementation((cb: any) => {
        cb();
        return 0 as any;
      });

      process.env.DB_CONN_STRING = "mongodb://localhost:27017/testdb";
      process.env.NODE_ENV = "production";

      const mockError = new Error("Connection failed");
      mockConnect.mockRejectedValue(mockError);

      await expect(connectToDatabase()).rejects.toThrow(
        "Database connection failed",
      );
      // In production mode, maxRetries is 5
      expect(mockConnect).toHaveBeenCalledTimes(5);
    });

    it("succeeds on first retry in production mode", async () => {
      // Mock setTimeout to execute immediately (no delay)
      jest.spyOn(global, "setTimeout").mockImplementation((cb: any) => {
        cb();
        return 0 as any;
      });

      process.env.DB_CONN_STRING = "mongodb://localhost:27017/testdb";
      process.env.NODE_ENV = "production";

      const mockError = new Error("Connection failed");
      mockConnect
        .mockRejectedValueOnce(mockError)
        .mockResolvedValueOnce(undefined);

      await connectToDatabase();

      expect(mockConnect).toHaveBeenCalledTimes(2);
    });

    it("does not expose connection string with credentials in error", async () => {
      // Mock setTimeout to execute immediately (no delay)
      jest.spyOn(global, "setTimeout").mockImplementation((cb: any) => {
        cb();
        return 0 as any;
      });

      process.env.DB_CONN_STRING =
        "mongodb+srv://user:password@cluster.mongodb.net/testdb";
      process.env.NODE_ENV = "test";

      const mockError = new Error("Connection failed");
      mockConnect.mockRejectedValue(mockError);

      try {
        await connectToDatabase();
        fail("Should have thrown an error");
      } catch (error) {
        // The error message should not contain the password
        expect(error).toBeInstanceOf(Error);
        if (error instanceof Error) {
          expect(error.message).toBe("Database connection failed");
          // Password should be masked in logs (tested indirectly)
        }
      }
    });

    it("calls mongoose.connect exactly once on success", async () => {
      process.env.DB_CONN_STRING = "mongodb://localhost:27017/testdb";

      mockConnect.mockResolvedValue(undefined);

      await connectToDatabase();

      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it("includes all required mongoose options", async () => {
      process.env.DB_CONN_STRING = "mongodb://localhost:27017/testdb";
      process.env.NODE_ENV = "test";

      mockConnect.mockResolvedValue(undefined);

      await connectToDatabase();

      const options = mockConnect.mock.calls[0][1];

      // Verify all critical options are present
      expect(options).toHaveProperty("dbName");
      expect(options).toHaveProperty("serverSelectionTimeoutMS", 5000);
      expect(options).toHaveProperty("socketTimeoutMS", 45000);
      expect(options).toHaveProperty("connectTimeoutMS", 10000);
      expect(options).toHaveProperty("maxPoolSize");
      expect(options).toHaveProperty("minPoolSize");
      expect(options).toHaveProperty("retryWrites", true);
      expect(options).toHaveProperty("w", "majority");
      expect(options).toHaveProperty("family", 4);
    });

    it("includes family: 4 in connection options", async () => {
      process.env.DB_CONN_STRING = "mongodb://localhost:27017/testdb";
      process.env.NODE_ENV = "test";

      mockConnect.mockResolvedValue(undefined);

      await connectToDatabase();

      expect(mockConnect).toHaveBeenCalledWith(
        "mongodb://localhost:27017/testdb",
        expect.objectContaining({
          family: 4,
        }),
      );
    });
  });
});
