import {
  listRateLimitEntries,
  resetRateLimitKey,
  updateRateLimitKey,
} from "../../services/adminRateLimitService";
import { getRedisClient } from "../../services/redisSessionService";

// On mocke uniquement l'accès au client Redis ; le reste du service (matching
// via RATE_LIMITER_REGISTRY, filtres, garde-fous) est exercé pour de vrai.
jest.mock("../../services/redisSessionService", () => ({
  getRedisClient: jest.fn(),
}));

const mockedGetRedisClient = getRedisClient as jest.MockedFunction<
  typeof getRedisClient
>;

interface FakeEntry {
  value: string;
  ttl: number;
}

function makeFakeRedis(store: Map<string, FakeEntry>) {
  return {
    scan: jest.fn(async (_cursor: string) => {
      const keys = [...store.keys()].filter((k) => k.startsWith("rl:"));
      return ["0", keys] as [string, string[]];
    }),
    pipeline: () => {
      const cmds: Array<[string, string]> = [];
      const p: Record<string, unknown> = {
        get: (k: string) => {
          cmds.push(["get", k]);
          return p;
        },
        ttl: (k: string) => {
          cmds.push(["ttl", k]);
          return p;
        },
        exec: async () =>
          cmds.map(([op, k]) => {
            const e = store.get(k);
            if (op === "get") return [null, e ? e.value : null];
            return [null, e ? e.ttl : -2];
          }),
      };
      return p;
    },
    del: jest.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
    exists: jest.fn(async (k: string) => (store.has(k) ? 1 : 0)),
    get: jest.fn(async (k: string) => store.get(k)?.value ?? null),
    ttl: jest.fn(async (k: string) => store.get(k)?.ttl ?? -2),
    set: jest.fn(async (k: string, v: string) => {
      const e = store.get(k) || { value: "0", ttl: -1 };
      store.set(k, { value: v, ttl: e.ttl });
      return "OK";
    }),
    expire: jest.fn(async (k: string, ttl: number) => {
      const e = store.get(k);
      if (e) {
        e.ttl = ttl;
        store.set(k, e);
      }
      return 1;
    }),
  };
}

describe("adminRateLimitService", () => {
  afterEach(() => jest.clearAllMocks());

  describe("listRateLimitEntries", () => {
    it("signale Redis indisponible", async () => {
      mockedGetRedisClient.mockReturnValue(null);
      const res = await listRateLimitEntries();
      expect(res.redisAvailable).toBe(false);
      expect(res.entries).toHaveLength(0);
    });

    it("enrichit les clés et calcule exceeded", async () => {
      const store = new Map<string, FakeEntry>([
        ["rl:auth:1.2.3.4", { value: "99999", ttl: 300 }],
        ["rl:general:5.6.7.8", { value: "1", ttl: 60 }],
      ]);
      mockedGetRedisClient.mockReturnValue(makeFakeRedis(store) as never);

      const res = await listRateLimitEntries();
      expect(res.redisAvailable).toBe(true);
      expect(res.total).toBe(2);

      const auth = res.entries.find((e) => e.key === "rl:auth:1.2.3.4");
      expect(auth?.limiterKey).toBe("auth");
      expect(auth?.identifier).toBe("1.2.3.4");
      expect(auth?.exceeded).toBe(true); // 99999 >= max
      expect(auth?.resetAt).not.toBeNull();

      const general = res.entries.find((e) => e.key === "rl:general:5.6.7.8");
      expect(general?.exceeded).toBe(false);
      // Les entrées dépassées sont triées en tête
      expect(res.entries[0].exceeded).toBe(true);
    });

    it("filtre onlyExceeded, limiterKey et search", async () => {
      const store = new Map<string, FakeEntry>([
        ["rl:auth:1.2.3.4", { value: "99999", ttl: 300 }],
        ["rl:auth:9.9.9.9", { value: "0", ttl: 300 }],
        ["rl:general:5.6.7.8", { value: "99999", ttl: 60 }],
      ]);
      mockedGetRedisClient.mockReturnValue(makeFakeRedis(store) as never);

      const exceeded = await listRateLimitEntries({ onlyExceeded: true });
      expect(exceeded.entries.every((e) => e.exceeded)).toBe(true);
      expect(exceeded.entries).toHaveLength(2);

      const byType = await listRateLimitEntries({ limiterKey: "auth" });
      expect(byType.entries.every((e) => e.limiterKey === "auth")).toBe(true);
      expect(byType.entries).toHaveLength(2);

      const bySearch = await listRateLimitEntries({ search: "5.6.7.8" });
      expect(bySearch.entries).toHaveLength(1);
      expect(bySearch.entries[0].identifier).toBe("5.6.7.8");
    });
  });

  describe("resetRateLimitKey", () => {
    it("supprime une clé rl:", async () => {
      const store = new Map<string, FakeEntry>([
        ["rl:auth:1.2.3.4", { value: "5", ttl: 300 }],
      ]);
      mockedGetRedisClient.mockReturnValue(makeFakeRedis(store) as never);

      await expect(resetRateLimitKey("rl:auth:1.2.3.4")).resolves.toBe(true);
      expect(store.has("rl:auth:1.2.3.4")).toBe(false);
    });

    it("refuse une clé hors préfixe rl: (garde-fou)", async () => {
      mockedGetRedisClient.mockReturnValue(makeFakeRedis(new Map()) as never);
      await expect(resetRateLimitKey("qvarry:session:abc")).rejects.toThrow(
        "INVALID_RATE_LIMIT_KEY",
      );
      await expect(resetRateLimitKey("rl:")).rejects.toThrow(
        "INVALID_RATE_LIMIT_KEY",
      );
    });
  });

  describe("updateRateLimitKey", () => {
    it("ajuste le compteur et le TTL", async () => {
      const store = new Map<string, FakeEntry>([
        ["rl:auth:1.2.3.4", { value: "99999", ttl: 300 }],
      ]);
      mockedGetRedisClient.mockReturnValue(makeFakeRedis(store) as never);

      const updated = await updateRateLimitKey("rl:auth:1.2.3.4", {
        count: 0,
        ttlSeconds: 30,
      });
      expect(updated?.count).toBe(0);
      expect(updated?.ttlSeconds).toBe(30);
      expect(updated?.exceeded).toBe(false);
      expect(store.get("rl:auth:1.2.3.4")).toEqual({ value: "0", ttl: 30 });
    });

    it("retourne null si la clé n'existe pas", async () => {
      mockedGetRedisClient.mockReturnValue(makeFakeRedis(new Map()) as never);
      const res = await updateRateLimitKey("rl:auth:absent", { count: 0 });
      expect(res).toBeNull();
    });

    it("refuse une clé hors préfixe rl:", async () => {
      mockedGetRedisClient.mockReturnValue(makeFakeRedis(new Map()) as never);
      await expect(
        updateRateLimitKey("session:x", { count: 0 }),
      ).rejects.toThrow("INVALID_RATE_LIMIT_KEY");
    });
  });
});
