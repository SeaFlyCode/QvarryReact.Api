// ═══════════════════════════════════════════════════════════════════════════
// TESTS: swagger configuration
// ═══════════════════════════════════════════════════════════════════════════

const mockSwaggerSpec = {
  openapi: "3.0.0",
  info: {
    title: "Qvarry API",
    version: "1.0.0",
    description: "Documentation de l'API Qvarry React",
    contact: { name: "Qvarry Team" },
  },
  servers: [
    {
      url: "http://localhost:3000/api",
      description: "Serveur de développement",
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Token JWT d'authentification",
      },
      cookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: "accessToken",
        description: "Token JWT dans le cookie",
      },
    },
  },
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  paths: {},
};

// We need to use jest.mock factories that always return proper values
// because jest.config has resetMocks: true
jest.mock("swagger-jsdoc", () => {
  const fn = jest.fn(() => ({
    openapi: "3.0.0",
    info: {
      title: "Qvarry API",
      version: "1.0.0",
      description: "Documentation de l'API Qvarry React",
      contact: { name: "Qvarry Team" },
    },
    servers: [
      {
        url: "http://localhost:3000/api",
        description: "Serveur de développement",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Token JWT d'authentification",
        },
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "accessToken",
          description: "Token JWT dans le cookie",
        },
      },
    },
    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
    paths: {},
  }));
  return { __esModule: true, default: fn };
});

const mockServeMiddleware = jest.fn((req: any, res: any, next: any) => next());
const mockSetupMiddleware = jest.fn((req: any, res: any, next: any) => next());

jest.mock("swagger-ui-express", () => ({
  serveFiles: jest.fn(() => mockServeMiddleware),
  setup: jest.fn(() => mockSetupMiddleware),
}));

import { Express, Request, Response, NextFunction } from "express";

