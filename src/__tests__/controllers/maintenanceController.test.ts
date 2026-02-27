/**
 * Tests unitaires pour maintenanceController
 * Teste les fonctions de gestion du mode maintenance
 */

jest.mock("../../models/maintenance");

import { Request, Response } from "express";
import {
  activateMaintenance,
  deactivateMaintenance,
  updateMaintenanceMessage,
} from "../../controllers/maintenanceController";
import MaintenanceModel from "../../models/maintenance";
import { mockRequest, mockResponse } from "../mocks";

describe("maintenanceController", () => {
  describe("activateMaintenance", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest();
      res = mockResponse();
    });

    it("devrait activer le mode maintenance avec succès (nouveau document)", async () => {
      const mockUser = { id: "507f1f77bcf86cd799439011" };
      req.user = mockUser;
      req.body = {
        message: "Maintenance en cours",
        estimatedEndTime: "2025-12-31T23:59:59.000Z",
      };

      const mockMaintenanceDoc = {
        isActive: true,
        message: "Maintenance en cours",
        activatedBy: "507f1f77bcf86cd799439011",
        activatedAt: new Date(),
        estimatedEndTime: new Date("2025-12-31T23:59:59.000Z"),
        save: jest.fn().mockResolvedValue(true),
      };

      (MaintenanceModel.findOne as jest.Mock).mockResolvedValue(null);
      (MaintenanceModel as any).mockImplementation(() => mockMaintenanceDoc);

      await activateMaintenance(req as Request, res as Response);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "Mode maintenance activé",
        maintenance: {
          isActive: true,
          message: "Maintenance en cours",
          estimatedEndTime: mockMaintenanceDoc.estimatedEndTime,
        },
      });
      expect(mockMaintenanceDoc.save).toHaveBeenCalled();
    });

    it("devrait activer le mode maintenance avec message par défaut", async () => {
      const mockUser = { id: "507f1f77bcf86cd799439011" };
      req.user = mockUser;
      req.body = {};

      const mockMaintenanceDoc = {
        isActive: true,
        message:
          "Le site est actuellement en maintenance. Nous serons bientôt de retour.",
        activatedBy: "507f1f77bcf86cd799439011",
        activatedAt: new Date(),
        save: jest.fn().mockResolvedValue(true),
      };

      (MaintenanceModel.findOne as jest.Mock).mockResolvedValue(null);
      (MaintenanceModel as any).mockImplementation(() => mockMaintenanceDoc);

      await activateMaintenance(req as Request, res as Response);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "Mode maintenance activé",
        maintenance: {
          isActive: true,
          message: mockMaintenanceDoc.message,
          estimatedEndTime: undefined,
        },
      });
    });

    it("devrait mettre à jour un document existant", async () => {
      const mockUser = { id: "507f1f77bcf86cd799439011" };
      req.user = mockUser;
      req.body = {
        message: "Nouvelle maintenance",
      };

      const mockMaintenanceDoc = {
        isActive: false,
        message: "Ancien message",
        activatedBy: "oldUserId",
        activatedAt: new Date("2025-01-01"),
        save: jest.fn().mockResolvedValue(true),
      };

      (MaintenanceModel.findOne as jest.Mock).mockResolvedValue(
        mockMaintenanceDoc,
      );

      await activateMaintenance(req as Request, res as Response);

      expect(mockMaintenanceDoc.isActive).toBe(true);
      expect(mockMaintenanceDoc.message).toBe("Nouvelle maintenance");
      expect(mockMaintenanceDoc.save).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "Mode maintenance activé",
        maintenance: expect.objectContaining({
          isActive: true,
          message: "Nouvelle maintenance",
        }),
      });
    });

    it("devrait rejeter un message invalide (non string)", async () => {
      req.user = { id: "userId" };
      req.body = { message: 123 };

      await activateMaintenance(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: "Message invalide" });
    });

    it("devrait rejeter un message trop long", async () => {
      req.user = { id: "userId" };
      req.body = { message: "a".repeat(1001) };

      await activateMaintenance(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Message trop long (max 1000 caractères)",
      });
    });

    it("devrait gérer les erreurs de base de données", async () => {
      req.user = { id: "userId" };
      req.body = { message: "Test" };

      (MaintenanceModel.findOne as jest.Mock).mockRejectedValue(
        new Error("DB Error"),
      );

      await activateMaintenance(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Erreur lors de l'activation du mode maintenance",
      });
    });
  });

  describe("deactivateMaintenance", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest();
      res = mockResponse();
    });

    it("devrait désactiver le mode maintenance avec succès", async () => {
      req.user = { id: "507f1f77bcf86cd799439011" };

      const mockMaintenanceDoc = {
        isActive: true,
        deactivatedAt: undefined,
        save: jest.fn().mockResolvedValue(true),
      };

      (MaintenanceModel.findOne as jest.Mock).mockResolvedValue(
        mockMaintenanceDoc,
      );

      await deactivateMaintenance(req as Request, res as Response);

      expect(mockMaintenanceDoc.isActive).toBe(false);
      expect(mockMaintenanceDoc.deactivatedAt).toBeInstanceOf(Date);
      expect(mockMaintenanceDoc.save).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "Mode maintenance désactivé",
      });
    });

    it("devrait gérer l'absence de document maintenance", async () => {
      req.user = { id: "userId" };
      (MaintenanceModel.findOne as jest.Mock).mockResolvedValue(null);

      await deactivateMaintenance(req as Request, res as Response);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "Mode maintenance désactivé",
      });
    });

    it("devrait gérer les erreurs de base de données", async () => {
      req.user = { id: "userId" };
      (MaintenanceModel.findOne as jest.Mock).mockRejectedValue(
        new Error("DB Error"),
      );

      await deactivateMaintenance(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Erreur lors de la désactivation du mode maintenance",
      });
    });
  });

  describe("updateMaintenanceMessage", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest();
      res = mockResponse();
    });

    it("devrait mettre à jour le message avec succès", async () => {
      req.body = {
        message: "Nouveau message de maintenance",
        estimatedEndTime: "2025-12-31T23:59:59.000Z",
      };

      const mockMaintenanceDoc = {
        message: "Ancien message",
        estimatedEndTime: undefined,
        save: jest.fn().mockResolvedValue(true),
      };

      (MaintenanceModel.findOne as jest.Mock).mockResolvedValue(
        mockMaintenanceDoc,
      );

      await updateMaintenanceMessage(req as Request, res as Response);

      expect(mockMaintenanceDoc.message).toBe("Nouveau message de maintenance");
      expect(mockMaintenanceDoc.estimatedEndTime).toBeInstanceOf(Date);
      expect(mockMaintenanceDoc.save).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "Message de maintenance mis à jour",
      });
    });

    it("devrait créer un nouveau document si aucun n'existe", async () => {
      req.body = { message: "Premier message" };

      const mockMaintenanceDoc = {
        isActive: false,
        message: "Premier message",
        save: jest.fn().mockResolvedValue(true),
      };

      (MaintenanceModel.findOne as jest.Mock).mockResolvedValue(null);
      (MaintenanceModel as any).mockImplementation(() => mockMaintenanceDoc);

      await updateMaintenanceMessage(req as Request, res as Response);

      expect(mockMaintenanceDoc.save).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "Message de maintenance mis à jour",
      });
    });

    it("devrait rejeter une requête sans message", async () => {
      req.body = {};

      await updateMaintenanceMessage(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: "Message requis" });
    });

    it("devrait rejeter un message invalide (non string)", async () => {
      req.body = { message: 123 };

      await updateMaintenanceMessage(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: "Message invalide" });
    });

    it("devrait rejeter un message trop long", async () => {
      req.body = { message: "a".repeat(1001) };

      await updateMaintenanceMessage(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Message trop long (max 1000 caractères)",
      });
    });

    it("devrait permettre de supprimer estimatedEndTime", async () => {
      req.body = { message: "Test", estimatedEndTime: null };

      const mockMaintenanceDoc = {
        message: "Ancien",
        estimatedEndTime: new Date(),
        save: jest.fn().mockResolvedValue(true),
      };

      (MaintenanceModel.findOne as jest.Mock).mockResolvedValue(
        mockMaintenanceDoc,
      );

      await updateMaintenanceMessage(req as Request, res as Response);

      expect(mockMaintenanceDoc.estimatedEndTime).toBeUndefined();
      expect(mockMaintenanceDoc.save).toHaveBeenCalled();
    });

    it("devrait gérer les erreurs de base de données", async () => {
      req.body = { message: "Test" };
      (MaintenanceModel.findOne as jest.Mock).mockRejectedValue(
        new Error("DB Error"),
      );

      await updateMaintenanceMessage(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Erreur lors de la mise à jour du message",
      });
    });
  });
});
