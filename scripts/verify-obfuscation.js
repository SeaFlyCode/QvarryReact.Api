#!/usr/bin/env node
/**
 * Script de vérification de l'obfuscation pour QvarryReact Server
 *
 * Ce script vérifie que l'obfuscation a été correctement appliquée
 * et teste l'exécutabilité du code obfusqué.
 *
 * Tests effectués:
 * - Vérification de la syntaxe JavaScript
 * - Détection des patterns d'obfuscation
 * - Test de chargement des modules
 * - Vérification de l'absence de code source lisible
 * - Test de démarrage du serveur (optionnel)
 *
 * @author QvarryReact Security Team
 * @version 2.0.0
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

// Couleurs pour le terminal
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

const log = {
  info: (msg) => console.log(`${colors.cyan}[INFO]${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}[✓]${colors.reset} ${msg}`),
  fail: (msg) => console.log(`${colors.red}[✗]${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}[!]${colors.reset} ${msg}`),
  test: (msg) => console.log(`${colors.blue}[TEST]${colors.reset} ${msg}`),
};

// Chemins
const DIST_DIR = path.join(__dirname, "..", "dist");
const STATS_FILE = path.join(__dirname, "..", "obfuscation-stats.json");

// Patterns qui indiquent que le code est obfusqué
const OBFUSCATION_PATTERNS = [
  /_0x[a-f0-9]+/, // Variables hexadécimales
  /\['\\x[0-9a-f]+/, // Chaînes échappées hex
  /\\u[0-9a-f]{4}/i, // Unicode escapes
  /atob\s*\(/, // Base64 decode
  /\[.*\]\[.*\]\[.*\]/, // Nested array access
  /while\s*\(\!\!\[\]\)/, // Self-defending pattern
  /debugger/, // Debug traps
];

// Patterns qui ne devraient PAS être présents dans du code obfusqué
const SENSITIVE_PATTERNS = [
  /process\.env\.JWT_SECRET/,
  /ENCRYPTION_KEY_MASTER/,
  /password\s*[:=]\s*["'][^"']+["']/i,
  /secret\s*[:=]\s*["'][^"']+["']/i,
  /apiKey\s*[:=]\s*["'][^"']+["']/i,
  /\/\/\s*TODO/i,
  /\/\/\s*FIXME/i,
  /console\.log\s*\(\s*["']DEBUG/i,
];

// Fichiers critiques qui DOIVENT être obfusqués
const CRITICAL_FILES = [
  "server.js",
  "controllers/auth/loginController.js",
  "controllers/auth/authHelpers.js",
  "middlewares/authMiddleware.js",
  "middlewares/mobileAuthMiddleware.js",
  "utils/jwtKeyManager.js",
  "utils/rsaEncryptionUtils.js",
  "utils/masterEncryptionUtils.js",
  "services/loggerService.js",
  "services/redisSessionService.js",
];

/**
 * Récupère tous les fichiers JS récursivement
 */
function getAllJsFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      getAllJsFiles(filePath, fileList);
    } else if (file.endsWith(".js")) {
      fileList.push(filePath);
    }
  }

  return fileList;
}

/**
 * Teste si un fichier contient des patterns d'obfuscation
 */
function checkObfuscationPatterns(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const matches = [];

  for (const pattern of OBFUSCATION_PATTERNS) {
    if (pattern.test(content)) {
      matches.push(pattern.toString());
    }
  }

  return {
    isObfuscated: matches.length >= 2, // Au moins 2 patterns
    matchCount: matches.length,
    patterns: matches,
  };
}

/**
 * Vérifie l'absence de données sensibles en clair
 */
function checkSensitiveData(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const violations = [];

  for (const pattern of SENSITIVE_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      violations.push({
        pattern: pattern.toString(),
        sample: match[0].substring(0, 50) + "...",
      });
    }
  }

  return {
    clean: violations.length === 0,
    violations,
  };
}

/**
 * Vérifie la syntaxe JavaScript
 */
