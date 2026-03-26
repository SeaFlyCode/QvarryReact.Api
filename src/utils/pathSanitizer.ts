import path from "path";
import mongoose from "mongoose";

/**
 * 🛡️ UTILITAIRE DE SANITIZATION POUR PATH TRAVERSAL
 *
 * Protège contre les attaques de type :
 * - Path traversal : ../../etc/passwd
 * - Null byte injection : file.txt%00.jpg
 * - Caractères spéciaux : ../; rm -rf /
 */

export class PathSanitizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathSanitizationError";
  }
}

/**
 * Valide et sanitize un MongoDB ObjectId pour utilisation dans un chemin
 * 🔒 CORRECTION: Support des fichiers temporaires (.tmp)
 * @param id - L'ID à valider (doit être un ObjectId valide, optionnellement suivi de .tmp)
 * @returns L'ID sanitizé (format hexadécimal 24 caractères + optionnel .tmp)
 * @throws PathSanitizationError si l'ID est invalide
 */
export function sanitizePathId(id: string): string {
  // Vérification 1 : ID non vide
  if (!id || typeof id !== "string") {
    throw new PathSanitizationError("ID must be a non-empty string");
  }

  // Vérification 2 : Trim whitespace
  const trimmedId = id.trim();

  // Vérification 3 : Gérer l'extension .tmp
  const isTempFile = trimmedId.endsWith(".tmp");
  const cleanId = isTempFile ? trimmedId.slice(0, -4) : trimmedId;

  // Vérification 4 : Format MongoDB ObjectId (24 caractères hexadécimaux)
  if (!mongoose.Types.ObjectId.isValid(cleanId)) {
    throw new PathSanitizationError(
      `Invalid MongoDB ObjectId format: ${cleanId.substring(0, 20)}...`,
    );
  }

  // Vérification 5 : Regex strict (seulement a-f, 0-9, exactement 24 caractères)
  const objectIdRegex = /^[a-f0-9]{24}$/i;
  if (!objectIdRegex.test(cleanId)) {
    throw new PathSanitizationError(
      "ID contains invalid characters or wrong length",
    );
  }

  // Vérification 6 : Détection de séquences dangereuses
  const dangerousPatterns = [
    "..", // Path traversal
    "/", // Directory separator
    "\\", // Windows path separator
    "\0", // Null byte
    "\x00", // Null byte (hex)
    "%", // URL encoding
    "~", // Home directory
    "$", // Variables
    "`", // Command substitution
    "|", // Pipe
    ";", // Command separator
    "&", // Background process
    "\n", // Newline
    "\r", // Carriage return
  ];

  for (const pattern of dangerousPatterns) {
    if (trimmedId.includes(pattern)) {
      throw new PathSanitizationError(
        `ID contains forbidden pattern: ${pattern}`,
      );
    }
  }

  // Retourner l'ID avec .tmp si c'était un fichier temporaire
  return isTempFile ? `${cleanId}.tmp` : cleanId;
}

/**
 * Vérifie qu'un chemin résolu reste dans le répertoire de base autorisé
 * @param resolvedPath - Le chemin complet résolu
 * @param basePath - Le répertoire de base autorisé
 * @throws PathSanitizationError si le chemin sort du basePath
 */
export function validatePathWithinBase(
  resolvedPath: string,
  basePath: string,
): void {
  // Normaliser les chemins pour comparaison
  const normalizedResolved = path.resolve(resolvedPath);
  const normalizedBase = path.resolve(basePath);

  // Vérifier que le chemin résolu commence par le basePath
  if (!normalizedResolved.startsWith(normalizedBase)) {
    throw new PathSanitizationError(
      `Path traversal detected: resolved path is outside base directory`,
    );
  }

  // Vérification supplémentaire : pas de symlinks sortants (si possible)
  // Note : fs.realpathSync() pourrait être utilisé ici en production
  // pour résoudre les symlinks, mais nécessite accès filesystem

  // Vérification : pas de segments ".." dans le chemin final
  const relativePath = path.relative(normalizedBase, normalizedResolved);
  if (relativePath.startsWith("..") || relativePath.includes("/../")) {
    throw new PathSanitizationError(
      `Path contains parent directory references after resolution`,
    );
  }
}

/**
 * Construit un chemin sécurisé en validant tous les composants
 * @param basePath - Le répertoire de base
 * @param segments - Les segments de chemin (chacun sera validé)
 * @returns Le chemin absolu sécurisé
 * @throws PathSanitizationError si validation échoue
 */
export function buildSecurePath(
  basePath: string,
  ...segments: string[]
): string {
  // Valider chaque segment
  const sanitizedSegments = segments.map((segment, index) => {
    try {
      return sanitizePathId(segment);
    } catch (error) {
      throw new PathSanitizationError(
        `Invalid path segment at index ${index}: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  });

  // Construire le chemin
  const constructedPath = path.join(basePath, ...sanitizedSegments);

  // Résoudre et valider
  const resolvedPath = path.resolve(constructedPath);
  validatePathWithinBase(resolvedPath, basePath);

  return resolvedPath;
}
