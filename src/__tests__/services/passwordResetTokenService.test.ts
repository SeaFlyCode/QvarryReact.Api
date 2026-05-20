/**
 * Tests unitaires pour passwordResetTokenService
 * Service partagé par les handlers reset-password mobile (Universal Link) et web (page fallback).
 */

jest.mock("../../models/users");
jest.mock("../../services/refreshTokenService");
jest.mock("../../services/redisSessionService");
jest.mock("../../services/auditService");
jest.mock("../../services/emailService");
jest.mock("../../utils/masterEncryptionUtils");
jest.mock("../../utils/passwordUtils");

import { resetPasswordByToken } from "../../services/passwordResetTokenService";
import UserModel from "../../models/users";
import { refreshTokenService } from "../../services/refreshTokenService";
import { redisSessionService } from "../../services/redisSessionService";
import { auditService } from "../../services/auditService";
import { sendPasswordChangedEmail } from "../../services/emailService";
import { decrypt } from "../../utils/masterEncryptionUtils";
import {
  isPasswordInHistory,
  addToPasswordHistory,
  validatePasswordStrength,
} from "../../utils/passwordUtils";
import bcrypt from "bcrypt";
import crypto from "crypto";

const VALID_TOKEN = "a".repeat(64); // 64 hex chars = format valide
const STRONG_PASSWORD = "Str0ngP@ssword!!";
const USER_ID = "507f1f77bcf86cd799439011";

