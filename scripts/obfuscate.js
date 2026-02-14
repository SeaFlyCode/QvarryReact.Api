#!/usr/bin/env node
/**
 * Script d'obfuscation professionnelle pour QvarryReact Server
 * Version optimisée avec gestion mémoire améliorée
 *
 * @author QvarryReact Security Team
 * @version 2.1.0
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Charger javascript-obfuscator une seule fois au démarrage
let JavaScriptObfuscator;
try {
    JavaScriptObfuscator = require('javascript-obfuscator');
} catch (e) {
    console.log('Installation de javascript-obfuscator...');
    execSync('npm install javascript-obfuscator --no-save', { stdio: 'inherit' });
    JavaScriptObfuscator = require('javascript-obfuscator');
}

// Couleurs pour le terminal
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
};

const log = {
    info: (msg) => console.log(`${colors.cyan}[INFO]${colors.reset} ${msg}`),
    success: (msg) => console.log(`${colors.green}[SUCCESS]${colors.reset} ${msg}`),
    warn: (msg) => console.log(`${colors.yellow}[WARN]${colors.reset} ${msg}`),
    error: (msg) => console.log(`${colors.red}[ERROR]${colors.reset} ${msg}`),
    step: (num, msg) => console.log(`${colors.magenta}[STEP ${num}]${colors.reset} ${msg}`),
    security: (msg) => console.log(`${colors.bright}${colors.blue}[SECURITY]${colors.reset} ${msg}`),
};

// Chemins
const DIST_DIR = path.join(__dirname, '..', 'dist');
const CONFIG_PATH = path.join(__dirname, '..', 'obfuscator.json');
const BACKUP_DIR = path.join(__dirname, '..', 'dist-backup');
const STATS_FILE = path.join(__dirname, '..', 'obfuscation-stats.json');

// Fichiers critiques
const CRITICAL_FILES = [
    'server.js',
    'controllers/authControllers.js',
    'controllers/twoFactorControllers.js',
    'middlewares/authMiddleware.js',
    'middlewares/adminMiddleware.js',
    'utils/jwtKeyManager.js',
    'utils/rsaEncryptionUtils.js',
    'utils/masterEncryptionUtils.js',
    'utils/userEncryptionUtils.js',
    'utils/communicationEncryptionUtils.js',
    'utils/passwordUtils.js',
    'services/sessionService.js',
    'services/refreshTokenService.js',
    'config/database.js',
];

// Patterns à exclure
const EXCLUDED_PATTERNS = [/\.d\.ts$/, /\.map$/, /templates\//, /\.json$/];

/**
 * Récupère tous les fichiers JS
 */
function getAllJsFiles(dir, fileList = []) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            getAllJsFiles(filePath, fileList);
        } else if (file.endsWith('.js')) {
            const relativePath = path.relative(DIST_DIR, filePath);
            const isExcluded = EXCLUDED_PATTERNS.some(pattern => pattern.test(relativePath));
            if (!isExcluded) {
                fileList.push(filePath);
            }
        }
    }
    return fileList;
}

/**
 * Crée une sauvegarde
 */
function createBackup() {
    if (fs.existsSync(BACKUP_DIR)) {
        fs.rmSync(BACKUP_DIR, { recursive: true });
    }
    fs.cpSync(DIST_DIR, BACKUP_DIR, { recursive: true });
    log.info(`Backup créé: ${BACKUP_DIR}`);
}

/**
 * Restaure le backup
 */
function restoreBackup() {
    if (fs.existsSync(BACKUP_DIR)) {
        fs.rmSync(DIST_DIR, { recursive: true });
        fs.renameSync(BACKUP_DIR, DIST_DIR);
        log.warn('Backup restauré');
    }
}

/**
 * Configuration adaptée à la taille du fichier
 */
