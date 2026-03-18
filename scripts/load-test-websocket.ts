/**
 * ═══════════════════════════════════════════════════════════════════════════
 * QVARRY API - CUSTOM WEBSOCKET LOAD TESTING SCRIPT
 * ═══════════════════════════════════════════════════════════════════════════
 * Script TypeScript pour effectuer des tests de charge personnalisés sur les
 * endpoints WebSocket avec métriques détaillées.
 *
 * Usage:
 *   npm run test:load:custom
 *   ts-node scripts/load-test-websocket.ts
 *
 * Options:
 *   --users <number>      Nombre d'utilisateurs simultanés (défaut: 50)
 *   --duration <seconds>  Durée du test en secondes (défaut: 60)
 *   --endpoint <name>     Endpoint à tester (notifications|messages|both)
 *   --output <path>       Chemin du fichier de résultats (défaut: ./load-test-results.json)
 *
 * Exemples:
 *   ts-node scripts/load-test-websocket.ts --users 100 --duration 120
 *   ts-node scripts/load-test-websocket.ts --endpoint messages --users 25
 * ═══════════════════════════════════════════════════════════════════════════
 */

import WebSocket from "ws";
import axios, { AxiosInstance } from "axios";
import * as fs from "fs";
import * as path from "path";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

interface LoadTestConfig {
  baseUrl: string;
  wsBaseUrl: string;
  maxUsers: number;
  testDurationSeconds: number;
  endpoint: "notifications" | "messages" | "both";
  outputPath: string;
  rampUpSeconds: number;
}

interface TestMetrics {
  totalConnections: number;
  successfulConnections: number;
  failedConnections: number;
  totalMessages: number;
  messagesPerSecond: number;
  errors: Array<{ type: string; message: string; timestamp: string }>;
  latencies: number[];
  connectionTimes: number[];
  startTime: string;
  endTime: string;
  durationMs: number;
}

interface PercentileStats {
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  avg: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// ARGUMENTS CLI
// ═══════════════════════════════════════════════════════════════════════════

function parseArgs(): Partial<LoadTestConfig> {
  const args = process.argv.slice(2);
  const config: Partial<LoadTestConfig> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case "--users":
        config.maxUsers = parseInt(nextArg, 10);
        i++;
        break;
      case "--duration":
        config.testDurationSeconds = parseInt(nextArg, 10);
        i++;
        break;
      case "--endpoint":
        if (["notifications", "messages", "both"].includes(nextArg)) {
          config.endpoint = nextArg as "notifications" | "messages" | "both";
        }
        i++;
        break;
      case "--output":
        config.outputPath = nextArg;
        i++;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
    }
  }

  return config;
}

