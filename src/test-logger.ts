// Test rapide du système de logging
// Exécuter avec: npx ts-node src/test-logger.ts

import { logger, sanitizeLogData } from "./services/loggerService";

console.log("\n=".repeat(60));
console.log("🧪 TEST DU SYSTÈME DE LOGGING");
console.log("=".repeat(60) + "\n");

// Test 1: Logging basique
console.log("📝 Test 1: Logging basique\n");
logger.debug("Message de debug");
logger.info("Message d'information");
logger.warn("Message d'avertissement");
logger.error("Message d'erreur");
logger.critical("Message critique");

// Test 2: Logging avec métadonnées
console.log("\n📦 Test 2: Logging avec métadonnées\n");
logger.info("Serveur démarré", { port: 3000, env: "test" });
logger.error("Erreur de connexion", { error: "Connection timeout", retry: 3 });

// Test 3: Child logger
console.log("\n👶 Test 3: Child logger avec contexte\n");
const authLogger = logger.child({ service: "auth" });
authLogger.info("Login réussi", { userId: "123" });
authLogger.warn("Tentative échouée", { userId: "456", attempts: 3 });

// Test 4: Sanitisation des données sensibles
console.log("\n🔒 Test 4: Sanitisation des données sensibles\n");
const sensitiveData = {
  email: "user@example.com",
  password: "super-secret-123",
  token: "jwt-token-here",
  apiKey: "api-key-secret",
  name: "John Doe",
};

console.log("Avant sanitisation:", sensitiveData);
const sanitized = sanitizeLogData(sensitiveData);
console.log("Après sanitisation:", sanitized);

logger.info("Login avec données sensibles", sensitiveData);

// Test 5: Données imbriquées
console.log("\n🪆 Test 5: Données imbriquées\n");
const nestedData = {
  user: {
    id: "123",
    email: "user@example.com",
    credentials: {
      password: "secret",
      apiKey: "key-123",
    },
  },
  session: {
    token: "session-token",
    refreshToken: "refresh-token",
  },
};

logger.info("Données imbriquées", nestedData);

// Test 6: Tableaux
console.log("\n📋 Test 6: Tableaux\n");
const arrayData = {
  users: [
    { id: "1", email: "user1@example.com", password: "pass1" },
    { id: "2", email: "user2@example.com", password: "pass2" },
  ],
};

logger.info("Données en tableau", arrayData);

console.log("\n" + "=".repeat(60));
console.log("✅ TESTS TERMINÉS");
console.log("=".repeat(60));
console.log("\nVérifiez les logs dans le dossier: logs/");
console.log("- logs/app-YYYY-MM-DD.log (tous les logs)");
console.log("- logs/error-YYYY-MM-DD.log (erreurs uniquement)\n");
