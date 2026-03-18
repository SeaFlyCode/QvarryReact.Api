#!/usr/bin/env ts-node

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WEBSOCKET STATE RECOVERY SCRIPT
 * ═══════════════════════════════════════════════════════════════════════════
 * Admin tool pour inspecter, gérer et récupérer les états WebSocket persistés
 * Usage:
 *   npm run ws:state:list                          - Lister tous les états
 *   npm run ws:state:inspect -- --userId=<id>      - Inspecter l'état d'un user
 *   npm run ws:state:clear -- --olderThan=7d       - Nettoyer états anciens
 *   npm run ws:state:export -- --output=states.json - Exporter états en JSON
 *   npm run ws:state:count                         - Compter les états
 * ═══════════════════════════════════════════════════════════════════════════
 */

import dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

// Charger .env
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { webSocketStateService } from "../src/services/webSocketStateService";
import Redis from "ioredis";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const REDIS_ENABLED = process.env.REDIS_ENABLED === "true";
let redis: Redis | null = null;

if (REDIS_ENABLED) {
  redis = new Redis({
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || "0"),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// FONCTIONS UTILITAIRES
// ═══════════════════════════════════════════════════════════════════════════

function parseArgs(): {
  command: string;
  userId?: string;
  olderThan?: string;
  output?: string;
} {
  const args = process.argv.slice(2);
  const command = args[0] || "list";

  const parsed: any = { command };

  args.forEach((arg) => {
    if (arg.startsWith("--userId=")) {
      parsed.userId = arg.split("=")[1];
    } else if (arg.startsWith("--olderThan=")) {
      parsed.olderThan = arg.split("=")[1];
    } else if (arg.startsWith("--output=")) {
      parsed.output = arg.split("=")[1];
    }
  });

  return parsed;
}

function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([hdm])$/);
  if (!match) {
    throw new Error(`Format de durée invalide: ${duration} (ex: 7d, 24h, 60m)`);
  }

  const value = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case "d":
      return value * 24; // heures
    case "h":
      return value; // heures
    case "m":
      return value / 60; // minutes -> heures
    default:
      throw new Error(`Unité inconnue: ${unit}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// COMMANDES
// ═══════════════════════════════════════════════════════════════════════════

async function listStates() {
  console.log("📋 Liste des états WebSocket persistés\n");

  const keys = await webSocketStateService.getAllStateKeys();

  if (keys.length === 0) {
    console.log("❌ Aucun état trouvé");
    return;
  }

  console.log(`✅ ${keys.length} état(s) trouvé(s):\n`);

  for (const key of keys) {
    // Extraire userId et deviceId (format: ws:state:userId:deviceId)
    const parts = key.split(":");
    if (parts.length < 4) continue;

    const userId = parts[2];
    const deviceId = parts[3];

    const state = await webSocketStateService.getClientState(userId, deviceId);

    if (state) {
      const lastActivity = new Date(state.lastActivityAt);
      const minutesAgo = Math.floor(
        (Date.now() - lastActivity.getTime()) / 60000,
      );

      console.log(`  • User: ${userId}`);
      console.log(`    Device: ${deviceId.substring(0, 16)}...`);
      console.log(`    Subscriptions: ${state.subscriptions.length}`);
      console.log(`    Pending Messages: ${state.pendingMessages.length}`);
      console.log(
        `    Last Activity: ${lastActivity.toISOString()} (${minutesAgo}min ago)`,
      );
      console.log("");
    }
  }

  console.log(`📊 Total: ${keys.length} états`);
}

async function inspectState(userId: string) {
  console.log(`🔍 Inspection de l'état pour l'utilisateur: ${userId}\n`);

  // Trouver tous les devices pour cet utilisateur
  const allKeys = await webSocketStateService.getAllStateKeys();
  const userKeys = allKeys.filter((key) => key.includes(`:${userId}:`));

  if (userKeys.length === 0) {
    console.log("❌ Aucun état trouvé pour cet utilisateur");
    return;
  }

  console.log(`✅ ${userKeys.length} device(s) trouvé(s):\n`);

  for (const key of userKeys) {
    const parts = key.split(":");
    const deviceId = parts[3];

    const state = await webSocketStateService.getClientState(userId, deviceId);

    if (state) {
      console.log(`📱 Device: ${deviceId}`);
      console.log(
        `   Last Activity: ${new Date(state.lastActivityAt).toISOString()}`,
      );
      console.log(`   Subscriptions (${state.subscriptions.length}):`);
      state.subscriptions.forEach((sub) => {
        console.log(`     - ${sub}`);
      });
      console.log(`   Pending Messages (${state.pendingMessages.length}):`);
      state.pendingMessages.slice(0, 5).forEach((msg) => {
        console.log(
          `     - [${msg.id}] ${msg.type} at ${new Date(msg.timestamp).toISOString()}`,
        );
      });
      if (state.pendingMessages.length > 5) {
        console.log(`     ... et ${state.pendingMessages.length - 5} autres`);
      }
      console.log(`   Last Seen Message IDs:`);
      Object.entries(state.lastSeenMessageIds).forEach(([convId, msgId]) => {
        console.log(`     - ${convId}: ${msgId.substring(0, 16)}...`);
      });
      console.log("");
    }
  }
}

async function clearStaleStates(olderThan: string) {
  const hours = parseDuration(olderThan);

  console.log(
    `🧹 Nettoyage des états plus anciens que ${olderThan} (${hours}h)\n`,
  );

  const cleaned = await webSocketStateService.cleanupStaleStates(hours);

  console.log(`✅ ${cleaned} état(s) nettoyé(s)`);
}

async function exportStates(outputPath: string) {
  console.log(`📤 Export des états vers ${outputPath}\n`);

  const keys = await webSocketStateService.getAllStateKeys();
  const states: any[] = [];

  for (const key of keys) {
    const parts = key.split(":");
    if (parts.length < 4) continue;

    const userId = parts[2];
    const deviceId = parts[3];

    const state = await webSocketStateService.getClientState(userId, deviceId);

    if (state) {
      states.push({
        userId,
        deviceId,
        state,
      });
    }
  }

  const outputData = {
    exportedAt: new Date().toISOString(),
    count: states.length,
    states,
  };

  fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));

  console.log(`✅ ${states.length} état(s) exporté(s) vers ${outputPath}`);
}

async function countStates() {
  console.log("📊 Comptage des états WebSocket\n");

  const count = await webSocketStateService.countStates();
  const metrics = webSocketStateService.getMetrics();

  console.log(`Total des états: ${count}`);
  console.log(`Service activé: ${metrics.enabled ? "✅ Oui" : "❌ Non"}`);
  console.log(`\nMétriques:`);
  console.log(`  - Sauvegardes: ${metrics.saves}`);
  console.log(`  - Restaurations: ${metrics.restores}`);
  console.log(`  - Misses: ${metrics.misses}`);
  console.log(`  - Messages en attente: ${metrics.queued}`);
  console.log(`  - Messages livrés: ${metrics.delivered}`);
  console.log(`\nConfiguration:`);
  console.log(`  - TTL des états: ${metrics.stateTTL}h`);
  console.log(`  - TTL de livraison: ${metrics.deliveryTTL}s`);
}

async function showHelp() {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════╗
║           WebSocket State Recovery Tool - Aide                            ║
╚═══════════════════════════════════════════════════════════════════════════╝

Commandes disponibles:

  list                           Lister tous les états persistés
  inspect --userId=<id>          Inspecter l'état d'un utilisateur spécifique
  clear --olderThan=<duration>   Nettoyer les états plus anciens que la durée
  export --output=<file.json>    Exporter tous les états en JSON
  count                          Afficher le nombre d'états et les métriques
  help                           Afficher cette aide

Exemples:

  npm run ws:state:list
  npm run ws:state:inspect -- --userId=507f1f77bcf86cd799439011
  npm run ws:state:clear -- --olderThan=7d
  npm run ws:state:export -- --output=./states-backup.json
  npm run ws:state:count

Formats de durée (pour --olderThan):
  7d    = 7 jours
  24h   = 24 heures
  60m   = 60 minutes
  `);
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  try {
    if (!REDIS_ENABLED) {
      console.error("❌ Redis n'est pas activé (REDIS_ENABLED=false)");
      process.exit(1);
    }

    if (!webSocketStateService.isEnabled()) {
      console.error(
        "❌ Service de persistance WebSocket non activé (WS_STATE_ENABLED=false)",
      );
      process.exit(1);
    }

    const args = parseArgs();

    switch (args.command) {
      case "list":
        await listStates();
        break;

      case "inspect":
        if (!args.userId) {
          console.error("❌ --userId est requis");
          process.exit(1);
        }
        await inspectState(args.userId);
        break;

      case "clear":
        if (!args.olderThan) {
          console.error("❌ --olderThan est requis (ex: 7d, 24h, 60m)");
          process.exit(1);
        }
        await clearStaleStates(args.olderThan);
        break;

      case "export":
        if (!args.output) {
          console.error("❌ --output est requis (ex: states.json)");
          process.exit(1);
        }
        await exportStates(args.output);
        break;

      case "count":
        await countStates();
        break;

      case "help":
      default:
        await showHelp();
        break;
    }

    // Fermer Redis
    if (redis) {
      await redis.quit();
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Erreur:", error instanceof Error ? error.message : error);
    if (redis) {
      await redis.quit();
    }
    process.exit(1);
  }
}

main();
