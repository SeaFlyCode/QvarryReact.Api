#!/usr/bin/env ts-node
/**
 * Script de vérification de la fonctionnalité Photos GPS
 * Vérifie que tous les services, middlewares et contrôleurs sont bien intégrés
 */

import * as fs from "fs";
import * as path from "path";

interface VerificationResult {
  name: string;
  status: "OK" | "ERROR" | "WARNING";
  message: string;
}

const results: VerificationResult[] = [];

function verify(name: string, condition: boolean, errorMessage: string): void {
  if (condition) {
    results.push({ name, status: "OK", message: "✓ Présent" });
  } else {
    results.push({ name, status: "ERROR", message: `✗ ${errorMessage}` });
  }
}

function verifyFileExists(name: string, filePath: string): void {
  const fullPath = path.join(__dirname, "..", filePath);
  verify(name, fs.existsSync(fullPath), `Fichier manquant: ${filePath}`);
}

function verifyFileContains(
  name: string,
  filePath: string,
  searchString: string,
): void {
  const fullPath = path.join(__dirname, "..", filePath);
  if (!fs.existsSync(fullPath)) {
    results.push({
      name,
      status: "ERROR",
      message: `✗ Fichier manquant: ${filePath}`,
    });
    return;
  }
  const content = fs.readFileSync(fullPath, "utf-8");
  verify(
    name,
    content.includes(searchString),
    `Contenu manquant dans ${filePath}: "${searchString}"`,
  );
}

console.log("🔍 Vérification de la fonctionnalité Photos GPS\n");
console.log("═".repeat(70));

// ═══════════════════════════════════════════════════════════════════════════
// 1. CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n📋 Configuration");
console.log("─".repeat(70));
verifyFileExists("storageConfig.ts", "src/config/storageConfig.ts");
verifyFileContains(
  ".env.example - STORAGE_PATH",
  ".env.example",
  "STORAGE_PATH",
);
verifyFileContains(
  ".env.example - STORAGE_DEFAULT_QUOTA_GB",
  ".env.example",
  "STORAGE_DEFAULT_QUOTA_GB",
);

// ═══════════════════════════════════════════════════════════════════════════
// 2. SERVICES
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n🛠️  Services");
console.log("─".repeat(70));
verifyFileExists(
  "imageProcessingService.ts",
  "src/services/imageProcessingService.ts",
);
verifyFileExists("storageService.ts", "src/services/storageService.ts");
verifyFileExists(
  "storageQuotaService.ts",
  "src/services/storageQuotaService.ts",
);

// ═══════════════════════════════════════════════════════════════════════════
// 3. MIDDLEWARES
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n🚦 Middlewares");
console.log("─".repeat(70));
verifyFileExists(
  "imageUploadMiddleware.ts",
  "src/middlewares/imageUploadMiddleware.ts",
);
verifyFileExists(
  "storageQuotaMiddleware.ts",
  "src/middlewares/storageQuotaMiddleware.ts",
);

// ═══════════════════════════════════════════════════════════════════════════
// 4. CONTRÔLEURS
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n🎮 Contrôleurs");
console.log("─".repeat(70));
verifyFileExists(
  "pointsPhotosController.ts",
  "src/controllers/pointsPhotosController.ts",
);
verifyFileExists(
  "adminStorageController.ts",
  "src/controllers/adminStorageController.ts",
);

// ═══════════════════════════════════════════════════════════════════════════
// 5. MODÈLES
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n📊 Modèles de données");
console.log("─".repeat(70));
verifyFileContains(
  "User.storage_quota",
  "src/models/users.ts",
  "storage_quota",
);
verifyFileContains("User.storage_used", "src/models/users.ts", "storage_used");
verifyFileContains("Point.photo", "src/models/points.ts", "photo:");

