// ═══════════════════════════════════════════════════════════════════════════
// SERVICE DOWN MONITOR
// ═══════════════════════════════════════════════════════════════════════════
// Surveille les services critiques (Mongo, Redis). Si l'un est déconnecté
// pendant > 2 min sans reconnexion → notifyAllAdmins('admin_service_down').
// Try/catch silencieux si la BDD est down (la notif WS peut encore passer
// si Redis est up, sinon on log critique).
// ═══════════════════════════════════════════════════════════════════════════

import mongoose from "mongoose";
import { logger } from "./loggerService";
import RedisConnectionPool from "../config/redisPool";

const monitorLogger = logger.child({ service: "service-down-monitor" });

const DOWN_GRACE_MS = 2 * 60 * 1000; // 2 minutes

type ServiceKey = "mongo" | "redis";

const pendingTimers = new Map<ServiceKey, NodeJS.Timeout>();
const downSince = new Map<ServiceKey, Date>();

function clearPending(service: ServiceKey): void {
  const t = pendingTimers.get(service);
  if (t) {
    clearTimeout(t);
    pendingTimers.delete(service);
  }
  downSince.delete(service);
}

function schedule(service: ServiceKey): void {
  if (pendingTimers.has(service)) return;
  downSince.set(service, new Date());
  const timer = setTimeout(() => {
    void notifyServiceDown(service);
    pendingTimers.delete(service);
  }, DOWN_GRACE_MS);
  if (typeof timer.unref === "function") timer.unref();
  pendingTimers.set(service, timer);
}

async function notifyServiceDown(service: ServiceKey): Promise<void> {
  const since = downSince.get(service);
  const elapsedMin = since
    ? Math.floor((Date.now() - since.getTime()) / 60000)
    : DOWN_GRACE_MS / 60000;

  monitorLogger.critical("[SERVICE-DOWN] Service indisponible > 2 min", {
    service,
    elapsedMin,
  });

  try {
    const { notifyAllAdmins } = await import("./adminNotificationService");
    await notifyAllAdmins(
      "admin_service_down",
      "🚨 Service indisponible",
      `${service.toUpperCase()} déconnecté depuis ${elapsedMin} min sans reconnexion.`,
      {
        service,
        elapsedMin,
        dedupKey: `service-down:${service}`,
      },
    );
  } catch (err) {
    // Si Mongo est down, la persistance échoue — on log seulement.
    monitorLogger.critical(
      "[SERVICE-DOWN] Échec notifyAllAdmins (probablement BDD down)",
      {
        service,
        error: err instanceof Error ? err.message : String(err),
      },
    );
  }
}

export function startServiceDownMonitor(): void {
  // ─── MongoDB ──────────────────────────────────────────────────────────
  const conn = mongoose.connection;
  conn.on("disconnected", () => {
    monitorLogger.warn("[SERVICE-DOWN] Mongo disconnected — grace timer 2 min");
    schedule("mongo");
  });
  conn.on("connected", () => {
    if (pendingTimers.has("mongo") || downSince.has("mongo")) {
      monitorLogger.info(
        "[SERVICE-DOWN] Mongo reconnected — grace timer cancelled",
      );
    }
    clearPending("mongo");
  });
  conn.on("reconnected", () => {
    if (pendingTimers.has("mongo") || downSince.has("mongo")) {
      monitorLogger.info("[SERVICE-DOWN] Mongo reconnected (event)");
    }
    clearPending("mongo");
  });

  // ─── Redis ────────────────────────────────────────────────────────────
  const redisEnabled = process.env.REDIS_ENABLED !== "false";
  if (!redisEnabled) {
    monitorLogger.info("[SERVICE-DOWN] Redis désactivé — skip monitor");
    return;
  }

  let publisher;
  try {
    publisher = RedisConnectionPool.getPublisher();
  } catch {
    monitorLogger.warn(
      "[SERVICE-DOWN] Redis publisher indisponible — skip monitor",
    );
    return;
  }

  publisher.on("end", () => {
    monitorLogger.warn("[SERVICE-DOWN] Redis end — grace timer 2 min");
    schedule("redis");
  });
  publisher.on("close", () => {
    // 'close' peut être suivi d'une reconnexion automatique — on attend la grace
    if (publisher.status !== "ready" && publisher.status !== "connect") {
      schedule("redis");
    }
  });
  publisher.on("ready", () => {
    if (pendingTimers.has("redis") || downSince.has("redis")) {
      monitorLogger.info(
        "[SERVICE-DOWN] Redis ready — grace timer cancelled",
      );
    }
    clearPending("redis");
  });
  publisher.on("reconnecting", () => {
    // Pas de notif tant qu'on est dans la fenêtre de grace
    monitorLogger.debug("[SERVICE-DOWN] Redis reconnecting...");
  });

  monitorLogger.info("[SERVICE-DOWN] Monitor Mongo + Redis démarré");
}
