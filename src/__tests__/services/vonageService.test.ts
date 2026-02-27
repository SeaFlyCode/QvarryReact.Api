// ═══════════════════════════════════════════════════════════════════════════
// TESTS: vonageService
// ═══════════════════════════════════════════════════════════════════════════

import { vonageService } from "../../services/vonageService";

// Mock global fetch
global.fetch = jest.fn();

describe("VonageService", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // ═════════════════════════════════════════════════════════════════════════
  // initialize
  // ═════════════════════════════════════════════════════════════════════════

  describe("initialize", () => {
    it("should configure service when env vars are present", () => {
      process.env.VONAGE_API_KEY = "test-key";
      process.env.VONAGE_API_SECRET = "test-secret";
      process.env.VONAGE_SMS_FROM = "Qvarry";

      vonageService.initialize();

      expect(vonageService.isReady()).toBe(true);
    });

    it("should not configure service when API key is missing", () => {
      delete process.env.VONAGE_API_KEY;
      process.env.VONAGE_API_SECRET = "test-secret";

      vonageService.initialize();

      expect(vonageService.isReady()).toBe(false);
    });

    it("should not configure service when API secret is missing", () => {
      process.env.VONAGE_API_KEY = "test-key";
      delete process.env.VONAGE_API_SECRET;

      vonageService.initialize();

      expect(vonageService.isReady()).toBe(false);
    });

    it("should use default SMS_FROM if not provided", () => {
      process.env.VONAGE_API_KEY = "test-key";
      process.env.VONAGE_API_SECRET = "test-secret";
      delete process.env.VONAGE_SMS_FROM;

      vonageService.initialize();

      expect(vonageService.isReady()).toBe(true);
    });

    it("should handle initialization errors gracefully", () => {
      process.env.VONAGE_API_KEY = "test-key";
      process.env.VONAGE_API_SECRET = "test-secret";

      // Should not throw
      expect(() => vonageService.initialize()).not.toThrow();
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // sendSms
  // ═════════════════════════════════════════════════════════════════════════

  describe("sendSms", () => {
    beforeEach(() => {
      process.env.VONAGE_API_KEY = "test-key";
      process.env.VONAGE_API_SECRET = "test-secret";
      vonageService.initialize();
    });

    it("should return error if service not configured", async () => {
      const uninitializedService = Object.create(
        Object.getPrototypeOf(vonageService),
      );

      const result = await uninitializedService.sendSms(
        "+33612345678",
        "Test message",
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Service Vonage non configuré");
    });

    it("should send SMS successfully", async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          "message-count": "1",
          messages: [
            {
              status: "0",
              "message-id": "msg-123",
              to: "33612345678",
              "error-text": "",
              "remaining-balance": "10.50",
              "message-price": "0.05",
              network: "Orange",
            },
          ],
        }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await vonageService.sendSms("+33612345678", "Test SMS");

      expect(result.success).toBe(true);
      expect(result.messageId).toBe("msg-123");
      expect(result.to).toBe("+33612345678");
    });

    it("should remove + from phone number before sending", async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          messages: [{ status: "0", "message-id": "msg-456" }],
        }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      await vonageService.sendSms("+33612345678", "Test");

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.to).toBe("33612345678");
    });

    it("should retry on failure", async () => {
      const mockFailResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          messages: [{ status: "1", "error-text": "Throttled" }],
        }),
      };
      const mockSuccessResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          messages: [{ status: "0", "message-id": "msg-retry" }],
        }),
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(mockFailResponse)
        .mockResolvedValueOnce(mockSuccessResponse);

      const result = await vonageService.sendSms("+33612345678", "Retry test");

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
    });

    it("should return error after max retries", async () => {
      const mockFailResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          messages: [{ status: "1", "error-text": "Invalid number" }],
        }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockFailResponse);

      const result = await vonageService.sendSms("+33612345678", "Fail test");

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(3);
      expect(result.error).toContain("Invalid number");
    });

    it("should handle HTTP errors", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      });

      const result = await vonageService.sendSms("+33612345678", "Auth fail");

      expect(result.success).toBe(false);
      expect(result.error).toContain("401");
    });

    it("should handle network exceptions", async () => {
      (global.fetch as jest.Mock).mockRejectedValue(
        new Error("Network timeout"),
      );

      const result = await vonageService.sendSms(
        "+33612345678",
        "Network fail",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Network timeout");
    });

    it("should not retry when service is not configured", async () => {
      delete process.env.VONAGE_API_KEY;
      vonageService.initialize();

      const result = await vonageService.sendSms("+33612345678", "Test");

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // sendSosAlert
  // ═════════════════════════════════════════════════════════════════════════

  describe("sendSosAlert", () => {
    beforeEach(() => {
      process.env.VONAGE_API_KEY = "test-key";
      process.env.VONAGE_API_SECRET = "test-secret";
      vonageService.initialize();
    });

    it("should format SOS alert message correctly", async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          messages: [{ status: "0", "message-id": "sos-123" }],
        }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      await vonageService.sendSosAlert(
        "John Doe",
        "+33612345678",
        "Alice Smith",
      );

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.text).toContain("🆘 ALERTE QVARRY");
      expect(body.text).toContain("Alice Smith");
    });

    it("should include session note in message if provided", async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          messages: [{ status: "0", "message-id": "sos-456" }],
        }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      await vonageService.sendSosAlert(
        "Contact",
        "+33612345678",
        "User",
        "Exploring cave X",
      );

      const body = JSON.parse(
        (global.fetch as jest.Mock).mock.calls[0][1].body,
      );
      expect(body.text).toContain("Exploring cave X");
    });

    it("should include GPS coordinates if provided", async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          messages: [{ status: "0", "message-id": "sos-789" }],
        }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      await vonageService.sendSosAlert(
        "Contact",
        "+33612345678",
        "User",
        undefined,
        { lat: 48.8566, lng: 2.3522 },
      );

      const body = JSON.parse(
        (global.fetch as jest.Mock).mock.calls[0][1].body,
      );
      expect(body.text).toContain("48.8566");
      expect(body.text).toContain("2.3522");
      expect(body.text).toContain("maps.google.com");
    });

    it("should return send result", async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          messages: [{ status: "0", "message-id": "sos-result" }],
        }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await vonageService.sendSosAlert(
        "Contact",
        "+33612345678",
        "User",
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toBe("sos-result");
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // sendSosAlertToMultiple
  // ═════════════════════════════════════════════════════════════════════════

  describe("sendSosAlertToMultiple", () => {
    beforeEach(() => {
      process.env.VONAGE_API_KEY = "test-key";
      process.env.VONAGE_API_SECRET = "test-secret";
      vonageService.initialize();
    });

    it("should send alerts to multiple contacts", async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          messages: [{ status: "0", "message-id": "multi-123" }],
        }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const contacts = [
        { name: "Contact 1", phone: "+33611111111" },
        { name: "Contact 2", phone: "+33622222222" },
        { name: "Contact 3", phone: "+33633333333" },
      ];

      const results = await vonageService.sendSosAlertToMultiple(
        contacts,
        "User",
      );

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.success)).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it("should handle mixed success/failure results", async () => {
      const mockSuccess = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          messages: [{ status: "0", "message-id": "ok" }],
        }),
      };
      const mockFail = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          messages: [{ status: "1", "error-text": "Invalid" }],
        }),
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(mockSuccess)
        .mockResolvedValueOnce(mockFail)
        .mockResolvedValueOnce(mockSuccess);

      const contacts = [
        { name: "C1", phone: "+33611111111" },
        { name: "C2", phone: "+33622222222" },
        { name: "C3", phone: "+33633333333" },
      ];

      const results = await vonageService.sendSosAlertToMultiple(
        contacts,
        "User",
      );

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[2].success).toBe(true);
    });

    it("should return error result for rejected promises", async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error("Network error"));

      const contacts = [{ name: "Contact", phone: "+33611111111" }];

      const results = await vonageService.sendSosAlertToMultiple(
        contacts,
        "User",
      );

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBeDefined();
    });

    it("should include session note and location in all messages", async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          messages: [{ status: "0", "message-id": "loc-123" }],
        }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const contacts = [
        { name: "C1", phone: "+33611111111" },
        { name: "C2", phone: "+33622222222" },
      ];

      await vonageService.sendSosAlertToMultiple(
        contacts,
        "User",
        "Cave exploration",
        { lat: 45.0, lng: 5.0 },
      );

      expect(global.fetch).toHaveBeenCalledTimes(2);
      const calls = (global.fetch as jest.Mock).mock.calls;
      calls.forEach((call) => {
        const body = JSON.parse(call[1].body);
        expect(body.text).toContain("Cave exploration");
        expect(body.text).toContain("45");
        expect(body.text).toContain("5");
      });
    });
  });
});
