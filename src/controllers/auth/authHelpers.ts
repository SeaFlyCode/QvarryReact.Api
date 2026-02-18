import { maskEmail } from "../../utils/logUtils";
import jwt from "jsonwebtoken";
import { memoryStorage } from "../../services/memoryStorageService";
import PointModel from "../../models/points";
import FicheModel from "../../models/fiches";
import ListModel from "../../models/lists";
import KeysModel from "../../models/keys";
import { decrypt, encrypt } from "../../utils/masterEncryptionUtils";
import { decryptUserKeys } from "../../utils/userEncryptionUtils";
import crypto from "crypto";
import mongoose from "mongoose";
import { redisSessionService } from "../../services/redisSessionService";
import { jwtKeyManager } from "../../utils/jwtKeyManager";
import dataArchiveService from "../../services/dataArchiveService";

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
    console.warn(
      `⚠️ [SECURITY] Email bloqué pour 30min après 5 tentatives: ${maskEmail(email)}`,
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
export async function recordFailedLogin(email: string): Promise<void> {
  await redisSessionService.recordLoginAttempt(email, false);
  const attempt = await redisSessionService.getLoginAttempts(email);
  console.warn(
    `⚠️ [SECURITY] Tentative de connexion échouée pour: ${maskEmail(email)} (${attempt?.attempts || 1} tentatives)`,
  );
}

// Réinitialiser les tentatives après un login réussi
export async function resetLoginAttempts(email: string): Promise<void> {
  await redisSessionService.resetLoginAttempts(email);
}

// Générer un token JWT sécurisé avec des claims appropriés (courte durée)
// REM-003: Support du key versioning pour rotation de clés
export function generateSecureToken(
  userId: string,
  isAdmin: boolean = false,
  tokenId?: string,
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
  const token = jwt.sign(
    {
      id: userId,
      isAdmin,
      iat: Math.floor(Date.now() / 1000), // Issued at
      jti, // JWT ID unique pour l'invalidation
      kv: version, // REM-003: Key Version pour le versioning
    },
    secret,
    {
      expiresIn: expiresIn, // Durée courte configurable
      algorithm: "HS256",
      issuer: "qvarry-api",
      audience: "qvarry-client",
    } as jwt.SignOptions,
  );

  return { token, tokenId: jti, keyVersion: version };
}

// ═══════════════════════════════════════════════════════════════════════════
// CHARGEMENT ET DÉCHIFFREMENT DES DONNÉES UTILISATEUR
// ═══════════════════════════════════════════════════════════════════════════

// NOUVEAU: Charger et déchiffrer toutes les données utilisateur (VERSION OPTIMISÉE)
export async function loadAndDecryptUserData(userId: string): Promise<void> {
  const startTime = Date.now();
  console.log(`🚀 Chargement des données de l'utilisateur ${userId}...`);

  // 1. Récupérer la clé AES utilisateur (type "user") - IGNORE les clés RSA
  let userKeyData = await KeysModel.findOne({
    userId,
    type: "user", // IMPORTANT : Chercher uniquement la clé AES, pas les clés RSA
  });

  // Si la clé AES utilisateur n'existe pas, la créer
  if (!userKeyData || !userKeyData.key) {
    console.log(`⚠️ Création d'une clé AES utilisateur pour ${userId}...`);
    const key = crypto.randomBytes(32).toString("hex");
    const cryptedKey = encrypt(key);

    // Créer une nouvelle clé AES de type "user"
    userKeyData = await KeysModel.create({
      userId: new mongoose.Types.ObjectId(userId),
      key: cryptedKey,
      type: "user", // Type "user" = clé AES pour les données
      date: new Date(),
    });
    console.log(`✅ Clé AES utilisateur créée pour ${userId}`);
  }

  // Vérifier que la clé existe avant de la déchiffrer
  if (!userKeyData || !userKeyData.key) {
    throw new Error(
      `Impossible de récupérer la clé AES utilisateur pour ${userId}`,
    );
  }

  // Vérifier que ce n'est pas une clé RSA (sécurité)
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
    PointModel.find({ userId }).lean(), // .lean() pour de meilleures performances
    FicheModel.find({ userId }).lean(),
    ListModel.find({ userId }).lean(),
  ]);

  console.log(
    `📊 Chargement de ${points.length} points, ${fiches.length} fiches, ${lists.length} listes...`,
  );

  // 4. Déchiffrer tous les points EN PARALLÈLE
  const decryptPointsStart = Date.now();
  const decryptedPoints = await Promise.all(
    points.map((point) => decryptPointOptimized(point, userKey)),
  );
  console.log(`⚡ Points déchiffrés en ${Date.now() - decryptPointsStart}ms`);

  // 5. Déchiffrer toutes les fiches EN PARALLÈLE
  const decryptFichesStart = Date.now();
  const decryptedFiches = await Promise.all(
    fiches.map((fiche) => decryptFicheOptimized(fiche, userKey)),
  );
  console.log(`⚡ Fiches déchiffrées en ${Date.now() - decryptFichesStart}ms`);

  // 6. Stocker toutes les données déchiffrées en mémoire
  decryptedPoints.forEach((point) =>
    memoryStorage.storePoint(userId, point as any),
  );
  decryptedFiches.forEach((fiche) =>
    memoryStorage.storeFiche(userId, fiche as any),
  );
  lists.forEach((list) => memoryStorage.storeList(userId, list as any));

  // Marquer comme synchronisé (pas de modifications à ce stade)
  memoryStorage.markAsSynced(userId);

  const totalTime = Date.now() - startTime;
  console.log(
    `✅ Données de l'utilisateur ${userId} chargées en ${totalTime}ms`,
  );
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
      const parsedLocation = JSON.parse(locationJson);

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
    };
  } catch (error) {
    console.error("Erreur lors du déchiffrement du point:", error);
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
    const praticite_souterrain = fiche.praticite_souterrain
      ? decryptWithKey(fiche.praticite_souterrain, userKey)
      : undefined;
    const etat_general = fiche.etat_general
      ? decryptWithKey(fiche.etat_general, userKey)
      : undefined;
    const commentaire = fiche.commentaire
      ? decryptWithKey(fiche.commentaire, userKey)
      : "";
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
      points_ids: fiche.points_ids,
      userId: fiche.userId,
      date_creation: fiche.date_creation,
      date_modification: fiche.date_modification,
    };
  } catch (error) {
    console.error("Erreur lors du déchiffrement de la fiche:", error);
    return fiche;
  }
}

