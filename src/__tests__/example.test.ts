/**
 * Test d'exemple pour vérifier que Jest fonctionne correctement
 */

/// <reference types="jest" />

import { mockRequest, mockResponse, mockNext, mockUser } from "./mocks";

describe("Configuration Jest - Tests de base", () => {
  describe("Mocks Express", () => {
    it("devrait créer un mock de Request", () => {
      const req = mockRequest({
        body: { test: "value" },
        params: { id: "123" },
      });

      expect(req.body).toEqual({ test: "value" });
      expect(req.params).toEqual({ id: "123" });
      expect(req.ip).toBe("127.0.0.1");
    });

    it("devrait créer un mock de Response", () => {
      const res = mockResponse();

      expect(res.status).toBeDefined();
      expect(res.json).toBeDefined();
      expect(res.send).toBeDefined();
    });

    it("devrait créer un mock de NextFunction", () => {
      const next = mockNext();

      expect(next).toBeDefined();
      expect(typeof next).toBe("function");
    });
  });

  describe("Mocks Utilisateur", () => {
    it("devrait créer un utilisateur standard", () => {
      const user = mockUser();

      expect(user.email).toBe("john.doe@test.com");
      expect(user.is_admin).toBe(false);
      expect(user.is_verified).toBe(true);
    });

    it("devrait créer un utilisateur avec des valeurs personnalisées", () => {
      const user = mockUser({
        email: "custom@test.com",
        name: "Custom",
      });

      expect(user.email).toBe("custom@test.com");
      expect(user.name).toBe("Custom");
    });
  });

  describe("Variables d'environnement", () => {
    it("devrait avoir NODE_ENV=test", () => {
      expect(process.env.NODE_ENV).toBe("test");
    });

    it("devrait avoir JWT_SECRET défini", () => {
      expect(process.env.JWT_SECRET).toBeDefined();
      expect(process.env.JWT_SECRET).toContain("test");
    });

    it("devrait avoir ENCRYPTION_KEY_MASTER défini", () => {
      expect(process.env.ENCRYPTION_KEY_MASTER).toBeDefined();
      expect(process.env.ENCRYPTION_KEY_MASTER?.length).toBe(64);
    });
  });
});
