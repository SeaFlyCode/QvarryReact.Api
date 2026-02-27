// ═══════════════════════════════════════════════════════════════════════════
// TESTS: memoryStorageService
// ═══════════════════════════════════════════════════════════════════════════

import { MemoryStorageService } from "../../services/memoryStorageService";
import mongoose from "mongoose";

describe("MemoryStorageService", () => {
  let service: MemoryStorageService;
  const testUserId = "507f1f77bcf86cd799439011";
  const testEncryptionKey = "test-encryption-key-123";

  beforeAll(() => {
    // Use fake timers to prevent setInterval from actually running
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    // Create a fresh instance for each test
    service = new MemoryStorageService();
    jest.clearAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Session Management
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Session Management", () => {
    it("should initialize a new session", () => {
      const result = service.initSession(testUserId, testEncryptionKey);

      expect(result).toBe(true);
      expect(service.hasSession(testUserId)).toBe(true);
    });

    it("should return false when initializing session without userId", () => {
      const result = service.initSession("", testEncryptionKey);

      expect(result).toBe(false);
    });

    it("should return false when initializing session without encryptionKey", () => {
      const result = service.initSession(testUserId, "");

      expect(result).toBe(false);
    });

    it("should check if session exists", () => {
      expect(service.hasSession(testUserId)).toBe(false);

      service.initSession(testUserId, testEncryptionKey);

      expect(service.hasSession(testUserId)).toBe(true);
    });

    it("should return false when checking session without userId", () => {
      expect(service.hasSession("")).toBe(false);
    });

    it("should throw error when accessing non-existent session", () => {
      expect(() => service.getSession("nonexistent")).toThrow(
        "Session utilisateur non trouvée",
      );
    });

    it("should touch session and update lastAccessed", () => {
      service.initSession(testUserId, testEncryptionKey);
      const session = service.getSession(testUserId);
      const oldAccess = session.lastAccessed.getTime();

      // Advance time slightly
      jest.advanceTimersByTime(100);

      // Touch session
      service.touchSession(testUserId);
      const newSession = service.getSession(testUserId);

      // lastAccessed should be updated to current time
      expect(newSession.lastAccessed.getTime()).toBeGreaterThanOrEqual(
        oldAccess,
      );
    });

    it("should end session and remove it", () => {
      service.initSession(testUserId, testEncryptionKey);
      expect(service.hasSession(testUserId)).toBe(true);

      service.endSession(testUserId);

      expect(service.hasSession(testUserId)).toBe(false);
    });

    it("should get encryption key from session", () => {
      service.initSession(testUserId, testEncryptionKey);

      const key = service.getUserEncryptionKey(testUserId);

      expect(key).toBe(testEncryptionKey);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Point Management
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Point Management", () => {
    const mockPoint: any = {
      _id: new mongoose.Types.ObjectId("507f1f77bcf86cd799439012"),
      name: "Test Point",
      description: "Test Description",
      lat: 48.8566,
      lng: 2.3522,
      userId: new mongoose.Types.ObjectId(testUserId),
    };

    beforeEach(() => {
      service.initSession(testUserId, testEncryptionKey);
    });

    it("should store a point", () => {
      const result = service.storePoint(testUserId, mockPoint);

      expect(result).toBe(true);
      expect(service.isDirty(testUserId)).toBe(true);
    });

    it("should return false when storing point without ID", () => {
      const invalidPoint = { ...mockPoint, _id: undefined };
      const result = service.storePoint(testUserId, invalidPoint);

      expect(result).toBe(false);
    });

    it("should retrieve stored point by ID", () => {
      service.storePoint(testUserId, mockPoint);

      const retrieved = service.getPointById(
        testUserId,
        mockPoint._id.toString(),
      );

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe("Test Point");
    });

    it("should return undefined for non-existent point", () => {
      const retrieved = service.getPointById(testUserId, "nonexistent");

      expect(retrieved).toBeUndefined();
    });

    it("should get all points", () => {
      service.storePoint(testUserId, mockPoint);
      service.storePoint(testUserId, {
        ...mockPoint,
        _id: new mongoose.Types.ObjectId("507f1f77bcf86cd799439013"),
      });

      const points = service.getAllPoints(testUserId);

      expect(points).toHaveLength(2);
    });

    it("should search points by query", () => {
      service.storePoint(testUserId, mockPoint);
      service.storePoint(testUserId, {
        ...mockPoint,
        _id: new mongoose.Types.ObjectId("507f1f77bcf86cd799439013"),
        name: "Different Point",
        description: "Different Description",
      });

      const results = service.searchPoints(testUserId, { query: "Test" });

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("Test Point");
    });

    it("should delete a point", () => {
      service.storePoint(testUserId, mockPoint);

      const result = service.deletePoint(testUserId, mockPoint._id.toString());

      expect(result).toBe(true);
      expect(
        service.getPointById(testUserId, mockPoint._id.toString()),
      ).toBeUndefined();
    });

    it("should return false when deleting non-existent point", () => {
      const result = service.deletePoint(testUserId, "nonexistent");

      expect(result).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Fiche Management
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Fiche Management", () => {
    const mockFiche: any = {
      _id: new mongoose.Types.ObjectId("507f1f77bcf86cd799439014"),
      name: "Test Fiche",
      ville: "Paris",
      type: "carriere",
      etat: "accessible",
      difficulte_acces: "facile",
      risque_oxygene: "faible",
      acces_souterrain: "ouvert",
      praticite_souterrain: "bonne",
      etat_general: "bon",
      points_ids: [],
      userId: new mongoose.Types.ObjectId(testUserId),
    };

    beforeEach(() => {
      service.initSession(testUserId, testEncryptionKey);
    });

    it("should store a fiche", () => {
      const result = service.storeFiche(testUserId, mockFiche);

      expect(result).toBe(true);
      expect(service.isDirty(testUserId)).toBe(true);
    });

    it("should return false when storing fiche without ID", () => {
      const invalidFiche = { ...mockFiche, _id: undefined };
      const result = service.storeFiche(testUserId, invalidFiche);

      expect(result).toBe(false);
    });

    it("should retrieve stored fiche by ID", () => {
      service.storeFiche(testUserId, mockFiche);

      const retrieved = service.getFicheById(
        testUserId,
        mockFiche._id.toString(),
      );

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe("Test Fiche");
    });

    it("should get all fiches", () => {
      service.storeFiche(testUserId, mockFiche);
      service.storeFiche(testUserId, {
        ...mockFiche,
        _id: new mongoose.Types.ObjectId("507f1f77bcf86cd799439015"),
      });

      const fiches = service.getAllFiches(testUserId);

      expect(fiches).toHaveLength(2);
    });

    it("should delete a fiche", () => {
      service.storeFiche(testUserId, mockFiche);

      const result = service.deleteFiche(testUserId, mockFiche._id.toString());

      expect(result).toBe(true);
      expect(
        service.getFicheById(testUserId, mockFiche._id.toString()),
      ).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // List Management
  // ═══════════════════════════════════════════════════════════════════════════

  describe("List Management", () => {
    const mockList: any = {
      _id: new mongoose.Types.ObjectId("507f1f77bcf86cd799439016"),
      name: "Test List",
      description: "Test list description",
      points: [],
      userId: new mongoose.Types.ObjectId(testUserId),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    beforeEach(() => {
      service.initSession(testUserId, testEncryptionKey);
    });

    it("should store a list", () => {
      const result = service.storeList(testUserId, mockList);

      expect(result).toBe(true);
      expect(service.isDirty(testUserId)).toBe(true);
    });

    it("should retrieve stored list by ID", () => {
      service.storeList(testUserId, mockList);

      const retrieved = service.getListById(
        testUserId,
        mockList._id.toString(),
      );

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe("Test List");
    });

    it("should get all lists", () => {
      service.storeList(testUserId, mockList);

      const lists = service.getAllLists(testUserId);

      expect(lists).toHaveLength(1);
    });

    it("should delete a list", () => {
      service.storeList(testUserId, mockList);

      const result = service.deleteList(testUserId, mockList._id.toString());

      expect(result).toBe(true);
      expect(
        service.getListById(testUserId, mockList._id.toString()),
      ).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Conversation Management
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Conversation Management", () => {
    const mockConversation: any = {
      _id: new mongoose.Types.ObjectId("507f1f77bcf86cd799439017"),
      name: "Test Conversation",
      isGroup: false,
      participants: [],
      lastMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    beforeEach(() => {
      service.initSession(testUserId, testEncryptionKey);
    });

    it("should store a conversation", () => {
      const result = service.storeConversation(testUserId, mockConversation);

      expect(result).toBe(true);
      expect(service.isDirty(testUserId)).toBe(true);
    });

    it("should retrieve stored conversation by ID", () => {
      service.storeConversation(testUserId, mockConversation);

      const retrieved = service.getConversationById(
        testUserId,
        mockConversation._id.toString(),
      );

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe("Test Conversation");
    });

    it("should get all conversations", () => {
      service.storeConversation(testUserId, mockConversation);

      const conversations = service.getAllConversations(testUserId);

      expect(conversations).toHaveLength(1);
    });

    it("should remove a conversation", () => {
      service.storeConversation(testUserId, mockConversation);

      const result = service.removeConversation(
        testUserId,
        mockConversation._id.toString(),
      );

      expect(result).toBe(true);
      expect(
        service.getConversationById(
          testUserId,
          mockConversation._id.toString(),
        ),
      ).toBeUndefined();
    });

    it("should update conversation lastMessage", () => {
      service.storeConversation(testUserId, mockConversation);
      const newMessageId = new mongoose.Types.ObjectId();

      service.updateConversationLastMessage(
        mockConversation._id.toString(),
        newMessageId,
        [testUserId],
      );

      const updated = service.getConversationById(
        testUserId,
        mockConversation._id.toString(),
      );
      expect(updated?.lastMessage).toEqual(newMessageId);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Contact Management
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Contact Management", () => {
    const mockContact: any = {
      _id: new mongoose.Types.ObjectId("507f1f77bcf86cd799439018"),
      userId: new mongoose.Types.ObjectId(testUserId),
      contactUserId: new mongoose.Types.ObjectId("507f1f77bcf86cd799439019"),
      status: "accepted",
      createdAt: new Date(),
    };

    beforeEach(() => {
      service.initSession(testUserId, testEncryptionKey);
    });

    it("should store a contact", () => {
      const result = service.storeContact(testUserId, mockContact);

      expect(result).toBe(true);
      expect(service.isDirty(testUserId)).toBe(true);
    });

    it("should retrieve stored contact by ID", () => {
      service.storeContact(testUserId, mockContact);

      const retrieved = service.getContact(
        testUserId,
        mockContact._id.toString(),
      );

      expect(retrieved).toBeDefined();
      expect(retrieved?.status).toBe("accepted");
    });

    it("should get all contacts", () => {
      service.storeContact(testUserId, mockContact);

      const contacts = service.getContacts(testUserId);

      expect(contacts).toHaveLength(1);
    });

    it("should filter contacts by status", () => {
      service.storeContact(testUserId, mockContact);
      service.storeContact(testUserId, {
        ...mockContact,
        _id: new mongoose.Types.ObjectId("507f1f77bcf86cd79943901a"),
        status: "pending",
      });

      const accepted = service.getContacts(testUserId, "accepted");

      expect(accepted).toHaveLength(1);
      expect(accepted[0].status).toBe("accepted");
    });

    it("should delete a contact", () => {
      service.storeContact(testUserId, mockContact);

      const result = service.deleteContact(
        testUserId,
        mockContact._id.toString(),
      );

      expect(result).toBe(true);
      expect(
        service.getContact(testUserId, mockContact._id.toString()),
      ).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Dirty State Management
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Dirty State Management", () => {
    beforeEach(() => {
      service.initSession(testUserId, testEncryptionKey);
    });

    it("should mark session as dirty when storing data", () => {
      const mockPoint: any = {
        _id: new mongoose.Types.ObjectId(),
        name: "Test",
      };

      expect(service.isDirty(testUserId)).toBe(false);

      service.storePoint(testUserId, mockPoint);

      expect(service.isDirty(testUserId)).toBe(true);
    });

    it("should track dirty point IDs", () => {
      const pointId = new mongoose.Types.ObjectId();
      const mockPoint: any = { _id: pointId, name: "Test" };

      service.storePoint(testUserId, mockPoint);

      const dirtyIds = service.getDirtyPointIds(testUserId);
      expect(dirtyIds.has(pointId.toString())).toBe(true);
    });

    it("should mark as synced and clear dirty state", () => {
      const mockPoint: any = {
        _id: new mongoose.Types.ObjectId(),
        name: "Test",
      };
      service.storePoint(testUserId, mockPoint);

      expect(service.isDirty(testUserId)).toBe(true);

      service.markAsSynced(testUserId);

      expect(service.isDirty(testUserId)).toBe(false);
      expect(service.getDirtyPointIds(testUserId).size).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Fiche-Point Relationships
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Fiche-Point Relationships", () => {
    const ficheId = new mongoose.Types.ObjectId();
    const pointId = new mongoose.Types.ObjectId();

    const mockFiche: any = {
      _id: ficheId,
      name: "Test Fiche",
      points_ids: [],
    };

    const mockPoint: any = {
      _id: pointId,
      name: "Test Point",
    };

    beforeEach(() => {
      service.initSession(testUserId, testEncryptionKey);
      service.storeFiche(testUserId, mockFiche);
      service.storePoint(testUserId, mockPoint);
    });

    it("should add point to fiche", () => {
      const result = service.addPointToFiche(
        testUserId,
        ficheId.toString(),
        pointId.toString(),
      );

      expect(result).toBe(true);

      const fiche = service.getFicheById(testUserId, ficheId.toString());
      expect(fiche?.points_ids).toContain(pointId.toString());
    });

    it("should not add duplicate point to fiche", () => {
      service.addPointToFiche(
        testUserId,
        ficheId.toString(),
        pointId.toString(),
      );
      const result = service.addPointToFiche(
        testUserId,
        ficheId.toString(),
        pointId.toString(),
      );

      expect(result).toBe(false);
    });

    it("should remove point from fiche", () => {
      service.addPointToFiche(
        testUserId,
        ficheId.toString(),
        pointId.toString(),
      );

      const result = service.removePointFromFiche(
        testUserId,
        ficheId.toString(),
        pointId.toString(),
      );

      expect(result).toBe(true);

      const fiche = service.getFicheById(testUserId, ficheId.toString());
      expect(fiche?.points_ids).not.toContain(pointId.toString());
    });

    it("should get points by fiche ID", () => {
      service.addPointToFiche(
        testUserId,
        ficheId.toString(),
        pointId.toString(),
      );

      const points = service.getPointsByFicheId(testUserId, ficheId.toString());

      expect(points).toHaveLength(1);
      expect(points[0]._id.toString()).toBe(pointId.toString());
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Usage Stats
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Usage Stats", () => {
    it("should return usage statistics", () => {
      const stats = service.getUsageStats();

      expect(stats).toHaveProperty("activeSessions");
      expect(stats).toHaveProperty("totalAccesses");
      expect(stats).toHaveProperty("memoryUsage");
      expect(stats.activeSessions).toBe(0);
    });

    it("should reset usage stats", () => {
      service.initSession(testUserId, testEncryptionKey);
      service.getAllPoints(testUserId); // Generate some access

      const statsBefore = service.getUsageStats();
      expect(Object.keys(statsBefore.totalAccesses).length).toBeGreaterThan(0);

      service.resetUsageStats();

      const statsAfter = service.getUsageStats();
      expect(Object.keys(statsAfter.totalAccesses).length).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Edge Cases
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Edge Cases", () => {
    it("should return empty array when getting all points without session", () => {
      const points = service.getAllPoints("nonexistent");

      expect(points).toEqual([]);
    });

    it("should handle error when searching points on invalid session", () => {
      const results = service.searchPoints("nonexistent", { query: "test" });

      expect(results).toEqual([]);
    });

    it("should return empty object with error when getting all user data fails", () => {
      const data = service.getAllUserData("nonexistent");

      expect(data).toHaveProperty("error");
    });

    it("should not crash when updating conversation lastMessage for non-existent session", () => {
      expect(() => {
        service.updateConversationLastMessage(
          "someConvId",
          new mongoose.Types.ObjectId(),
          ["nonexistent"],
        );
      }).not.toThrow();
    });
  });
});