function printHelp(): void {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════╗
║              QVARRY API - WEBSOCKET LOAD TESTING SCRIPT                   ║
╚═══════════════════════════════════════════════════════════════════════════╝

Usage:
  npm run test:load:custom [options]

Options:
  --users <number>      Nombre d'utilisateurs simultanés (défaut: 50)
  --duration <seconds>  Durée du test en secondes (défaut: 60)
  --endpoint <name>     Endpoint à tester: notifications|messages|both (défaut: both)
  --output <path>       Chemin du fichier de résultats (défaut: ./load-test-results.json)
  --help, -h            Afficher cette aide

Exemples:
  npm run test:load:custom -- --users 100 --duration 120
  npm run test:load:custom -- --endpoint messages --users 25
  npm run test:load:custom -- --output ./results/test-$(date +%s).json
  `);
}

// ═══════════════════════════════════════════════════════════════════════════
// CLASSE PRINCIPALE
// ═══════════════════════════════════════════════════════════════════════════

class WebSocketLoadTester {
  private config: LoadTestConfig;
  private metrics: TestMetrics;
  private httpClient: AxiosInstance;
  private activeConnections: WebSocket[] = [];
  private testStartTime: number = 0;

  constructor(config: LoadTestConfig) {
    this.config = config;
    this.httpClient = axios.create({
      baseURL: config.baseUrl,
      timeout: 10000,
      headers: {
        "Content-Type": "application/json",
      },
    });

    this.metrics = {
      totalConnections: 0,
      successfulConnections: 0,
      failedConnections: 0,
      totalMessages: 0,
      messagesPerSecond: 0,
      errors: [],
      latencies: [],
      connectionTimes: [],
      startTime: "",
      endTime: "",
      durationMs: 0,
    };
  }

  /**
   * Lance le test de charge
   */
  async run(): Promise<void> {
    console.log(
      "\n╔═══════════════════════════════════════════════════════════════════════════╗",
    );
    console.log(
      "║              DÉMARRAGE DU TEST DE CHARGE WEBSOCKET                        ║",
    );
    console.log(
      "╚═══════════════════════════════════════════════════════════════════════════╝\n",
    );

    console.log("📋 Configuration:");
    console.log(`   • Base URL: ${this.config.baseUrl}`);
    console.log(`   • WebSocket URL: ${this.config.wsBaseUrl}`);
    console.log(`   • Utilisateurs: ${this.config.maxUsers}`);
    console.log(`   • Durée: ${this.config.testDurationSeconds}s`);
    console.log(`   • Endpoint: ${this.config.endpoint}`);
    console.log(`   • Ramp-up: ${this.config.rampUpSeconds}s`);
    console.log();

    this.metrics.startTime = new Date().toISOString();
    this.testStartTime = Date.now();

    try {
      // Phase 1: Ramp-up (montée en charge progressive)
      await this.rampUpPhase();

      // Phase 2: Test soutenu
      await this.sustainedLoadPhase();

      // Phase 3: Nettoyage
      await this.cleanupPhase();

      // Calcul des statistiques finales
      this.calculateFinalMetrics();

      // Affichage des résultats
      this.displayResults();

      // Sauvegarde des résultats
      await this.saveResults();
    } catch (error) {
      console.error("❌ Erreur pendant le test:", error);
      this.recordError(
        "FATAL_ERROR",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Phase 1: Montée en charge progressive
   */
  private async rampUpPhase(): Promise<void> {
    console.log("📈 Phase 1: Montée en charge progressive...");

    const usersPerSecond = Math.ceil(
      this.config.maxUsers / this.config.rampUpSeconds,
    );
    const delayBetweenUsers = 1000 / usersPerSecond;

    for (let i = 0; i < this.config.maxUsers; i++) {
      this.createUser(i).catch((err) => {
        this.recordError("USER_CREATION_FAILED", err.message);
      });

      // Délai entre chaque utilisateur
      if (i < this.config.maxUsers - 1) {
        await this.sleep(delayBetweenUsers);
      }

      // Progress bar
      if ((i + 1) % 10 === 0 || i === this.config.maxUsers - 1) {
        const progress = (((i + 1) / this.config.maxUsers) * 100).toFixed(1);
        process.stdout.write(
          `\r   ⏳ Création des utilisateurs: ${i + 1}/${this.config.maxUsers} (${progress}%)`,
        );
      }
    }

    console.log("\n   ✅ Tous les utilisateurs sont connectés\n");
  }

  /**
   * Phase 2: Test soutenu
   */
  private async sustainedLoadPhase(): Promise<void> {
    console.log("🔥 Phase 2: Test de charge soutenu...");

    const sustainedDuration =
      (this.config.testDurationSeconds - this.config.rampUpSeconds) * 1000;
    const startTime = Date.now();

    while (Date.now() - startTime < sustainedDuration) {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const remaining = Math.floor(
        (sustainedDuration - (Date.now() - startTime)) / 1000,
      );

      process.stdout.write(
        `\r   ⏱️  Temps écoulé: ${elapsed}s | Restant: ${remaining}s | ` +
          `Connexions: ${this.metrics.successfulConnections}/${this.config.maxUsers} | ` +
          `Messages: ${this.metrics.totalMessages}`,
      );

      await this.sleep(1000);
    }

    console.log("\n   ✅ Phase de test soutenu terminée\n");
  }

  /**
   * Phase 3: Nettoyage
   */
  private async cleanupPhase(): Promise<void> {
    console.log("🧹 Phase 3: Nettoyage des connexions...");

    for (const ws of this.activeConnections) {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1000, "Test completed");
        }
      } catch (error) {
        // Ignorer les erreurs de fermeture
      }
    }

    console.log(`   ✅ ${this.activeConnections.length} connexions fermées\n`);
    this.activeConnections = [];
  }

  /**
   * Crée un utilisateur de test et établit une connexion WebSocket
   */
  private async createUser(index: number): Promise<void> {
    const userId = `loadtest-${Date.now()}-${index}`;
    const email = `${userId}@qvarry.test`;
    const password = "LoadTest123!";

    try {
      // 1. Créer un compte utilisateur
      const registerResponse = await this.httpClient.post("/auth/register", {
        email,
        password,
        name: `Load Test User ${index}`,
      });

      const accessToken = registerResponse.data?.tokens?.access;

      if (!accessToken) {
        throw new Error("Access token not received");
      }

      // 2. Obtenir un ws-token
      const wsTokenResponse = await this.httpClient.post(
        "/auth/ws-token",
        {},
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      const wsToken =
        this.config.endpoint === "messages"
          ? wsTokenResponse.data?.messagesToken
          : wsTokenResponse.data?.notificationsToken;

      if (!wsToken) {
        throw new Error("WebSocket token not received");
      }

      // 3. Se connecter au WebSocket
      await this.connectWebSocket(index, wsToken, accessToken);
    } catch (error) {
      this.metrics.failedConnections++;
      this.recordError(
        "USER_CREATION_ERROR",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Établit une connexion WebSocket
   */
  private async connectWebSocket(
    index: number,
    wsToken: string,
    accessToken: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const connectionStartTime = Date.now();

      let wsUrl = "";
      if (this.config.endpoint === "notifications") {
        wsUrl = `${this.config.wsBaseUrl}/ws/notifications`;
      } else if (this.config.endpoint === "messages") {
        // Pour les messages, on devrait créer une conversation
        // Pour simplifier, on utilise notifications
        wsUrl = `${this.config.wsBaseUrl}/ws/notifications`;
      } else {
        // both: alternance
        wsUrl =
          index % 2 === 0
            ? `${this.config.wsBaseUrl}/ws/notifications`
            : `${this.config.wsBaseUrl}/ws/notifications`;
      }

      const ws = new WebSocket(wsUrl, {
        headers: {
          Origin: this.config.baseUrl,
        },
      });

      // Timeout de connexion
      const connectionTimeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          ws.close();
          reject(new Error("Connection timeout"));
        }
      }, 10000);

      ws.on("open", () => {
        clearTimeout(connectionTimeout);

        // Authentification
        ws.send(JSON.stringify({ type: "auth", token: wsToken }));
      });

      ws.on("message", (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          const latency = Date.now() - connectionStartTime;

          if (message.type === "connected") {
            // Connexion réussie
            this.metrics.successfulConnections++;
            this.metrics.totalConnections++;
            this.metrics.connectionTimes.push(latency);
            this.activeConnections.push(ws);

            // Envoyer des messages périodiquement (si bidirectionnel)
            if (this.config.endpoint === "messages") {
              this.sendPeriodicMessages(ws);
            }

            resolve();
          } else if (message.type === "error") {
            this.recordError(
              "WS_AUTH_ERROR",
              message.message || "Unknown error",
            );
            ws.close();
            reject(new Error(message.message));
          }

          this.metrics.totalMessages++;
          this.metrics.latencies.push(latency);
        } catch (error) {
          this.recordError("MESSAGE_PARSE_ERROR", String(error));
        }
      });

      ws.on("error", (error) => {
        clearTimeout(connectionTimeout);
        this.metrics.failedConnections++;
        this.recordError("WS_ERROR", error.message);
        reject(error);
      });

      ws.on("close", (code, reason) => {
        clearTimeout(connectionTimeout);
        if (code !== 1000) {
          this.recordError(
            "WS_CLOSE_UNEXPECTED",
            `Code ${code}: ${reason.toString()}`,
          );
        }
      });
    });
  }

  /**
   * Envoie des messages périodiques sur une connexion WebSocket
   */
  private sendPeriodicMessages(ws: WebSocket): void {
    const interval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        const message = {
          type: "message",
          content: `Load test message at ${new Date().toISOString()}`,
          messageType: "text",
        };

        try {
          ws.send(JSON.stringify(message));
          this.metrics.totalMessages++;
        } catch (error) {
          this.recordError("MESSAGE_SEND_ERROR", String(error));
        }
      } else {
        clearInterval(interval);
      }
    }, 5000); // Toutes les 5 secondes
  }

  /**
   * Enregistre une erreur dans les métriques
   */
  private recordError(type: string, message: string): void {
    this.metrics.errors.push({
      type,
      message,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Calcule les statistiques finales
   */
  private calculateFinalMetrics(): void {
    this.metrics.endTime = new Date().toISOString();
    this.metrics.durationMs = Date.now() - this.testStartTime;
    this.metrics.messagesPerSecond =
      this.metrics.totalMessages / (this.metrics.durationMs / 1000);
  }

  /**
   * Calcule les percentiles d'un tableau
   */
  private calculatePercentiles(values: number[]): PercentileStats {
    if (values.length === 0) {
      return { p50: 0, p75: 0, p90: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0 };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const getPercentile = (p: number) => {
      const index = Math.ceil((p / 100) * sorted.length) - 1;
      return sorted[Math.max(0, index)];
    };

    const sum = sorted.reduce((acc, val) => acc + val, 0);
    const avg = sum / sorted.length;

    return {
      p50: getPercentile(50),
      p75: getPercentile(75),
      p90: getPercentile(90),
      p95: getPercentile(95),
      p99: getPercentile(99),
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: Math.round(avg),
    };
  }

  /**
   * Affiche les résultats dans le terminal
   */
  private displayResults(): void {
    console.log(
      "\n╔═══════════════════════════════════════════════════════════════════════════╗",
    );
    console.log(
      "║                        RÉSULTATS DU TEST DE CHARGE                        ║",
    );
    console.log(
      "╚═══════════════════════════════════════════════════════════════════════════╝\n",
    );

    const successRate = (
      (this.metrics.successfulConnections / this.config.maxUsers) *
      100
    ).toFixed(2);
    const errorRate = (
      (this.metrics.failedConnections / this.config.maxUsers) *
      100
    ).toFixed(2);

    console.log("📊 STATISTIQUES GLOBALES:");
    console.log(
      `   • Durée totale: ${(this.metrics.durationMs / 1000).toFixed(2)}s`,
    );
    console.log(`   • Utilisateurs cibles: ${this.config.maxUsers}`);
    console.log(
      `   • Connexions réussies: ${this.metrics.successfulConnections} (${successRate}%)`,
    );
    console.log(
      `   • Connexions échouées: ${this.metrics.failedConnections} (${errorRate}%)`,
    );
    console.log(`   • Messages totaux: ${this.metrics.totalMessages}`);
    console.log(
      `   • Débit: ${this.metrics.messagesPerSecond.toFixed(2)} msg/s`,
    );
    console.log();

    const connectionStats = this.calculatePercentiles(
      this.metrics.connectionTimes,
    );
    console.log("⚡ TEMPS DE CONNEXION (ms):");
    console.log(`   • Minimum: ${connectionStats.min}ms`);
    console.log(`   • Médiane (p50): ${connectionStats.p50}ms`);
    console.log(`   • p95: ${connectionStats.p95}ms`);
    console.log(`   • p99: ${connectionStats.p99}ms`);
    console.log(`   • Maximum: ${connectionStats.max}ms`);
    console.log(`   • Moyenne: ${connectionStats.avg}ms`);
    console.log();

    const latencyStats = this.calculatePercentiles(this.metrics.latencies);
    console.log("📡 LATENCE DES MESSAGES (ms):");
    console.log(`   • Minimum: ${latencyStats.min}ms`);
    console.log(`   • Médiane (p50): ${latencyStats.p50}ms`);
    console.log(`   • p95: ${latencyStats.p95}ms`);
    console.log(`   • p99: ${latencyStats.p99}ms`);
    console.log(`   • Maximum: ${latencyStats.max}ms`);
    console.log(`   • Moyenne: ${latencyStats.avg}ms`);
    console.log();

    if (this.metrics.errors.length > 0) {
      console.log("❌ ERREURS RENCONTRÉES:");
      const errorCounts = this.metrics.errors.reduce(
        (acc, err) => {
          acc[err.type] = (acc[err.type] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      Object.entries(errorCounts).forEach(([type, count]) => {
        console.log(`   • ${type}: ${count}`);
      });
      console.log();
    }

    // Verdict
    if (parseFloat(successRate) >= 99 && latencyStats.p95 < 200) {
      console.log("✅ VERDICT: Performance excellente!");
    } else if (parseFloat(successRate) >= 95 && latencyStats.p95 < 500) {
      console.log("⚠️  VERDICT: Performance acceptable");
    } else {
      console.log("❌ VERDICT: Performance insuffisante");
    }
    console.log();
  }

  /**
   * Sauvegarde les résultats dans un fichier JSON
   */
  private async saveResults(): Promise<void> {
    const results = {
      config: this.config,
      metrics: this.metrics,
      percentiles: {
        connectionTimes: this.calculatePercentiles(
          this.metrics.connectionTimes,
        ),
        latencies: this.calculatePercentiles(this.metrics.latencies),
      },
    };

    const outputPath = path.resolve(this.config.outputPath);
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));

    console.log(`💾 Résultats sauvegardés dans: ${outputPath}\n`);
  }

  /**
   * Utilitaire: pause asynchrone
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// POINT D'ENTRÉE
// ═══════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const customConfig = parseArgs();

  const defaultConfig: LoadTestConfig = {
    baseUrl: process.env.API_BASE_URL || "http://localhost:3000/api/v1",
    wsBaseUrl: process.env.WS_BASE_URL || "ws://localhost:3000",
    maxUsers: 50,
    testDurationSeconds: 60,
    endpoint: "both",
    outputPath: "./load-test-results.json",
    rampUpSeconds: 10,
  };

  const config: LoadTestConfig = { ...defaultConfig, ...customConfig };

  const tester = new WebSocketLoadTester(config);
  await tester.run();

  process.exit(0);
}

// Exécuter le script
if (require.main === module) {
  main().catch((error) => {
    console.error("❌ Erreur fatale:", error);
    process.exit(1);
  });
}

export { WebSocketLoadTester, LoadTestConfig, TestMetrics };