// Anciennes fonctions conservées pour compatibilité mais dépréciées
export async function decryptPoint(point: any, userId: string) {
  try {
    // Convertir userId string en ObjectId pour decryptUserKeys
    const userIdObjectId = new mongoose.Types.ObjectId(userId);

    // Déchiffrer les champs simples
    const name = await decryptUserKeys(userIdObjectId, point.name);
    const description = point.description
      ? await decryptUserKeys(userIdObjectId, point.description)
      : "";

    // Déchiffrer et parser les coordonnées
    let location = null;

    if (point.location_encrypted) {
      const locationJson = await decryptUserKeys(
        userIdObjectId,
        point.location_encrypted,
      );
      const parsedLocation = JSON.parse(locationJson);

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
      ...point.toObject(),
      name,
      description,
      location,
      location_encrypted: point.location_encrypted, // Conserver pour le rechiffrement ultérieur
    };
  } catch (error) {
    console.error("Erreur lors du déchiffrement du point:", error);
    return point;
  }
}

// Fonction pour déchiffrer une fiche - version originale
export async function decryptFiche(fiche: any, userId: string) {
  try {
    // Convertir userId string en ObjectId pour decryptUserKeys
    const userIdObjectId = new mongoose.Types.ObjectId(userId);

    // Déchiffrer les champs
    const name = await decryptUserKeys(userIdObjectId, fiche.name);
    const ville = await decryptUserKeys(userIdObjectId, fiche.ville);
    const type = await decryptUserKeys(userIdObjectId, fiche.type);
    const etat = await decryptUserKeys(userIdObjectId, fiche.etat);

    // Déchiffrer les champs optionnels s'ils existent
    const difficulte_acces = fiche.difficulte_acces
      ? await decryptUserKeys(userIdObjectId, fiche.difficulte_acces)
      : undefined;
    const risque_oxygene = fiche.risque_oxygene
      ? await decryptUserKeys(userIdObjectId, fiche.risque_oxygene)
      : undefined;
    const acces_souterrain = fiche.acces_souterrain
      ? await decryptUserKeys(userIdObjectId, fiche.acces_souterrain)
      : undefined;
    const praticite_souterrain = fiche.praticite_souterrain
      ? await decryptUserKeys(userIdObjectId, fiche.praticite_souterrain)
      : undefined;
    const etat_general = fiche.etat_general
      ? await decryptUserKeys(userIdObjectId, fiche.etat_general)
      : undefined;

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
      points_ids: fiche.points_ids,
      userId: fiche.userId,
      date_creation: fiche.date_creation,
      date_modification: fiche.date_modification,
    };
  } catch (error) {
    console.error("Erreur lors du déchiffrement de la fiche:", error);
    return fiche;
  }
}

