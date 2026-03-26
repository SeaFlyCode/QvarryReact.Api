// scripts/test-phase4-logging.ts
// Script de test manuel pour valider les utilitaires de logging Phase 4

import { logger } from "../src/services/loggerService";
import {
  logPerformance,
  measureTime,
  startTimer,
  PERFORMANCE_THRESHOLDS,
} from "../src/utils/performanceLogger";
import {
  createContextLogger,
  createServiceLogger,
  createOperationLogger,
} from "../src/utils/contextLogger";

console.log("═══════════════════════════════════════════════════════");
console.log("🧪 Test Phase 4 - Utilitaires de Logging");
console.log("═══════════════════════════════════════════════════════\n");

// ════════════════════════════════════════════════════════
// Test 1 : Performance Logger - Opération rapide
// ════════════════════════════════════════════════════════

async function testPerformanceLoggerFast() {
  console.log("📊 Test 1 : Performance Logger - Opération rapide");

  const { result, duration, performanceLevel } = await logPerformance(
    "fastOperation",
    async () => {
      // Simuler une opération rapide (50ms)
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { success: true };
    },
    {
      slowThreshold: 1000,
      context: { testId: "test-1" },
    },
  );

  console.log(`✅ Résultat: ${JSON.stringify(result)}`);
  console.log(`⏱️  Durée: ${duration}ms`);
  console.log(`📈 Niveau: ${performanceLevel}`);
  console.log("Attendu: performanceLevel = 'fast'\n");
}

// ════════════════════════════════════════════════════════
// Test 2 : Performance Logger - Opération lente
// ════════════════════════════════════════════════════════

async function testPerformanceLoggerSlow() {
  console.log("📊 Test 2 : Performance Logger - Opération lente");

  const { result, duration, performanceLevel } = await logPerformance(
    "slowOperation",
    async () => {
      // Simuler une opération lente (1500ms)
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return { success: true };
    },
    {
      slowThreshold: 1000,
      context: { testId: "test-2" },
    },
  );

  console.log(`✅ Résultat: ${JSON.stringify(result)}`);
  console.log(`⏱️  Durée: ${duration}ms`);
  console.log(`📈 Niveau: ${performanceLevel}`);
  console.log("Attendu: performanceLevel = 'slow', warning dans les logs\n");
}

// ════════════════════════════════════════════════════════
// Test 3 : Performance Logger - logOnlyIfSlow
// ════════════════════════════════════════════════════════

async function testPerformanceLoggerOnlyIfSlow() {
  console.log("📊 Test 3 : Performance Logger - logOnlyIfSlow (rapide)");

  const { duration, performanceLevel } = await logPerformance(
    "silentFastOperation",
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { success: true };
    },
    {
      logOnlyIfSlow: true,
      slowThreshold: 500,
      context: { testId: "test-3" },
    },
  );

  console.log(`⏱️  Durée: ${duration}ms`);
  console.log(`📈 Niveau: ${performanceLevel}`);
  console.log("Attendu: PAS de log (opération rapide avec logOnlyIfSlow)\n");
}

// ════════════════════════════════════════════════════════
// Test 4 : measureTime (sans logging)
// ════════════════════════════════════════════════════════

async function testMeasureTime() {
  console.log("📊 Test 4 : measureTime (sans logging automatique)");

  const { result, duration } = await measureTime(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { data: "test" };
  });

  console.log(`✅ Résultat: ${JSON.stringify(result)}`);
  console.log(`⏱️  Durée: ${duration}ms`);
  console.log("Attendu: Pas de log automatique, uniquement mesure\n");
}

// ════════════════════════════════════════════════════════
// Test 5 : startTimer (timer manuel)
// ════════════════════════════════════════════════════════

async function testStartTimer() {
  console.log("📊 Test 5 : startTimer (timer manuel)");

  const timer = startTimer("manualOperation", { testId: "test-5" });

  // Simuler plusieurs étapes
  await new Promise((resolve) => setTimeout(resolve, 100));
  console.log("  ⏳ Étape 1 terminée...");

  await new Promise((resolve) => setTimeout(resolve, 150));
  console.log("  ⏳ Étape 2 terminée...");

  const duration = timer.stop({ additionalInfo: "completed" });

  console.log(`⏱️  Durée totale: ${duration}ms`);
  console.log("Attendu: Log automatique avec durée ~250ms\n");
}