function getConfigForFile(baseConfig, fileSize, isCritical) {
    const config = { ...baseConfig };

    // Pour les très gros fichiers (>50KB), configuration minimale
    if (fileSize > 50000) {
        config.controlFlowFlattening = false;
        config.deadCodeInjection = false;
        config.stringArrayWrappersCount = 1;
        config.splitStrings = false;
        config.stringArrayThreshold = 0.5;
    }
    // Pour les fichiers moyens (20-50KB)
    else if (fileSize > 20000) {
        config.controlFlowFlattening = false;
        config.deadCodeInjection = false;
        config.stringArrayThreshold = 0.6;
    }
    // Pour les petits fichiers critiques, protection maximale
    else if (isCritical && fileSize < 10000) {
        config.controlFlowFlattening = true;
        config.controlFlowFlatteningThreshold = 0.4;
        config.stringArrayThreshold = 0.8;
    }

    return config;
}

/**
 * Obfusque un fichier unique
 */
function obfuscateFile(filePath, baseConfig, isCritical) {
    const code = fs.readFileSync(filePath, 'utf-8');
    const originalSize = Buffer.byteLength(code, 'utf-8');

    const config = getConfigForFile(baseConfig, originalSize, isCritical);

    try {
        const result = JavaScriptObfuscator.obfuscate(code, config);
        const obfuscatedCode = result.getObfuscatedCode();
        fs.writeFileSync(filePath, obfuscatedCode);

        const newSize = Buffer.byteLength(obfuscatedCode, 'utf-8');
        return {
            success: true,
            originalSize,
            newSize,
            ratio: (newSize / originalSize).toFixed(2),
        };
    } catch (error) {
        return {
            success: false,
            error: error.message,
            originalSize,
        };
    }
}

/**
 * Vérifie la syntaxe d'un fichier
 */
function verifyFile(filePath) {
    try {
        const code = fs.readFileSync(filePath, 'utf-8');
        new Function(code);
        return { valid: true };
    } catch (error) {
        return { valid: false, error: error.message };
    }
}

/**
 * Point d'entrée principal
 */