// ═══════════════════════════════════════════════════════════════════════════
// 6. ROUTES
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n🛣️  Routes");
console.log("─".repeat(70));
verifyFileContains(
  "pointsRoutes - uploadPointPhoto",
  "src/routes/pointsRoutes.ts",
  "uploadPointPhoto",
);
verifyFileContains(
  "pointsRoutes - getPointPhoto",
  "src/routes/pointsRoutes.ts",
  "getPointPhoto",
);
verifyFileContains(
  "pointsRoutes - deletePointPhoto",
  "src/routes/pointsRoutes.ts",
  "deletePointPhoto",
);
verifyFileContains(
  "pointsRoutes - getUserStorageInfo",
  "src/routes/pointsRoutes.ts",
  "getUserStorageInfo",
);
verifyFileContains(
  "adminRoutes - getAllUsersStorage",
  "src/routes/adminRoutes.ts",
  "getAllUsersStorage",
);
verifyFileContains(
  "adminRoutes - updateUserQuota",
  "src/routes/adminRoutes.ts",
  "updateUserQuota",
);
verifyFileContains(
  "adminRoutes - cleanupOrphanFiles",
  "src/routes/adminRoutes.ts",
  "cleanupOrphanFiles",
);

// ═══════════════════════════════════════════════════════════════════════════
// 7. MIGRATION
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n📦 Migration");
console.log("─".repeat(70));
verifyFileExists(
  "addPhotoStorageFields.ts",
  "src/migrations/addPhotoStorageFields.ts",
);
verifyFileContains(
  "package.json - migrate:storage",
  "package.json",
  '"migrate:storage"',
);

// ═══════════════════════════════════════════════════════════════════════════
// 8. DÉPENDANCES
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n📚 Dépendances NPM");
console.log("─".repeat(70));
verifyFileContains("package.json - sharp", "package.json", '"sharp"');
verifyFileContains("package.json - multer", "package.json", '"multer"');
verifyFileContains(
  "package.json - heic-convert",
  "package.json",
  '"heic-convert"',
);
verifyFileContains("package.json - mime-types", "package.json", '"mime-types"');

// ═══════════════════════════════════════════════════════════════════════════
// 9. INFRASTRUCTURE
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n🗂️  Infrastructure");
console.log("─".repeat(70));
const uploadsPath = path.join(__dirname, "..", "uploads", "points");
verify(
  "Dossier uploads/points",
  fs.existsSync(uploadsPath),
  "Dossier uploads/points manquant",
);

// ═══════════════════════════════════════════════════════════════════════════
// RÉSUMÉ
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n═".repeat(70));
console.log("📊 RÉSUMÉ\n");

const okCount = results.filter((r) => r.status === "OK").length;
const errorCount = results.filter((r) => r.status === "ERROR").length;
const warningCount = results.filter((r) => r.status === "WARNING").length;

console.log(`✅ OK:       ${okCount}`);
console.log(`❌ ERREURS:  ${errorCount}`);
console.log(`⚠️  WARNINGS: ${warningCount}`);
console.log(`📝 TOTAL:    ${results.length}\n`);

// Afficher les détails
results.forEach((result) => {
  const icon =
    result.status === "OK" ? "✅" : result.status === "ERROR" ? "❌" : "⚠️";
  console.log(`${icon} ${result.name.padEnd(40)} ${result.message}`);
});

console.log("\n═".repeat(70));

if (errorCount > 0) {
  console.log("\n❌ Vérification échouée. Corrigez les erreurs ci-dessus.\n");
  process.exit(1);
} else {
  console.log(
    "\n✅ Toutes les vérifications ont réussi ! La fonctionnalité est prête.\n",
  );
  console.log("📝 Prochaines étapes :");
  console.log("   1. Configurer les variables d'environnement (.env)");
  console.log("   2. Exécuter la migration : npm run migrate:storage up");
  console.log("   3. Démarrer le serveur : npm run dev");
  console.log("   4. Tester l'upload de photos\n");
  process.exit(0);
}
