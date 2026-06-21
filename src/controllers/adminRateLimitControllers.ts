// ═══════════════════════════════════════════════════════════════════════════
// CONTRÔLEURS ADMIN — RATE LIMITER / PUNITIONS
// ═══════════════════════════════════════════════════════════════════════════
// Panel admin : visualiser et gérer les punitions du rate limiter.
//  - Rate limits Redis (compteurs `rl:*`) : lister / reset / ajuster (TTL, count)
//  - Blocages IP (MongoDB) : durée modifiable (les list/block/unblock vivent
//    déjà dans adminControllers)
// Toutes ces routes sont montées sous /admin (authMiddleware + adminMiddleware).
// ═══════════════════════════════════════════════════════════════════════════

import { Request, Response } from "express";
import { z } from "zod";
import { logger } from "../services/loggerService";
import { auditService } from "../services/auditService";
import { securityAlertService } from "../services/securityAlertService";
import {
  listRateLimitEntries,
  resetRateLimitKey,
  updateRateLimitKey,
  getRateLimiterRegistry,
} from "../services/adminRateLimitService";

const rlLogger = logger.child({ service: "admin-rate-limit-ctrl" });

// Borne haute du TTL ajustable : 7 jours (évite les punitions « infinies » par erreur).
const MAX_TTL_SECONDS = 7 * 24 * 60 * 60;

const rlKeySchema = z
  .string()
  .min(4)
  .startsWith("rl:", "La clé doit être une clé de rate limit (préfixe rl:)");

const updateEntrySchema = z
  .object({
    key: rlKeySchema,
    ttlSeconds: z.number().int().positive().max(MAX_TTL_SECONDS).optional(),
    count: z.number().int().min(0).max(1_000_000).optional(),
  })
  .refine((d) => d.ttlSeconds !== undefined || d.count !== undefined, {
    message: "Fournir au moins `ttlSeconds` ou `count`.",
  });

const blockDurationSchema = z.object({
  // null = blocage permanent ; nombre d'heures > 0 sinon.
  durationHours: z
    .number()
    .positive()
    .max(24 * 365)
    .nullable(),
});

/**
 * GET /admin/rate-limit/entries
 * Liste les compteurs de rate limit actifs (Redis).
 * Query: ?onlyExceeded=true&limiterKey=auth&search=1.2.3.4&limit=500
 */
export async function getRateLimitEntries(req: Request, res: Response) {
  try {
    const onlyExceeded = req.query.onlyExceeded === "true";
    const limiterKey = (req.query.limiterKey as string) || undefined;
    const search = (req.query.search as string) || undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 500, 2000);

    const result = await listRateLimitEntries({
      onlyExceeded,
      limiterKey,
      search,
      limit,
    });

    if (!result.redisAvailable) {
      return res.status(503).json({
        error: "Redis indisponible — impossible de lire les rate limits.",
        code: "REDIS_UNAVAILABLE",
      });
    }

    res.status(200).json({
      success: true,
      entries: result.entries,
      count: result.entries.length,
      total: result.total,
      truncated: result.truncated,
      limiters: getRateLimiterRegistry().map((m) => ({
        key: m.key,
        label: m.label,
        windowMs: m.windowMs,
        max: m.max,
      })),
    });
  } catch (error) {
    rlLogger.error("[ADMIN] Erreur liste rate limits", {
      error: error instanceof Error ? error.message : String(error),
    });
    res
      .status(500)
      .json({ error: "Erreur lors de la récupération des rate limits." });
  }
}

/**
 * DELETE /admin/rate-limit/entries
 * Retire une punition (supprime la clé Redis). Body: { key }
 */
export async function deleteRateLimitEntry(req: Request, res: Response) {
  try {
    const parsed = rlKeySchema.safeParse((req.body ?? {}).key);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Clé de rate limit invalide.", code: "INVALID_KEY" });
    }
    const key = parsed.data;

    const removed = await resetRateLimitKey(key);
    if (!removed) {
      return res
        .status(404)
        .json({ error: "Clé introuvable ou déjà expirée.", code: "NOT_FOUND" });
    }

    await auditService.log({
      userId: req.user?.id,
      action: "ADMIN_RATE_LIMIT_RESET",
      level: "warning",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      details: { key },
    });

    res.status(200).json({ success: true, key });
  } catch (error) {
    if (error instanceof Error && error.message === "REDIS_UNAVAILABLE") {
      return res
        .status(503)
        .json({ error: "Redis indisponible.", code: "REDIS_UNAVAILABLE" });
    }
    rlLogger.error("[ADMIN] Erreur reset rate limit", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: "Erreur lors du reset du rate limit." });
  }
}

/**
 * PATCH /admin/rate-limit/entries
 * Réduit/augmente une punition. Body: { key, ttlSeconds?, count? }
 */
export async function patchRateLimitEntry(req: Request, res: Response) {
  try {
    const parsed = updateEntrySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || "Requête invalide.",
        code: "INVALID_BODY",
      });
    }
    const { key, ttlSeconds, count } = parsed.data;

    const updated = await updateRateLimitKey(key, { ttlSeconds, count });
    if (!updated) {
      return res
        .status(404)
        .json({ error: "Clé introuvable ou déjà expirée.", code: "NOT_FOUND" });
    }

    await auditService.log({
      userId: req.user?.id,
      action: "ADMIN_RATE_LIMIT_UPDATED",
      level: "warning",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      details: { key, ttlSeconds, count },
    });

    res.status(200).json({ success: true, entry: updated });
  } catch (error) {
    if (error instanceof Error && error.message === "REDIS_UNAVAILABLE") {
      return res
        .status(503)
        .json({ error: "Redis indisponible.", code: "REDIS_UNAVAILABLE" });
    }
    rlLogger.error("[ADMIN] Erreur update rate limit", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: "Erreur lors de l'ajustement du rate limit." });
  }
}

/**
 * PATCH /admin/security/blocked-ips/:ipAddress
 * Réduit/augmente la durée d'un blocage IP. Body: { durationHours: number|null }
 */
export async function patchBlockedIpDuration(req: Request, res: Response) {
  try {
    const { ipAddress } = req.params;
    if (!ipAddress) {
      return res.status(400).json({ error: "Adresse IP requise." });
    }

    const parsed = blockDurationSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || "Durée invalide.",
        code: "INVALID_BODY",
      });
    }

    const updated = await securityAlertService.updateBlockedIpDuration(
      ipAddress,
      parsed.data.durationHours,
    );
    if (!updated) {
      return res
        .status(404)
        .json({ error: "Blocage actif introuvable pour cette IP.", code: "NOT_FOUND" });
    }

    await auditService.log({
      userId: req.user?.id,
      action: "ADMIN_IP_BLOCK_DURATION_UPDATED",
      level: "warning",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      details: { targetIp: ipAddress, durationHours: parsed.data.durationHours },
    });

    res.status(200).json({ success: true, blockedIp: updated });
  } catch (error) {
    rlLogger.error("[ADMIN] Erreur update durée blocage IP", {
      error: error instanceof Error ? error.message : String(error),
    });
    res
      .status(500)
      .json({ error: "Erreur lors de la mise à jour de la durée de blocage." });
  }
}
