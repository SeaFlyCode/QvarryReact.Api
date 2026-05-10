import { maskEmail } from "../../utils/logUtils";
import jwt from "jsonwebtoken";
import { memoryStorage } from "../../services/memoryStorageService";
import PointModel from "../../models/points";
import FicheModel from "../../models/fiches";
import ListModel from "../../models/lists";
import KeysModel from "../../models/keys";
import { decrypt, encrypt } from "../../utils/masterEncryptionUtils";
import crypto from "crypto";
import mongoose from "mongoose";
import { redisSessionService } from "../../services/redisSessionService";
import { jwtKeyManager } from "../../utils/jwtKeyManager";
import { logger } from "../../services/loggerService";
import { safeJsonParse } from "../../utils/secureJsonParser";

const authHelpersLogger = logger.child({ service: "auth-helpers" });
// ═══════════════════════════════════════════════════════════════════════════
// INTERFACES PARTAGÉES
// ═══════════════════════════════════════════════════════════════════════════

export interface BlacklistedToken {
  token: string;
  expiresAt: Date;
  blacklistedAt: Date;
  reason: string;
  userId: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// GESTION DES TOKENS ET BLACKLIST (VIA REDIS)
// ═══════════════════════════════════════════════════════════════════════════
// CRIT-10: blacklistedTokens Set/Map en mémoire supprimés
// Toute la logique de blacklist passe exclusivement par redisSessionService
// ═══════════════════════════════════════════════════════════════════════════

// Helper pour vérifier si un token est blacklisté (Redis uniquement)
export async function isTokenBlacklisted(token: string): Promise<boolean> {
  return redisSessionService.isTokenBlacklisted(token);
}

// Helper pour blacklister un token (Redis uniquement)
export async function blacklistToken(
  token: string,
  details: BlacklistedToken,
): Promise<void> {
  const expiresInSeconds = Math.floor(
    (details.expiresAt.getTime() - Date.now()) / 1000,
  );

  await redisSessionService.blacklistToken(token, details, expiresInSeconds);
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTH-006: TENTATIVES DE CONNEXION - STOCKAGE REDIS
// ═══════════════════════════════════════════════════════════════════════════
// CRIT-10: loginAttempts en mémoire supprimé — géré exclusivement par redisSessionService
// CRIT-10: Nettoyage automatique en mémoire supprimé — Redis gère le TTL automatiquement
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// AUTH-006: TENTATIVES DE CONNEXION VIA REDIS (PERSISTÉES)
// ═══════════════════════════════════════════════════════════════════════════
// Les tentatives sont désormais stockées dans Redis pour survivre aux redémarrages
// Fallback automatique vers la mémoire si Redis non disponible

// Vérification et gestion des tentatives de connexion
export async function checkLoginAttempts(
  email: string,
): Promise<{ allowed: boolean; message?: string; waitTime?: number }> {
  const now = new Date();
  const attempt = await redisSessionService.getLoginAttempts(email);

  if (!attempt) {
    return { allowed: true };
  }

  // Si l'utilisateur est bloqué
  if (attempt.blockedUntil && attempt.blockedUntil > now) {
    const waitTimeMinutes = Math.ceil(
      (attempt.blockedUntil.getTime() - now.getTime()) / 60000,
    );
    return {
      allowed: false,
      message: `Trop de tentatives échouées. Veuillez réessayer dans ${waitTimeMinutes} minute(s).`,
      waitTime: waitTimeMinutes,
    };
  }

  // Si plus de 5 tentatives dans les 15 dernières minutes
  const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);
  if (attempt.lastAttempt > fifteenMinutesAgo && attempt.attempts >= 5) {
    // Bloquer pour 30 minutes
    await redisSessionService.recordLoginAttempt(email, true, 30);
    authHelpersLogger.warn(
      "[SECURITY] Email bloqué pour 30min après 5 tentatives",
      { email: maskEmail(email) },
    );
    return {
      allowed: false,
      message:
        "Trop de tentatives échouées. Compte temporairement bloqué pour 30 minutes.",
      waitTime: 30,
    };
  }

  return { allowed: true };
}

// Enregistrer une tentative de connexion échouée
export async function recordFailedLogin(
  email: string,
  ip?: string,
): Promise<void> {
  await redisSessionService.recordLoginAttempt(email, false);
  const attempt = await redisSessionService.getLoginAttempts(email);
  authHelpersLogger.warn("[SECURITY] Tentative de connexion échouée", {
    email: maskEmail(email),
    attempts: attempt?.attempts || 1,
  });

  // admin_security_breach : > 20 échecs / 60s sur la même IP
  if (ip) {
    await checkAuthFailureBurst(ip).catch((err) => {
      authHelpersLogger.warn(
        "[SECURITY] Échec check pic logins échoués",
        { error: err instanceof Error ? err.message : String(err) },
      );
    });
  }
}

const AUTH_FAIL_WINDOW_SECONDS = 60;
const AUTH_FAIL_THRESHOLD = 20;

async function checkAuthFailureBurst(ip: string): Promise<void> {
  // Utiliser Redis pour compter les échecs par IP sur 60s. Fallback in-memory
  // si Redis indisponible (best-effort, le throttle de notifyAllAdmins protège).
  let count = 0;
  try {
    const RedisConnectionPool = (
      await import("../../config/redisPool")
    ).default;
    const client = RedisConnectionPool.getPublisher();
    const key = `auth:fails:${ip}`;
    count = await client.incr(key);
    if (count === 1) {
      await client.expire(key, AUTH_FAIL_WINDOW_SECONDS);
    }
  } catch {
    count = inMemoryAuthFailIncr(ip);
  }

  if (count <= AUTH_FAIL_THRESHOLD) return;

  try {
    const { notifyAllAdmins } = await import(
      "../../services/adminNotificationService"
    );
    await notifyAllAdmins(
      "admin_security_breach",
      "🚨 Pic de logins échoués",
      `IP ${ip} — ${count}+ échecs en ${AUTH_FAIL_WINDOW_SECONDS}s`,
      {
        ip,
        attempts: count,
        windowSeconds: AUTH_FAIL_WINDOW_SECONDS,
        // dedupKey : 1 notif par IP, throttle 5 min côté service
        dedupKey: `breach:${ip}`,
      },
    );
  } catch (err) {
    authHelpersLogger.warn("[SECURITY] Échec notification admin_security_breach", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

const authFailMemory = new Map<
  string,
  { count: number; expiresAt: number }
>();

function inMemoryAuthFailIncr(ip: string): number {
  const now = Date.now();
  const entry = authFailMemory.get(ip);
  if (!entry || entry.expiresAt <= now) {
    authFailMemory.set(ip, {
      count: 1,
      expiresAt: now + AUTH_FAIL_WINDOW_SECONDS * 1000,
    });
    return 1;
  }
  entry.count += 1;
  return entry.count;
}

// Réinitialiser les tentatives après un login réussi
export async function resetLoginAttempts(email: string): Promise<void> {
  await redisSessionService.resetLoginAttempts(email);
}

// Générer un token JWT sécurisé avec des claims appropriés (courte durée)
// REM-003: Support du key versioning pour rotation de clés
export function generateSecureToken(
  userId: string,
  isAdmin: boolean,
  platform: "web" | "mobile" = "web",
  tokenId?: string,
  deviceId?: string,
): { token: string; tokenId: string; keyVersion: string } {
  // REM-003: Utiliser le JWT Key Manager pour le versioning
  const { secret, version } = jwtKeyManager.getCurrentKey();

  // AUTH-005: Validation longueur minimum du JWT_SECRET
  if (secret.length < 32) {
    throw new Error(
      "JWT_SECRET doit contenir au moins 32 caractères pour garantir la sécurité.",
    );
  }

  const jti = tokenId || crypto.randomBytes(16).toString("hex");
  const expiresIn = process.env.JWT_EXPIRES_IN || "15m"; // 15 minutes par défaut

  // Ajouter des claims de sécurité
  // REM-003: Inclure la version de la clé dans le token pour la vérification
  const payload: any = {
    id: userId,
    isAdmin,
    iat: Math.floor(Date.now() / 1000), // Issued at
    jti, // JWT ID unique pour l'invalidation
    kv: version, // REM-003: Key Version pour le versioning
    platform, // Platform claim (web/mobile)
  };

  // MED-001: Ajouter device_id pour tokens mobiles
  if (platform === "mobile" && deviceId) {
    payload.deviceId = deviceId;
  }

  const token = jwt.sign(payload, secret, {
    expiresIn: expiresIn, // Durée courte configurable
    algorithm: "HS256",
    issuer: "qvarry-api",
    audience: platform === "mobile" ? "qvarry-mobile" : "qvarry-client",
  } as jwt.SignOptions);

  return { token, tokenId: jti, keyVersion: version };
}

// ═══════════════════════════════════════════════════════════════════════════
// CHARGEMENT ET DÉCHIFFREMENT DES DONNÉES UTILISATEUR
// ═══════════════════════════════════════════════════════════════════════════

// Helper pour déchiffrer un champ de liste, avec fallback si le champ est en plaintext (migration)
// Le format chiffré est "iv:authTag:encrypted" — si le champ ne contient pas ce pattern,
// c'est qu'il est encore en plaintext (données pré-migration).
function decryptListField(
  decryptWithKey: (data: string, key: string) => string,
  value: string | undefined | null,
  userKey: string,
  fallback: string,
): string {
  if (!value) return fallback;
  if (value.includes(":")) {
    // Format chiffré détecté
    try {
      return decryptWithKey(value, userKey);
    } catch {
      return fallback; // Si déchiffrement échoue, retourner fallback
    }
  }
  // Sinon, c'est du plaintext (données pré-migration)
  return value;
}

export async function loadAndDecryptUserData(userId: string) {
  const startTime = Date.now();

  try {
    // 1. Récupérer la clé de chiffrement de l'utilisateur
    // IMPORTANT: Spécifier type: "user" pour récupérer la clé AES et non les clés RSA
    const userKeyData = await KeysModel.findOne({
      userId,
      type: "user",
    }).lean();

    if (!userKeyData || !userKeyData.key) {
      authHelpersLogger.error(
        "Clé de chiffrement utilisateur introuvable en DB",
        { userId },
      );
      throw new Error("Clé de chiffrement utilisateur non trouvée");
    }

    // Vérifier que ce n'est pas une clé RSA (sécurité supplémentaire)
    if (userKeyData.key.includes("-----BEGIN")) {
      throw new Error(
        `Erreur : La clé récupérée est une clé RSA, pas une clé AES utilisateur`,
      );
    }

    // Déchiffrer la clé AES utilisateur avec la clé maître
    const userKey = decrypt(userKeyData.key);

    // 2. Initialiser la session
    memoryStorage.initSession(userId, userKey);

    // 3. Charger TOUTES les données en parallèle (au lieu de séquentiellement)
    const [points, fiches, lists] = await Promise.all([
      PointModel.find({ userId, deletedAt: null }).lean(), // .lean() pour de meilleures performances
      FicheModel.find({ userId, deletedAt: null }).lean(),
      ListModel.find({ userId, deletedAt: null }).lean(),
    ]);

    authHelpersLogger.info("Chargement des données", {
      userId,
      pointsCount: points.length,
      fichesCount: fiches.length,
      listsCount: lists.length,
    });

    // 4. Déchiffrer tous les points EN PARALLÈLE
    const decryptPointsStart = Date.now();
    const decryptedPoints = await Promise.all(
      points.map((point) => decryptPointOptimized(point, userKey)),
    );
    authHelpersLogger.info("Points déchiffrés", {
      userId,
      duration: Date.now() - decryptPointsStart,
    });

    // 5. Déchiffrer toutes les fiches EN PARALLÈLE
    const decryptFichesStart = Date.now();
    const decryptedFiches = await Promise.all(
      fiches.map((fiche) => decryptFicheOptimized(fiche, userKey)),
    );
    authHelpersLogger.info("Fiches déchiffrées", {
      userId,
      duration: Date.now() - decryptFichesStart,
    });

    // 6. Déchiffrer les listes et stocker toutes les données en mémoire
    decryptedPoints.forEach((point) =>
      memoryStorage.storePoint(userId, point as any, true),
    );
    decryptedFiches.forEach((fiche) =>
      memoryStorage.storeFiche(userId, fiche as any, true),
    );

    // Déchiffrer les listes (name et description sont chiffrés en DB)
    const { decryptWithKey } = await import("../../utils/userEncryptionUtils");
    for (const list of lists) {
      try {
        const decryptedList = {
          ...list,
          name: decryptListField(
            decryptWithKey,
            (list as any).name,
            userKey,
            "Liste sans nom",
          ),
          description: decryptListField(
            decryptWithKey,
            (list as any).description,
            userKey,
            "",
          ),
        };
        memoryStorage.storeList(userId, decryptedList as any, true);
      } catch (_listDecryptError) {
        // Fallback : si le déchiffrement échoue, la liste est probablement en plaintext (migration)
        authHelpersLogger.warn(
          "Déchiffrement de la liste échoué, stockage en plaintext (migration nécessaire)",
          {
            userId,
            listId: (list as any)._id,
          },
        );
        memoryStorage.storeList(userId, list as any, true);
      }
    }

    // Marquer comme synchronisé (pas de modifications à ce stade)
    memoryStorage.markAsSynced(userId);

    const totalTime = Date.now() - startTime;
    authHelpersLogger.info("Données de l'utilisateur chargées", {
      userId,
      duration: totalTime,
    });
  } catch (error) {
    authHelpersLogger.error("Erreur chargement données utilisateur", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// Rafraîchir le memoryStorage avec les changements de la DB depuis le dernier refresh
// (permet au PC de voir les modifications faites par le mobile)
export async function refreshFromDB(
  userId: string,
): Promise<{ added: number; updated: number; deleted: number }> {
  const startTime = Date.now();
  const userKey = memoryStorage.getUserEncryptionKey(userId);
  const since = memoryStorage.getLastRefreshedAt(userId);

  authHelpersLogger.info("Refresh incrémental pour utilisateur", {
    userId,
    since: since.toISOString(),
  });

  let added = 0;
  let updated = 0;
  let deleted = 0;

  // 1. Chercher les items modifiés/créés depuis le dernier refresh (et non soft-deleted)
  const [newPoints, newFiches, newLists] = await Promise.all([
    PointModel.find({
      userId,
      deletedAt: null,
      updatedAt: { $gt: since },
    }).lean(),
    FicheModel.find({
      userId,
      deletedAt: null,
      date_modification: { $gt: since },
    }).lean(),
    ListModel.find({
      userId,
      deletedAt: null,
      updatedAt: { $gt: since },
    }).lean(),
  ]);

  // 2. Chercher les items soft-deleted depuis le dernier refresh
  const [deletedPoints, deletedFiches, deletedLists] = await Promise.all([
    PointModel.find({ userId, deletedAt: { $gt: since } })
      .select("_id")
      .lean(),
    FicheModel.find({ userId, deletedAt: { $gt: since } })
      .select("_id")
      .lean(),
    ListModel.find({ userId, deletedAt: { $gt: since } })
      .select("_id")
      .lean(),
  ]);

  // 3. Déchiffrer et injecter les points modifiés/créés
  const currentPointIds = new Set(
    memoryStorage.getAllPoints(userId).map((p: any) => p._id.toString()),
  );
  for (const point of newPoints) {
    const decrypted = await decryptPointOptimized(point, userKey);
    const pointId = (point._id as any).toString();
    memoryStorage.storePoint(userId, decrypted as any, true);
    if (currentPointIds.has(pointId)) {
      updated++;
    } else {
      added++;
    }
  }

  // 4. Déchiffrer et injecter les fiches modifiées/créées
  const currentFicheIds = new Set(
    memoryStorage.getAllFiches(userId).map((f: any) => f._id.toString()),
  );
  for (const fiche of newFiches) {
    const decrypted = await decryptFicheOptimized(fiche, userKey);
    const ficheId = (fiche._id as any).toString();
    memoryStorage.storeFiche(userId, decrypted as any, true);
    if (currentFicheIds.has(ficheId)) {
      updated++;
    } else {
      added++;
    }
  }

  // 5. Déchiffrer et injecter les listes modifiées/créées
  const { decryptWithKey } = await import("../../utils/userEncryptionUtils");
  const currentListIds = new Set(
    memoryStorage.getAllLists(userId).map((l: any) => l._id.toString()),
  );
  for (const list of newLists) {
    const listId = (list._id as any).toString();
    const decryptedList = {
      ...list,
      name: decryptListField(
        decryptWithKey,
        (list as any).name,
        userKey,
        "Liste sans nom",
      ),
      description: decryptListField(
        decryptWithKey,
        (list as any).description,
        userKey,
        "",
      ),
    };
    memoryStorage.storeList(userId, decryptedList as any, true);
    if (currentListIds.has(listId)) {
      updated++;
    } else {
      added++;
    }
  }

  // 6. Supprimer de la mémoire les items soft-deleted depuis le mobile
  for (const point of deletedPoints) {
    const pointId = (point._id as any).toString();
    if (currentPointIds.has(pointId)) {
      memoryStorage.deletePoint(userId, pointId);
      deleted++;
    }
  }

  for (const fiche of deletedFiches) {
    const ficheId = (fiche._id as any).toString();
    if (currentFicheIds.has(ficheId)) {
      memoryStorage.deleteFiche(userId, ficheId);
      deleted++;
    }
  }

  for (const list of deletedLists) {
    const listId = (list._id as any).toString();
    if (currentListIds.has(listId)) {
      memoryStorage.deleteList(userId, listId);
      deleted++;
    }
  }

  // 7. Mettre à jour le timestamp de refresh
  memoryStorage.setLastRefreshedAt(userId, new Date());

  const totalTime = Date.now() - startTime;
  authHelpersLogger.info("Refresh terminé", {
    userId,
    duration: totalTime,
    added,
    updated,
    deleted,
  });

  return { added, updated, deleted };
}

// Fonction pour déchiffrer un point (VERSION OPTIMISÉE)
export async function decryptPointOptimized(point: any, userKey: string) {
  try {
    // Import des fonctions optimisées
    const { decryptWithKey } = await import("../../utils/userEncryptionUtils");

    // Déchiffrer les champs simples
    const name = decryptWithKey(point.name, userKey);
    const description = point.description
      ? decryptWithKey(point.description, userKey)
      : "";

    // Déchiffrer et parser les coordonnées
    let location = null;

    if (point.location_encrypted) {
      const locationJson = decryptWithKey(point.location_encrypted, userKey);
      const parsedLocation = safeJsonParse(locationJson, {
        context: "decrypt-point-location",
        maxDepth: 3,
      });

      // Convertir les coordonnées en nombres pour l'affichage
      location = {
        type: parsedLocation.type,
        coordinates: [
          parseFloat(parsedLocation.coordinates[0]),
          parseFloat(parsedLocation.coordinates[1]),
        ],
      };
    }

    // Construire et retourner l'objet point déchiffré
    return {
      ...point,
      name,
      description,
      location,
      location_encrypted: point.location_encrypted, // Conserver pour le rechiffrement ultérieur
      version: point.version || 1,
    };
  } catch (error) {
    authHelpersLogger.error("Erreur lors du déchiffrement du point", {
      error: error instanceof Error ? error.message : String(error),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    return point;
  }
}

// Fonction pour déchiffrer une fiche (VERSION OPTIMIZÉE)
export async function decryptFicheOptimized(fiche: any, userKey: string) {
  try {
    const { decryptWithKey } = await import("../../utils/userEncryptionUtils");

    // Déchiffrer les champs
    const name = decryptWithKey(fiche.name, userKey);
    const ville = decryptWithKey(fiche.ville, userKey);
    const type = decryptWithKey(fiche.type, userKey);
    const etat = decryptWithKey(fiche.etat, userKey);

    // Déchiffrer les champs optionnels s'ils existent
    const difficulte_acces = fiche.difficulte_acces
      ? decryptWithKey(fiche.difficulte_acces, userKey)
      : undefined;
    const risque_oxygene = fiche.risque_oxygene
      ? decryptWithKey(fiche.risque_oxygene, userKey)
      : undefined;
    const acces_souterrain = fiche.acces_souterrain
      ? decryptWithKey(fiche.acces_souterrain, userKey)
      : undefined;
    // §V8 contrats : le sync stocke `praticite_souterrain` comme String (model
    // Mongoose). Si le client a envoyé un array, on a JSON.stringify avant
    // encrypt (cf. sync). Au decrypt, on tente de parser le JSON pour restaurer
    // l'array — fallback string brute si le contenu n'était pas du JSON.
    let praticite_souterrain: any = undefined;
    if (fiche.praticite_souterrain) {
      const decryptedPraticite = decryptWithKey(
        fiche.praticite_souterrain,
        userKey,
      );
      if (
        typeof decryptedPraticite === "string" &&
        decryptedPraticite.startsWith("[") &&
        decryptedPraticite.endsWith("]")
      ) {
        try {
          praticite_souterrain = JSON.parse(decryptedPraticite);
        } catch {
          praticite_souterrain = decryptedPraticite;
        }
      } else {
        praticite_souterrain = decryptedPraticite;
      }
    }
    const etat_general = fiche.etat_general
      ? decryptWithKey(fiche.etat_general, userKey)
      : undefined;
    const commentaire = fiche.commentaire
      ? decryptWithKey(fiche.commentaire, userKey)
      : "";
    const accessibilite = fiche.accessibilite
      ? decryptWithKey(fiche.accessibilite, userKey)
      : "";
    const interets = fiche.interets
      ? decryptWithKey(fiche.interets, userKey)
      : "";

    // Déchiffrer les champs tableaux (chaque élément est chiffré individuellement)
    // Robustesse: try/catch par élément pour qu'un élément invalide ne bloque pas toute la fiche
    const equipement_conseille = fiche.equipement_conseille
      ? fiche.equipement_conseille
          .filter((item: string) => item && item.length > 0)
          .map((item: string) => {
            try {
              return decryptWithKey(item, userKey);
            } catch {
              return item; // Fallback: plaintext ou donnée corrompue
            }
          })
      : [];
    const surface = fiche.surface
      ? fiche.surface
          .filter((item: string) => item && item.length > 0)
          .map((item: string) => {
            try {
              return decryptWithKey(item, userKey);
            } catch {
              return item;
            }
          })
      : [];
    const type_galeries = fiche.type_galeries
      ? fiche.type_galeries
          .filter((item: string) => item && item.length > 0)
          .map((item: string) => {
            try {
              return decryptWithKey(item, userKey);
            } catch {
              return item;
            }
          })
      : [];

    // Construire l'objet fiche déchifré sans les versions chiffrées
    return {
      _id: fiche._id,
      name,
      ville,
      type,
      etat,
      difficulte_acces,
      risque_oxygene,
      acces_souterrain,
      praticite_souterrain,
      etat_general,
      commentaire,
      accessibilite,
      equipement_conseille,
      surface,
      type_galeries,
      interets,
      center_cavite: fiche.center_cavite,
      points_ids: fiche.points_ids,
      userId: fiche.userId,
      date_creation: fiche.date_creation,
      date_modification: fiche.date_modification,
      version: fiche.version || 1,
    };
  } catch (error) {
    authHelpersLogger.error("Erreur lors du déchiffrement de la fiche", {
      error: error instanceof Error ? error.message : String(error),
      // HIGH-001: stack trace supprimé pour sécurité,
    });
    return fiche;
  }
}

// Synchroniser les données de l'utilisateur vers la base de données
export async function syncUserDataToDB(userId: string): Promise<void> {
  authHelpersLogger.info("Synchronisation des données de l'utilisateur", {
    userId,
  });

  try {
    // Récupérer toutes les données en mémoire
    const points = memoryStorage.getAllPoints(userId);
    const fiches = memoryStorage.getAllFiches(userId);
    const lists = memoryStorage.getAllLists(userId); // Récupération des listes
    const userKey = memoryStorage.getUserEncryptionKey(userId);

    if (!userKey) {
      throw new Error("Clé de chiffrement non trouvée pour l'utilisateur");
    }

    // Récupérer les IDs des items modifiés depuis le dernier sync
    // Seuls ces items seront re-chiffrés et sauvegardés en DB
    const dirtyPointIds = memoryStorage.getDirtyPointIds(userId);
    const dirtyFicheIds = memoryStorage.getDirtyFicheIds(userId);
    const dirtyListIds = memoryStorage.getDirtyListIds(userId);

    authHelpersLogger.info("Dirty tracking", {
      userId,
      dirtyPoints: dirtyPointIds.size,
      dirtyFiches: dirtyFicheIds.size,
      dirtyLists: dirtyListIds.size,
    });

    // 1. Synchronisation des points

    // 1.1 Récupérer tous les points existants dans la base de données
    const allPointsInDB = await PointModel.find({ userId, deletedAt: null });

    // 1.2 Identifier les points à supprimer (présents dans DB mais plus en mémoire)
    const pointIdsInMemory = new Set(
      points.map((p: { _id: any }) => p._id.toString()),
    );
    const pointsToDelete = allPointsInDB.filter(
      (p) => !pointIdsInMemory.has((p._id as any).toString()),
    );

    // 1.3 Soft-delete les points qui n'existent plus en mémoire
    // (au lieu de hard-delete, pour que le mobile détecte la suppression via deletedAt)
    for (const pointToDelete of pointsToDelete) {
      authHelpersLogger.info("Soft-delete du point de la base de données", {
        userId,
        pointId: pointToDelete._id,
      });
      await PointModel.updateOne(
        { _id: pointToDelete._id },
        { $set: { deletedAt: new Date() } },
      );
    }

    // 1.4 Synchroniser uniquement les points modifiés (dirty tracking)
    const dirtyPoints = points.filter((p: { _id: any }) =>
      dirtyPointIds.has(p._id.toString()),
    );
    authHelpersLogger.info("Points à synchroniser", {
      userId,
      dirtyCount: dirtyPoints.length,
      totalCount: points.length,
    });
    for (const point of dirtyPoints) {
      // Le reste du code de synchronisation des points reste inchangé
      let pointFromDB = await PointModel.findById(point._id);

      if (!pointFromDB) {
        authHelpersLogger.info("Création d'un nouveau point", {
          userId,
          pointId: point._id,
        });
        pointFromDB = new PointModel({
          _id: point._id,
          userId: point.userId,
        });
      }

      const { name, description } = point;

      // Rechifrer les données modifiées
      if (name) {
        pointFromDB.name = await encryptUserData(userKey, name);
      }

      if (description) {
        pointFromDB.description = await encryptUserData(userKey, description);
      }

      // CORRECTION: Valider et chiffrer les coordonnées
      // Valider que les coordonnées sont présentes et valides
      if (
        (point as any).location &&
        Array.isArray((point as any).location.coordinates) &&
        (point as any).location.coordinates.length === 2 &&
        !isNaN((point as any).location.coordinates[0]) &&
        !isNaN((point as any).location.coordinates[1])
      ) {
        try {
          const locationData = {
            type: "Point",
            coordinates: [
              (point as any).location.coordinates[0].toString(),
              (point as any).location.coordinates[1].toString(),
            ],
          };

          // Chiffrer les données de localisation
          pointFromDB.location_encrypted = await encryptUserData(
            userKey,
            JSON.stringify(locationData),
          );
          authHelpersLogger.info("Coordonnées chiffrées pour le point", {
            userId,
            pointId: point._id,
          });
        } catch (locError) {
          authHelpersLogger.error(
            "Erreur lors du chiffrement des coordonnées pour le point",
            {
              userId,
              pointId: point._id,
              error:
                locError instanceof Error ? locError.message : String(locError),
              // HIGH-001: stack trace supprimé pour sécurité,
            },
          );
          return Promise.reject(
            new Error(
              `Erreur lors du chiffrement des coordonnées: ${
                locError &&
                typeof locError === "object" &&
                "message" in locError
                  ? (locError as any).message
                  : String(locError)
              }`,
            ),
          );
        }
      } else if (point.location_encrypted) {
        // Si nous avons déjà une version chiffrée, l'utiliser
        pointFromDB.location_encrypted = point.location_encrypted;
      } else {
        // Si aucune coordonnée n'est fournie, utiliser des coordonnées par défaut
        try {
          const defaultLocation = {
            type: "Point",
            coordinates: ["0", "0"],
          };
          pointFromDB.location_encrypted = await encryptUserData(
            userKey,
            JSON.stringify(defaultLocation),
          );
          authHelpersLogger.info(
            "Coordonnées par défaut utilisées pour le point",
            {
              userId,
              pointId: point._id,
            },
          );
        } catch (defLocError) {
          authHelpersLogger.error(
            "Erreur lors de la création des coordonnées par défaut pour le point",
            {
              userId,
              pointId: point._id,
              error:
                defLocError instanceof Error
                  ? defLocError.message
                  : String(defLocError),
              stack:
                defLocError instanceof Error ? defLocError.stack : undefined,
            },
          );
          return Promise.reject(
            new Error(
              `Erreur lors de la création des coordonnées par défaut: ${
                defLocError &&
                typeof defLocError === "object" &&
                "message" in defLocError
                  ? (defLocError as any).message
                  : String(defLocError)
              }`,
            ),
          );
        }
      }

      // IMPORTANT: Supprimer le champ location avant la sauvegarde pour éviter l'erreur MongoDB
      // MongoDB n'accepte pas { coordinates: [] } ou des coordonnées invalides
      (pointFromDB as any).location = undefined;

      // AJOUT IMPORTANT : Synchroniser le ficheId comme ObjectID ou le supprimer si nécessaire
      if ((point as any).ficheId) {
        try {
          // Si ficheId est déjà un ObjectID, l'utiliser directement
          if ((point as any).ficheId instanceof mongoose.Types.ObjectId) {
            pointFromDB.ficheId = (point as any).ficheId;
          }
          // Si c'est une chaîne valide, la convertir en ObjectID
          else if (mongoose.Types.ObjectId.isValid((point as any).ficheId)) {
            pointFromDB.ficheId = new mongoose.Types.ObjectId(
              (point as any).ficheId,
            );
          }
          // Sinon, laisser tel quel (mais c'est un cas d'erreur)
          else {
            authHelpersLogger.warn("ficheId invalide pour le point", {
              userId,
              pointId: point._id,
              ficheId: (point as any).ficheId,
            });
            pointFromDB.ficheId = (point as any).ficheId;
          }

          authHelpersLogger.info("Point associé à la fiche", {
            userId,
            pointId: point._id,
            ficheId: pointFromDB.ficheId,
          });
        } catch (idError) {
          authHelpersLogger.error("Erreur lors de la manipulation du ficheId", {
            userId,
            error: idError instanceof Error ? idError.message : String(idError),
            // HIGH-001: stack trace supprimé pour sécurité,
          });
          // En cas d'erreur, garder la valeur originale
          pointFromDB.ficheId = (point as any).ficheId;
        }
      } else {
        // Si ficheId est undefined/null dans la version mémoire, s'assurer qu'il est aussi null dans la BDD
        // C'est crucial pour les dissociations
        if (pointFromDB.ficheId) {
          authHelpersLogger.info(
            "Suppression de l'association entre le point et la fiche",
            {
              userId,
              pointId: point._id,
              ficheId: pointFromDB.ficheId,
            },
          );
          pointFromDB.ficheId = undefined;
        }
      }

      // Incrémenter la version pour le suivi de concurrence optimiste
      (pointFromDB as any).version = ((point as any).version || 0) + 1;

      // Sauvegarder le point
      await pointFromDB.save();

      authHelpersLogger.info("Point synchronisé", {
        userId,
        pointId: point._id,
      });
    }

    // 2. Synchronisation des fiches

    // 2.1 Récupérer toutes les fiches existantes dans la base de données
    const allFichesInDB = await FicheModel.find({ userId, deletedAt: null });

    // 2.2 Identifier les fiches à supprimer
    const ficheIdsInMemory = new Set(
      fiches.map((f) => (f._id as mongoose.Types.ObjectId).toString()),
    );
    const fichesToDelete = allFichesInDB.filter(
      (f) =>
        !ficheIdsInMemory.has((f._id as mongoose.Types.ObjectId).toString()),
    );

    // 2.3 Soft-delete les fiches qui n'existent plus en mémoire
    // (au lieu de hard-delete, pour que le mobile détecte la suppression via deletedAt)
    for (const ficheToDelete of fichesToDelete) {
      authHelpersLogger.info("Soft-delete de la fiche de la base de données", {
        userId,
        ficheId: ficheToDelete._id,
      });
      await FicheModel.updateOne(
        { _id: ficheToDelete._id },
        { $set: { deletedAt: new Date() } },
      );
    }

    // 2.4 Synchroniser uniquement les fiches modifiées (dirty tracking)
    const dirtyFiches = fiches.filter((f) =>
      dirtyFicheIds.has((f._id as mongoose.Types.ObjectId).toString()),
    );
    authHelpersLogger.info("Fiches à synchroniser", {
      userId,
      dirtyCount: dirtyFiches.length,
      totalCount: fiches.length,
    });
    for (const fiche of dirtyFiches) {
      // Vérifier si la fiche existe déjà dans la base de données
      let ficheFromDB = await FicheModel.findById(fiche._id);

      // Si la fiche n'existe pas, la créer
      if (!ficheFromDB) {
        authHelpersLogger.info("Création d'une nouvelle fiche", {
          userId,
          ficheId: fiche._id,
        });
        ficheFromDB = new FicheModel({
          _id: fiche._id,
          userId: fiche.userId,
          points_ids: fiche.points_ids,
          date_creation: fiche.date_creation || new Date(),
          date_modification: new Date(),
        });
      }

      // Chiffrer toutes les données de la fiche
      ficheFromDB.name = await encryptUserData(userKey, fiche.name);
      ficheFromDB.ville = await encryptUserData(userKey, fiche.ville);
      ficheFromDB.type = await encryptUserData(userKey, fiche.type);
      ficheFromDB.etat = await encryptUserData(userKey, fiche.etat);

      // Chiffrer les champs optionnels s'ils existent
      if (fiche.difficulte_acces) {
        ficheFromDB.difficulte_acces = await encryptUserData(
          userKey,
          fiche.difficulte_acces,
        );
      }

      if (fiche.risque_oxygene) {
        ficheFromDB.risque_oxygene = await encryptUserData(
          userKey,
          fiche.risque_oxygene,
        );
      }

      if (fiche.acces_souterrain) {
        ficheFromDB.acces_souterrain = await encryptUserData(
          userKey,
          fiche.acces_souterrain,
        );
      }

      if (fiche.praticite_souterrain) {
        // §V8 contrats : le schema Zod accepte union(string | array) pour
        // rétro-compat, mais le model Mongoose est String. Si on reçoit un
        // array (cas mobile multi-select), on JSON.stringify avant encrypt
        // (pattern existant côté mobile cf. types/sync.ts:36 "JSON string
        // d'un tableau, ou string simple"). Le decrypt côté lecture parse
        // back via la même convention.
        const praticiteValue = Array.isArray(fiche.praticite_souterrain)
          ? JSON.stringify(fiche.praticite_souterrain)
          : fiche.praticite_souterrain;
        ficheFromDB.praticite_souterrain = await encryptUserData(
          userKey,
          praticiteValue,
        );
      }

      if (fiche.etat_general) {
        ficheFromDB.etat_general = await encryptUserData(
          userKey,
          fiche.etat_general,
        );
      }

      // Chiffrer le commentaire s'il existe
      if ((fiche as any).commentaire) {
        (ficheFromDB as any).commentaire = await encryptUserData(
          userKey,
          (fiche as any).commentaire,
        );
      } else {
        (ficheFromDB as any).commentaire = "";
      }

      // Chiffrer le champ accessibilite
      if ((fiche as any).accessibilite) {
        (ficheFromDB as any).accessibilite = await encryptUserData(
          userKey,
          (fiche as any).accessibilite,
        );
      } else {
        (ficheFromDB as any).accessibilite = "";
      }

      // Chiffrer le champ interets
      if ((fiche as any).interets) {
        (ficheFromDB as any).interets = await encryptUserData(
          userKey,
          (fiche as any).interets,
        );
      } else {
        (ficheFromDB as any).interets = "";
      }

      // Chiffrer le tableau equipement_conseille (chaque élément)
      if (
        Array.isArray((fiche as any).equipement_conseille) &&
        (fiche as any).equipement_conseille.length > 0
      ) {
        (ficheFromDB as any).equipement_conseille = await Promise.all(
          (fiche as any).equipement_conseille.map((item: string) =>
            encryptUserData(userKey, item),
          ),
        );
      } else {
        (ficheFromDB as any).equipement_conseille = [];
      }

      // Chiffrer le tableau surface (chaque élément)
      if (
        Array.isArray((fiche as any).surface) &&
        (fiche as any).surface.length > 0
      ) {
        (ficheFromDB as any).surface = await Promise.all(
          (fiche as any).surface.map((item: string) =>
            encryptUserData(userKey, item),
          ),
        );
      } else {
        (ficheFromDB as any).surface = [];
      }

      // Chiffrer le tableau type_galeries (chaque élément)
      if (
        Array.isArray((fiche as any).type_galeries) &&
        (fiche as any).type_galeries.length > 0
      ) {
        (ficheFromDB as any).type_galeries = await Promise.all(
          (fiche as any).type_galeries.map((item: string) =>
            encryptUserData(userKey, item),
          ),
        );
      } else {
        (ficheFromDB as any).type_galeries = [];
      }

      // Synchroniser center_cavite (GeoJSON non chiffré)
      if ((fiche as any).center_cavite) {
        (ficheFromDB as any).center_cavite = (fiche as any).center_cavite;
      }

      ficheFromDB.points_ids = fiche.points_ids || [];

      // Journaliser pour faciliter le débogage
      authHelpersLogger.info("Fiche synchronisée avec points", {
        userId,
        ficheId: fiche._id,
        pointsCount: ficheFromDB.points_ids.length,
      });

      // Note: date_modification est gérée automatiquement par Mongoose timestamps
      // (updatedAt mappé à date_modification dans le schema)
      // Ne PAS la forcer manuellement : cela cassait le sync incrémental mobile
      // car toutes les fiches étaient marquées comme modifiées à chaque sync

      // Incrémenter la version pour le suivi de concurrence optimiste
      (ficheFromDB as any).version = ((fiche as any).version || 0) + 1;

      // Sauvegarder la fiche
      await ficheFromDB.save();

      authHelpersLogger.info("Fiche synchronisée", {
        userId,
        ficheId: fiche._id,
      });
    }

    // 3.1 Récupérer toutes les listes existantes dans la base de données
    const allListsInDB = await ListModel.find({ userId, deletedAt: null });

    // 3.2 Identifier les listes à supprimer (présentes dans DB mais plus en mémoire)
    const listIdsInMemory = new Set(
      lists.map((l) => (l._id as mongoose.Types.ObjectId).toString()),
    );
    const listsToDelete = allListsInDB.filter(
      (l) =>
        !listIdsInMemory.has((l._id as mongoose.Types.ObjectId).toString()),
    );

    // 3.3 Soft-delete les listes qui n'existent plus en mémoire
    // (au lieu de hard-delete, pour que le mobile détecte la suppression via deletedAt)
    for (const listToDelete of listsToDelete) {
      authHelpersLogger.info("Soft-delete de la liste de la base de données", {
        userId,
        listId: listToDelete._id,
      });
      await ListModel.updateOne(
        { _id: listToDelete._id },
        { $set: { deletedAt: new Date() } },
      );
    }

    // 3.4 Synchroniser uniquement les listes modifiées (dirty tracking)
    const dirtyLists = lists.filter((l) =>
      dirtyListIds.has((l._id as mongoose.Types.ObjectId).toString()),
    );
    authHelpersLogger.info("Listes à synchroniser", {
      userId,
      dirtyCount: dirtyLists.length,
      totalCount: lists.length,
    });
    for (const list of dirtyLists) {
      // Vérifier si la liste existe déjà dans la base de données
      let listFromDB = await ListModel.findById(list._id);

      // Chiffrer les champs sensibles
      const encryptedName = await encryptUserData(
        userKey,
        list.name || "Liste sans nom",
      );
      const encryptedDescription = await encryptUserData(
        userKey,
        list.description || "",
      );

      // Si la liste n'existe pas, la créer
      if (!listFromDB) {
        authHelpersLogger.info("Création d'une nouvelle liste", {
          userId,
          listId: list._id,
        });
        listFromDB = new ListModel({
          _id: list._id,
          userId,
          name: encryptedName,
          description: encryptedDescription,
          points: list.points || [],
          color: list.color || "#000000",
          icon: list.icon || "default-icon",
          version: 1,
        });
      } else {
        // Mettre à jour les champs existants
        listFromDB.name = encryptedName;
        listFromDB.description = encryptedDescription;
        listFromDB.points = list.points || [];
        listFromDB.color = list.color || "#000000";
        listFromDB.icon = list.icon || "default-icon";
        // Incrémenter la version pour le suivi de concurrence optimiste
        (listFromDB as any).version = ((list as any).version || 0) + 1;
      }

      // Sauvegarder la liste
      await listFromDB.save();

      authHelpersLogger.info("Liste synchronisée avec points", {
        userId,
        listId: list._id,
        pointsCount: listFromDB.points.length,
      });
    }

    memoryStorage.markAsSynced(userId);
    authHelpersLogger.info(
      "Données de l'utilisateur synchronisées avec succès",
      { userId },
    );
  } catch (error) {
    authHelpersLogger.error(
      "Erreur lors de la synchronisation des données utilisateur",
      {
        userId,
        error: error instanceof Error ? error.message : String(error),
        // HIGH-001: stack trace supprimé pour sécurité,
      },
    );
    throw error;
  }
}

// Fonction utilitaire pour chiffrer les données avec la clé utilisateur
// IMPORTANT: Utiliser le même algorithme et format que decryptWithKey (AES-256-GCM avec format iv:authTag:encrypted)
export async function encryptUserData(
  userKey: string,
  data: string,
): Promise<string> {
  const { encryptWithKey } = await import("../../utils/userEncryptionUtils");
  return encryptWithKey(data, userKey);
}
