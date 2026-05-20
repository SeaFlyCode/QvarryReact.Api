/**
 * Tests unitaires pour handleMobileResetPassword
 * Le handler délègue toute la logique métier à
 * passwordResetTokenService.resetPasswordByToken → on vérifie ici que le
 * mapping Request → Service et Service Result → Response est correct.
 */

jest.mock("../../services/passwordResetTokenService");
jest.mock("../../services/userService");
jest.mock("../../services/refreshTokenService");
jest.mock("../../services/redisSessionService");
jest.mock("../../services/auditService");
jest.mock("../../services/emailService");
jest.mock("../../services/loggerService");
jest.mock("../../utils/masterEncryptionUtils");
jest.mock("../../utils/passwordUtils");
jest.mock("../../utils/emailUtils");
jest.mock("../../utils/logUtils");
jest.mock("../../middlewares/mobileSecurityMiddleware");
jest.mock("../../controllers/auth/authHelpers");
jest.mock("../../models/users");
jest.mock("../../models/maintenance");

import { Request, Response } from "express";
import { handleMobileResetPassword } from "../../controllers/mobileAuthControllers";
import { resetPasswordByToken } from "../../services/passwordResetTokenService";
import { mockRequest, mockResponse } from "../mocks";

const VALID_TOKEN = "a".repeat(64);

describe("handleMobileResetPassword", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;

  beforeEach(() => {
    jest.clearAllMocks();
    req = mockRequest({
      body: { token: VALID_TOKEN, newPassword: "Str0ngP@ssword!!" },
      ip: "1.2.3.4",
      headers: { "user-agent": "iOS/17.0" },
    });
    (req as any).mobileContext = {
      platform: "ios",
      deviceId: "device-abc",
    };
    res = mockResponse();
  });

  it("appelle resetPasswordByToken avec le contexte mobile complet", async () => {
    (resetPasswordByToken as jest.Mock).mockResolvedValue({
      success: true,
      userId: "u1",
      tokensRevoked: 2,
    });

    await handleMobileResetPassword(req as Request, res as Response);

    expect(resetPasswordByToken).toHaveBeenCalledWith(
      VALID_TOKEN,
      "Str0ngP@ssword!!",
      expect.objectContaining({
        source: "mobile",
        platform: "ios",
        deviceId: "device-abc",
        ipAddress: "1.2.3.4",
      }),
    );
  });

  it("retourne 200 { success: true } quand le service réussit", async () => {
    (resetPasswordByToken as jest.Mock).mockResolvedValue({
      success: true,
      userId: "u1",
      tokensRevoked: 2,
    });

    await handleMobileResetPassword(req as Request, res as Response);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it("retourne le status + code d'erreur du service en cas d'échec", async () => {
    (resetPasswordByToken as jest.Mock).mockResolvedValue({
      success: false,
      code: "TOKEN_EXPIRED",
      message: "Token expiré",
      status: 400,
    });

    await handleMobileResetPassword(req as Request, res as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "Token expiré",
      code: "TOKEN_EXPIRED",
    });
  });

  it("propage un body vide sans crasher", async () => {
    req.body = undefined;
    (resetPasswordByToken as jest.Mock).mockResolvedValue({
      success: false,
      code: "INVALID_TOKEN",
      message: "Token requis.",
      status: 400,
    });

    await handleMobileResetPassword(req as Request, res as Response);

    expect(resetPasswordByToken).toHaveBeenCalledWith(
      undefined,
      undefined,
      expect.objectContaining({ source: "mobile" }),
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("source = 'mobile' même sans mobileContext (fallback safe)", async () => {
    (req as any).mobileContext = undefined;
    (resetPasswordByToken as jest.Mock).mockResolvedValue({
      success: true,
      userId: "u1",
      tokensRevoked: 0,
    });

    await handleMobileResetPassword(req as Request, res as Response);

    expect(resetPasswordByToken).toHaveBeenCalledWith(
      VALID_TOKEN,
      "Str0ngP@ssword!!",
      expect.objectContaining({
        source: "mobile",
        platform: undefined,
        deviceId: undefined,
      }),
    );
  });
});
