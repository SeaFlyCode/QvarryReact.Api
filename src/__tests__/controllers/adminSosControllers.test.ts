/**
 * Tests unitaires pour adminSosControllers
 * Teste les fonctions d'administration du Mode SOS
 */

jest.mock("../../services/sosService");
jest.mock("../../utils/errorUtils");

import { Request, Response } from "express";
import {
  handleAdminSosDashboard,
  handleAdminSosActiveSessions,
  handleAdminSosSessionDetails,
  handleAdminSosCancelSession,
  handleAdminSosHistory,
  handleAdminSosStats,
  handleAdminSosForceEscalation,
  handleAdminSosExtendSession,
  handleAdminSosActivateSession,
  handleAdminSosConfirmSafe,
  handleAdminSosTriggerSms,
  handleAdminSosSendNotification,
  handleAdminSosAddParticipant,
  handleAdminSosRemoveParticipant,
} from "../../controllers/adminSosControllers";
import { mockRequest, mockResponse } from "../mocks";
import { sosService } from "../../services/sosService";
import { getErrorMessage } from "../../utils/errorUtils";

describe("adminSosControllers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getErrorMessage as jest.Mock).mockImplementation((err) =>
      err instanceof Error ? err.message : String(err),
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: handleAdminSosDashboard
  // ═══════════════════════════════════════════════════════════════════════════

  describe("handleAdminSosDashboard", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "admin123", isAdmin: true },
      });
      res = mockResponse();

      (sosService.getAdminDashboard as jest.Mock).mockResolvedValue({
        activeSessions: 5,
        totalSessionsToday: 12,
        totalSessionsWeek: 45,
        averageResponseTime: 120,
        emergencyCount: 2,
      });
    });

    it("devrait retourner le dashboard SOS", async () => {
      await handleAdminSosDashboard(req as Request, res as Response);

      expect(sosService.getAdminDashboard).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            activeSessions: 5,
            totalSessionsToday: 12,
            totalSessionsWeek: 45,
          }),
        }),
      );
    });

    it("devrait rejeter si non authentifié", async () => {
      req = mockRequest({ user: undefined });

      await handleAdminSosDashboard(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("Authentification requise"),
          code: "UNAUTHORIZED",
        }),
      );
    });

    it("devrait gérer les erreurs du service", async () => {
      (sosService.getAdminDashboard as jest.Mock).mockRejectedValue(
        new Error("Service error"),
      );

      await handleAdminSosDashboard(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("dashboard"),
          code: "INTERNAL_ERROR",
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: handleAdminSosActiveSessions
  // ═══════════════════════════════════════════════════════════════════════════

  describe("handleAdminSosActiveSessions", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "admin123", isAdmin: true },
      });
      res = mockResponse();

      const mockSessions = [
        {
          _id: "session1",
          userId: "user123",
          status: "active",
          startedAt: new Date(),
          participantCount: 2,
        },
        {
          _id: "session2",
          userId: "user456",
          status: "active",
          startedAt: new Date(),
          participantCount: 1,
        },
      ];

      (sosService.getAllActiveSessions as jest.Mock).mockResolvedValue(
        mockSessions,
      );
    });

    it("devrait retourner les sessions actives", async () => {
      await handleAdminSosActiveSessions(req as Request, res as Response);

      expect(sosService.getAllActiveSessions).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          sessions: expect.arrayContaining([
            expect.objectContaining({
              _id: "session1",
              status: "active",
            }),
          ]),
          count: 2,
        }),
      );
    });

    it("devrait rejeter si non authentifié", async () => {
      req = mockRequest({ user: undefined });

      await handleAdminSosActiveSessions(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("Authentification requise"),
          code: "UNAUTHORIZED",
        }),
      );
    });

    it("devrait retourner un tableau vide si aucune session", async () => {
      (sosService.getAllActiveSessions as jest.Mock).mockResolvedValue([]);

      await handleAdminSosActiveSessions(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          sessions: [],
          count: 0,
        }),
      );
    });

    it("devrait gérer les erreurs du service", async () => {
      (sosService.getAllActiveSessions as jest.Mock).mockRejectedValue(
        new Error("Service error"),
      );

      await handleAdminSosActiveSessions(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("sessions actives"),
          code: "INTERNAL_ERROR",
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: handleAdminSosSessionDetails
  // ═══════════════════════════════════════════════════════════════════════════

  describe("handleAdminSosSessionDetails", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "admin123", isAdmin: true },
        params: { sessionId: "session123" },
      });
      res = mockResponse();

      const mockDetails = {
        _id: "session123",
        userId: "user123",
        status: "active",
        startedAt: new Date(),
        participants: [
          { userId: "user123", status: "active" },
          { userId: "user456", status: "active" },
        ],
        logs: [
          { action: "session_started", timestamp: new Date() },
          { action: "participant_joined", timestamp: new Date() },
        ],
      };

      (sosService.getSessionDetails as jest.Mock).mockResolvedValue(
        mockDetails,
      );
    });

    it("devrait retourner les détails d'une session", async () => {
      await handleAdminSosSessionDetails(req as Request, res as Response);

      expect(sosService.getSessionDetails).toHaveBeenCalledWith("session123");
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            _id: "session123",
            status: "active",
            participants: expect.any(Array),
          }),
        }),
      );
    });

    it("devrait rejeter si non authentifié", async () => {
      req = mockRequest({
        user: undefined,
        params: { sessionId: "session123" },
      });

      await handleAdminSosSessionDetails(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("Authentification requise"),
          code: "UNAUTHORIZED",
        }),
      );
    });

    it("devrait rejeter si sessionId manquant", async () => {
      req.params = {};

      await handleAdminSosSessionDetails(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("ID de session requis"),
          code: "MISSING_SESSION_ID",
        }),
      );
    });

    it("devrait retourner 404 si session non trouvée", async () => {
      const error = new Error("SESSION_NOT_FOUND");
      (sosService.getSessionDetails as jest.Mock).mockRejectedValue(error);

      await handleAdminSosSessionDetails(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("Session non trouvée"),
          code: "SESSION_NOT_FOUND",
        }),
      );
    });

    it("devrait gérer les autres erreurs", async () => {
      (sosService.getSessionDetails as jest.Mock).mockRejectedValue(
        new Error("Service error"),
      );

      await handleAdminSosSessionDetails(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("détails"),
          code: "INTERNAL_ERROR",
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: handleAdminSosCancelSession
  // ═══════════════════════════════════════════════════════════════════════════

  describe("handleAdminSosCancelSession", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "admin123", isAdmin: true },
        params: { sessionId: "session123" },
        body: { reason: "Résolution manuelle par admin" },
      });
      res = mockResponse();

      const mockSession = {
        _id: "session123",
        status: "resolved",
        resolvedAt: new Date(),
        resolvedBy: "admin123",
        participants: [
          { userId: "user123", status: "left", leftAt: new Date() },
          { userId: "user456", status: "left", leftAt: new Date() },
        ],
      };

      (sosService.adminCancelSession as jest.Mock).mockResolvedValue(
        mockSession,
      );
    });

    it("devrait annuler une session SOS", async () => {
      await handleAdminSosCancelSession(req as Request, res as Response);

      expect(sosService.adminCancelSession).toHaveBeenCalledWith(
        "session123",
        "admin123",
        "Résolution manuelle par admin",
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          session: expect.objectContaining({
            id: "session123",
            status: "resolved",
            participantCount: 2,
          }),
          message: expect.stringContaining("annulée avec succès"),
        }),
      );
    });

    it("devrait rejeter si non authentifié", async () => {
      req = mockRequest({
        user: undefined,
        params: { sessionId: "session123" },
      });

      await handleAdminSosCancelSession(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("Authentification requise"),
          code: "UNAUTHORIZED",
        }),
      );
    });

    it("devrait rejeter si sessionId manquant", async () => {
      req.params = {};

      await handleAdminSosCancelSession(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("ID de session requis"),
          code: "MISSING_SESSION_ID",
        }),
      );
    });

    it("devrait retourner 404 si session non trouvée", async () => {
      const error = new Error("SESSION_NOT_FOUND");
      (sosService.adminCancelSession as jest.Mock).mockRejectedValue(error);

      await handleAdminSosCancelSession(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("Session non trouvée"),
          code: "SESSION_NOT_FOUND",
        }),
      );
    });

    it("devrait gérer les erreurs du service", async () => {
      (sosService.adminCancelSession as jest.Mock).mockRejectedValue(
        new Error("Service error"),
      );

      await handleAdminSosCancelSession(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("annulation"),
          code: "INTERNAL_ERROR",
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: handleAdminSosHistory
  // ═══════════════════════════════════════════════════════════════════════════

  describe("handleAdminSosHistory", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "admin123", isAdmin: true },
        query: { limit: "50", status: "resolved" },
      });
      res = mockResponse();

      const mockHistory = [
        {
          _id: "session1",
          userId: "user123",
          status: "resolved",
          startedAt: new Date(),
          resolvedAt: new Date(),
        },
        {
          _id: "session2",
          userId: "user456",
          status: "cancelled",
          startedAt: new Date(),
          resolvedAt: new Date(),
        },
      ];

      (sosService.getAdminSessionHistory as jest.Mock).mockResolvedValue(
        mockHistory,
      );
    });

    it("devrait retourner l'historique des sessions", async () => {
      await handleAdminSosHistory(req as Request, res as Response);

      expect(sosService.getAdminSessionHistory).toHaveBeenCalledWith(
        50,
        "resolved",
        undefined,
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          sessions: expect.arrayContaining([
            expect.objectContaining({
              _id: "session1",
              status: "resolved",
            }),
          ]),
          count: 2,
        }),
      );
    });

    it("devrait filtrer par userId", async () => {
      req.query = { userId: "user123" };

      await handleAdminSosHistory(req as Request, res as Response);

      expect(sosService.getAdminSessionHistory).toHaveBeenCalledWith(
        50,
        undefined,
        "user123",
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("devrait limiter le nombre de résultats (max 100)", async () => {
      req.query = { limit: "150" }; // Doit être limité à 100

      await handleAdminSosHistory(req as Request, res as Response);

      expect(sosService.getAdminSessionHistory).toHaveBeenCalledWith(
        100,
        undefined,
        undefined,
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("devrait rejeter si non authentifié", async () => {
      req = mockRequest({ user: undefined });

      await handleAdminSosHistory(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("Authentification requise"),
          code: "UNAUTHORIZED",
        }),
      );
    });

    it("devrait gérer les erreurs du service", async () => {
      (sosService.getAdminSessionHistory as jest.Mock).mockRejectedValue(
        new Error("Service error"),
      );

      await handleAdminSosHistory(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("historique"),
          code: "INTERNAL_ERROR",
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: handleAdminSosStats
  // ═══════════════════════════════════════════════════════════════════════════

  describe("handleAdminSosStats", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "admin123", isAdmin: true },
        query: {},
      });
      res = mockResponse();

      const mockStats = {
        totalSessions: 150,
        activeSessions: 3,
        resolvedSessions: 145,
        cancelledSessions: 2,
        averageResponseTime: 180,
        averageDuration: 300,
        peakHour: 14,
      };

      (sosService.getAdminSosStats as jest.Mock).mockResolvedValue(mockStats);
    });

    it("devrait retourner les statistiques SOS", async () => {
      await handleAdminSosStats(req as Request, res as Response);

      expect(sosService.getAdminSosStats).toHaveBeenCalledWith(
        undefined,
        undefined,
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            totalSessions: 150,
            activeSessions: 3,
            averageResponseTime: 180,
          }),
        }),
      );
    });

    it("devrait filtrer par dates", async () => {
      req.query = {
        startDate: "2024-01-01",
        endDate: "2024-12-31",
      };

      await handleAdminSosStats(req as Request, res as Response);

      expect(sosService.getAdminSosStats).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("devrait rejeter une date de début invalide", async () => {
      req.query = { startDate: "invalid-date" };

      await handleAdminSosStats(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("Date de début invalide"),
          code: "INVALID_START_DATE",
        }),
      );
    });

    it("devrait rejeter une date de fin invalide", async () => {
      req.query = { endDate: "invalid-date" };

      await handleAdminSosStats(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("Date de fin invalide"),
          code: "INVALID_END_DATE",
        }),
      );
    });

    it("devrait rejeter si non authentifié", async () => {
      req = mockRequest({ user: undefined });

      await handleAdminSosStats(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("Authentification requise"),
          code: "UNAUTHORIZED",
        }),
      );
    });

    it("devrait gérer les erreurs du service", async () => {
      (sosService.getAdminSosStats as jest.Mock).mockRejectedValue(
        new Error("Service error"),
      );

      await handleAdminSosStats(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("statistiques"),
          code: "INTERNAL_ERROR",
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: handleAdminSosForceEscalation
  // ═══════════════════════════════════════════════════════════════════════════

  describe("handleAdminSosForceEscalation", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "admin123", isAdmin: true },
        params: { sessionId: "session123" },
        body: { userId: "user123", targetStage: 1 },
      });
      res = mockResponse();

      (sosService.adminForceEscalation as jest.Mock).mockResolvedValue({
        session: {
          _id: "session123",
          status: "ESCALATING",
          currentStage: 1,
        },
        participant: {
          userId: "user123",
          currentStage: 1,
          escalationHistory: [],
        },
      });
    });

    it("devrait forcer l'escalade d'un participant", async () => {
      await handleAdminSosForceEscalation(req as Request, res as Response);

      expect(sosService.adminForceEscalation).toHaveBeenCalledWith(
        "session123",
        "user123",
        1,
        "admin123",
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          session: expect.objectContaining({
            id: "session123",
            currentStage: 1,
          }),
          participant: expect.objectContaining({
            userId: "user123",
            currentStage: 1,
          }),
        }),
      );
    });

    it("devrait rejeter si non authentifié", async () => {
      req = mockRequest({ user: undefined });

      await handleAdminSosForceEscalation(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("Authentification requise"),
          code: "UNAUTHORIZED",
        }),
      );
    });

    it("devrait rejeter si sessionId manquant", async () => {
      req.params = {};

      await handleAdminSosForceEscalation(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "MISSING_SESSION_ID",
        }),
      );
    });

    it("devrait rejeter si userId manquant", async () => {
      req.body = { targetStage: 1 };

      await handleAdminSosForceEscalation(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "MISSING_USER_ID",
        }),
      );
    });

    it("devrait rejeter si targetStage invalide", async () => {
      req.body = { userId: "user123", targetStage: 5 };

      await handleAdminSosForceEscalation(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "INVALID_STAGE",
        }),
      );
    });

    it("devrait retourner 404 si session non trouvée", async () => {
      (sosService.adminForceEscalation as jest.Mock).mockRejectedValue(
        new Error("SESSION_NOT_FOUND"),
      );

      await handleAdminSosForceEscalation(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "SESSION_NOT_FOUND",
        }),
      );
    });

    it("devrait retourner 409 si stage déjà atteint", async () => {
      (sosService.adminForceEscalation as jest.Mock).mockRejectedValue(
        new Error("STAGE_ALREADY_REACHED"),
      );

      await handleAdminSosForceEscalation(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "STAGE_ALREADY_REACHED",
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: handleAdminSosExtendSession
  // ═══════════════════════════════════════════════════════════════════════════

  describe("handleAdminSosExtendSession", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "admin123", isAdmin: true },
        params: { sessionId: "session123" },
        body: { additionalMinutes: 30 },
      });
      res = mockResponse();

      (sosService.adminExtendSession as jest.Mock).mockResolvedValue({
        _id: "session123",
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + 90 * 60 * 1000),
        extensionCount: 1,
      });
    });

    it("devrait étendre la durée d'une session", async () => {
      await handleAdminSosExtendSession(req as Request, res as Response);

      expect(sosService.adminExtendSession).toHaveBeenCalledWith(
        "session123",
        30,
        "admin123",
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          session: expect.objectContaining({
            id: "session123",
            extensionCount: 1,
          }),
        }),
      );
    });

    it("devrait rejeter si non authentifié", async () => {
      req = mockRequest({ user: undefined });

      await handleAdminSosExtendSession(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "UNAUTHORIZED",
        }),
      );
    });

    it("devrait rejeter si sessionId manquant", async () => {
      req.params = {};

      await handleAdminSosExtendSession(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "MISSING_SESSION_ID",
        }),
      );
    });

    it("devrait rejeter si additionalMinutes invalide (trop court)", async () => {
      req.body = { additionalMinutes: 5 };

      await handleAdminSosExtendSession(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "INVALID_EXTENSION_DURATION",
        }),
      );
    });

    it("devrait rejeter si additionalMinutes invalide (trop long)", async () => {
      req.body = { additionalMinutes: 600 };

      await handleAdminSosExtendSession(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "INVALID_EXTENSION_DURATION",
        }),
      );
    });

    it("devrait retourner 404 si session non trouvée", async () => {
      (sosService.adminExtendSession as jest.Mock).mockRejectedValue(
        new Error("SESSION_NOT_FOUND"),
      );

      await handleAdminSosExtendSession(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "SESSION_NOT_FOUND",
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: handleAdminSosActivateSession
  // ═══════════════════════════════════════════════════════════════════════════

  describe("handleAdminSosActivateSession", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "admin123", isAdmin: true },
        body: {
          targetUserId: "user123",
          expectedDuration: 60,
          note: "Test dive",
          lat: 48.8566,
          lng: 2.3522,
        },
      });
      res = mockResponse();

      (sosService.adminActivateSession as jest.Mock).mockResolvedValue({
        _id: "session123",
        status: "ACTIVE",
        activatedAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        participants: [
          { userId: { toString: () => "user123" }, status: "ACTIVE", currentStage: -1 },
        ],
      });
    });

    it("devrait activer une session pour un utilisateur cible", async () => {
      await handleAdminSosActivateSession(req as Request, res as Response);

      expect(sosService.adminActivateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          targetUserId: "user123",
          adminId: "admin123",
          expectedDuration: 60,
        }),
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          session: expect.objectContaining({
            id: "session123",
            status: "ACTIVE",
          }),
        }),
      );
    });

    it("devrait rejeter si non authentifié", async () => {
      req = mockRequest({ user: undefined });

      await handleAdminSosActivateSession(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "UNAUTHORIZED",
        }),
      );
    });

    it("devrait rejeter si targetUserId manquant", async () => {
      req.body = { expectedDuration: 60 };

      await handleAdminSosActivateSession(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "MISSING_TARGET_USER_ID",
        }),
      );
    });

    it("devrait rejeter si expectedDuration invalide", async () => {
      req.body = { targetUserId: "user123", expectedDuration: 5 };

      await handleAdminSosActivateSession(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "INVALID_DURATION",
        }),
      );
    });

    it("devrait retourner 409 si session déjà active", async () => {
      (sosService.adminActivateSession as jest.Mock).mockRejectedValue(
        new Error("SESSION_ALREADY_ACTIVE"),
      );

      await handleAdminSosActivateSession(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "SESSION_ALREADY_ACTIVE",
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: handleAdminSosConfirmSafe
  // ═══════════════════════════════════════════════════════════════════════════

  describe("handleAdminSosConfirmSafe", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "admin123", isAdmin: true },
        params: { sessionId: "session123" },
        body: { reason: "Résolution manuelle admin" },
      });
      res = mockResponse();

      (sosService.adminConfirmSafe as jest.Mock).mockResolvedValue({
        _id: "session123",
        status: "RESOLVED",
        resolvedAt: new Date(),
        resolvedBy: "ADMIN_CONFIRM",
        participants: [
          { userId: { toString: () => "user123" }, status: "LEFT" },
        ],
      });
    });

    it("devrait confirmer la sécurité via admin", async () => {
      await handleAdminSosConfirmSafe(req as Request, res as Response);

      expect(sosService.adminConfirmSafe).toHaveBeenCalledWith(
        "session123",
        "admin123",
        "Résolution manuelle admin",
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          session: expect.objectContaining({
            id: "session123",
            status: "RESOLVED",
          }),
        }),
      );
    });

    it("devrait rejeter si non authentifié", async () => {
      req = mockRequest({ user: undefined });

      await handleAdminSosConfirmSafe(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "UNAUTHORIZED",
        }),
      );
    });

    it("devrait rejeter si sessionId manquant", async () => {
      req.params = {};

      await handleAdminSosConfirmSafe(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "MISSING_SESSION_ID",
        }),
      );
    });

    it("devrait retourner 404 si session non trouvée", async () => {
      (sosService.adminConfirmSafe as jest.Mock).mockRejectedValue(
        new Error("SESSION_NOT_FOUND"),
      );

      await handleAdminSosConfirmSafe(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "SESSION_NOT_FOUND",
        }),
      );
    });

    it("devrait gérer les erreurs du service", async () => {
      (sosService.adminConfirmSafe as jest.Mock).mockRejectedValue(
        new Error("Service error"),
      );

      await handleAdminSosConfirmSafe(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "INTERNAL_ERROR",
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: handleAdminSosTriggerSms
  // ═══════════════════════════════════════════════════════════════════════════

  describe("handleAdminSosTriggerSms", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "admin123", isAdmin: true },
        params: { sessionId: "session123" },
      });
      res = mockResponse();

      (sosService.adminTriggerSms as jest.Mock).mockResolvedValue({
        sent: 2,
        failed: 0,
      });
    });

    it("devrait déclencher les SMS d'urgence", async () => {
      await handleAdminSosTriggerSms(req as Request, res as Response);

      expect(sosService.adminTriggerSms).toHaveBeenCalledWith(
        "session123",
        "admin123",
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          sent: 2,
          failed: 0,
        }),
      );
    });

    it("devrait rejeter si non authentifié", async () => {
      req = mockRequest({ user: undefined });

      await handleAdminSosTriggerSms(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "UNAUTHORIZED",
        }),
      );
    });

    it("devrait rejeter si sessionId manquant", async () => {
      req.params = {};

      await handleAdminSosTriggerSms(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "MISSING_SESSION_ID",
        }),
      );
    });

    it("devrait retourner 404 si session non trouvée", async () => {
      (sosService.adminTriggerSms as jest.Mock).mockRejectedValue(
        new Error("SESSION_NOT_FOUND"),
      );

      await handleAdminSosTriggerSms(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "SESSION_NOT_FOUND",
        }),
      );
    });

    it("devrait retourner 400 si aucun contact trouvé", async () => {
      (sosService.adminTriggerSms as jest.Mock).mockRejectedValue(
        new Error("NO_CONTACTS_FOUND"),
      );

      await handleAdminSosTriggerSms(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "NO_CONTACTS_FOUND",
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: handleAdminSosSendNotification
  // ═══════════════════════════════════════════════════════════════════════════

  describe("handleAdminSosSendNotification", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "admin123", isAdmin: true },
        params: { sessionId: "session123" },
        body: { targetUserId: "user123", message: "Alerte admin" },
      });
      res = mockResponse();

      (sosService.adminSendNotification as jest.Mock).mockResolvedValue(
        undefined,
      );
    });

    it("devrait envoyer une notification à un participant", async () => {
      await handleAdminSosSendNotification(req as Request, res as Response);

      expect(sosService.adminSendNotification).toHaveBeenCalledWith(
        "session123",
        "user123",
        "Alerte admin",
        "admin123",
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: expect.stringContaining("Notification envoyée"),
        }),
      );
    });

    it("devrait rejeter si non authentifié", async () => {
      req = mockRequest({ user: undefined });

      await handleAdminSosSendNotification(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "UNAUTHORIZED",
        }),
      );
    });

    it("devrait rejeter si sessionId manquant", async () => {
      req.params = {};

      await handleAdminSosSendNotification(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "MISSING_SESSION_ID",
        }),
      );
    });

    it("devrait rejeter si targetUserId manquant", async () => {
      req.body = { message: "Alerte" };

      await handleAdminSosSendNotification(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "MISSING_TARGET_USER_ID",
        }),
      );
    });

    it("devrait rejeter si message vide", async () => {
      req.body = { targetUserId: "user123", message: "" };

      await handleAdminSosSendNotification(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "INVALID_MESSAGE",
        }),
      );
    });

    it("devrait rejeter si message trop long", async () => {
      req.body = { targetUserId: "user123", message: "a".repeat(501) };

      await handleAdminSosSendNotification(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "MESSAGE_TOO_LONG",
        }),
      );
    });

    it("devrait retourner 404 si participant non trouvé", async () => {
      (sosService.adminSendNotification as jest.Mock).mockRejectedValue(
        new Error("PARTICIPANT_NOT_FOUND"),
      );

      await handleAdminSosSendNotification(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "PARTICIPANT_NOT_FOUND",
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: handleAdminSosAddParticipant
  // ═══════════════════════════════════════════════════════════════════════════

  describe("handleAdminSosAddParticipant", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "admin123", isAdmin: true },
        params: { sessionId: "session123" },
        body: { targetUserId: "user456" },
      });
      res = mockResponse();

      (sosService.adminAddParticipant as jest.Mock).mockResolvedValue({
        _id: "session123",
        participants: [
          {
            userId: { toString: () => "user123" },
            status: "ACTIVE",
            currentStage: -1,
            joinedAt: new Date(),
          },
          {
            userId: { toString: () => "user456" },
            status: "ACTIVE",
            currentStage: -1,
            joinedAt: new Date(),
          },
        ],
      });
    });

    it("devrait ajouter un participant à une session", async () => {
      await handleAdminSosAddParticipant(req as Request, res as Response);

      expect(sosService.adminAddParticipant).toHaveBeenCalledWith(
        "session123",
        "user456",
        "admin123",
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          session: expect.objectContaining({
            id: "session123",
            participantCount: 2,
          }),
        }),
      );
    });

    it("devrait rejeter si non authentifié", async () => {
      req = mockRequest({ user: undefined });

      await handleAdminSosAddParticipant(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "UNAUTHORIZED",
        }),
      );
    });

    it("devrait rejeter si sessionId manquant", async () => {
      req.params = {};

      await handleAdminSosAddParticipant(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "MISSING_SESSION_ID",
        }),
      );
    });

    it("devrait rejeter si targetUserId manquant", async () => {
      req.body = {};

      await handleAdminSosAddParticipant(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "MISSING_TARGET_USER_ID",
        }),
      );
    });

    it("devrait retourner 404 si session non trouvée", async () => {
      (sosService.adminAddParticipant as jest.Mock).mockRejectedValue(
        new Error("SESSION_NOT_FOUND"),
      );

      await handleAdminSosAddParticipant(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "SESSION_NOT_FOUND",
        }),
      );
    });

    it("devrait retourner 409 si déjà participant", async () => {
      (sosService.adminAddParticipant as jest.Mock).mockRejectedValue(
        new Error("ALREADY_PARTICIPANT"),
      );

      await handleAdminSosAddParticipant(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "ALREADY_PARTICIPANT",
        }),
      );
    });

    it("devrait retourner 409 si utilisateur a déjà une session active", async () => {
      (sosService.adminAddParticipant as jest.Mock).mockRejectedValue(
        new Error("USER_HAS_ACTIVE_SESSION"),
      );

      await handleAdminSosAddParticipant(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "USER_HAS_ACTIVE_SESSION",
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: handleAdminSosRemoveParticipant
  // ═══════════════════════════════════════════════════════════════════════════

  describe("handleAdminSosRemoveParticipant", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "admin123", isAdmin: true },
        params: { sessionId: "session123" },
        body: { targetUserId: "user456" },
      });
      res = mockResponse();

      (sosService.adminRemoveParticipant as jest.Mock).mockResolvedValue({
        _id: "session123",
        status: "ACTIVE",
        participants: [
          {
            userId: { toString: () => "user123" },
            status: "ACTIVE",
            leftAt: null,
          },
          {
            userId: { toString: () => "user456" },
            status: "LEFT",
            leftAt: new Date(),
          },
        ],
      });
    });

    it("devrait retirer un participant d'une session", async () => {
      await handleAdminSosRemoveParticipant(req as Request, res as Response);

      expect(sosService.adminRemoveParticipant).toHaveBeenCalledWith(
        "session123",
        "user456",
        "admin123",
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          session: expect.objectContaining({
            id: "session123",
            participantCount: 2,
          }),
        }),
      );
    });

    it("devrait rejeter si non authentifié", async () => {
      req = mockRequest({ user: undefined });

      await handleAdminSosRemoveParticipant(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "UNAUTHORIZED",
        }),
      );
    });

    it("devrait rejeter si sessionId manquant", async () => {
      req.params = {};

      await handleAdminSosRemoveParticipant(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "MISSING_SESSION_ID",
        }),
      );
    });

    it("devrait rejeter si targetUserId manquant", async () => {
      req.body = {};

      await handleAdminSosRemoveParticipant(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "MISSING_TARGET_USER_ID",
        }),
      );
    });

    it("devrait retourner 404 si session non trouvée", async () => {
      (sosService.adminRemoveParticipant as jest.Mock).mockRejectedValue(
        new Error("SESSION_NOT_FOUND"),
      );

      await handleAdminSosRemoveParticipant(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "SESSION_NOT_FOUND",
        }),
      );
    });

    it("devrait retourner 404 si participant non trouvé", async () => {
      (sosService.adminRemoveParticipant as jest.Mock).mockRejectedValue(
        new Error("PARTICIPANT_NOT_FOUND"),
      );

      await handleAdminSosRemoveParticipant(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "PARTICIPANT_NOT_FOUND",
        }),
      );
    });

    it("devrait retourner 409 si participant a déjà quitté", async () => {
      (sosService.adminRemoveParticipant as jest.Mock).mockRejectedValue(
        new Error("PARTICIPANT_ALREADY_LEFT"),
      );

      await handleAdminSosRemoveParticipant(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "PARTICIPANT_ALREADY_LEFT",
        }),
      );
    });
  });
});
