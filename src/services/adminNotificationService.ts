// ═══════════════════════════════════════════════════════════════════════════
// ADMIN NOTIFICATION SERVICE
// ═══════════════════════════════════════════════════════════════════════════
// Service dédié à l'envoi de notifications aux comptes admin avec :
//  - Rate limiting / dédup (5 min, par admin × type × dedupKey)
//  - Niveau P0/P1 → push direct (createNotification)
//  - Niveau P2 → BDD seule + soft throttle si > 5 admin_* dans la dernière heure
//  - Niveau P3 → BDD uniquement (digest, pas de push)
// ═══════════════════════════════════════════════════════════════════════════

import crypto from "crypto";
import mongoose from "mongoose";
import UserModel from "../models/users";
import NotificationModel from "../models/notifications";
import { createNotification } from "./notificationService";
import { getNotificationLevel } from "./notificationMapper";
import { logger } from "./loggerService";
import RedisConnectionPool from "../config/redisPool";
import type Redis from "ioredis";
import type { Cluster } from "ioredis";

const adminNotifLogger = logger.child({ service: "admin-notification" });

// ─── Types publics ────────────────────────────────────────────────────────

export type AdminNotificationType =
  | "admin_sos_unresolved"
  | "admin_security_breach"
  | "admin_service_down"
  | "admin_critical_audit"
  | "admin_user_report"
  | "admin_abuse_pattern"
  | "admin_quota_exceeded"
  | "admin_verification_pending"
  | "admin_sos_failed_sms"
  | "admin_sentry_high"
  | "admin_cron_failed"
  | "admin_metrics_anomaly"
  | "admin_daily_digest"
  | "admin_weekly_report";

export interface AdminNotifyResult {
  notified: number;
  throttled: number;
}

// ─── Configuration ────────────────────────────────────────────────────────

const DEDUP_TTL_SECONDS = 5 * 60; // 5 minutes
const SOFT_AGGREGATION_WINDOW_MS = 60 * 60 * 1000; // 1 heure
const SOFT_AGGREGATION_THRESHOLD = 5; // > 5 admin_* / heure → on n'envoie pas le push P2

// ─── Cache Redis ou fallback in-memory ────────────────────────────────────

interface DedupStore {
  setIfAbsent(key: string, ttlSeconds: number): Promise<boolean>;
}

class RedisDedupStore implements DedupStore {
  constructor(private client: Redis | Cluster) {}

  async setIfAbsent(key: string, ttlSeconds: number): Promise<boolean> {
    // SET key 1 NX EX ttl — atomique, retourne "OK" si la clé n'existait pas
    const result = await this.client.set(key, "1", "EX", ttlSeconds, "NX");
    return result === "OK";
  }
}

class InMemoryDedupStore implements DedupStore {
  private map = new Map<string, NodeJS.Timeout>();

  async setIfAbsent(key: string, ttlSeconds: number): Promise<boolean> {
    if (this.map.has(key)) {
      return false;
    }
    const timer = setTimeout(() => {
      this.map.delete(key);
    }, ttlSeconds * 1000);
    // Empêche le timer de garder le process en vie
    if (typeof timer.unref === "function") {
      timer.unref();
    }
    this.map.set(key, timer);
    return true;
  }
}

let dedupStore: DedupStore | null = null;

