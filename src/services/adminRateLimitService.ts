// ═══════════════════════════════════════════════════════════════════════════
// SERVICE ADMIN — RATE LIMITER (lecture / reset / ajustement des punitions)
// ═══════════════════════════════════════════════════════════════════════════
// Énumère les compteurs de rate limit stockés dans Redis (clés `rl:*`), les
// enrichit via RATE_LIMITER_REGISTRY (type, fenêtre, limite max), et permet de
// les retirer (DEL), réduire/augmenter la durée (EXPIRE) ou le compteur (SET).
//
// Sécurité : toutes les opérations d'écriture sont strictement bornées au
// préfixe `rl:` — aucune autre clé Redis (sessions, etc.) ne peut être touchée.
//
// Limite connue : en topologie Redis Cluster, SCAN ne couvre qu'un nœud. La prod
// utilise un Redis standalone — si un cluster est introduit, prévoir un scan
// multi-nœuds.
// ═══════════════════════════════════════════════════════════════════════════

import { getRedisClient } from "./redisSessionService";
import {
  RATE_LIMITER_REGISTRY,
  type RateLimiterMeta,
} from "../config/rateLimitConfig";
import { logger } from "./loggerService";

const log = logger.child({ service: "admin-rate-limit" });

const RL_PREFIX = "rl:";

// Matching du préfixe le plus spécifique d'abord (évite qu'une clé d'un limiter
// au préfixe plus long soit attribuée à un limiter au préfixe plus court).
const REGISTRY_BY_SPECIFICITY = [...RATE_LIMITER_REGISTRY].sort(
  (a, b) => b.prefix.length - a.prefix.length,
);

export interface RateLimitEntry {
  /** Clé Redis complète, ex "rl:auth:1.2.3.4" */
  key: string;
  /** Identifiant court du limiter, ex "auth" (null si inconnu) */
  limiterKey: string | null;
  /** Libellé humain du limiter */
  limiterLabel: string;
  /** Partie identifiant de la clé (IP / userId / hash device) */
  identifier: string;
  /** Compteur de hits actuel */
  count: number;
  /** Limite max du limiter (null si inconnu) */
  max: number | null;
  /** Fenêtre du limiter en ms (null si inconnu) */
  windowMs: number | null;
  /** Secondes restantes avant expiration (-1 = pas de TTL, -2 = clé absente) */
  ttlSeconds: number;
  /** Date ISO de réinitialisation (null si pas de TTL) */
  resetAt: string | null;
  /** true si le compteur a atteint/dépassé la limite (= actuellement puni) */
  exceeded: boolean;
}

export interface ListRateLimitOptions {
  onlyExceeded?: boolean;
  limiterKey?: string;
  search?: string;
  limit?: number;
}

export interface ListRateLimitResult {
  entries: RateLimitEntry[];
  total: number;
  truncated: boolean;
  redisAvailable: boolean;
}

function matchMeta(key: string): RateLimiterMeta | null {
  return REGISTRY_BY_SPECIFICITY.find((m) => key.startsWith(m.prefix)) || null;
}

function toEntry(key: string, count: number, ttl: number): RateLimitEntry {
  const meta = matchMeta(key);
  const max = meta?.max ?? null;
  return {
    key,
    limiterKey: meta?.key ?? null,
    limiterLabel: meta?.label ?? "Inconnu",
    identifier: meta ? key.slice(meta.prefix.length) : key.slice(RL_PREFIX.length),
    count,
    max,
    windowMs: meta?.windowMs ?? null,
    ttlSeconds: ttl,
    resetAt: ttl > 0 ? new Date(Date.now() + ttl * 1000).toISOString() : null,
    exceeded: max !== null && count >= max,
  };
}

function assertRlKey(key: string): void {
  // Borne stricte : on ne touche QUE les clés de rate limit.
  if (typeof key !== "string" || !key.startsWith(RL_PREFIX) || key.length <= RL_PREFIX.length) {
    throw new Error("INVALID_RATE_LIMIT_KEY");
  }
}

/**
 * Liste les compteurs de rate limit actifs dans Redis, enrichis et filtrés.
 */
