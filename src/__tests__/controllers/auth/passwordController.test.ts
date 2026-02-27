/**
 * Tests unitaires pour passwordController
 * Teste les fonctions de gestion du mot de passe (forgot/reset)
 */

jest.mock("../../../services/userService");
jest.mock("../../../services/emailService");
jest.mock("../../../services/refreshTokenService");
jest.mock("../../../services/auditService");
jest.mock("../../../services/redisSessionService");
jest.mock("../../../utils/masterEncryptionUtils");
jest.mock("../../../utils/passwordUtils");
jest.mock("crypto");
jest.mock("mongoose");

import { Request, Response } from "express";
import {
  handleForgotPassword,
  handleResetPassword,
} from "../../../controllers/auth/passwordController";
import { mockRequest, mockResponse, mockUser } from "../../mocks";
import { getUserByEmail } from "../../../services/userService";
import {
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
  generateVerificationCode,
} from "../../../services/emailService";
import { refreshTokenService } from "../../../services/refreshTokenService";
import { auditService } from "../../../services/auditService";
import { redisSessionService } from "../../../services/redisSessionService";
import { decrypt } from "../../../utils/masterEncryptionUtils";
import {
  isPasswordInHistory,
  addToPasswordHistory,
  validatePasswordStrength,
} from "../../../utils/passwordUtils";
import crypto from "crypto";
import bcrypt from "bcrypt";