// ════════════════════════════════════════════════════════
// Test 6 : Context Logger
// ════════════════════════════════════════════════════════

async function testContextLogger() {
  console.log("📊 Test 6 : Context Logger");

  const log = createContextLogger({
    controller: "TestController",
    action: "testAction",
    userId: "test-user-123",
  });

  log.info("Message avec contexte pré-rempli");
  log.debug("Debug message", { additionalData: "extra" });
  log.warn("Warning message");

  console.log("Attendu: 3 logs avec controller, action, userId automatiques\n");
}

// ════════════════════════════════════════════════════════
// Test 7 : Service Logger
// ════════════════════════════════════════════════════════

async function testServiceLogger() {
  console.log("📊 Test 7 : Service Logger");

  const log = createServiceLogger("TestService");

  log.info("Service démarré");
  log.info("Traitement en cours", { itemCount: 42 });
  log.info("Service terminé");

  console.log("Attendu: 3 logs avec service: 'TestService' automatique\n");
}

// ════════════════════════════════════════════════════════
// Test 8 : Operation Logger (avec auto-enrichissement)
// ════════════════════════════════════════════════════════

async function testOperationLogger() {
  console.log("📊 Test 8 : Operation Logger (enrichissement automatique)");

  const log = createOperationLogger("testOperation", { orderId: "order-456" });

  log.info("Début de l'opération");
  log.debug("Étape intermédiaire", { step: 2 });
  log.info("Opération terminée");

  console.log(
    "Attendu: 3 logs avec operation: 'testOperation' et orderId automatiques\n",
  );
}

// ════════════════════════════════════════════════════════
// Test 9 : Child Logger (héritage de contexte)
// ════════════════════════════════════════════════════════

async function testChildLogger() {
  console.log("📊 Test 9 : Child Logger (héritage de contexte)");

  const parentLog = createContextLogger({
    service: "ParentService",
    userId: "user-789",
  });

  parentLog.info("Parent log");

  const childLog = parentLog.child({ action: "childAction" });
  childLog.info("Child log");

  console.log(
    "Attendu: Parent log avec service+userId, Child log avec service+userId+action\n",
  );
}

// ════════════════════════════════════════════════════════
// Test 10 : Performance Thresholds
// ════════════════════════════════════════════════════════

async function testPerformanceThresholds() {
  console.log("📊 Test 10 : Vérification des seuils de performance");

  console.log(`FAST:     < ${PERFORMANCE_THRESHOLDS.FAST}ms`);
  console.log(`NORMAL:   < ${PERFORMANCE_THRESHOLDS.NORMAL}ms`);
  console.log(`SLOW:     < ${PERFORMANCE_THRESHOLDS.SLOW}ms`);
  console.log(`CRITICAL: >= ${PERFORMANCE_THRESHOLDS.CRITICAL}ms`);
  console.log("✅ Seuils définis correctement\n");
}

// ════════════════════════════════════════════════════════
// Exécution de tous les tests
// ════════════════════════════════════════════════════════

async function runAllTests() {
  try {
    await testPerformanceLoggerFast();
    await testPerformanceLoggerSlow();
    await testPerformanceLoggerOnlyIfSlow();
    await testMeasureTime();
    await testStartTimer();
    await testContextLogger();
    await testServiceLogger();
    await testOperationLogger();
    await testChildLogger();
    await testPerformanceThresholds();

    console.log("═══════════════════════════════════════════════════════");
    console.log("✅ Tous les tests sont terminés !");
    console.log("═══════════════════════════════════════════════════════");
    console.log("\n📋 Vérifiez les logs dans:");
    console.log("   - Console (logs colorés)");
    console.log("   - logs/app-YYYY-MM-DD.log (logs JSON structurés)");
    console.log("   - logs/error-YYYY-MM-DD.log (erreurs uniquement)");
    console.log("\n🔍 Rechercher dans les logs:");
    console.log('   grep "PERF" logs/app-*.log');
    console.log('   grep "TestController" logs/app-*.log');
    console.log('   grep "slowOperation" logs/app-*.log');
  } catch (error) {
    console.error("❌ Erreur lors des tests:", error);
    process.exit(1);
  }
}

// Lancer les tests
runAllTests();
