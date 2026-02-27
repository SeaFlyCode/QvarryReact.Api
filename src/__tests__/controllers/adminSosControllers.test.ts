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
});
