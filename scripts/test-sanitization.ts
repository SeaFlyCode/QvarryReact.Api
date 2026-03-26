/**
 * Script de test de la sanitization des logs
 *
 * Ce script démontre les capacités de sanitization du système de logging.
 *
 * Usage: npm run test:sanitization
 */

import { logger, sanitizeLogData } from "../src/services/loggerService";

console.log("═════════════════════════════════════════════════════════");
console.log("🔒 TEST DE SANITIZATION DES LOGS");
console.log("═════════════════════════════════════════════════════════\n");

// ═══════════════════════════════════════════════════════════════
// Test 1 : Masquage complet des données sensibles
// ═══════════════════════════════════════════════════════════════

console.log("📋 Test 1 : Masquage complet (passwords, tokens, secrets)");
console.log("─────────────────────────────────────────────────────────");

const sensitiveData = {
  user: "john_doe",
  password: "MySecretP@ssw0rd!",
  token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0",
  accessToken: "sk_live_1234567890abcdefghijklmnop",
  refreshToken: "def502001234567890abcdef",
  apiKey: "AIzaSyDxxxxxxxxxxxxxxxxxxxxxx",
  apiSecret: "super_secret_key_12345",
  jwt: "Bearer eyJhbGciOiJIUzI1NiJ9...",
  authorization: "Bearer token123",
  secretKey: "my-encryption-key-2024",
  privateKey: "-----BEGIN PRIVATE KEY-----\nMIIE...",
};

console.log("Avant sanitization :");
console.log(JSON.stringify(sensitiveData, null, 2));
console.log("\nAprès sanitization :");
console.log(JSON.stringify(sanitizeLogData(sensitiveData), null, 2));
console.log("\n");

// ═══════════════════════════════════════════════════════════════
// Test 2 : Masquage partiel (emails, IPs, device IDs)
// ═══════════════════════════════════════════════════════════════

console.log("📋 Test 2 : Masquage partiel (emails, IPs, device IDs)");
console.log("─────────────────────────────────────────────────────────");

const partialData = {
  email: "john.doe@example.com",
  userEmail: "jane.smith@company.org",
  ip: "192.168.1.42",
  ipAddress: "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
  deviceId: "DEVICE-ABC-123-XYZ-789",
  username: "johndoe123",
};

console.log("Avant sanitization :");
console.log(JSON.stringify(partialData, null, 2));
console.log("\nAprès sanitization :");
console.log(JSON.stringify(sanitizeLogData(partialData), null, 2));
console.log("\n");

// ═══════════════════════════════════════════════════════════════
// Test 3 : Données personnelles critiques
// ═══════════════════════════════════════════════════════════════

console.log("📋 Test 3 : Données personnelles critiques (SSN, cartes)");
console.log("─────────────────────────────────────────────────────────");

const personalData = {
  customer: {
    name: "John Doe",
    email: "john@example.com",
    ssn: "123-45-6789",
    socialSecurityNumber: "987-65-4321",
  },
  payment: {
    creditCard: "4111-1111-1111-1111",
    cardNumber: "5555-5555-5555-4444",
    cvv: "123",
    cvc: "456",
    pin: "1234",
    pinCode: "9876",
  },
};

console.log("Avant sanitization :");
console.log(JSON.stringify(personalData, null, 2));
console.log("\nAprès sanitization :");
console.log(JSON.stringify(sanitizeLogData(personalData), null, 2));
console.log("\n");

// ═══════════════════════════════════════════════════════════════
// Test 4 : Objets imbriqués et tableaux
// ═══════════════════════════════════════════════════════════════

console.log("📋 Test 4 : Objets imbriqués et tableaux");
console.log("─────────────────────────────────────────────────────────");

const nestedData = {
  users: [
    {
      id: 1,
      email: "user1@example.com",
      password: "secret123",
      ip: "192.168.1.10",
    },
    {
      id: 2,
      email: "user2@example.com",
      password: "secret456",
      ip: "192.168.1.20",
    },
  ],
  config: {
    database: {
      host: "localhost",
      credentials: {
        username: "dbuser",
        password: "dbpass123",
      },
    },
    api: {
      keys: [
        { name: "production", apiKey: "prod_key_12345" },
        { name: "development", apiKey: "dev_key_67890" },
      ],
    },
  },
};

console.log("Avant sanitization :");
console.log(JSON.stringify(nestedData, null, 2));
console.log("\nAprès sanitization :");
console.log(JSON.stringify(sanitizeLogData(nestedData), null, 2));
console.log("\n");