function makeUser(overrides: Partial<any> = {}) {
  return {
    _id: USER_ID,
    name: "encrypted_name",
    email: "encrypted_email",
    password: "$2b$12$oldHash",
    password_history: [],
    is_verified: true,
    reset_password_token: crypto
      .createHash("sha256")
      .update(VALID_TOKEN)
      .digest("hex"),
    reset_password_expires: new Date(Date.now() + 60 * 60 * 1000),
    save: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("passwordResetTokenService.resetPasswordByToken", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (validatePasswordStrength as jest.Mock).mockReturnValue({
      isValid: true,
      message: "OK",
    });
    (isPasswordInHistory as jest.Mock).mockResolvedValue(false);
    (addToPasswordHistory as jest.Mock).mockReturnValue([]);
    (decrypt as jest.Mock).mockImplementation((v: string) =>
      v === "encrypted_email" ? "user@example.com" : "John",
    );
    (bcrypt.hash as unknown as jest.Mock) = jest
      .fn()
      .mockResolvedValue("$2b$12$newHash");
    (refreshTokenService.revokeAllUserTokens as jest.Mock).mockResolvedValue(3);
    (redisSessionService.deleteSession as jest.Mock).mockResolvedValue(
      undefined,
    );
    (auditService.log as jest.Mock).mockResolvedValue(undefined);
    (sendPasswordChangedEmail as jest.Mock).mockResolvedValue(true);
  });

  // ─── Validation d'entrée ─────────────────────────────────────────────

  it("retourne INVALID_TOKEN si le token est manquant", async () => {
    const result = await resetPasswordByToken(undefined, STRONG_PASSWORD, {
      source: "mobile",
    });
    expect(result).toMatchObject({
      success: false,
      code: "INVALID_TOKEN",
      status: 400,
    });
  });

  it("retourne WEAK_PASSWORD si le mot de passe est manquant", async () => {
    const result = await resetPasswordByToken(VALID_TOKEN, undefined, {
      source: "mobile",
    });
    expect(result).toMatchObject({
      success: false,
      code: "WEAK_PASSWORD",
      status: 400,
    });
  });

  it("retourne INVALID_TOKEN si le token n'a pas un format hex 64", async () => {
    const cases = ["short", "X".repeat(64), "a".repeat(63), "a".repeat(65)];
    for (const bad of cases) {
      const result = await resetPasswordByToken(bad, STRONG_PASSWORD, {
        source: "mobile",
      });
      expect(result).toMatchObject({ success: false, code: "INVALID_TOKEN" });
    }
  });

  it("retourne INVALID_TOKEN si le type du token n'est pas string", async () => {
    const result = await resetPasswordByToken(12345, STRONG_PASSWORD, {
      source: "mobile",
    });
    expect(result).toMatchObject({ success: false, code: "INVALID_TOKEN" });
  });

  it("retourne WEAK_PASSWORD si validatePasswordStrength échoue", async () => {
    (validatePasswordStrength as jest.Mock).mockReturnValue({
      isValid: false,
      message: "Trop court",
    });
    const result = await resetPasswordByToken(VALID_TOKEN, "weak", {
      source: "mobile",
    });
    expect(result).toMatchObject({
      success: false,
      code: "WEAK_PASSWORD",
      message: "Trop court",
    });
  });

  // ─── Lookup utilisateur ──────────────────────────────────────────────

  it("retourne INVALID_TOKEN si aucun user ne matche", async () => {
    (UserModel.findOne as jest.Mock).mockReturnValue({
      select: jest.fn().mockResolvedValue(null),
    });
    const result = await resetPasswordByToken(VALID_TOKEN, STRONG_PASSWORD, {
      source: "mobile",
    });
    expect(result).toMatchObject({ success: false, code: "INVALID_TOKEN" });
  });

  it("retourne TOKEN_EXPIRED si reset_password_expires est passé", async () => {
    const expiredUser = makeUser({
      reset_password_expires: new Date(Date.now() - 1000),
    });
    (UserModel.findOne as jest.Mock).mockReturnValue({
      select: jest.fn().mockResolvedValue(expiredUser),
    });
    const result = await resetPasswordByToken(VALID_TOKEN, STRONG_PASSWORD, {
      source: "mobile",
    });
    expect(result).toMatchObject({ success: false, code: "TOKEN_EXPIRED" });
  });

  it("retourne TOKEN_EXPIRED si reset_password_expires est absent", async () => {
    const noExpireUser = makeUser({ reset_password_expires: null });
    (UserModel.findOne as jest.Mock).mockReturnValue({
      select: jest.fn().mockResolvedValue(noExpireUser),
    });
    const result = await resetPasswordByToken(VALID_TOKEN, STRONG_PASSWORD, {
      source: "mobile",
    });
    expect(result).toMatchObject({ success: false, code: "TOKEN_EXPIRED" });
  });

  it("retourne USER_NOT_FOUND si l'email n'est pas vérifié", async () => {
    const unverifiedUser = makeUser({ is_verified: false });
    (UserModel.findOne as jest.Mock).mockReturnValue({
      select: jest.fn().mockResolvedValue(unverifiedUser),
    });
    const result = await resetPasswordByToken(VALID_TOKEN, STRONG_PASSWORD, {
      source: "mobile",
    });
    expect(result).toMatchObject({ success: false, code: "USER_NOT_FOUND" });
  });

  // ─── Historique mots de passe ────────────────────────────────────────

  it("retourne WEAK_PASSWORD si le password est dans l'historique", async () => {
    const user = makeUser();
    (UserModel.findOne as jest.Mock).mockReturnValue({
      select: jest.fn().mockResolvedValue(user),
    });
    (isPasswordInHistory as jest.Mock).mockResolvedValue(true);
    const result = await resetPasswordByToken(VALID_TOKEN, STRONG_PASSWORD, {
      source: "mobile",
    });
    expect(result).toMatchObject({ success: false, code: "WEAK_PASSWORD" });
  });

  // ─── Happy path ──────────────────────────────────────────────────────

  it("met à jour le password, révoque tokens + sessions et retourne success", async () => {
    const user = makeUser();
    (UserModel.findOne as jest.Mock).mockReturnValue({
      select: jest.fn().mockResolvedValue(user),
    });

    const result = await resetPasswordByToken(VALID_TOKEN, STRONG_PASSWORD, {
      source: "mobile",
      ipAddress: "1.2.3.4",
      userAgent: "ios",
      platform: "ios",
      deviceId: "device-xyz",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.userId).toBe(USER_ID);
      expect(result.tokensRevoked).toBe(3);
    }
    expect(user.password).toBe("$2b$12$newHash");
    expect(user.reset_password_token).toBe("");
    expect(user.save).toHaveBeenCalledTimes(1);
    expect(refreshTokenService.revokeAllUserTokens).toHaveBeenCalledWith(
      USER_ID,
      "password_changed",
    );
    expect(redisSessionService.deleteSession).toHaveBeenCalledWith(USER_ID);
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        action: "MOBILE_PASSWORD_RESET_COMPLETED",
        level: "warning",
      }),
    );
    expect(sendPasswordChangedEmail).toHaveBeenCalledWith(
      "user@example.com",
      "John",
      "1.2.3.4",
      "ios",
    );
  });

  it("audit avec action web-fallback quand source=web-fallback", async () => {
    const user = makeUser();
    (UserModel.findOne as jest.Mock).mockReturnValue({
      select: jest.fn().mockResolvedValue(user),
    });

    await resetPasswordByToken(VALID_TOKEN, STRONG_PASSWORD, {
      source: "web-fallback",
      ipAddress: "1.2.3.4",
    });

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "PASSWORD_RESET_BY_TOKEN_COMPLETED",
      }),
    );
  });

  it("ne bloque pas la réponse success si l'email de confirmation échoue", async () => {
    const user = makeUser();
    (UserModel.findOne as jest.Mock).mockReturnValue({
      select: jest.fn().mockResolvedValue(user),
    });
    (sendPasswordChangedEmail as jest.Mock).mockRejectedValue(
      new Error("SMTP down"),
    );

    const result = await resetPasswordByToken(VALID_TOKEN, STRONG_PASSWORD, {
      source: "mobile",
    });

    expect(result.success).toBe(true);
  });

  // ─── Erreurs infrastructure ──────────────────────────────────────────

  it("retourne INTERNAL_ERROR si UserModel.findOne lève une exception", async () => {
    (UserModel.findOne as jest.Mock).mockImplementation(() => {
      throw new Error("DB down");
    });
    const result = await resetPasswordByToken(VALID_TOKEN, STRONG_PASSWORD, {
      source: "mobile",
    });
    expect(result).toMatchObject({
      success: false,
      code: "INTERNAL_ERROR",
      status: 500,
    });
  });

  it("retourne INTERNAL_ERROR si user.save() throw", async () => {
    const user = makeUser({
      save: jest.fn().mockRejectedValue(new Error("Save failed")),
    });
    (UserModel.findOne as jest.Mock).mockReturnValue({
      select: jest.fn().mockResolvedValue(user),
    });
    const result = await resetPasswordByToken(VALID_TOKEN, STRONG_PASSWORD, {
      source: "mobile",
    });
    expect(result).toMatchObject({
      success: false,
      code: "INTERNAL_ERROR",
    });
  });

  // ─── Sécurité : hash du token cohérent ───────────────────────────────

  it("hash le token reçu en SHA-256 avant le lookup (impossible de bypass avec le hash)", async () => {
    const user = makeUser();
    (UserModel.findOne as jest.Mock).mockReturnValue({
      select: jest.fn().mockResolvedValue(user),
    });

    await resetPasswordByToken(VALID_TOKEN, STRONG_PASSWORD, {
      source: "mobile",
    });

    const expectedHash = crypto
      .createHash("sha256")
      .update(VALID_TOKEN)
      .digest("hex");
    expect(UserModel.findOne).toHaveBeenCalledWith({
      reset_password_token: expectedHash,
    });
  });
});