function getDedupStore(): DedupStore {
  if (dedupStore) return dedupStore;

  try {
    const client = RedisConnectionPool.getPublisher();
    dedupStore = new RedisDedupStore(client);
    adminNotifLogger.debug("[admin-notif] Dedup store: Redis");
  } catch {
    dedupStore = new InMemoryDedupStore();
    adminNotifLogger.warn(
      "[admin-notif] Redis indisponible — fallback dedup in-memory (non partagé entre instances)",
    );
  }
  return dedupStore;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function buildDedupKey(
  adminId: string,
  type: AdminNotificationType,
  data?: Record<string, any>,
): string {
  const explicit =
    data && typeof data.dedupKey === "string" ? data.dedupKey : null;

  if (explicit) {
    return `admin-notif:${adminId}:${type}:${explicit}`;
  }

  // Hash stable du contenu si pas de dedupKey explicite
  const stable = JSON.stringify({ type, data: data ?? {} });
  const digest = crypto
    .createHash("sha1")
    .update(stable)
    .digest("hex")
    .slice(0, 16);
  return `admin-notif:${adminId}:${type}:${digest}`;
}

async function countAdminNotificationsLastHour(
  adminId: mongoose.Types.ObjectId,
): Promise<number> {
  const since = new Date(Date.now() - SOFT_AGGREGATION_WINDOW_MS);
  return NotificationModel.countDocuments({
    userId: adminId,
    type: { $regex: /^admin_/ },
    createdAt: { $gte: since },
  }).maxTimeMS(2000);
}

async function persistDbOnly(
  adminId: mongoose.Types.ObjectId,
  type: AdminNotificationType,
  title: string,
  message: string,
  data?: Record<string, any>,
): Promise<void> {
  const notification = new NotificationModel({
    userId: adminId,
    type,
    title,
    message,
    read: false,
    createdAt: new Date(),
    relatedEntityId:
      data && typeof data.dedupKey === "string" ? data.dedupKey : undefined,
  });
  await notification.save();
}

// ─── API publique ─────────────────────────────────────────────────────────

/**
 * Envoie une notification admin à tous les comptes admin (`is_admin === true`).
 *
 * Comportement par niveau :
 *  - P0/P1 : push immédiat via createNotification (BDD + WebSocket + FCM)
 *  - P2    : BDD + push, sauf si l'admin a déjà reçu > 5 admin_* dans la dernière heure
 *            (soft throttle) — dans ce cas, BDD seule
 *  - P3    : BDD seule, pas de push (digest)
 *
 * Rate limiting : un admin ne reçoit pas deux fois la même notif (même type +
 * même `data.dedupKey`, ou hash du contenu) en moins de 5 minutes.
 */
export async function notifyAllAdmins(
  type: AdminNotificationType,
  title: string,
  message: string,
  data?: Record<string, any>,
): Promise<AdminNotifyResult> {
  const level = getNotificationLevel(type);

  // Récupérer tous les admins actifs (non bloqués)
  const admins = await UserModel.find({
    is_admin: true,
    is_blocked: { $ne: true },
  })
    .select("_id")
    .lean()
    .maxTimeMS(3000);

  if (admins.length === 0) {
    adminNotifLogger.warn("[admin-notif] Aucun admin actif trouvé", { type });
    return { notified: 0, throttled: 0 };
  }

  const store = getDedupStore();
  let notified = 0;
  let throttled = 0;

  for (const admin of admins) {
    const adminId = admin._id as mongoose.Types.ObjectId;
    const adminIdStr = adminId.toString();

    // ─── Rate limiting / dédup (5 min) ────────────────────────────────────
    const dedupKey = buildDedupKey(adminIdStr, type, data);
    let acquired = false;
    try {
      acquired = await store.setIfAbsent(dedupKey, DEDUP_TTL_SECONDS);
    } catch (err) {
      adminNotifLogger.warn("[admin-notif] Dedup store erreur — on envoie", {
        adminId: adminIdStr,
        type,
        error: err instanceof Error ? err.message : String(err),
      });
      acquired = true; // fail-open : mieux vaut une notif en double qu'aucune
    }

    if (!acquired) {
      throttled++;
      continue;
    }

    try {
      if (level === "P0" || level === "P1") {
        await createNotification(adminId, type, title, message, data);
        notified++;
      } else if (level === "P2") {
        const recentCount = await countAdminNotificationsLastHour(adminId);
        if (recentCount > SOFT_AGGREGATION_THRESHOLD) {
          // Trop de notifs récentes → BDD seule, pas de push
          await persistDbOnly(adminId, type, title, message, data);
          throttled++;
          adminNotifLogger.debug(
            "[admin-notif] Soft throttle P2 — BDD seule",
            { adminId: adminIdStr, type, recentCount },
          );
        } else {
          await createNotification(adminId, type, title, message, data);
          notified++;
        }
      } else {
        // P3 — digest : BDD uniquement
        await persistDbOnly(adminId, type, title, message, data);
        notified++;
      }
    } catch (err) {
      adminNotifLogger.error("[admin-notif] Échec d'envoi à un admin", {
        adminId: adminIdStr,
        type,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  adminNotifLogger.info("[admin-notif] Notification admin diffusée", {
    type,
    level,
    adminCount: admins.length,
    notified,
    throttled,
  });

  return { notified, throttled };
}