export async function listRateLimitEntries(
  opts: ListRateLimitOptions = {},
): Promise<ListRateLimitResult> {
  const redis = getRedisClient();
  if (!redis) {
    return { entries: [], total: 0, truncated: false, redisAvailable: false };
  }

  const hardCap = Math.min(Math.max(opts.limit ?? 500, 1), 2000);
  // Plafond de scan pour éviter de balayer une base énorme indéfiniment.
  const SCAN_CAP = hardCap * 4;

  const keys: string[] = [];
  let cursor = "0";
  let truncated = false;

  do {
    const [next, batch] = (await (redis as any).scan(
      cursor,
      "MATCH",
      `${RL_PREFIX}*`,
      "COUNT",
      200,
    )) as [string, string[]];
    cursor = next;
    for (const k of batch) keys.push(k);
    if (keys.length >= SCAN_CAP) {
      truncated = true;
      break;
    }
  } while (cursor !== "0");

  if (keys.length === 0) {
    return { entries: [], total: 0, truncated, redisAvailable: true };
  }

  // Récupération count + TTL en une seule passe (pipeline) pour limiter les RTT.
  const pipeline = (redis as any).pipeline();
  for (const k of keys) {
    pipeline.get(k);
    pipeline.ttl(k);
  }
  const results = (await pipeline.exec()) as Array<[Error | null, unknown]>;

  const entries: RateLimitEntry[] = [];
  for (let i = 0; i < keys.length; i++) {
    const rawCount = results?.[i * 2]?.[1];
    const rawTtl = results?.[i * 2 + 1]?.[1];
    const count = parseInt(String(rawCount ?? "0"), 10) || 0;
    const ttl = typeof rawTtl === "number" ? rawTtl : -1;
    entries.push(toEntry(keys[i], count, ttl));
  }

  // Filtres
  let filtered = entries;
  if (opts.limiterKey) {
    filtered = filtered.filter((e) => e.limiterKey === opts.limiterKey);
  }
  if (opts.onlyExceeded) {
    filtered = filtered.filter((e) => e.exceeded);
  }
  if (opts.search) {
    const q = opts.search.toLowerCase();
    filtered = filtered.filter(
      (e) =>
        e.identifier.toLowerCase().includes(q) ||
        e.key.toLowerCase().includes(q),
    );
  }

  // Tri : punitions actives (dépassées) en tête, puis par compteur décroissant.
  filtered.sort(
    (a, b) => Number(b.exceeded) - Number(a.exceeded) || b.count - a.count,
  );

  const total = filtered.length;
  return {
    entries: filtered.slice(0, hardCap),
    total,
    truncated,
    redisAvailable: true,
  };
}

/**
 * Retire une punition : supprime la clé de rate limit (reset immédiat).
 */
export async function resetRateLimitKey(key: string): Promise<boolean> {
  assertRlKey(key);
  const redis = getRedisClient();
  if (!redis) throw new Error("REDIS_UNAVAILABLE");
  const deleted = await (redis as any).del(key);
  log.info("Punition rate-limit retirée", { key });
  return Number(deleted) > 0;
}

/**
 * Réduit/augmente une punition : ajuste le compteur (count) et/ou la durée (TTL).
 * Retourne l'entrée mise à jour, ou null si la clé n'existe pas / plus.
 */
export async function updateRateLimitKey(
  key: string,
  updates: { ttlSeconds?: number; count?: number },
): Promise<RateLimitEntry | null> {
  assertRlKey(key);
  const redis = getRedisClient();
  if (!redis) throw new Error("REDIS_UNAVAILABLE");

  const exists = await (redis as any).exists(key);
  if (!Number(exists)) return null;

  if (typeof updates.count === "number") {
    const next = Math.max(0, Math.floor(updates.count));
    // KEEPTTL : on ne modifie le compteur qu'en préservant l'expiration en cours.
    await (redis as any).set(key, String(next), "KEEPTTL");
  }
  if (typeof updates.ttlSeconds === "number" && updates.ttlSeconds > 0) {
    await (redis as any).expire(key, Math.floor(updates.ttlSeconds));
  }

  const [rawCount, rawTtl] = await Promise.all([
    (redis as any).get(key),
    (redis as any).ttl(key),
  ]);
  if (rawCount === null) return null; // expirée entre-temps
  const count = parseInt(String(rawCount ?? "0"), 10) || 0;
  const ttl = typeof rawTtl === "number" ? rawTtl : -1;
  log.info("Punition rate-limit ajustée", {
    key,
    count: updates.count,
    ttlSeconds: updates.ttlSeconds,
  });
  return toEntry(key, count, ttl);
}

/**
 * Métadonnées des limiters (pour alimenter les filtres du panel admin).
 */
export function getRateLimiterRegistry(): RateLimiterMeta[] {
  return RATE_LIMITER_REGISTRY;
}
