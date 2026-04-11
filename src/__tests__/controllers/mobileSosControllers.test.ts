/**
 * Tests unitaires pour mobileSosControllers
 * Teste les fonctions de gestion du Mode SOS mobile
 */

jest.mock("../../services/sosService");
jest.mock("../../services/loggerService");

import { Request, Response } from "express";
import {
  handleSosActivate,
  handleSosHeartbeat,
  handleSosExtend,
  handleSosDeactivate,
  handleSosDeactivateByParam,
  handleSosStatus,
  handleSosHistory,
  handleSosActiveSessions,
  handleSosConfirmSafe,
  handleSosCreateContact,
  handleSosGetContacts,
  handleSosUpdateContact,
  handleSosDeleteContact,
} from "../../controllers/mobileSosControllers";
import { mockRequest, mockResponse } from "../mocks";
import { sosService } from "../../services/sosService";

describe("mobileSosControllers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("handleSosActivate", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        body: {
          expectedDuration: 60,
          note: "Plongée récif sud",
          lat: 43.5,
          lng: 5.3,
        },
        user: { id: "user-123" },
      });
      res = mockResponse();
    });

    it("devrait activer une session SOS avec succès", async () => {
      const mockSession = {
        _id: "session-123",
        status: "ACTIVE",
        activatedAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        expectedDuration: 60,
        currentStage: "STAGE_1",
        participants: [],
      };

      (sosService.activateSession as jest.Mock).mockResolvedValue(mockSession);

      await handleSosActivate(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          session: expect.objectContaining({
            id: "session-123",
            status: "ACTIVE",
          }),
        }),
      );
    });

    it("devrait rejeter si non authentifié", async () => {
      req.user = undefined;

      await handleSosActivate(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    });

    it("devrait rejeter si durée manquante ou invalide", async () => {
      req.body.expectedDuration = undefined;

      await handleSosActivate(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Durée attendue requise (en minutes).",
        code: "MISSING_DURATION",
      });
    });

    it("devrait rejeter si durée hors limites", async () => {
      req.body.expectedDuration = 0;

      await handleSosActivate(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "La durée doit être entre 1 minute et 8 heures.",
        code: "INVALID_DURATION",
      });
    });

    it("devrait gérer l'erreur session déjà active", async () => {
      const error = new Error("SESSION_ALREADY_ACTIVE");
      (sosService.activateSession as jest.Mock).mockRejectedValue(error);

      await handleSosActivate(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        error: "Une session SOS est déjà active.",
        code: "SESSION_ALREADY_ACTIVE",
      });
    });
  });

  describe("handleSosHeartbeat", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        body: {
          sessionId: "session-123",
          lat: 43.5,
          lng: 5.3,
        },
        user: { id: "user-123" },
      });
      res = mockResponse();
    });

    it("devrait enregistrer un heartbeat avec succès", async () => {
      const mockSession = {
        _id: "session-123",
        status: "ACTIVE",
        expiresAt: new Date(),
        heartbeatCount: 5,
        currentStage: "STAGE_1",
      };

      (sosService.heartbeat as jest.Mock).mockResolvedValue(mockSession);

      await handleSosHeartbeat(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          session: expect.objectContaining({
            heartbeatCount: 5,
          }),
        }),
      );
    });

    it("devrait rejeter si pas de session active", async () => {
      const error = new Error("NO_ACTIVE_SESSION");
      (sosService.heartbeat as jest.Mock).mockRejectedValue(error);

      await handleSosHeartbeat(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: "Aucune session SOS active.",
        code: "NO_ACTIVE_SESSION",
      });
    });

    it("devrait gérer les erreurs serveur", async () => {
      (sosService.heartbeat as jest.Mock).mockRejectedValue(
        new Error("Database error"),
      );

      await handleSosHeartbeat(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Erreur lors du heartbeat.",
        code: "INTERNAL_ERROR",
      });
    });
  });

  describe("handleSosExtend", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        body: {
          sessionId: "session-123",
          additionalMinutes: 30,
        },
        user: { id: "user-123" },
      });
      res = mockResponse();
    });

    it("devrait prolonger le timer avec succès", async () => {
      const mockSession = {
        _id: "session-123",
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + 90 * 60 * 1000),
        extensionCount: 1,
        currentStage: "STAGE_1",
      };

      (sosService.extendSession as jest.Mock).mockResolvedValue(mockSession);

      await handleSosExtend(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          session: expect.objectContaining({
            extensionCount: 1,
          }),
        }),
      );
    });

    it("devrait rejeter si durée manquante", async () => {
      req.body.additionalMinutes = undefined;

      await handleSosExtend(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Durée de prolongation requise (en minutes).",
        code: "MISSING_DURATION",
      });
    });

    it("devrait rejeter si durée invalide", async () => {
      req.body.additionalMinutes = 10;

      await handleSosExtend(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "La prolongation doit être entre 15 minutes et 8 heures.",
        code: "INVALID_EXTENSION_DURATION",
      });
    });
  });

  describe("handleSosDeactivate", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        body: {
          sessionId: "session-123",
          scope: "all",
        },
        user: { id: "user-123" },
      });
      res = mockResponse();
    });

    it("devrait désactiver la session avec succès", async () => {
      const mockSession = {
        _id: "session-123",
        status: "RESOLVED",
        resolvedAt: new Date(),
        resolvedBy: "user-123",
      };

      (sosService.deactivateSession as jest.Mock).mockResolvedValue(
        mockSession,
      );

      await handleSosDeactivate(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          session: expect.objectContaining({
            status: "RESOLVED",
          }),
        }),
      );
    });

    it("devrait gérer l'absence de session active", async () => {
      const error = new Error("NO_ACTIVE_SESSION");
      (sosService.deactivateSession as jest.Mock).mockRejectedValue(error);

      await handleSosDeactivate(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: "Aucune session SOS active.",
        code: "NO_ACTIVE_SESSION",
      });
    });
  });

  describe("handleSosDeactivateByParam", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        params: { sessionId: "session-123" },
        body: { scope: "all" },
        user: { id: "user-123" },
      });
      res = mockResponse();
    });

    it("devrait désactiver la session par paramètre", async () => {
      const mockSession = {
        _id: "session-123",
        status: "RESOLVED",
        resolvedAt: new Date(),
        resolvedBy: "user-123",
      };

      (sosService.deactivateSession as jest.Mock).mockResolvedValue(
        mockSession,
      );

      await handleSosDeactivateByParam(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        }),
      );
    });

    it("devrait rejeter si sessionId manquant", async () => {
      req.params = {};

      await handleSosDeactivateByParam(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "ID de session requis.",
        code: "MISSING_SESSION_ID",
      });
    });
  });

  describe("handleSosStatus", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "user-123" },
      });
      res = mockResponse();
    });

    it("devrait retourner le statut de la session active", async () => {
      const mockSession = {
        _id: "session-123",
        status: "ACTIVE",
        activatedAt: new Date(),
        expiresAt: new Date(),
        expectedDuration: 60,
        currentStage: "STAGE_1",
        heartbeatCount: 3,
        extensionCount: 0,
        userId: "user-123",
        participants: [],
      };

      (sosService.getActiveSession as jest.Mock).mockResolvedValue(mockSession);

      await handleSosStatus(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          active: true,
          session: expect.objectContaining({
            id: "session-123",
          }),
        }),
      );
    });

    it("devrait retourner active: false si pas de session", async () => {
      (sosService.getActiveSession as jest.Mock).mockResolvedValue(null);

      await handleSosStatus(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        active: false,
        session: null,
      });
    });
  });

  describe("handleSosHistory", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        query: { limit: "20" },
        user: { id: "user-123" },
      });
      res = mockResponse();
    });

    it("devrait retourner l'historique des sessions", async () => {
      const mockResult = {
        sessions: [
          { _id: "session-1", status: "RESOLVED" },
          { _id: "session-2", status: "EXPIRED" },
        ],
        stats: { total: 2, resolved: 1, expired: 1 },
      };

      (sosService.getSessionHistory as jest.Mock).mockResolvedValue(mockResult);

      await handleSosHistory(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          sessions: expect.arrayContaining([
            expect.objectContaining({ _id: "session-1" }),
          ]),
          count: 2,
        }),
      );
    });
  });

  describe("handleSosActiveSessions", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "user-123" },
      });
      res = mockResponse();
    });

    it("devrait retourner les sessions actives", async () => {
      const mockSessions = [
        { _id: "session-1", status: "ACTIVE" },
        { _id: "session-2", status: "ACTIVE" },
      ];

      (sosService.getActiveSessions as jest.Mock).mockResolvedValue(
        mockSessions,
      );

      await handleSosActiveSessions(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        sessions: mockSessions,
        count: 2,
      });
    });
  });

  describe("handleSosConfirmSafe", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        params: { sessionId: "session-123" },
        user: { id: "user-123" },
      });
      res = mockResponse();
    });

    it("devrait confirmer la sécurité de l'utilisateur", async () => {
      const mockSession = {
        _id: "session-123",
        status: "RESOLVED",
        resolvedAt: new Date(),
        resolvedBy: "user-123",
      };

      (sosService.confirmSafe as jest.Mock).mockResolvedValue(mockSession);

      await handleSosConfirmSafe(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        }),
      );
    });

    it("devrait rejeter si sessionId manquant", async () => {
      req.params = {};

      await handleSosConfirmSafe(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "ID de session requis.",
        code: "MISSING_SESSION_ID",
      });
    });

    it("devrait gérer l'erreur session non trouvée", async () => {
      const error = new Error("SESSION_NOT_FOUND_OR_NOT_ESCALATING");
      (sosService.confirmSafe as jest.Mock).mockRejectedValue(error);

      await handleSosConfirmSafe(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: "Session non trouvée ou pas en escalade.",
        code: "SESSION_NOT_FOUND",
      });
    });
  });

  describe("handleSosCreateContact", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        body: {
          name: "Contact Urgence",
          phone: "+33612345678",
          relationship: "family",
          isDefault: true,
        },
        user: { id: "user-123" },
      });
      res = mockResponse();
    });

    it("devrait créer un contact d'urgence avec succès", async () => {
      const mockContact = {
        _id: "contact-123",
        name: "Contact Urgence",
        phone: "+33612345678",
        relationship: "family",
        isDefault: true,
      };

      (sosService.addContact as jest.Mock).mockResolvedValue(mockContact);

      await handleSosCreateContact(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          contact: expect.objectContaining({
            id: "contact-123",
          }),
        }),
      );
    });

    it("devrait rejeter si nom ou téléphone manquant", async () => {
      req.body.name = undefined;

      await handleSosCreateContact(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Nom et numéro de téléphone requis.",
        code: "MISSING_FIELDS",
      });
    });

    it("devrait rejeter si format téléphone invalide", async () => {
      req.body.phone = "123456";

      await handleSosCreateContact(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "INVALID_PHONE_FORMAT",
        }),
      );
    });

    it("devrait gérer l'erreur nombre maximum de contacts", async () => {
      const error = new Error("MAX_CONTACTS_REACHED");
      (sosService.addContact as jest.Mock).mockRejectedValue(error);

      await handleSosCreateContact(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Nombre maximum de contacts d'urgence atteint (5).",
        code: "MAX_CONTACTS_REACHED",
      });
    });
  });

  describe("handleSosGetContacts", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        user: { id: "user-123" },
      });
      res = mockResponse();
    });

    it("devrait retourner la liste des contacts", async () => {
      const mockContacts = [
        { _id: "contact-1", name: "Contact 1", phone: "+33612345678" },
        { _id: "contact-2", name: "Contact 2", phone: "+33687654321" },
      ];

      (sosService.getContacts as jest.Mock).mockResolvedValue(mockContacts);

      await handleSosGetContacts(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        contacts: mockContacts,
        count: 2,
      });
    });
  });

  describe("handleSosUpdateContact", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        params: { id: "contact-123" },
        body: {
          name: "Contact Updated",
          phone: "+33698765432",
        },
        user: { id: "user-123" },
      });
      res = mockResponse();
    });

    it("devrait mettre à jour un contact avec succès", async () => {
      const mockContact = {
        _id: "contact-123",
        name: "Contact Updated",
        phone: "+33698765432",
      };

      (sosService.updateContact as jest.Mock).mockResolvedValue(mockContact);

      await handleSosUpdateContact(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        contact: mockContact,
      });
    });

    it("devrait rejeter si format téléphone invalide", async () => {
      req.body.phone = "invalid";

      await handleSosUpdateContact(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Format de téléphone invalide.",
        code: "INVALID_PHONE_FORMAT",
      });
    });

    it("devrait retourner 404 si contact non trouvé", async () => {
      (sosService.updateContact as jest.Mock).mockResolvedValue(null);

      await handleSosUpdateContact(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: "Contact non trouvé.",
        code: "CONTACT_NOT_FOUND",
      });
    });
  });

  describe("handleSosDeleteContact", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest({
        params: { id: "contact-123" },
        user: { id: "user-123" },
      });
      res = mockResponse();
    });

    it("devrait supprimer un contact avec succès", async () => {
      (sosService.deleteContact as jest.Mock).mockResolvedValue(true);

      await handleSosDeleteContact(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "Contact d'urgence supprimé.",
      });
    });

    it("devrait retourner 404 si contact non trouvé", async () => {
      (sosService.deleteContact as jest.Mock).mockResolvedValue(false);

      await handleSosDeleteContact(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: "Contact non trouvé.",
        code: "CONTACT_NOT_FOUND",
      });
    });
  });
});
