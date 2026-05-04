import mongoose from "mongoose";
import { getErrorMessage } from "../utils/errorUtils";
import { logger } from "../services/loggerService";

const dbLogger = logger.child({ service: "database" });

/**
 * Masque les credentials dans une connection string MongoDB
 * Transforme: mongodb+srv://user:password@cluster... en mongodb+srv://user:***@cluster...
 */
function maskConnectionString(connString: string): string {
  return connString.replace(/:([^:@]+)@/, ":***@");
}

export async function connectToDatabase() {
  const dbName = process.env.DB_NAME || "QvarryStorage";
  const dbConnString = process.env.DB_CONN_STRING || "";
  const isProduction = process.env.NODE_ENV === "production";

  // SSL/TLS: activé par défaut en production (opt-out avec DB_SSL=false)
  // En dev/test: désactivé par défaut (opt-in avec DB_SSL=true)
  const enableSSL = isProduction
    ? process.env.DB_SSL !== "false"
    : process.env.DB_SSL === "true";

  dbLogger.info("Database SSL configuration", {
    sslEnabled: enableSSL,
    dbSSLEnv: process.env.DB_SSL ?? "undefined",
    nodeEnv: process.env.NODE_ENV ?? "undefined",
  });

  if (!dbConnString) {
    dbLogger.error("Missing DB_CONN_STRING environment variable");
    throw new Error("Missing DB_CONN_STRING env variable");
  }

  // Options de sécurité MongoDB
  const mongoOptions: mongoose.ConnectOptions = {
    dbName,
    // Timeouts pour éviter les connexions infinies (plus longs en production)
    serverSelectionTimeoutMS: isProduction ? 30000 : 5000, // 30s en prod, 5s en dev
    socketTimeoutMS: 45000, // Timeout socket: 45s
    connectTimeoutMS: isProduction ? 30000 : 10000, // 30s en prod, 10s en dev
    // Pool de connexions
    maxPoolSize: isProduction ? 50 : 10, // LOW-04: Pool adapté à l'environnement
    minPoolSize: isProduction ? 10 : 2, // LOW-04: Min connexions maintenues
    // Sécurité écriture
    retryWrites: true,
    w: "majority", // Confirmation écriture majorité
    // SSL/TLS configurable
    ...(enableSSL && {
      tls: true, // TLS standard (ssl: true est legacy)
    }),
    // Force IPv4 pour éviter les problèmes DNS IPv6 dans Docker Alpine
    family: 4,
  };

  // Configuration retry avec exponential backoff
  const maxRetries = isProduction ? 5 : 2;
  const retryDelays = isProduction
    ? [3000, 6000, 12000, 24000, 48000] // 3s, 6s, 12s, 24s, 48s
    : [1000, 2000]; // 1s, 2s

  let lastError: Error | unknown = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await mongoose.connect(dbConnString, mongoOptions);
      dbLogger.info("Database connected", {
        dbName,
        ssl: enableSSL,
        attempt,
      });

      // Activer le slow-query log en production (cf. fix.md backend #3c).
      // Toutes les requêtes > 100 ms partent dans `system.profile` et peuvent
      // être grepées via `db.system.profile.find().sort({ ts: -1 })`.
      if (isProduction && mongoose.connection.db) {
        try {
          const slowMs = parseInt(process.env.MONGO_SLOW_QUERY_MS ?? "100", 10);
          await mongoose.connection.db.command({ profile: 1, slowms: slowMs });
          dbLogger.info("MongoDB slow query profiling activé", { slowMs });
        } catch (profileErr) {
          dbLogger.warn("Impossible d'activer le slow query profiling", {
            error: getErrorMessage(profileErr),
          });
        }
      }

      return; // Succès, on sort de la fonction
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries) {
        const delay = retryDelays[attempt - 1];
        dbLogger.warn("Database connection attempt failed, retrying...", {
          attempt,
          maxRetries,
          nextRetryInMs: delay,
          error:
            error instanceof Error ? getErrorMessage(error) : "Unknown error",
        });
        // Attendre avant le prochain essai
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  // Si on arrive ici, toutes les tentatives ont échoué
  // SÉCURITÉ: Ne jamais afficher la connection string avec les credentials
  const maskedConnString = maskConnectionString(dbConnString);
  dbLogger.error("Database connection failed after all retries", {
    maskedConnString,
    maxRetries,
    error:
      lastError instanceof Error ? getErrorMessage(lastError) : "Unknown error",
  });
  throw new Error("Database connection failed");
}