describe("passwordController", () => {
  describe("handleForgotPassword", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest();
      res = mockResponse();

      (crypto.randomBytes as jest.Mock).mockReturnValue({
        toString: jest.fn().mockReturnValue("reset-token-12345"),
      });
      (generateVerificationCode as jest.Mock).mockReturnValue("12345678");
      (decrypt as jest.Mock).mockReturnValue("John");
    });

    it("devrait rejeter une requête sans email", async () => {
      req.body = {};

      await handleForgotPassword(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ message: "Email requis." });
    });

    it("devrait retourner une réponse générique si l'utilisateur n'existe pas", async () => {
      req.body = { email: "nonexistent@test.com" };
      (getUserByEmail as jest.Mock).mockResolvedValue(null);

      await handleForgotPassword(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message:
          "Si cet email est associé à un compte, un lien de réinitialisation sera envoyé.",
      });
      expect(sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it("devrait envoyer un email de réinitialisation pour un utilisateur valide", async () => {
      req.body = { email: "john.doe@test.com" };
      req.ip = "192.168.1.1";
      req.headers = { "user-agent": "Mozilla/5.0" };

      const user = {
        ...mockUser(),
        save: jest.fn().mockResolvedValue(true),
      };
      (getUserByEmail as jest.Mock).mockResolvedValue(user);

      await handleForgotPassword(req as Request, res as Response);

      expect(user.reset_password_token).toBe("reset-token-12345:12345678");
      expect(user.reset_password_expires).toBeInstanceOf(Date);
      expect(user.save).toHaveBeenCalled();

      expect(sendPasswordResetEmail).toHaveBeenCalledWith(
        "john.doe@test.com",
        "John",
        expect.stringContaining("?reset="),
        "12345678",
        "192.168.1.1",
        "Mozilla/5.0",
        "1 heure",
      );

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message:
          "Si cet email est associé à un compte, un lien de réinitialisation sera envoyé.",
      });
    });

    it("devrait générer un code à 8 chiffres", async () => {
      req.body = { email: "john.doe@test.com" };

      const user = {
        ...mockUser(),
        save: jest.fn().mockResolvedValue(true),
      };
      (getUserByEmail as jest.Mock).mockResolvedValue(user);

      await handleForgotPassword(req as Request, res as Response);

      expect(generateVerificationCode).toHaveBeenCalledWith(8);
    });

    it("devrait gérer les erreurs d'envoi d'email", async () => {
      req.body = { email: "john.doe@test.com" };

      const user = {
        ...mockUser(),
        save: jest.fn().mockResolvedValue(true),
      };
      (getUserByEmail as jest.Mock).mockResolvedValue(user);
      (sendPasswordResetEmail as jest.Mock).mockRejectedValue(
        new Error("Email error"),
      );

      await handleForgotPassword(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        message: "Erreur lors de l'envoi de l'email de réinitialisation.",
        error: "Une erreur interne est survenue",
      });
    });

    it("devrait gérer les erreurs de base de données", async () => {
      req.body = { email: "john.doe@test.com" };

      (getUserByEmail as jest.Mock).mockRejectedValue(new Error("DB Error"));

      await handleForgotPassword(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        message: "Erreur lors de l'envoi de l'email de réinitialisation.",
        error: "Une erreur interne est survenue",
      });
    });
  });

  describe("handleResetPassword", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
      req = mockRequest();
      res = mockResponse();

      (decrypt as jest.Mock).mockReturnValue("John");
      (bcrypt.hash as jest.Mock).mockResolvedValue("$2b$12$newHashedPassword");
      (validatePasswordStrength as jest.Mock).mockReturnValue({
        isValid: true,
        message: "Mot de passe valide",
      });
      (isPasswordInHistory as jest.Mock).mockResolvedValue(false);
      (addToPasswordHistory as jest.Mock).mockReturnValue([
        "oldHash1",
        "oldHash2",
      ]);
    });

    it("devrait rejeter une requête avec champs manquants", async () => {
      req.body = { email: "test@test.com" };

      await handleResetPassword(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message: "Email, code et nouveau mot de passe requis.",
      });
    });

    it("devrait rejeter un mot de passe faible", async () => {
      req.body = {
        email: "test@test.com",
        code: "12345678",
        newPassword: "weak",
      };

      (validatePasswordStrength as jest.Mock).mockReturnValue({
        isValid: false,
        message: "Mot de passe trop faible",
      });

      await handleResetPassword(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message: "Mot de passe trop faible",
      });
    });

    it("devrait rejeter si l'utilisateur n'existe pas", async () => {
      req.body = {
        email: "nonexistent@test.com",
        code: "12345678",
        newPassword: "NewPassword123!",
      };

      (getUserByEmail as jest.Mock).mockResolvedValue(null);

      await handleResetPassword(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message: "Code invalide ou expiré.",
        expired: true,
      });
    });

    it("devrait rejeter si l'utilisateur n'est pas vérifié", async () => {
      req.body = {
        email: "test@test.com",
        code: "12345678",
        newPassword: "NewPassword123!",
      };

      const user = {
        ...mockUser({ is_verified: false }),
      };
      (getUserByEmail as jest.Mock).mockResolvedValue(user);

      await handleResetPassword(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message: "Veuillez d'abord vérifier votre adresse email.",
        needsVerification: true,
      });
    });

    it("devrait rejeter si le code est expiré", async () => {
      req.body = {
        email: "test@test.com",
        code: "12345678",
        newPassword: "NewPassword123!",
      };

      const user = {
        ...mockUser(),
        reset_password_token: "token:12345678",
        reset_password_expires: new Date(Date.now() - 1000),
      };
      (getUserByEmail as jest.Mock).mockResolvedValue(user);

      await handleResetPassword(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message: "Le code a expiré. Veuillez demander un nouveau code.",
        expired: true,
      });
    });

    it("devrait rejeter si le code est invalide", async () => {
      req.body = {
        email: "test@test.com",
        code: "wrongcode",
        newPassword: "NewPassword123!",
      };

      const user = {
        ...mockUser(),
        reset_password_token: "token:12345678",
        reset_password_expires: new Date(Date.now() + 60000),
      };
      (getUserByEmail as jest.Mock).mockResolvedValue(user);

      await handleResetPassword(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message: "Code invalide.",
        expired: false,
      });
    });

    it("devrait rejeter si le mot de passe est dans l'historique", async () => {
      req.body = {
        email: "test@test.com",
        code: "12345678",
        newPassword: "OldPassword123!",
      };

      const user = {
        ...mockUser(),
        reset_password_token: "token:12345678",
        reset_password_expires: new Date(Date.now() + 60000),
        password_history: ["oldHash1", "oldHash2"],
      };
      (getUserByEmail as jest.Mock).mockResolvedValue(user);
      (isPasswordInHistory as jest.Mock).mockResolvedValue(true);

      await handleResetPassword(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message:
          "Ce mot de passe a déjà été utilisé récemment. Veuillez en choisir un nouveau.",
        passwordReused: true,
      });
    });

    it("devrait réinitialiser le mot de passe avec succès", async () => {
      req.body = {
        email: "test@test.com",
        code: "12345678",
        newPassword: "NewPassword123!",
      };
      req.ip = "192.168.1.1";
      req.headers = { "user-agent": "Mozilla/5.0" };

      const user = {
        ...mockUser(),
        _id: "507f1f77bcf86cd799439011",
        reset_password_token: "token:12345678",
        reset_password_expires: new Date(Date.now() + 60000),
        password_history: [],
        save: jest.fn().mockResolvedValue(true),
      };
      (getUserByEmail as jest.Mock).mockResolvedValue(user);
      (refreshTokenService.revokeAllUserTokens as jest.Mock).mockResolvedValue(
        3,
      );
      (redisSessionService.deleteSession as jest.Mock).mockResolvedValue(
        undefined,
      );
      (auditService.log as jest.Mock).mockResolvedValue(undefined);
      (sendPasswordChangedEmail as jest.Mock).mockResolvedValue(undefined);

      await handleResetPassword(req as Request, res as Response);

      expect(bcrypt.hash).toHaveBeenCalledWith("NewPassword123!", 12);
      expect(user.password).toBe("$2b$12$newHashedPassword");
      expect(user.reset_password_token).toBe("");
      expect(user.reset_password_expires).toEqual(new Date(0));
      expect(user.save).toHaveBeenCalled();

      expect(refreshTokenService.revokeAllUserTokens).toHaveBeenCalledWith(
        "507f1f77bcf86cd799439011",
        "password_changed",
      );

      expect(sendPasswordChangedEmail).toHaveBeenCalledWith(
        "test@test.com",
        "John",
        "192.168.1.1",
        "Mozilla/5.0",
      );

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message:
          "Mot de passe réinitialisé avec succès ! Vous pouvez maintenant vous connecter.",
        success: true,
      });
    });

    it("devrait mettre à jour l'historique des mots de passe", async () => {
      req.body = {
        email: "test@test.com",
        code: "12345678",
        newPassword: "NewPassword123!",
      };

      const user = {
        ...mockUser(),
        _id: "userId",
        reset_password_token: "token:12345678",
        reset_password_expires: new Date(Date.now() + 60000),
        password: "currentHash",
        password_history: ["oldHash1", "oldHash2"],
        save: jest.fn().mockResolvedValue(true),
      };
      (getUserByEmail as jest.Mock).mockResolvedValue(user);
      (refreshTokenService.revokeAllUserTokens as jest.Mock).mockResolvedValue(
        0,
      );

      const newHistory = ["currentHash", "oldHash1", "oldHash2"];
      (addToPasswordHistory as jest.Mock).mockReturnValue(newHistory);

      await handleResetPassword(req as Request, res as Response);

      expect(addToPasswordHistory).toHaveBeenCalledWith("currentHash", [
        "oldHash1",
        "oldHash2",
      ]);
      expect(user.password_history).toEqual(newHistory);
    });

    it("devrait gérer les erreurs de base de données", async () => {
      req.body = {
        email: "test@test.com",
        code: "12345678",
        newPassword: "NewPassword123!",
      };

      (getUserByEmail as jest.Mock).mockRejectedValue(new Error("DB Error"));

      await handleResetPassword(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        message: "Erreur lors de la réinitialisation du mot de passe.",
        error: "Une erreur interne est survenue",
      });
    });
  });
});
