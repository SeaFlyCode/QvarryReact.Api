// src/__tests__/services/storageQuotaService.test.ts
// Tests unitaires pour le service de gestion des quotas

import storageQuotaService from "../../services/storageQuotaService";
import UserModel from "../../models/users";
import { Types } from "mongoose";
import { STORAGE_CONFIG } from "../../config/storageConfig";
import { encrypt } from "../../utils/masterEncryptionUtils";
import { createTestUser, TEST_CONSTANTS } from "../helpers/imageTestHelpers";

const { GB } = TEST_CONSTANTS;

// Mock du modèle User
jest.mock("../../models/users");

describe("StorageQuotaService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("checkQuotaAvailable", () => {
    it("devrait retourner true si quota suffisant", async () => {
      const userId = new Types.ObjectId().toString();
      const mockUser = {
        _id: userId,
        storage_quota: 2 * GB,
        storage_used: 0.5 * GB,
      };

      (UserModel.findById as jest.Mock).mockResolvedValue(mockUser);

      const hasQuota = await storageQuotaService.checkQuotaAvailable(
        userId,
        0.3 * GB,
      );

      expect(hasQuota).toBe(true);
      expect(UserModel.findById).toHaveBeenCalledWith(userId);
    });

    it("devrait retourner false si quota insuffisant", async () => {
      const userId = new Types.ObjectId().toString();
      const mockUser = {
        _id: userId,
        storage_quota: 2 * GB,
        storage_used: 1.9 * GB,
      };

      (UserModel.findById as jest.Mock).mockResolvedValue(mockUser);

      const hasQuota = await storageQuotaService.checkQuotaAvailable(
        userId,
        0.5 * GB,
      );

      expect(hasQuota).toBe(false);
    });

    it("devrait retourner false si quota exactement atteint", async () => {
      const userId = new Types.ObjectId().toString();
      const mockUser = {
        _id: userId,
        storage_quota: 2 * GB,
        storage_used: 2 * GB,
      };

      (UserModel.findById as jest.Mock).mockResolvedValue(mockUser);

      const hasQuota = await storageQuotaService.checkQuotaAvailable(
        userId,
        1000,
      );

      expect(hasQuota).toBe(false);
    });

    it("devrait retourner false si utilisateur non trouvé", async () => {
      const userId = new Types.ObjectId().toString();

      (UserModel.findById as jest.Mock).mockResolvedValue(null);

      const hasQuota = await storageQuotaService.checkQuotaAvailable(
        userId,
        1000,
      );

      expect(hasQuota).toBe(false);
    });

    it("devrait utiliser le quota par défaut si non défini", async () => {
      const userId = new Types.ObjectId().toString();
      const mockUser = {
        _id: userId,
        storage_quota: undefined,
        storage_used: 0.5 * GB,
      };

      (UserModel.findById as jest.Mock).mockResolvedValue(mockUser);

      const hasQuota = await storageQuotaService.checkQuotaAvailable(
        userId,
        0.5 * GB,
      );

      expect(hasQuota).toBe(true);
    });

    it("devrait gérer les erreurs", async () => {
      const userId = new Types.ObjectId().toString();

      (UserModel.findById as jest.Mock).mockRejectedValue(
        new Error("Database error"),
      );

      const hasQuota = await storageQuotaService.checkQuotaAvailable(
        userId,
        1000,
      );

      expect(hasQuota).toBe(false);
    });
  });

  describe("incrementStorageUsed", () => {
    it("devrait incrémenter le storage_used", async () => {
      const userId = new Types.ObjectId().toString();
      const bytes = 100 * 1024; // 100 KB

      (UserModel.findByIdAndUpdate as jest.Mock).mockResolvedValue({});

      await storageQuotaService.incrementStorageUsed(userId, bytes);

      expect(UserModel.findByIdAndUpdate).toHaveBeenCalledWith(userId, {
        $inc: { storage_used: bytes },
      });
    });

    it("devrait gérer les erreurs", async () => {
      const userId = new Types.ObjectId().toString();
      const bytes = 1000;

      (UserModel.findByIdAndUpdate as jest.Mock).mockRejectedValue(
        new Error("Update failed"),
      );

      await expect(
        storageQuotaService.incrementStorageUsed(userId, bytes),
      ).rejects.toThrow("Impossible de mettre à jour le quota");
    });

    it("devrait accepter de grandes valeurs", async () => {
      const userId = new Types.ObjectId().toString();
      const bytes = 1 * GB;

      (UserModel.findByIdAndUpdate as jest.Mock).mockResolvedValue({});

      await storageQuotaService.incrementStorageUsed(userId, bytes);

      expect(UserModel.findByIdAndUpdate).toHaveBeenCalledWith(userId, {
        $inc: { storage_used: bytes },
      });
    });
  });

  describe("decrementStorageUsed", () => {
    it("devrait décrémenter le storage_used", async () => {
      const userId = new Types.ObjectId().toString();
      const bytes = 100 * 1024;

      (UserModel.findByIdAndUpdate as jest.Mock).mockResolvedValue({});

      await storageQuotaService.decrementStorageUsed(userId, bytes);

      expect(UserModel.findByIdAndUpdate).toHaveBeenCalledWith(userId, {
        $inc: { storage_used: -bytes },
      });
    });

    it("devrait gérer les erreurs", async () => {
      const userId = new Types.ObjectId().toString();
      const bytes = 1000;

      (UserModel.findByIdAndUpdate as jest.Mock).mockRejectedValue(
        new Error("Update failed"),
      );

      await expect(
        storageQuotaService.decrementStorageUsed(userId, bytes),
      ).rejects.toThrow("Impossible de mettre à jour le quota");
    });
  });

  describe("getUserStorageInfo", () => {
    it("devrait retourner les informations de stockage", async () => {
      const userId = new Types.ObjectId().toString();
      const mockUser = {
        _id: userId,
        storage_quota: 2 * GB,
        storage_used: 0.5 * GB,
      };

      (UserModel.findById as jest.Mock).mockResolvedValue(mockUser);

      const info = await storageQuotaService.getUserStorageInfo(userId);

      expect(info.used).toBe(0.5 * GB);
      expect(info.quota).toBe(2 * GB);
      expect(info.available).toBe(1.5 * GB);
      expect(info.percentage).toBe(25);
    });

    it("devrait calculer le pourcentage correctement", async () => {
      const userId = new Types.ObjectId().toString();
      const mockUser = {
        _id: userId,
        storage_quota: 2 * GB,
        storage_used: 1 * GB,
      };

      (UserModel.findById as jest.Mock).mockResolvedValue(mockUser);

      const info = await storageQuotaService.getUserStorageInfo(userId);

      expect(info.percentage).toBe(50);
    });

    it("devrait gérer le cas où storage_used est undefined", async () => {
      const userId = new Types.ObjectId().toString();
      const mockUser = {
        _id: userId,
        storage_quota: 2 * GB,
        storage_used: undefined,
      };

      (UserModel.findById as jest.Mock).mockResolvedValue(mockUser);

      const info = await storageQuotaService.getUserStorageInfo(userId);

      expect(info.used).toBe(0);
      expect(info.available).toBe(2 * GB);
      expect(info.percentage).toBe(0);
    });

    it("devrait utiliser le quota par défaut si non défini", async () => {
      const userId = new Types.ObjectId().toString();
      const mockUser = {
        _id: userId,
        storage_quota: undefined,
        storage_used: 0.5 * GB,
      };

      (UserModel.findById as jest.Mock).mockResolvedValue(mockUser);

      const info = await storageQuotaService.getUserStorageInfo(userId);

      expect(info.quota).toBe(STORAGE_CONFIG.DEFAULT_QUOTA_BYTES);
    });

    it("ne devrait pas retourner available négatif", async () => {
      const userId = new Types.ObjectId().toString();
      const mockUser = {
        _id: userId,
        storage_quota: 1 * GB,
        storage_used: 1.5 * GB, // Over quota
      };

      (UserModel.findById as jest.Mock).mockResolvedValue(mockUser);

      const info = await storageQuotaService.getUserStorageInfo(userId);

      expect(info.available).toBe(0);
    });

    it("devrait lancer une erreur si utilisateur non trouvé", async () => {
      const userId = new Types.ObjectId().toString();

      (UserModel.findById as jest.Mock).mockResolvedValue(null);

      await expect(
        storageQuotaService.getUserStorageInfo(userId),
      ).rejects.toThrow("Utilisateur non trouvé");
    });
  });

  describe("getAllUsersStorage", () => {
    it("devrait retourner la liste paginée des utilisateurs", async () => {
      const mockUsers = [
        {
          _id: new Types.ObjectId(),
          name: encrypt("John"),
          surname: encrypt("Doe"),
          email: encrypt("john@example.com"),
          storage_quota: 2 * GB,
          storage_used: 1 * GB,
        },
        {
          _id: new Types.ObjectId(),
          name: encrypt("Jane"),
          surname: encrypt("Smith"),
          email: encrypt("jane@example.com"),
          storage_quota: 2 * GB,
          storage_used: 0.5 * GB,
        },
      ];

      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockUsers),
      };

      (UserModel.find as jest.Mock).mockReturnValue(mockQuery);
      (UserModel.countDocuments as jest.Mock).mockResolvedValue(2);

      const result = await storageQuotaService.getAllUsersStorage(1, 50);

      expect(result.users).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(50);
      expect(result.totalPages).toBe(1);
      expect(result.users[0].name).toBe("John Doe");
      expect(result.users[0].storage.used).toBe(1 * GB);
    });

    it("devrait gérer la pagination", async () => {
      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      };

      (UserModel.find as jest.Mock).mockReturnValue(mockQuery);
      (UserModel.countDocuments as jest.Mock).mockResolvedValue(100);

      const result = await storageQuotaService.getAllUsersStorage(2, 10);

      expect(mockQuery.skip).toHaveBeenCalledWith(10); // (page - 1) * limit
      expect(mockQuery.limit).toHaveBeenCalledWith(10);
      expect(result.totalPages).toBe(10);
    });

    it("devrait utiliser les valeurs par défaut", async () => {
      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      };

      (UserModel.find as jest.Mock).mockReturnValue(mockQuery);
      (UserModel.countDocuments as jest.Mock).mockResolvedValue(0);

      const result = await storageQuotaService.getAllUsersStorage();

      expect(result.page).toBe(1);
      expect(result.limit).toBe(50);
    });
  });

  describe("updateUserQuota", () => {
    it("devrait mettre à jour le quota", async () => {
      const userId = new Types.ObjectId().toString();
      const newQuotaBytes = 3 * GB;
      const mockUser = {
        _id: userId,
        storage_quota: 2 * GB,
        storage_used: 1 * GB,
      };

      (UserModel.findById as jest.Mock).mockResolvedValue(mockUser);
      (UserModel.findByIdAndUpdate as jest.Mock).mockResolvedValue({});

      await storageQuotaService.updateUserQuota(userId, newQuotaBytes);

      expect(UserModel.findByIdAndUpdate).toHaveBeenCalledWith(userId, {
        storage_quota: newQuotaBytes,
      });
    });

    it("devrait rejeter si nouveau quota < storage_used", async () => {
      const userId = new Types.ObjectId().toString();
      const mockUser = {
        _id: userId,
        storage_quota: 2 * GB,
        storage_used: 1.5 * GB,
      };

      (UserModel.findById as jest.Mock).mockResolvedValue(mockUser);

      await expect(
        storageQuotaService.updateUserQuota(userId, 1 * GB),
      ).rejects.toThrow(
        "Le nouveau quota doit être supérieur ou égal à l'espace utilisé",
      );
    });

    it("devrait accepter quota égal à storage_used", async () => {
      const userId = new Types.ObjectId().toString();
      const mockUser = {
        _id: userId,
        storage_quota: 2 * GB,
        storage_used: 1 * GB,
      };

      (UserModel.findById as jest.Mock).mockResolvedValue(mockUser);
      (UserModel.findByIdAndUpdate as jest.Mock).mockResolvedValue({});

      await expect(
        storageQuotaService.updateUserQuota(userId, 1 * GB),
      ).resolves.not.toThrow();
    });

    it("devrait lancer une erreur si utilisateur non trouvé", async () => {
      const userId = new Types.ObjectId().toString();

      (UserModel.findById as jest.Mock).mockResolvedValue(null);

      await expect(
        storageQuotaService.updateUserQuota(userId, 3 * GB),
      ).rejects.toThrow("Utilisateur non trouvé");
    });
  });

  describe("recalculateUserStorage", () => {
    it("devrait recalculer le storage_used", async () => {
      const userId = new Types.ObjectId().toString();
      const actualSize = 1.2 * GB;

      (UserModel.findByIdAndUpdate as jest.Mock).mockResolvedValue({});

      await storageQuotaService.recalculateUserStorage(userId, actualSize);

      expect(UserModel.findByIdAndUpdate).toHaveBeenCalledWith(userId, {
        storage_used: actualSize,
      });
    });

    it("devrait gérer les erreurs", async () => {
      const userId = new Types.ObjectId().toString();

      (UserModel.findByIdAndUpdate as jest.Mock).mockRejectedValue(
        new Error("Update failed"),
      );

      await expect(
        storageQuotaService.recalculateUserStorage(userId, 1000),
      ).rejects.toThrow();
    });
  });

  describe("getGlobalStorageStats", () => {
    it("devrait retourner les statistiques globales", async () => {
      const mockStats = [
        {
          _id: null,
          totalUsers: 10,
          totalUsed: 15 * GB,
          totalQuota: 20 * GB,
          usersOverQuota: 2,
        },
      ];

      (UserModel.aggregate as jest.Mock).mockResolvedValue(mockStats);

      const stats = await storageQuotaService.getGlobalStorageStats();

      expect(stats.totalUsers).toBe(10);
      expect(stats.totalUsed).toBe(15 * GB);
      expect(stats.totalQuota).toBe(20 * GB);
      expect(stats.usersOverQuota).toBe(2);
      expect(stats.averageUsage).toBe(1.5 * GB);
    });

    it("devrait retourner des stats vides si aucun utilisateur", async () => {
      (UserModel.aggregate as jest.Mock).mockResolvedValue([]);

      const stats = await storageQuotaService.getGlobalStorageStats();

      expect(stats.totalUsers).toBe(0);
      expect(stats.totalUsed).toBe(0);
      expect(stats.totalQuota).toBe(0);
      expect(stats.averageUsage).toBe(0);
      expect(stats.usersOverQuota).toBe(0);
    });

    it("devrait gérer les erreurs", async () => {
      (UserModel.aggregate as jest.Mock).mockRejectedValue(
        new Error("Aggregation failed"),
      );

      await expect(
        storageQuotaService.getGlobalStorageStats(),
      ).rejects.toThrow();
    });
  });
});