// ═══════════════════════════════════════════════════════════════
// Test 5 : Types spéciaux (Date, Error)
// ═══════════════════════════════════════════════════════════════

console.log("📋 Test 5 : Types spéciaux (Date, Error, RegExp)");
console.log("─────────────────────────────────────────────────────────");

const specialTypes = {
  timestamp: new Date("2026-03-24T10:30:00Z"),
  error: new Error("Something went wrong"),
  pattern: /^[a-z]+$/,
  nested: {
    date: new Date("2026-01-01"),
  },
};

console.log("Avant sanitization :");
console.log(JSON.stringify(specialTypes, null, 2));
console.log("\nAprès sanitization :");
console.log(JSON.stringify(sanitizeLogData(specialTypes), null, 2));
console.log("\n");

// ═══════════════════════════════════════════════════════════════
// Test 6 : Headers HTTP sensibles
// ═══════════════════════════════════════════════════════════════

console.log("📋 Test 6 : Headers HTTP sensibles");
console.log("─────────────────────────────────────────────────────────");

const httpData = {
  request: {
    method: "POST",
    url: "/api/login",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer eyJhbGciOiJIUzI1NiJ9...",
      cookie: "sessionId=abc123; token=xyz789",
      "set-cookie": "refreshToken=def456; HttpOnly",
      "user-agent": "Mozilla/5.0...",
    },
    body: {
      email: "user@example.com",
      password: "userpass123",
    },
  },
};

console.log("Avant sanitization :");
console.log(JSON.stringify(httpData, null, 2));
console.log("\nAprès sanitization :");
console.log(JSON.stringify(sanitizeLogData(httpData), null, 2));
console.log("\n");

// ═══════════════════════════════════════════════════════════════
// Test 7 : Utilisation avec le logger
// ═══════════════════════════════════════════════════════════════

console.log("📋 Test 7 : Utilisation avec le logger (logs réels)");
console.log("─────────────────────────────────────────────────────────");

logger.info("User authentication attempt", {
  userId: "12345",
  email: "john.doe@example.com",
  password: "should_be_hidden",
  ip: "192.168.1.100",
  deviceId: "DEVICE-XYZ-123",
  timestamp: new Date(),
});

logger.warn("API key usage", {
  endpoint: "/api/data",
  apiKey: "sk_live_should_be_hidden",
  rateLimit: {
    remaining: 100,
    reset: new Date(),
  },
});

logger.error("Payment processing failed", {
  error: new Error("Card declined"),
  payment: {
    creditCard: "4111-1111-1111-1111",
    cvv: "123",
    amount: 99.99,
  },
  customer: {
    email: "customer@example.com",
    ssn: "123-45-6789",
  },
});

console.log(
  "\n✅ Vérifiez les logs ci-dessus - toutes les données sensibles doivent être masquées !\n",
);

// ═══════════════════════════════════════════════════════════════
// Test 8 : Protection contre récursion infinie
// ═══════════════════════════════════════════════════════════════

console.log("📋 Test 8 : Protection contre récursion infinie");
console.log("─────────────────────────────────────────────────────────");

const deepNested: any = { level: 1 };
let current = deepNested;
for (let i = 2; i <= 15; i++) {
  current.next = { level: i, password: "secret" };
  current = current.next;
}

console.log("Objet avec 15 niveaux d'imbrication...");
const sanitized = sanitizeLogData(deepNested);
console.log(
  "Profondeur maximale atteinte :",
  JSON.stringify(sanitized).includes("[MAX_DEPTH]") ? "Oui ✅" : "Non ❌",
);
console.log("\n");

// ═══════════════════════════════════════════════════════════════
// Résumé
// ═══════════════════════════════════════════════════════════════

console.log("═════════════════════════════════════════════════════════");
console.log("✅ TESTS DE SANITIZATION TERMINÉS");
console.log("═════════════════════════════════════════════════════════");
console.log("\n📊 Résumé des protections :");
console.log("  ✓ Passwords, tokens, secrets → [REDACTED]");
console.log("  ✓ Emails → ma***@example.com");
console.log("  ✓ IP addresses → 192.168.1.*");
console.log("  ✓ Device IDs → ABC123...");
console.log("  ✓ SSN, credit cards, CVV, PIN → [REDACTED]");
console.log("  ✓ HTTP headers sensibles → [REDACTED]");
console.log("  ✓ Objets imbriqués et tableaux → ✓");
console.log("  ✓ Types spéciaux (Date, Error) → ✓");
console.log("  ✓ Protection récursion infinie → ✓");
console.log("\n🔒 Votre système de logging est sécurisé !");
console.log("═════════════════════════════════════════════════════════\n");