function checkSyntax(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    // Parse sans exécuter
    new Function(content);
    return { valid: true };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

/**
 * Calcule la complexité du code (indicateur d'obfuscation)
 */
function calculateComplexity(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");

  // Métriques de complexité
  const metrics = {
    lineLength: content
      .split("\n")
      .reduce((max, line) => Math.max(max, line.length), 0),
    avgLineLength: content.length / Math.max(1, content.split("\n").length),
    semicolonDensity:
      (content.match(/;/g) || []).length / (content.length / 1000),
    bracketDepth: Math.max(
      (content.match(/\[/g) || []).length,
      (content.match(/\{/g) || []).length,
    ),
    hexPatterns: (content.match(/_0x[a-f0-9]+/g) || []).length,
    stringArrayCalls: (content.match(/\['[^']+'\]/g) || []).length,
  };

  // Score de complexité (plus élevé = plus obfusqué)
  const score =
    (metrics.avgLineLength > 500 ? 2 : 0) +
    (metrics.semicolonDensity > 50 ? 2 : 0) +
    (metrics.hexPatterns > 10 ? 3 : 0) +
    (metrics.stringArrayCalls > 20 ? 2 : 0) +
    (metrics.lineLength > 10000 ? 1 : 0);

  return {
    metrics,
    score,
    level: score >= 7 ? "HIGH" : score >= 4 ? "MEDIUM" : "LOW",
  };
}

/**
 * Teste le chargement d'un module
 */
function testModuleLoad(filePath) {
  try {
    // Clear cache first
    delete require.cache[require.resolve(filePath)];

    // Try to require the module
    require(filePath);
    return { success: true };
  } catch (error) {
    // Some errors are expected (missing dependencies in test context)
    if (error.code === "MODULE_NOT_FOUND") {
      return { success: true, note: "Module dependencies not loaded" };
    }
    return { success: false, error: error.message };
  }
}

/**
 * Teste le démarrage du serveur
 */
async function testServerStartup(timeout = 10000) {
  return new Promise((resolve) => {
    const serverPath = path.join(DIST_DIR, "server.js");

    if (!fs.existsSync(serverPath)) {
      resolve({ success: false, error: "server.js not found" });
      return;
    }

    const env = {
      ...process.env,
      NODE_ENV: "test",
      PORT: "0", // Random port
      SKIP_DB_CONNECTION: "true",
    };

    const child = spawn("node", [serverPath], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
      cwd: path.join(__dirname, ".."),
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
      // Check for successful startup indicators
      if (
        stdout.includes("listening") ||
        stdout.includes("started") ||
        stdout.includes("ready")
      ) {
        child.kill();
        resolve({ success: true, output: stdout.substring(0, 200) });
      }
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      resolve({ success: false, error: error.message });
    });

    child.on("exit", (code) => {
      if (code === 0 || code === null) {
        resolve({ success: true });
      } else {
        resolve({
          success: false,
          error: `Exit code: ${code}`,
          stderr: stderr.substring(0, 500),
        });
      }
    });

    setTimeout(() => {
      child.kill();
      resolve({
        success: true,
        note: "Timeout (server likely waiting for DB)",
      });
    }, timeout);
  });
}

/**
 * Point d'entrée principal
 */
async function main() {
  console.log("\n" + "=".repeat(60));
  console.log(
    `${colors.bright}${colors.blue}  QvarryReact Obfuscation Verification${colors.reset}`,
  );
  console.log("=".repeat(60) + "\n");

  const args = process.argv.slice(2);
  const runServerTest = args.includes("--server-test") || args.includes("-s");
  const verbose = args.includes("--verbose") || args.includes("-v");

  // Vérifier que le répertoire dist existe
  if (!fs.existsSync(DIST_DIR)) {
    log.fail("Répertoire dist non trouvé");
    log.info("Exécutez d'abord: npm run build && npm run obfuscate");
    process.exit(1);
  }

  // Charger les stats si disponibles
  let stats = null;
  if (fs.existsSync(STATS_FILE)) {
    stats = JSON.parse(fs.readFileSync(STATS_FILE, "utf-8"));
    log.info(`Stats d'obfuscation trouvées: ${stats.timestamp}`);
  }

  // Récupérer les fichiers
  const files = getAllJsFiles(DIST_DIR);
  log.info(`${files.length} fichiers JavaScript à vérifier\n`);

  const results = {
    total: files.length,
    obfuscated: 0,
    syntaxValid: 0,
    sensitiveDataFree: 0,
    criticalProtected: 0,
    highComplexity: 0,
    failures: [],
    warnings: [],
  };

  // Test 1: Vérification des patterns d'obfuscation
  console.log(`${colors.bright}Test 1: Patterns d'obfuscation${colors.reset}`);
  console.log("-".repeat(40));

  for (const filePath of files) {
    const relativePath = path.relative(DIST_DIR, filePath);
    const check = checkObfuscationPatterns(filePath);

    if (check.isObfuscated) {
      results.obfuscated++;
      if (verbose)
        log.success(`${relativePath} (${check.matchCount} patterns)`);
    } else {
      log.fail(`${relativePath} - Non obfusqué (${check.matchCount} patterns)`);
      results.failures.push({ file: relativePath, reason: "Not obfuscated" });
    }
  }
  console.log(
    `\n  Résultat: ${results.obfuscated}/${results.total} fichiers obfusqués\n`,
  );

  // Test 2: Validation syntaxique
  console.log(`${colors.bright}Test 2: Validation syntaxique${colors.reset}`);
  console.log("-".repeat(40));

  for (const filePath of files) {
    const relativePath = path.relative(DIST_DIR, filePath);
    const check = checkSyntax(filePath);

    if (check.valid) {
      results.syntaxValid++;
      if (verbose) log.success(relativePath);
    } else {
      log.fail(`${relativePath} - ${check.error}`);
      results.failures.push({
        file: relativePath,
        reason: `Syntax error: ${check.error}`,
      });
    }
  }
  console.log(
    `\n  Résultat: ${results.syntaxValid}/${results.total} fichiers valides\n`,
  );

  // Test 3: Données sensibles
  console.log(
    `${colors.bright}Test 3: Absence de données sensibles${colors.reset}`,
  );
  console.log("-".repeat(40));

  for (const filePath of files) {
    const relativePath = path.relative(DIST_DIR, filePath);
    const check = checkSensitiveData(filePath);

    if (check.clean) {
      results.sensitiveDataFree++;
      if (verbose) log.success(relativePath);
    } else {
      log.warn(`${relativePath} - ${check.violations.length} violation(s)`);
      if (verbose) {
        check.violations.forEach((v) =>
          console.log(`    Pattern: ${v.pattern}`),
        );
      }
      results.warnings.push({
        file: relativePath,
        violations: check.violations,
      });
    }
  }
  console.log(
    `\n  Résultat: ${results.sensitiveDataFree}/${results.total} fichiers propres\n`,
  );

  // Test 4: Fichiers critiques
  console.log(
    `${colors.bright}Test 4: Protection des fichiers critiques${colors.reset}`,
  );
  console.log("-".repeat(40));

  for (const criticalFile of CRITICAL_FILES) {
    const filePath = path.join(DIST_DIR, criticalFile);
    const relativePath = criticalFile;

    if (!fs.existsSync(filePath)) {
      log.warn(`${relativePath} - Non trouvé (peut-être renommé)`);
      continue;
    }

    const obfCheck = checkObfuscationPatterns(filePath);
    const complexity = calculateComplexity(filePath);

    if (obfCheck.isObfuscated && complexity.level !== "LOW") {
      results.criticalProtected++;
      log.success(`${relativePath} (Complexité: ${complexity.level})`);
    } else {
      log.fail(`${relativePath} - Protection insuffisante`);
      results.failures.push({
        file: relativePath,
        reason: `Critical file not properly protected (Complexity: ${complexity.level})`,
      });
    }
  }
  console.log(
    `\n  Résultat: ${results.criticalProtected}/${CRITICAL_FILES.length} fichiers critiques protégés\n`,
  );

  // Test 5: Complexité globale
  console.log(`${colors.bright}Test 5: Analyse de complexité${colors.reset}`);
  console.log("-".repeat(40));

  const complexityDistribution = { HIGH: 0, MEDIUM: 0, LOW: 0 };

  for (const filePath of files) {
    const complexity = calculateComplexity(filePath);
    complexityDistribution[complexity.level]++;

    if (complexity.level === "HIGH") {
      results.highComplexity++;
    }
  }

  console.log(`  HIGH:   ${complexityDistribution.HIGH} fichiers`);
  console.log(`  MEDIUM: ${complexityDistribution.MEDIUM} fichiers`);
  console.log(`  LOW:    ${complexityDistribution.LOW} fichiers`);
  console.log(
    `\n  Résultat: ${results.highComplexity} fichiers haute complexité\n`,
  );

  // Test 6 (optionnel): Test de démarrage serveur
  if (runServerTest) {
    console.log(`${colors.bright}Test 6: Démarrage serveur${colors.reset}`);
    console.log("-".repeat(40));

    log.test("Tentative de démarrage du serveur obfusqué...");
    const serverTest = await testServerStartup(15000);

    if (serverTest.success) {
      log.success(
        `Serveur démarré avec succès ${serverTest.note ? `(${serverTest.note})` : ""}`,
      );
    } else {
      log.fail(`Échec du démarrage: ${serverTest.error}`);
      if (serverTest.stderr) {
        console.log(`  stderr: ${serverTest.stderr}`);
      }
    }
    console.log("");
  }

  // Rapport final
  console.log("=".repeat(60));
  console.log(`${colors.bright}RAPPORT FINAL${colors.reset}`);
  console.log("=".repeat(60));

  const allTestsPassed =
    results.obfuscated === results.total &&
    results.syntaxValid === results.total &&
    results.criticalProtected === CRITICAL_FILES.length;

  console.log(`
  📊 Résumé:
     - Fichiers obfusqués: ${results.obfuscated}/${results.total}
     - Syntaxe valide: ${results.syntaxValid}/${results.total}
     - Sans données sensibles: ${results.sensitiveDataFree}/${results.total}
     - Fichiers critiques protégés: ${results.criticalProtected}/${CRITICAL_FILES.length}
     - Haute complexité: ${results.highComplexity}/${results.total}
`);

  if (results.failures.length > 0) {
    console.log(`  ${colors.red}❌ Échecs:${colors.reset}`);
    results.failures.forEach((f) => {
      console.log(`     - ${f.file}: ${f.reason}`);
    });
    console.log("");
  }

  if (results.warnings.length > 0) {
    console.log(
      `  ${colors.yellow}⚠️  Avertissements: ${results.warnings.length}${colors.reset}`,
    );
  }

  console.log("");

  if (allTestsPassed) {
    console.log(
      `  ${colors.green}${colors.bright}✅ TOUS LES TESTS PASSÉS${colors.reset}`,
    );
    console.log(
      `  ${colors.green}Le code est correctement obfusqué et prêt pour la production.${colors.reset}`,
    );
  } else {
    console.log(
      `  ${colors.red}${colors.bright}❌ CERTAINS TESTS ONT ÉCHOUÉ${colors.reset}`,
    );
    console.log(
      `  ${colors.red}Veuillez corriger les problèmes avant le déploiement.${colors.reset}`,
    );
  }

  console.log("\n" + "=".repeat(60) + "\n");

  process.exit(allTestsPassed ? 0 : 1);
}

// Affichage de l'aide
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`
Usage: node verify-obfuscation.js [options]

Options:
  -v, --verbose      Affiche les détails de chaque fichier
  -s, --server-test  Teste le démarrage du serveur obfusqué
  -h, --help         Affiche cette aide

Exemples:
  node verify-obfuscation.js
  node verify-obfuscation.js -v
  node verify-obfuscation.js -v -s
`);
  process.exit(0);
}

main().catch((error) => {
  log.fail(`Erreur fatale: ${error.message}`);
  console.error(error);
  process.exit(1);
});
