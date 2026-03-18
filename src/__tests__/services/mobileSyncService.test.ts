// src/__tests__/services/mobileSyncService.test.ts

// Mock dependencies BEFORE imports
jest.mock("../../services/loggerService", () => ({
  logger: {
    child: jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    }),
  },
}));
jest.mock("../../models/points");
jest.mock("../../models/fiches");
jest.mock("../../models/lists");
jest.mock("../../models/sosContact");
jest.mock("../../models/sosSession");
jest.mock("../../models/keys");
jest.mock("../../utils/masterEncryptionUtils");
jest.mock("../../utils/userEncryptionUtils");
jest.mock("../../services/validationService");

import mongoose from "mongoose";
import PointModel from "../../models/points";
import FicheModel from "../../models/fiches";
import ListModel from "../../models/lists";
import SosContactModel from "../../models/sosContact";
import SosSessionModel from "../../models/sosSession";
import KeysModel from "../../models/keys";
import { decrypt } from "../../utils/masterEncryptionUtils";
import {
  encryptWithKey,
  decryptWithKey,
} from "../../utils/userEncryptionUtils";
import { validateFicheData } from "../../services/validationService";
import {
  mobileSyncService,
  LocalChange,
} from "../../services/mobileSyncService";

describe("MobileSyncService", () => {
  const mockUserId = new mongoose.Types.ObjectId().toString();
  const mockUserKey = "test-user-key-32-bytes-long!!!";

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock getUserKey dependencies
    (KeysModel.findOne as jest.Mock).mockResolvedValue({
      key: "encrypted-user-key",
    });
    (decrypt as jest.Mock).mockReturnValue(mockUserKey);

    // Mock SosContact and SosSession for getFullData
    (SosContactModel.find as jest.Mock).mockReturnValue({
      lean: jest.fn().mockResolvedValue([]),
    });
    (SosSessionModel.findOne as jest.Mock).mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
  });

  describe("getUserKey", () => {
    it("should retrieve and decrypt user key", async () => {
      const result = await mobileSyncService.getUserKey(mockUserId);

      expect(KeysModel.findOne).toHaveBeenCalledWith({
        userId: expect.any(mongoose.Types.ObjectId),
        type: "user",
      });
      expect(result).toBe(mockUserKey);
    });

    it("should throw error if key not found", async () => {
      (KeysModel.findOne as jest.Mock).mockResolvedValue(null);

      await expect(mobileSyncService.getUserKey(mockUserId)).rejects.toThrow(
        "Clé utilisateur non trouvée",
      );
    });
  });

  describe("getFullData", () => {
    it("should return all user data with correct structure", async () => {
      const mockPoints = [
        { _id: new mongoose.Types.ObjectId(), name: "Point1" },
      ];
      const mockFiches = [
        { _id: new mongoose.Types.ObjectId(), name: "Fiche1" },
      ];
      const mockLists = [
        { _id: new mongoose.Types.ObjectId(), title: "List1" },
      ];

      (PointModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockPoints),
      });
      (FicheModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockFiches),
      });
      (ListModel.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockLists),
      });

      const result = await mobileSyncService.getFullData(mockUserId);

      // Result has nested created/updated/deleted structure
      expect(result).toHaveProperty("points");
      expect(result).toHaveProperty("fiches");
      expect(result).toHaveProperty("lists");
      expect(result.points).toHaveProperty("created");
      expect(result.points).toHaveProperty("updated");
      expect(result.points).toHaveProperty("deleted");
    });
  });

  describe("softDeletePoint", () => {
    it("should soft delete a point", async () => {
      const pointId = new mongoose.Types.ObjectId().toString();

      (PointModel.updateOne as jest.Mock).mockResolvedValue({
        modifiedCount: 1,
      });

      const result = await mobileSyncService.softDeletePoint(
        pointId,
        mockUserId,
      );

      expect(result).toBe(true);
      expect(PointModel.updateOne).toHaveBeenCalledWith(
        { _id: pointId, userId: mockUserId },
        { $set: { deletedAt: expect.any(Date) } },
      );
    });

    it("should return false if point not found", async () => {
      const pointId = new mongoose.Types.ObjectId().toString();

      (PointModel.updateOne as jest.Mock).mockResolvedValue({
        modifiedCount: 0,
      });

      const result = await mobileSyncService.softDeletePoint(
        pointId,
        mockUserId,
      );

      expect(result).toBe(false);
    });
  });

  describe("softDeleteFiche", () => {
    it("should soft delete a fiche", async () => {
      const ficheId = new mongoose.Types.ObjectId().toString();

      (FicheModel.updateOne as jest.Mock).mockResolvedValue({
        modifiedCount: 1,
      });

      const result = await mobileSyncService.softDeleteFiche(
        ficheId,
        mockUserId,
      );

      expect(result).toBe(true);
      expect(FicheModel.updateOne).toHaveBeenCalledWith(
        { _id: ficheId, userId: mockUserId },
        { $set: { deletedAt: expect.any(Date) } },
      );
    });
  });

  describe("softDeleteList", () => {
    it("should soft delete a list", async () => {
      const listId = new mongoose.Types.ObjectId().toString();

      (ListModel.updateOne as jest.Mock).mockResolvedValue({
        modifiedCount: 1,
      });

      const result = await mobileSyncService.softDeleteList(listId, mockUserId);

      expect(result).toBe(true);
      expect(ListModel.updateOne).toHaveBeenCalledWith(
        { _id: listId, userId: mockUserId },
        { $set: { deletedAt: expect.any(Date) } },
      );
    });
  });

  describe("applyLocalChanges", () => {
    beforeEach(() => {
      (encryptWithKey as jest.Mock).mockImplementation(
        (data, _key) => `encrypted:${data}`,
      );
      (decryptWithKey as jest.Mock).mockImplementation((data, _key) =>
        data.replace("encrypted:", ""),
      );
    });

    it("should process a mix of points/fiches/lists/sosContacts changes", async () => {
      const changes: LocalChange[] = [
        {
          type: "point",
          action: "create",
          data: {
            name: "Test Point",
            description: "Description",
            location: { type: "Point", coordinates: [1, 2] },
          },
          timestamp: new Date().toISOString(),
        },
        {
          type: "fiche",
          action: "create",
          data: {
            name: "Test Fiche",
            ville: "Paris",
            type: "Carrière",
            etat: "Bon",
            difficulte_acces: "Facile",
            risque_oxygene: "Faible",
            acces_souterrain: "Ouvert",
            praticite_souterrain: "Bonne",
            etat_general: "Stable",
          },
          timestamp: new Date().toISOString(),
        },
        {
          type: "list",
          action: "create",
          data: {
            name: "Test List",
            description: "Description",
            points: [],
            color: "#FF0000",
            icon: "star",
          },
          timestamp: new Date().toISOString(),
        },
        {
          type: "sosContact",
          action: "create",
          data: {
            name: "John Doe",
            phone: "+33612345678",
            relationship: "Friend",
            isDefault: false,
          },
          timestamp: new Date().toISOString(),
        },
      ];

      const mockPointId = new mongoose.Types.ObjectId();
      const mockFicheId = new mongoose.Types.ObjectId();
      const mockListId = new mongoose.Types.ObjectId();
      const mockContactId = new mongoose.Types.ObjectId();

      (PointModel.create as jest.Mock).mockResolvedValue({
        _id: mockPointId,
      });
      (FicheModel.create as jest.Mock).mockResolvedValue({
        _id: mockFicheId,
      });
      (ListModel.create as jest.Mock).mockResolvedValue({
        _id: mockListId,
      });
      (SosContactModel.create as jest.Mock).mockResolvedValue({
        _id: mockContactId,
      });
      (SosContactModel.countDocuments as jest.Mock).mockResolvedValue(0);
      (validateFicheData as jest.Mock).mockReturnValue({
        isValid: true,
        errors: [],
      });

      const result = await mobileSyncService.applyLocalChanges(
        mockUserId,
        changes,
      );

      expect(result.synced).toHaveLength(4);
      expect(result.conflicts).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it("should return errors when changes fail", async () => {
      const changes: LocalChange[] = [
        {
          type: "point",
          action: "update",
          id: "nonexistent-id",
          data: { name: "Updated Point" },
          timestamp: new Date().toISOString(),
        },
      ];

      (PointModel.findOne as jest.Mock).mockResolvedValue(null);

      const result = await mobileSyncService.applyLocalChanges(
        mockUserId,
        changes,
      );

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain("non trouvé");
    });
  });

  describe("applyPointChange", () => {
    beforeEach(() => {
      (encryptWithKey as jest.Mock).mockImplementation(
        (data, _key) => `encrypted:${data}`,
      );
    });

    it("should create a point with encrypted data", async () => {
      const change: LocalChange = {
        type: "point",
        action: "create",
        data: {
          name: "New Point",
          description: "Test description",
          location: { type: "Point", coordinates: [1.5, 2.5] },
          accessType: "public",
        },
        timestamp: new Date().toISOString(),
      };

      const mockPointId = new mongoose.Types.ObjectId();
      (PointModel.create as jest.Mock).mockResolvedValue({
        _id: mockPointId,
      });

      const result = await mobileSyncService.applyLocalChanges(mockUserId, [
        change,
      ]);

      expect(result.synced).toHaveLength(1);
      expect(result.synced[0].id).toBe(mockPointId.toString());
      expect(PointModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: expect.any(mongoose.Types.ObjectId),
          name: "encrypted:New Point",
          description: "encrypted:Test description",
          version: 1,
        }),
      );
    });

    it("should update an existing point and increment version", async () => {
      const pointId = new mongoose.Types.ObjectId().toString();
      const change: LocalChange = {
        type: "point",
        action: "update",
        id: pointId,
        data: {
          name: "Updated Point",
          version: 1,
        },
        timestamp: new Date().toISOString(),
      };

      (PointModel.findOne as jest.Mock).mockResolvedValue({
        _id: pointId,
        userId: mockUserId,
        version: 1,
      });
      (PointModel.updateOne as jest.Mock).mockResolvedValue({
        modifiedCount: 1,
      });

      const result = await mobileSyncService.applyLocalChanges(mockUserId, [
        change,
      ]);

      expect(result.synced).toHaveLength(1);
      expect(PointModel.updateOne).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          $set: expect.objectContaining({
            version: 2,
          }),
        }),
      );
    });

    it("should soft-delete a point", async () => {
      const pointId = new mongoose.Types.ObjectId().toString();
      const change: LocalChange = {
        type: "point",
        action: "delete",
        id: pointId,
        timestamp: new Date().toISOString(),
      };

      (PointModel.updateOne as jest.Mock).mockResolvedValue({
        modifiedCount: 1,
      });

      const result = await mobileSyncService.applyLocalChanges(mockUserId, [
        change,
      ]);

      expect(result.synced).toHaveLength(1);
      expect(PointModel.updateOne).toHaveBeenCalledWith(expect.any(Object), {
        $set: { deletedAt: expect.any(Date) },
      });
    });

    it("should throw error when point not found for update", async () => {
      const change: LocalChange = {
        type: "point",
        action: "update",
        id: "nonexistent-id",
        data: { name: "Updated" },
        timestamp: new Date().toISOString(),
      };

      (PointModel.findOne as jest.Mock).mockResolvedValue(null);

      const result = await mobileSyncService.applyLocalChanges(mockUserId, [
        change,
      ]);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain("non trouvé");
    });

    it("should throw error when ID is missing for update", async () => {
      const change: LocalChange = {
        type: "point",
        action: "update",
        data: { name: "Updated" },
        timestamp: new Date().toISOString(),
      };

      const result = await mobileSyncService.applyLocalChanges(mockUserId, [
        change,
      ]);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain("ID manquant");
    });

    it("should detect version conflict and add to conflicts", async () => {
      const pointId = new mongoose.Types.ObjectId().toString();
      const change: LocalChange = {
        type: "point",
        action: "update",
        id: pointId,
        data: {
          name: "Updated Point",
          version: 1, // Client version is 1
        },
        timestamp: new Date().toISOString(),
      };

      (PointModel.findOne as jest.Mock).mockResolvedValue({
        _id: pointId,
        userId: mockUserId,
        name: "encrypted:Current Point",
        description: "encrypted:Description",
        version: 3, // Server version is 3 (higher)
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (decryptWithKey as jest.Mock).mockImplementation((data, _key) =>
        data.replace("encrypted:", ""),
      );

      const result = await mobileSyncService.applyLocalChanges(mockUserId, [
        change,
      ]);

      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].type).toBe("point");
      expect(result.conflicts[0].resolution).toBe("server_wins");
      expect(PointModel.updateOne).not.toHaveBeenCalled();
    });
  });

  describe("applyFicheChange", () => {
    beforeEach(() => {
      (encryptWithKey as jest.Mock).mockImplementation(
        (data, _key) => `encrypted:${data}`,
      );
      (validateFicheData as jest.Mock).mockReturnValue({
        isValid: true,
        errors: [],
      });
    });

    it("should create a fiche with validation and encryption", async () => {
      const change: LocalChange = {
        type: "fiche",
        action: "create",
        data: {
          name: "New Fiche",
          ville: "Lyon",
          type: "Carrière",
          etat: "Bon",
          difficulte_acces: "Facile",
          risque_oxygene: "Faible",
          acces_souterrain: "Ouvert",
          praticite_souterrain: "Bonne",
          etat_general: "Stable",
          equipement_conseille: ["Casque", "Lampe"],
          surface: ["Pierre"],
          type_galeries: ["Horizontal"],
        },
        timestamp: new Date().toISOString(),
      };

      const mockFicheId = new mongoose.Types.ObjectId();
      (FicheModel.create as jest.Mock).mockResolvedValue({
        _id: mockFicheId,
      });

      const result = await mobileSyncService.applyLocalChanges(mockUserId, [
        change,
      ]);

      expect(result.synced).toHaveLength(1);
      expect(validateFicheData).toHaveBeenCalledWith(change.data);
      expect(FicheModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "encrypted:New Fiche",
          ville: "encrypted:Lyon",
          equipement_conseille: ["encrypted:Casque", "encrypted:Lampe"],
          version: 1,
        }),
      );
    });

    it("should update an existing fiche with validation", async () => {
      const ficheId = new mongoose.Types.ObjectId().toString();
      const change: LocalChange = {
        type: "fiche",
        action: "update",
        id: ficheId,
        data: {
          name: "Updated Fiche",
          ville: "Paris",
          type: "Carrière",
          etat: "Bon",
          difficulte_acces: "Facile",
          risque_oxygene: "Faible",
          acces_souterrain: "Ouvert",
          praticite_souterrain: "Bonne",
          etat_general: "Stable",
          version: 1,
        },
        timestamp: new Date().toISOString(),
      };

      (FicheModel.findOne as jest.Mock).mockResolvedValue({
        _id: ficheId,
        userId: mockUserId,
        version: 1,
      });
      (FicheModel.updateOne as jest.Mock).mockResolvedValue({
        modifiedCount: 1,
      });

      const result = await mobileSyncService.applyLocalChanges(mockUserId, [
        change,
      ]);

      expect(result.synced).toHaveLength(1);
      expect(validateFicheData).toHaveBeenCalled();
      expect(FicheModel.updateOne).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          $set: expect.objectContaining({
            version: 2,
          }),
        }),
      );
    });

    it("should soft-delete a fiche", async () => {
      const ficheId = new mongoose.Types.ObjectId().toString();
      const change: LocalChange = {
        type: "fiche",
        action: "delete",
        id: ficheId,
        timestamp: new Date().toISOString(),
      };

      (FicheModel.updateOne as jest.Mock).mockResolvedValue({
        modifiedCount: 1,
      });

      const result = await mobileSyncService.applyLocalChanges(mockUserId, [
        change,
      ]);

      expect(result.synced).toHaveLength(1);
      expect(FicheModel.updateOne).toHaveBeenCalledWith(expect.any(Object), {
        $set: { deletedAt: expect.any(Date) },
      });
    });

    it("should throw error when validation fails", async () => {
      const change: LocalChange = {
        type: "fiche",
        action: "create",
        data: {
          name: "Invalid Fiche",
          // Missing required fields
        },
        timestamp: new Date().toISOString(),
      };

      (validateFicheData as jest.Mock).mockReturnValue({
        isValid: false,
        errors: ["Le champ ville est obligatoire"],
      });

      const result = await mobileSyncService.applyLocalChanges(mockUserId, [
        change,
      ]);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain("Validation échouée");
    });

    it("should throw error when fiche not found for update", async () => {
      const change: LocalChange = {
        type: "fiche",
        action: "update",
        id: "nonexistent-id",
        data: {
          name: "Updated",
          ville: "Paris",
          type: "Carrière",
          etat: "Bon",
          difficulte_acces: "Facile",
          risque_oxygene: "Faible",
          acces_souterrain: "Ouvert",
          praticite_souterrain: "Bonne",
          etat_general: "Stable",
        },
        timestamp: new Date().toISOString(),
      };

      (FicheModel.findOne as jest.Mock).mockResolvedValue(null);

      const result = await mobileSyncService.applyLocalChanges(mockUserId, [
        change,
      ]);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain("non trouvée");
    });
  });

  describe("applyListChange", () => {
    beforeEach(() => {
      (encryptWithKey as jest.Mock).mockImplementation(
        (data, _key) => `encrypted:${data}`,
      );
    });

    it("should create a list", async () => {
      const change: LocalChange = {
        type: "list",
        action: "create",
        data: {
          name: "New List",
          description: "Test description",
          points: [],
          color: "#FF0000",
          icon: "star",
        },
        timestamp: new Date().toISOString(),
      };

      const mockListId = new mongoose.Types.ObjectId();
      (ListModel.create as jest.Mock).mockResolvedValue({
        _id: mockListId,
      });

      const result = await mobileSyncService.applyLocalChanges(mockUserId, [
        change,
      ]);

      expect(result.synced).toHaveLength(1);
      expect(ListModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "encrypted:New List",
          description: "encrypted:Test description",
          color: "#FF0000",
          icon: "star",
          version: 1,
        }),
      );
    });

    it("should update an existing list", async () => {
      const listId = new mongoose.Types.ObjectId().toString();
      const change: LocalChange = {
        type: "list",
        action: "update",
        id: listId,
        data: {
          name: "Updated List",
          version: 1,
        },
        timestamp: new Date().toISOString(),
      };

      (ListModel.findOne as jest.Mock).mockResolvedValue({
        _id: listId,
        userId: mockUserId,
        version: 1,
      });
      (ListModel.updateOne as jest.Mock).mockResolvedValue({
        modifiedCount: 1,
      });

      const result = await mobileSyncService.applyLocalChanges(mockUserId, [
        change,
      ]);

      expect(result.synced).toHaveLength(1);
      expect(ListModel.updateOne).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          $set: expect.objectContaining({
            version: 2,
          }),
        }),
      );
    });

    it("should soft-delete a list", async () => {
      const listId = new mongoose.Types.ObjectId().toString();
      const change: LocalChange = {
        type: "list",
        action: "delete",
        id: listId,
        timestamp: new Date().toISOString(),
      };

      (ListModel.updateOne as jest.Mock).mockResolvedValue({
        modifiedCount: 1,
      });

      const result = await mobileSyncService.applyLocalChanges(mockUserId, [
        change,
      ]);

      expect(result.synced).toHaveLength(1);
      expect(ListModel.updateOne).toHaveBeenCalledWith(expect.any(Object), {
        $set: { deletedAt: expect.any(Date) },
      });
    });

    it("should throw error when list not found", async () => {
      const change: LocalChange = {
        type: "list",
        action: "update",
        id: "nonexistent-id",
        data: { name: "Updated" },
        timestamp: new Date().toISOString(),
      };

      (ListModel.findOne as jest.Mock).mockResolvedValue(null);

      const result = await mobileSyncService.applyLocalChanges(mockUserId, [
        change,
      ]);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain("non trouvée");
    });
  });

  describe("applySosContactChange", () => {
    it("should create a contact SOS", async () => {
      const change: LocalChange = {
        type: "sosContact",
        action: "create",
        data: {
          name: "Jane Doe",
          phone: "+33687654321",
          relationship: "Spouse",
          isDefault: true,
        },
        timestamp: new Date().toISOString(),
      };

      const mockContactId = new mongoose.Types.ObjectId();
      (SosContactModel.countDocuments as jest.Mock).mockResolvedValue(2); // Less than 5
      (SosContactModel.create as jest.Mock).mockResolvedValue({
        _id: mockContactId,
      });

      const result = await mobileSyncService.applyLocalChanges(mockUserId, [
        change,
      ]);

      expect(result.synced).toHaveLength(1);
      expect(SosContactModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Jane Doe",
          phone: "+33687654321",
          relationship: "Spouse",
          isDefault: true,
        }),
      );
    });

    it("should update a contact SOS", async () => {
      const contactId = new mongoose.Types.ObjectId().toString();
      const change: LocalChange = {
        type: "sosContact",
        action: "update",
        id: contactId,
        data: {
          name: "Jane Updated",
          phone: "+33612345678",
        },
        timestamp: new Date().toISOString(),
      };

      (SosContactModel.findOne as jest.Mock).mockResolvedValue({
        _id: contactId,
        userId: mockUserId,
        name: "Jane Doe",
      });
      (SosContactModel.updateOne as jest.Mock).mockResolvedValue({
        modifiedCount: 1,
      });

      const result = await mobileSyncService.applyLocalChanges(mockUserId, [
        change,
      ]);

      expect(result.synced).toHaveLength(1);
      expect(SosContactModel.updateOne).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          $set: expect.objectContaining({
            name: "Jane Updated",
            phone: "+33612345678",
          }),
        }),
      );
    });

    it("should soft-delete a permanent contact SOS", async () => {
      const contactId = new mongoose.Types.ObjectId().toString();
      const change: LocalChange = {
        type: "sosContact",
        action: "delete",
        id: contactId,
        timestamp: new Date().toISOString(),
      };

      (SosContactModel.findOne as jest.Mock).mockResolvedValue({
        _id: contactId,
        userId: mockUserId,
        sessionId: undefined, // Permanent contact
        version: 1,
      });
      (SosContactModel.updateOne as jest.Mock).mockResolvedValue({
        modifiedCount: 1,
      });

      const result = await mobileSyncService.applyLocalChanges(mockUserId, [
        change,
      ]);

      expect(result.synced).toHaveLength(1);
      expect(SosContactModel.updateOne).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          $set: expect.objectContaining({
            deletedAt: expect.any(Date),
            version: 2,
          }),
        }),
      );
    });

    it("should hard-delete a temporary contact SOS with sessionId", async () => {
      const contactId = new mongoose.Types.ObjectId().toString();
      const sessionId = new mongoose.Types.ObjectId();
      const change: LocalChange = {
        type: "sosContact",
        action: "delete",
        id: contactId,
        timestamp: new Date().toISOString(),
      };

      (SosContactModel.findOne as jest.Mock).mockResolvedValue({
        _id: contactId,
        userId: mockUserId,
        sessionId: sessionId, // Temporary contact
      });
      (SosContactModel.deleteOne as jest.Mock).mockResolvedValue({
        deletedCount: 1,
      });

      const result = await mobileSyncService.applyLocalChanges(mockUserId, [
        change,
      ]);

      expect(result.synced).toHaveLength(1);
      expect(SosContactModel.deleteOne).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: expect.any(mongoose.Types.ObjectId),
        }),
      );
    });

    it("should throw error when contact not found", async () => {
      const nonexistentId = new mongoose.Types.ObjectId().toString();
      const change: LocalChange = {
        type: "sosContact",
        action: "update",
        id: nonexistentId,
        data: { name: "Updated" },
        timestamp: new Date().toISOString(),
      };

      (SosContactModel.findOne as jest.Mock).mockResolvedValue(null);

      const result = await mobileSyncService.applyLocalChanges(mockUserId, [
        change,
      ]);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain("non trouvé");
    });

    it("should throw error when max contacts reached (5)", async () => {
      const change: LocalChange = {
        type: "sosContact",
        action: "create",
        data: {
          name: "John Sixth",
          phone: "+33612345678",
        },
        timestamp: new Date().toISOString(),
      };

      (SosContactModel.countDocuments as jest.Mock).mockResolvedValue(5); // Already at max

      const result = await mobileSyncService.applyLocalChanges(mockUserId, [
        change,
      ]);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain("MAX_CONTACTS_REACHED");
    });
  });
});