// Synchroniser les données de l'utilisateur vers la base de données
export async function syncUserDataToDB(userId: string): Promise<void> {
  console.log(`Synchronisation des données de l'utilisateur ${userId}...`);

  try {
    // Récupérer toutes les données en mémoire
    const points = memoryStorage.getAllPoints(userId);
    const fiches = memoryStorage.getAllFiches(userId);
    const lists = memoryStorage.getAllLists(userId); // Récupération des listes
    const userKey = memoryStorage.getUserEncryptionKey(userId);

    if (!userKey) {
      throw new Error("Clé de chiffrement non trouvée pour l'utilisateur");
    }

    // 1. Synchronisation des points

    // 1.1 Récupérer tous les points existants dans la base de données
    const allPointsInDB = await PointModel.find({ userId });

    // 1.2 Identifier les points à supprimer (présents dans DB mais plus en mémoire)
    const pointIdsInMemory = new Set(
      points.map((p: { _id: any }) => p._id.toString()),
    );
    const pointsToDelete = allPointsInDB.filter(
      (p) => !pointIdsInMemory.has((p._id as any).toString()),
    );

    // 1.3 Supprimer les points qui n'existent plus en mémoire
    for (const pointToDelete of pointsToDelete) {
      console.log(
        `Suppression du point ${pointToDelete._id} de la base de données`,
      );
      // Archiver le point avant suppression (données chiffrées)
      await dataArchiveService.archiveAndRecordDeletion(
        "point",
        pointToDelete._id as mongoose.Types.ObjectId,
        pointToDelete.toObject() as unknown as Record<string, unknown>,
        userId,
        { reason: "Synchronisation - point supprimé par utilisateur" },
      );
      await PointModel.findByIdAndDelete(pointToDelete._id);
    }

    // 1.4 Synchroniser les points existants
    for (const point of points) {
      // Le reste du code de synchronisation des points reste inchangé
      let pointFromDB = await PointModel.findById(point._id);

      if (!pointFromDB) {
        console.log(
          `Création d'un nouveau point ${point._id} pour l'utilisateur ${userId}`,
        );
        pointFromDB = new PointModel({
          _id: point._id,
          userId: point.userId,
        });
      }

      const { name, description, location_encrypted } = point;

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
          console.log(`Coordonnées chiffrées pour le point ${point._id}`);
        } catch (locError) {
          console.error(
            `Erreur lors du chiffrement des coordonnées pour le point ${point._id}:`,
            locError,
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
          console.log(
            `Coordonnées par défaut utilisées pour le point ${point._id}`,
          );
        } catch (defLocError) {
          console.error(
            `Erreur lors de la création des coordonnées par défaut pour le point ${point._id}:`,
            defLocError,
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
            console.warn(
              `ficheId invalide pour le point ${point._id}: ${(point as any).ficheId}`,
            );
            pointFromDB.ficheId = (point as any).ficheId;
          }

          console.log(
            `Point ${point._id} associé à la fiche ${pointFromDB.ficheId}`,
          );
        } catch (idError) {
          console.error(`Erreur lors de la manipulation du ficheId:`, idError);
          // En cas d'erreur, garder la valeur originale
          pointFromDB.ficheId = (point as any).ficheId;
        }
      } else {
        // Si ficheId est undefined/null dans la version mémoire, s'assurer qu'il est aussi null dans la BDD
        // C'est crucial pour les dissociations
        if (pointFromDB.ficheId) {
          console.log(
            `Suppression de l'association entre le point ${point._id} et la fiche ${pointFromDB.ficheId}`,
          );
          pointFromDB.ficheId = undefined;
        }
      }

      // Sauvegarder le point
      await pointFromDB.save();

      console.log(
        `Point ${point._id} synchronisé pour l'utilisateur ${userId}`,
      );
    }

    // 2. Synchronisation des fiches

    // 2.1 Récupérer toutes les fiches existantes dans la base de données
    const allFichesInDB = await FicheModel.find({ userId });

    // 2.2 Identifier les fiches à supprimer
    const ficheIdsInMemory = new Set(
      fiches.map((f) => (f._id as mongoose.Types.ObjectId).toString()),
    );
    const fichesToDelete = allFichesInDB.filter(
      (f) =>
        !ficheIdsInMemory.has((f._id as mongoose.Types.ObjectId).toString()),
    );

    // 2.3 Supprimer les fiches qui n'existent plus en mémoire
    for (const ficheToDelete of fichesToDelete) {
      console.log(
        `Suppression de la fiche ${ficheToDelete._id} de la base de données`,
      );
      // Archiver la fiche avant suppression (données chiffrées)
      await dataArchiveService.archiveAndRecordDeletion(
        "fiche",
        ficheToDelete._id as mongoose.Types.ObjectId,
        ficheToDelete.toObject() as unknown as Record<string, unknown>,
        userId,
        { reason: "Synchronisation - fiche supprimée par utilisateur" },
      );
      await FicheModel.findByIdAndDelete(ficheToDelete._id);
    }

    // 2.4 Synchroniser les fiches existantes
    for (const fiche of fiches) {
      // Vérifier si la fiche existe déjà dans la base de données
      let ficheFromDB = await FicheModel.findById(fiche._id);

      // Si la fiche n'existe pas, la créer
      if (!ficheFromDB) {
        console.log(
          `Création d'une nouvelle fiche ${fiche._id} pour l'utilisateur ${userId}`,
        );
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
        ficheFromDB.praticite_souterrain = await encryptUserData(
          userKey,
          fiche.praticite_souterrain,
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

      ficheFromDB.points_ids = fiche.points_ids || [];

      // Journaliser pour faciliter le débogage
      console.log(
        `Fiche ${fiche._id}: ${ficheFromDB.points_ids.length} points synchronisés`,
      );

      // Mettre à jour la date de modification
      ficheFromDB.date_modification = new Date();

      // Sauvegarder la fiche
      await ficheFromDB.save();

      console.log(
        `Fiche ${fiche._id} synchronisée pour l'utilisateur ${userId}`,
      );
    }

    // 3.1 Récupérer toutes les listes existantes dans la base de données
    const allListsInDB = await ListModel.find({ userId });

    // 3.2 Identifier les listes à supprimer (présentes dans DB mais plus en mémoire)
    const listIdsInMemory = new Set(
      lists.map((l) => (l._id as mongoose.Types.ObjectId).toString()),
    );
    const listsToDelete = allListsInDB.filter(
      (l) =>
        !listIdsInMemory.has((l._id as mongoose.Types.ObjectId).toString()),
    );

    // 3.3 Supprimer les listes qui n'existent plus en mémoire
    for (const listToDelete of listsToDelete) {
      console.log(
        `Suppression de la liste ${listToDelete._id} de la base de données`,
      );
      // Archiver la liste avant suppression
      await dataArchiveService.archiveAndRecordDeletion(
        "list",
        listToDelete._id as mongoose.Types.ObjectId,
        listToDelete.toObject() as unknown as Record<string, unknown>,
        userId,
        { reason: "Synchronisation - liste supprimée par utilisateur" },
      );
      await ListModel.findByIdAndDelete(listToDelete._id);
    }

    // 3.4 Synchroniser les listes existantes
    for (const list of lists) {
      // Vérifier si la liste existe déjà dans la base de données
      let listFromDB = await ListModel.findById(list._id);

      // Si la liste n'existe pas, la créer
      if (!listFromDB) {
        console.log(
          `Création d'une nouvelle liste ${list._id} pour l'utilisateur ${userId}`,
        );
        listFromDB = new ListModel({
          _id: list._id,
          userId,
          // Utiliser les noms de champs du modèle lists.ts
          name: list.name || "Liste sans nom", // Valeur par défaut pour éviter l'erreur de validation
          description: list.description || "",
          points: list.points || [], // Utiliser pointIds de la mémoire -> points du modèle
          color: list.color || "#000000",
          icon: list.icon || "default-icon",
        });
      } else {
        // Mettre à jour les champs existants
        listFromDB.name = list.name || "Liste sans nom";
        listFromDB.description = list.description || "";
        listFromDB.points = list.points || []; // Utiliser pointIds de la mémoire -> points du modèle
        listFromDB.color = list.color || "#000000";
        listFromDB.icon = list.icon || "default-icon";
      }

      // Sauvegarder la liste
      await listFromDB.save();

      console.log(
        `Liste ${list._id} synchronisée pour l'utilisateur ${userId} avec ${listFromDB.points.length} points`,
      );
    }

    memoryStorage.markAsSynced(userId);
    console.log(
      `Données de l'utilisateur ${userId} synchronisées avec succès.`,
    );
  } catch (error) {
    console.error(
      `Erreur lors de la synchronisation des données utilisateur ${userId}:`,
      error,
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