async function main() {
    console.log('\n' + '='.repeat(60));
    console.log(`${colors.bright}${colors.blue}  QvarryReact Professional Code Obfuscation v2.1${colors.reset}`);
    console.log('='.repeat(60) + '\n');

    const startTime = Date.now();

    // Vérification du répertoire dist
    log.step(1, 'Vérification du répertoire dist...');
    if (!fs.existsSync(DIST_DIR)) {
        log.error(`Répertoire dist non trouvé: ${DIST_DIR}`);
        process.exit(1);
    }
    log.success(`Répertoire dist trouvé`);

    // Création du backup
    log.step(2, 'Création du backup...');
    createBackup();

    // Chargement de la configuration
    log.step(3, 'Chargement de la configuration...');
    let config;
    try {
        config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
        log.success('Configuration chargée');
    } catch (error) {
        log.error(`Erreur configuration: ${error.message}`);
        process.exit(1);
    }

    // Récupération des fichiers
    log.step(4, 'Analyse des fichiers...');
    const files = getAllJsFiles(DIST_DIR);
    log.info(`${files.length} fichiers JS trouvés`);

    // Obfuscation
    log.step(5, 'Obfuscation en cours...');
    console.log('');

    const results = [];
    let processed = 0;
    let successCount = 0;
    let failCount = 0;

    for (const filePath of files) {
        const relativePath = path.relative(DIST_DIR, filePath);
        const isCritical = CRITICAL_FILES.some(cf => relativePath.includes(cf.replace('.js', '')));

        process.stdout.write(`\r  [${++processed}/${files.length}] ${relativePath.padEnd(50).substring(0, 50)}`);

        const result = obfuscateFile(filePath, config, isCritical);
        result.filePath = filePath;
        result.relativePath = relativePath;
        result.isCritical = isCritical;

        if (result.success) {
            successCount++;
        } else {
            failCount++;
        }

        results.push(result);

        // Force garbage collection entre les fichiers
        if (global.gc) {
            global.gc();
        }
    }
    console.log('\n');

    // Vérification
    log.step(6, 'Vérification de l\'intégrité...');
    let verificationErrors = 0;
    for (const result of results) {
        if (result.success) {
            const check = verifyFile(result.filePath);
            if (!check.valid) {
                result.success = false;
                result.error = `Syntax error: ${check.error}`;
                successCount--;
                failCount++;
                verificationErrors++;
            }
        }
    }

    if (verificationErrors > 0) {
        log.warn(`${verificationErrors} fichiers ont des erreurs de syntaxe`);
    } else if (successCount > 0) {
        log.success('Tous les fichiers obfusqués sont valides');
    }

    // Statistiques
    const stats = {
        timestamp: new Date().toISOString(),
        totalFiles: files.length,
        successCount,
        failureCount: failCount,
        totalOriginalSize: results.reduce((acc, r) => acc + (r.originalSize || 0), 0),
        totalNewSize: results.reduce((acc, r) => acc + (r.newSize || 0), 0),
        files: results.map(r => ({
            file: r.relativePath,
            success: r.success,
            isCritical: r.isCritical,
            originalSize: r.originalSize,
            newSize: r.newSize,
            error: r.error,
        })),
    };

    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));

    // Gestion du backup
    if (failCount === 0) {
        fs.rmSync(BACKUP_DIR, { recursive: true });
        log.info('Backup supprimé (succès total)');
    } else if (successCount > 0) {
        log.warn(`Backup conservé (${failCount} échecs, ${successCount} succès)`);
    } else {
        restoreBackup();
        log.error('Backup restauré (aucun succès)');
    }

    // Rapport final
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n' + '='.repeat(60));
    console.log(`${colors.bright}${colors.green}  RAPPORT D'OBFUSCATION${colors.reset}`);
    console.log('='.repeat(60));
    console.log(`
  📊 Statistiques:
     - Fichiers traités: ${stats.totalFiles}
     - Succès: ${colors.green}${successCount}${colors.reset}
     - Échecs: ${failCount > 0 ? colors.red : colors.green}${failCount}${colors.reset}

  📦 Taille:
     - Original: ${(stats.totalOriginalSize / 1024).toFixed(2)} KB
     - Obfusqué: ${(stats.totalNewSize / 1024).toFixed(2)} KB
     - Ratio: x${(stats.totalNewSize / stats.totalOriginalSize).toFixed(2)}

  ⏱️  Durée: ${duration}s

  🔒 Protections appliquées:
     ✓ Identifiants hexadécimaux
     ✓ String Array (Base64)
     ✓ String Rotation/Shuffle
     ✓ Numbers to Expressions
     ✓ Code Compaction

  📄 Rapport: ${path.relative(process.cwd(), STATS_FILE)}
`);
    console.log('='.repeat(60) + '\n');

    if (failCount > 0 && successCount === 0) {
        log.error('Échec total de l\'obfuscation');
        console.log('\nFichiers en échec:');
        results.filter(r => !r.success).slice(0, 10).forEach(r => {
            console.log(`  - ${r.relativePath}: ${r.error}`);
        });
        if (failCount > 10) {
            console.log(`  ... et ${failCount - 10} autres`);
        }
        process.exit(1);
    } else if (failCount > 0) {
        log.warn('Obfuscation partielle réussie');
        process.exit(0);
    } else {
        log.success('Obfuscation terminée avec succès!');
        process.exit(0);
    }
}

// Gestion des erreurs
process.on('uncaughtException', (error) => {
    log.error(`Erreur: ${error.message}`);
    restoreBackup();
    process.exit(1);
});

process.on('SIGINT', () => {
    log.warn('Interruption');
    restoreBackup();
    process.exit(1);
});

main().catch((error) => {
    log.error(`Erreur fatale: ${error.message}`);
    restoreBackup();
    process.exit(1);
});
