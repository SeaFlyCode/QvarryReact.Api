/**
 * Tests unitaires pour deviceFingerprint
 * Génération d'empreinte unique pour les devices
 */

import { generateDeviceFingerprint } from "../../utils/deviceFingerprint";
import { Request } from "express";

describe("deviceFingerprint", () => {
  describe("generateDeviceFingerprint", () => {
    const createMockRequest = (
      headers: Record<string, string>,
    ): Partial<Request> => {
      return {
        headers: headers as any,
      };
    };

    it("should return a 32-character hex string", () => {
      const req = createMockRequest({
        "user-agent": "Mozilla/5.0",
        "accept-language": "en-US,en;q=0.9",
        "accept-encoding": "gzip, deflate, br",
      }) as Request;

      const fingerprint = generateDeviceFingerprint(req);

      expect(fingerprint).toHaveLength(32);
      expect(fingerprint).toMatch(/^[a-f0-9]{32}$/);
    });

    it("should produce the same fingerprint for the same request", () => {
      const headers = {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0",
        "accept-language": "en-US,en;q=0.9",
        "accept-encoding": "gzip, deflate, br",
        "sec-ch-ua": '"Chrome";v="120"',
        "sec-ch-ua-platform": '"Windows"',
        "sec-ch-ua-mobile": "?0",
      };

      const req1 = createMockRequest(headers) as Request;
      const req2 = createMockRequest(headers) as Request;

      const fingerprint1 = generateDeviceFingerprint(req1);
      const fingerprint2 = generateDeviceFingerprint(req2);

      expect(fingerprint1).toBe(fingerprint2);
    });

    it("should produce different fingerprints for different user-agents", () => {
      const req1 = createMockRequest({
        "user-agent": "Mozilla/5.0 (Windows) Chrome/120.0",
        "accept-language": "en-US",
        "accept-encoding": "gzip",
      }) as Request;

      const req2 = createMockRequest({
        "user-agent": "Mozilla/5.0 (Macintosh) Safari/17.0",
        "accept-language": "en-US",
        "accept-encoding": "gzip",
      }) as Request;

      const fingerprint1 = generateDeviceFingerprint(req1);
      const fingerprint2 = generateDeviceFingerprint(req2);

      expect(fingerprint1).not.toBe(fingerprint2);
    });

    it("should produce different fingerprints for different accept-language", () => {
      const req1 = createMockRequest({
        "user-agent": "Mozilla/5.0",
        "accept-language": "en-US,en;q=0.9",
        "accept-encoding": "gzip",
      }) as Request;

      const req2 = createMockRequest({
        "user-agent": "Mozilla/5.0",
        "accept-language": "fr-FR,fr;q=0.9",
        "accept-encoding": "gzip",
      }) as Request;

      const fingerprint1 = generateDeviceFingerprint(req1);
      const fingerprint2 = generateDeviceFingerprint(req2);

      expect(fingerprint1).not.toBe(fingerprint2);
    });

    it("should produce different fingerprints for different accept-encoding", () => {
      const req1 = createMockRequest({
        "user-agent": "Mozilla/5.0",
        "accept-language": "en-US",
        "accept-encoding": "gzip, deflate, br",
      }) as Request;

      const req2 = createMockRequest({
        "user-agent": "Mozilla/5.0",
        "accept-language": "en-US",
        "accept-encoding": "gzip, deflate",
      }) as Request;

      const fingerprint1 = generateDeviceFingerprint(req1);
      const fingerprint2 = generateDeviceFingerprint(req2);

      expect(fingerprint1).not.toBe(fingerprint2);
    });

    it("should handle missing user-agent header", () => {
      const req = createMockRequest({
        "accept-language": "en-US",
        "accept-encoding": "gzip",
      }) as Request;

      const fingerprint = generateDeviceFingerprint(req);

      expect(fingerprint).toHaveLength(32);
      expect(fingerprint).toMatch(/^[a-f0-9]{32}$/);
    });

    it("should handle missing accept-language header", () => {
      const req = createMockRequest({
        "user-agent": "Mozilla/5.0",
        "accept-encoding": "gzip",
      }) as Request;

      const fingerprint = generateDeviceFingerprint(req);

      expect(fingerprint).toHaveLength(32);
      expect(fingerprint).toMatch(/^[a-f0-9]{32}$/);
    });

    it("should handle missing accept-encoding header", () => {
      const req = createMockRequest({
        "user-agent": "Mozilla/5.0",
        "accept-language": "en-US",
      }) as Request;

      const fingerprint = generateDeviceFingerprint(req);

      expect(fingerprint).toHaveLength(32);
      expect(fingerprint).toMatch(/^[a-f0-9]{32}$/);
    });

    it("should handle completely empty headers", () => {
      const req = createMockRequest({}) as Request;

      const fingerprint = generateDeviceFingerprint(req);

      expect(fingerprint).toHaveLength(32);
      expect(fingerprint).toMatch(/^[a-f0-9]{32}$/);
    });

    it("should produce the same fingerprint for empty headers", () => {
      const req1 = createMockRequest({}) as Request;
      const req2 = createMockRequest({}) as Request;

      const fingerprint1 = generateDeviceFingerprint(req1);
      const fingerprint2 = generateDeviceFingerprint(req2);

      expect(fingerprint1).toBe(fingerprint2);
    });

    it("should include sec-ch-ua headers in fingerprint", () => {
      const req1 = createMockRequest({
        "user-agent": "Mozilla/5.0",
        "sec-ch-ua": '"Chrome";v="120"',
        "sec-ch-ua-platform": '"Windows"',
        "sec-ch-ua-mobile": "?0",
      }) as Request;

      const req2 = createMockRequest({
        "user-agent": "Mozilla/5.0",
        "sec-ch-ua": '"Chrome";v="121"',
        "sec-ch-ua-platform": '"Windows"',
        "sec-ch-ua-mobile": "?0",
      }) as Request;

      const fingerprint1 = generateDeviceFingerprint(req1);
      const fingerprint2 = generateDeviceFingerprint(req2);

      expect(fingerprint1).not.toBe(fingerprint2);
    });

    it("should include dnt header in fingerprint", () => {
      const req1 = createMockRequest({
        "user-agent": "Mozilla/5.0",
        dnt: "1",
      }) as Request;

      const req2 = createMockRequest({
        "user-agent": "Mozilla/5.0",
        dnt: "0",
      }) as Request;

      const fingerprint1 = generateDeviceFingerprint(req1);
      const fingerprint2 = generateDeviceFingerprint(req2);

      expect(fingerprint1).not.toBe(fingerprint2);
    });

    it("should include connection header in fingerprint", () => {
      const req1 = createMockRequest({
        "user-agent": "Mozilla/5.0",
        connection: "keep-alive",
      }) as Request;

      const req2 = createMockRequest({
        "user-agent": "Mozilla/5.0",
        connection: "close",
      }) as Request;

      const fingerprint1 = generateDeviceFingerprint(req1);
      const fingerprint2 = generateDeviceFingerprint(req2);

      expect(fingerprint1).not.toBe(fingerprint2);
    });

    it("should handle real-world Chrome headers", () => {
      const req = createMockRequest({
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "accept-language": "en-US,en;q=0.9,fr;q=0.8",
        "accept-encoding": "gzip, deflate, br",
        "sec-ch-ua":
          '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        "sec-ch-ua-platform": '"Windows"',
        "sec-ch-ua-mobile": "?0",
        connection: "keep-alive",
      }) as Request;

      const fingerprint = generateDeviceFingerprint(req);

      expect(fingerprint).toHaveLength(32);
      expect(fingerprint).toMatch(/^[a-f0-9]{32}$/);
    });

    it("should handle real-world Safari headers", () => {
      const req = createMockRequest({
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        "accept-language": "en-US,en;q=0.9",
        "accept-encoding": "gzip, deflate, br",
        connection: "keep-alive",
      }) as Request;

      const fingerprint = generateDeviceFingerprint(req);

      expect(fingerprint).toHaveLength(32);
      expect(fingerprint).toMatch(/^[a-f0-9]{32}$/);
    });

    it("should handle real-world Firefox headers", () => {
      const req = createMockRequest({
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
        "accept-language": "en-US,en;q=0.5",
        "accept-encoding": "gzip, deflate, br",
        dnt: "1",
        connection: "keep-alive",
      }) as Request;

      const fingerprint = generateDeviceFingerprint(req);

      expect(fingerprint).toHaveLength(32);
      expect(fingerprint).toMatch(/^[a-f0-9]{32}$/);
    });

    it("should be deterministic across multiple calls", () => {
      const headers = {
        "user-agent": "Mozilla/5.0",
        "accept-language": "en-US",
        "accept-encoding": "gzip",
      };

      const fingerprints = Array.from({ length: 10 }, () => {
        const req = createMockRequest(headers) as Request;
        return generateDeviceFingerprint(req);
      });

      const uniqueFingerprints = new Set(fingerprints);
      expect(uniqueFingerprints.size).toBe(1);
    });
  });
});