describe("swagger configuration", () => {
  let mockApp: any;
  let setupSwagger: (app: Express) => void;
  let swaggerSpec: any;
  let swaggerJsdoc: jest.Mock;
  let swaggerUi: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.resetModules();

    // Re-import fresh module each time
    const swaggerModule = await import("../../config/swagger");
    setupSwagger = swaggerModule.setupSwagger;
    swaggerSpec = swaggerModule.swaggerSpec;

    swaggerJsdoc = (await import("swagger-jsdoc")).default as jest.Mock;
    swaggerUi = await import("swagger-ui-express");

    mockApp = {
      use: jest.fn(),
      get: jest.fn(),
    };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test: setupSwagger registers routes
  // ═══════════════════════════════════════════════════════════════════════════

  describe("setupSwagger", () => {
    it("should register /api-docs route on Express app", () => {
      setupSwagger(mockApp as Express);

      expect(mockApp.use).toHaveBeenCalledWith(
        "/api-docs",
        expect.any(Function),
        expect.any(Function),
        expect.any(Function),
      );
    });

    it("should register /api-docs.json route on Express app", () => {
      setupSwagger(mockApp as Express);

      expect(mockApp.get).toHaveBeenCalledWith(
        "/api-docs.json",
        expect.any(Function),
      );
    });

    it("should call swagger-ui-express.serveFiles with correct options", () => {
      setupSwagger(mockApp as Express);

      expect(swaggerUi.serveFiles).toHaveBeenCalledWith(undefined, {
        swaggerOptions: { url: "/api-docs.json" },
      });
    });

    it("should call swagger-ui-express.setup with correct options", () => {
      setupSwagger(mockApp as Express);

      expect(swaggerUi.setup).toHaveBeenCalledWith(undefined, {
        explorer: true,
        customCss: ".swagger-ui .topbar { display: none }",
        customSiteTitle: "Qvarry API Documentation",
        swaggerOptions: {
          url: "/api-docs.json",
          persistAuthorization: true,
          docExpansion: "none",
          filter: true,
          showRequestDuration: true,
        },
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test: /api-docs.json handler
  // ═══════════════════════════════════════════════════════════════════════════

  describe("/api-docs.json handler", () => {
    it("should send JSON with correct Content-Type header", () => {
      setupSwagger(mockApp as Express);

      const getCall = mockApp.get.mock.calls.find(
        (call: any) => call[0] === "/api-docs.json",
      );
      expect(getCall).toBeDefined();

      const handler = getCall![1] as (req: Request, res: Response) => void;

      const mockRes = {
        setHeader: jest.fn(),
        send: jest.fn(),
      } as unknown as Response;

      handler({} as Request, mockRes);

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        "Content-Type",
        "application/json",
      );
    });

    it("should send JSON with no-cache headers", () => {
      setupSwagger(mockApp as Express);

      const getCall = mockApp.get.mock.calls.find(
        (call: any) => call[0] === "/api-docs.json",
      );
      const handler = getCall![1] as (req: Request, res: Response) => void;

      const mockRes = {
        setHeader: jest.fn(),
        send: jest.fn(),
      } as unknown as Response;

      handler({} as Request, mockRes);

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        "Cache-Control",
        "no-cache, no-store, must-revalidate",
      );
    });

    it("should send the generated swagger spec", () => {
      setupSwagger(mockApp as Express);

      const getCall = mockApp.get.mock.calls.find(
        (call: any) => call[0] === "/api-docs.json",
      );
      const handler = getCall![1] as (req: Request, res: Response) => void;

      const mockRes = {
        setHeader: jest.fn(),
        send: jest.fn(),
      } as unknown as Response;

      handler({} as Request, mockRes);

      expect(mockRes.send).toHaveBeenCalledWith(
        expect.objectContaining({
          openapi: "3.0.0",
          info: expect.objectContaining({ title: "Qvarry API" }),
        }),
      );
    });

    it("should regenerate spec on each request (hot-reload)", () => {
      setupSwagger(mockApp as Express);

      const getCall = mockApp.get.mock.calls.find(
        (call: any) => call[0] === "/api-docs.json",
      );
      const handler = getCall![1] as (req: Request, res: Response) => void;

      const mockRes = {
        setHeader: jest.fn(),
        send: jest.fn(),
      } as unknown as Response;

      swaggerJsdoc.mockClear();

      handler({} as Request, mockRes);
      handler({} as Request, mockRes);

      expect(swaggerJsdoc).toHaveBeenCalledTimes(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test: refreshSwaggerSpec middleware
  // ═══════════════════════════════════════════════════════════════════════════

  describe("refreshSwaggerSpec middleware", () => {
    it("should regenerate spec and call next()", () => {
      setupSwagger(mockApp as Express);

      const useCall = mockApp.use.mock.calls.find(
        (call: any) => call[0] === "/api-docs",
      );
      expect(useCall).toBeDefined();

      const refreshMiddleware = useCall![1] as (
        req: any,
        res: Response,
        next: NextFunction,
      ) => void;

      const mockReq = {} as any;
      const mockNext = jest.fn();

      swaggerJsdoc.mockClear();

      refreshMiddleware(mockReq, {} as Response, mockNext);

      expect(swaggerJsdoc).toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.swaggerDoc).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test: swaggerSpec export
  // ═══════════════════════════════════════════════════════════════════════════

  describe("swaggerSpec export", () => {
    it("should be defined", () => {
      expect(swaggerSpec).toBeDefined();
    });

    it("should have OpenAPI 3.0.0 version", () => {
      expect(swaggerSpec.openapi).toBe("3.0.0");
    });

    it("should have API title and version", () => {
      expect(swaggerSpec.info.title).toBe("Qvarry API");
      expect(swaggerSpec.info.version).toBe("1.0.0");
    });

    it("should contain security schemes", () => {
      expect(swaggerSpec.components.securitySchemes).toHaveProperty(
        "bearerAuth",
      );
      expect(swaggerSpec.components.securitySchemes).toHaveProperty(
        "cookieAuth",
      );
    });
  });
});
