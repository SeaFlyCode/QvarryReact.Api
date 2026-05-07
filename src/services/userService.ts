import mongoose from "mongoose";
import crypto from "crypto";
import { encrypt, decrypt, hashEmail } from "../utils/masterEncryptionUtils";
import UserModel, { IUser, IUserBase } from "../models/users";
import KeyModel from "../models/keys";
import {
  generateRSAKeyPair,
  encryptPrivateKey,
} from "../utils/rsaEncryptionUtils";
import dataArchiveService from "./dataArchiveService";
import { logger } from "./loggerService";
import { logPerformance } from "../utils/performanceLogger";

const userServiceLogger = logger.child({ service: "user-service" });

// Import des modèles pour la suppression en cascade RGPD
import PointModel from "../models/points";
import FicheModel from "../models/fiches";
import ListModel from "../models/lists";
import MessageModel from "../models/messages";
import ConversationModel from "../models/conversations";
import DataShareModel from "../models/dataShare";
import ContactModel from "../models/contacts";
import NotificationModel from "../models/notifications";
import RefreshTokenModel from "../models/refreshTokens";
import AuditLogModel from "../models/auditLogs";

// Création d'un utilisateur
export async function createUser(
  userData: Omit<IUserBase, "_id">,
): Promise<IUser> {
  userServiceLogger.info("Création d'un nouvel utilisateur", {
    email: userData.email,
  });

  // 1. Créer l'utilisateur en base
  const { result: newUser, duration: createDuration } = await logPerformance(
    "User.create",
    async () => await UserModel.create(userData),
    { slowThreshold: 1000 },
  );

  userServiceLogger.debug("Utilisateur créé en base", {
    userId: newUser._id.toString(),
    duration: createDuration,
  });

  try {
    // ⚠️ Pas de transaction MongoDB (nécessite replica set). Rollback manuel en cas d'échec (ligne 94).

    // 2. Générer la clé AES-256 pour le chiffrement des données utilisateur
    const aesKey = crypto.randomBytes(32).toString("hex"); // 256 bits
    const encryptedAESKey = encrypt(aesKey);

    // 3. Générer la paire de clés RSA 4096 bits pour le partage de données
    const { result: keys, duration: keyGenDuration } = await logPerformance(
      "User.generateKeys",
      async () => {
        const { publicKey, privateKey } = generateRSAKeyPair();
        const encryptedPrivateKey = encryptPrivateKey(privateKey);
        return { publicKey, encryptedPrivateKey };
      },
      { slowThreshold: 2000 },
    );

    userServiceLogger.debug("Clés RSA générées", {
      userId: newUser._id.toString(),
      duration: keyGenDuration,
    });

    // 4. Stocker les clés en base de données
    await Promise.all([
      // Clé AES-256 (pour chiffrer les données personnelles)
      KeyModel.create({
        userId: newUser._id,
        key: encryptedAESKey,
        type: "user", // Type standardisé pour compatibilité avec authControllers
        date: new Date(),
      }),
      // Clé publique RSA (pour recevoir des données partagées)
      KeyModel.create({
        userId: newUser._id,
        key: keys.publicKey,
        type: "rsa-public",
        date: new Date(),
      }),
      // Clé privée RSA chiffrée (pour déchiffrer les données reçues)
      KeyModel.create({
        userId: newUser._id,
        key: keys.encryptedPrivateKey,
        type: "rsa-private",
        date: new Date(),
      }),
    ]);

    userServiceLogger.info("Utilisateur créé avec clés AES-256 et RSA-4096", {
      userId: newUser._id.toString(),
      totalDuration: createDuration + keyGenDuration,
    });

    return newUser;
  } catch (error) {
    // Si la création des clés échoue, supprimer l'utilisateur créé
    await UserModel.findByIdAndDelete(newUser._id);
    userServiceLogger.error(
      "Erreur lors de la création des clés, utilisateur supprimé",
      {
        userId: newUser._id.toString(),
        error: error instanceof Error ? error.message : String(error),
        // HIGH-001: stack trace supprimé pour sécurité,
      },
    );
    throw new Error("Erreur lors de la création du compte utilisateur");
  }
}

// RGPD-001: Suppression complète d'un utilisateur et de TOUTES ses données (Art. 17 - Droit à l'effacement)
export async function deleteUserById(userId: string): Promise<{
  success: boolean;
  deletedData: {
    points: number;
    fiches: number;
    lists: number;
    messages: number;
    conversations: number;
    dataShares: number;
    contacts: number;
    notifications: number;
    refreshTokens: number;
    keys: number;
    auditLogs: number;
  };
}> {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new Error("L'ID utilisateur fourni n'est pas valide.");
  }

  const userObjectId = new mongoose.Types.ObjectId(userId);

  userServiceLogger.info(
    "Début de la suppression complète RGPD pour utilisateur",
    {
      userId,
    },
  );

  // ARCHIVAGE: Récupérer et archiver toutes les données avant suppression (RGPD compliant)
  userServiceLogger.info("Archivage des données avant suppression");

  // Récupérer l'utilisateur
  const user = await UserModel.findById(userObjectId).lean();
  if (user) {
    await dataArchiveService.archiveAndRecordDeletion(
      "user",
      userObjectId,
      user as Record<string, unknown>,
      userObjectId, // L'utilisateur lui-même demande la suppression
      { reason: "Suppression RGPD - Droit à l'effacement (Art. 17)" },
    );
  }

  // Archiver les points
  // BUG-003: Utilisation de Promise.all pour paralléliser l'archivage (éviter le pattern N+1)
  // §4.2.2: archivage RGPD doit inclure les soft-deleted (cascade complète)
  const pointsToArchive = await PointModel.find({
    userId: userObjectId,
  })
    .setOptions({ withDeleted: true })
    .lean();
  await Promise.all(
    pointsToArchive.map((point) =>
      dataArchiveService.archiveEntity(
        "point",
        point._id as mongoose.Types.ObjectId,
        point as Record<string, unknown>,
        userObjectId,
        {
          reason: "Suppression RGPD - cascade utilisateur",
          parentEntityType: "user",
          parentEntityId: userObjectId,
        },
      ),
    ),
  );

  // Archiver les fiches
  // §4.2.2: archivage RGPD doit inclure les soft-deleted (cascade complète)
  const fichesToArchive = await FicheModel.find({
    userId: userObjectId,
  })
    .setOptions({ withDeleted: true })
    .lean();
  await Promise.all(
    fichesToArchive.map((fiche) =>
      dataArchiveService.archiveEntity(
        "fiche",
        fiche._id as mongoose.Types.ObjectId,
        fiche as Record<string, unknown>,
        userObjectId,
        {
          reason: "Suppression RGPD - cascade utilisateur",
          parentEntityType: "user",
          parentEntityId: userObjectId,
        },
      ),
    ),
  );

  // Archiver les listes
  // §4.2.2: archivage RGPD doit inclure les soft-deleted (cascade complète)
  const listsToArchive = await ListModel.find({ userId: userObjectId })
    .setOptions({ withDeleted: true })
    .lean();
  await Promise.all(
    listsToArchive.map((list) =>
      dataArchiveService.archiveEntity(
        "list",
        list._id as mongoose.Types.ObjectId,
        list as Record<string, unknown>,
        userObjectId,
        {
          reason: "Suppression RGPD - cascade utilisateur",
          parentEntityType: "user",
          parentEntityId: userObjectId,
        },
      ),
    ),
  );

  // Archiver les messages
  const messagesToArchive = await MessageModel.find({
    senderId: userObjectId,
  }).lean();
  await Promise.all(
    messagesToArchive.map((msg) =>
      dataArchiveService.archiveEntity(
        "message",
        msg._id as mongoose.Types.ObjectId,
        msg as Record<string, unknown>,
        userObjectId,
        {
          reason: "Suppression RGPD - cascade utilisateur",
          parentEntityType: "user",
          parentEntityId: userObjectId,
        },
      ),
    ),
  );

  // Archiver les partages de données
  const sharesToArchive = await DataShareModel.find({
    $or: [{ senderId: userObjectId }, { recipientId: userObjectId }],
  }).lean();
  await Promise.all(
    sharesToArchive.map((share) =>
      dataArchiveService.archiveEntity(
        "dataShare",
        share._id as mongoose.Types.ObjectId,
        share as Record<string, unknown>,
        userObjectId,
        {
          reason: "Suppression RGPD - cascade utilisateur",
          parentEntityType: "user",
          parentEntityId: userObjectId,
        },
      ),
    ),
  );

  // Archiver les contacts
  const contactsToArchive = await ContactModel.find({
    $or: [{ userId: userObjectId }, { contactId: userObjectId }],
  }).lean();
  await Promise.all(
    contactsToArchive.map((contact) =>
      dataArchiveService.archiveEntity(
        "contact",
        contact._id as mongoose.Types.ObjectId,
        contact as Record<string, unknown>,
        userObjectId,
        {
          reason: "Suppression RGPD - cascade utilisateur",
          parentEntityType: "user",
          parentEntityId: userObjectId,
        },
      ),
    ),
  );

  // Archiver les notifications
  const notificationsToArchive = await NotificationModel.find({
    userId: userObjectId,
  }).lean();
  await Promise.all(
    notificationsToArchive.map((notif) =>
      dataArchiveService.archiveEntity(
        "notification",
        notif._id as mongoose.Types.ObjectId,
        notif as Record<string, unknown>,
        userObjectId,
        {
          reason: "Suppression RGPD - cascade utilisateur",
          parentEntityType: "user",
          parentEntityId: userObjectId,
        },
      ),
    ),
  );

  userServiceLogger.info("Archivage terminé. Suppression physique en cours");

  // ⚠️ Pas de transaction MongoDB (nécessite replica set). L'archivage préalable permet la restauration en cas d'interruption.

  // Exécuter toutes les suppressions en parallèle pour l'efficacité
  const [
    pointsResult,
    fichesResult,
    listsResult,
    messagesResult,
    conversationsUpdateResult,
    dataSharesResult,
    contactsResult,
    notificationsResult,
    refreshTokensResult,
    keysResult,
    auditLogsResult,
    userResult,
  ] = await Promise.all([
    // Supprimer tous les points créés par l'utilisateur
    PointModel.deleteMany({ userId: userObjectId }),

    // Supprimer toutes les fiches créées par l'utilisateur
    FicheModel.deleteMany({ userId: userObjectId }),

    // Supprimer toutes les listes créées par l'utilisateur
    ListModel.deleteMany({ userId: userObjectId }),

    // Supprimer tous les messages envoyés par l'utilisateur
    MessageModel.deleteMany({ senderId: userObjectId }),

    // Retirer l'utilisateur des conversations (ne pas supprimer les conversations des autres)
    ConversationModel.updateMany(
      { participants: userObjectId },
      { $pull: { participants: userObjectId } },
    ),

    // Supprimer tous les partages de données envoyés par l'utilisateur
    DataShareModel.deleteMany({
      $or: [{ senderId: userObjectId }, { recipientId: userObjectId }],
    }),

    // Supprimer tous les contacts (où l'utilisateur est propriétaire ou contact)
    ContactModel.deleteMany({
      $or: [{ userId: userObjectId }, { contactId: userObjectId }],
    }),

    // Supprimer toutes les notifications de l'utilisateur
    NotificationModel.deleteMany({ userId: userObjectId }),

    // Supprimer tous les refresh tokens
    RefreshTokenModel.deleteMany({ userId: userObjectId }),

    // Supprimer toutes les clés de chiffrement (AES et RSA)
    KeyModel.deleteMany({ userId: userObjectId }),

    // Anonymiser les logs d'audit (conserver pour conformité mais retirer l'identifiant)
    AuditLogModel.updateMany(
      { userId: userObjectId },
      {
        $set: {
          userId: null,
          details: "[RGPD] Données anonymisées suite à suppression de compte",
        },
      },
    ),

    // Supprimer le compte utilisateur
    UserModel.findByIdAndDelete(userId),
  ]);

  if (!userResult) {
    throw new Error("Utilisateur non trouvé.");
  }

  const deletedData = {
    points: pointsResult.deletedCount || 0,
    fiches: fichesResult.deletedCount || 0,
    lists: listsResult.deletedCount || 0,
    messages: messagesResult.deletedCount || 0,
    conversations: conversationsUpdateResult.modifiedCount || 0,
    dataShares: dataSharesResult.deletedCount || 0,
    contacts: contactsResult.deletedCount || 0,
    notifications: notificationsResult.deletedCount || 0,
    refreshTokens: refreshTokensResult.deletedCount || 0,
    keys: keysResult.deletedCount || 0,
    auditLogs: auditLogsResult.modifiedCount || 0,
  };

  userServiceLogger.info(
    "Suppression complète RGPD terminée pour utilisateur",
    {
      userId,
      deletedData,
    },
  );

  return { success: true, deletedData };
}

// Récupération de tous les utilisateurs
export async function getAllUsers(): Promise<IUser[]> {
  return UserModel.find({});
}

// Récupération d'un utilisateur par email (décrypté)
export async function getUserByEmail(email: string): Promise<IUser | null> {
  if (!email || typeof email !== "string")
    throw new Error("L'email fourni n'est pas valide.");

  const emailHashValue = hashEmail(email);

  // Recherche rapide par hash indexé
  const user = await UserModel.findOne({ emailHash: emailHashValue }).select(
    "+password +password_history +reset_password_token +email_verification_token +email_verification_code +two_factor_secret +two_factor_recovery_codes",
  );
  if (user) return user;

  // Fallback : scan pour les anciens utilisateurs sans emailHash (migration progressive)
  const users = await UserModel.find({ emailHash: { $exists: false } }).select(
    "+password +password_history +reset_password_token +email_verification_token +email_verification_code +two_factor_secret +two_factor_recovery_codes",
  );
  for (const u of users) {
    const decryptedEmail = decrypt(u.email);
    if (decryptedEmail === email) {
      // Migrer ce user en ajoutant le hash
      u.emailHash = emailHashValue;
      await u.save();
      return u;
    }
  }
  return null;
}

// Récupération d'un utilisateur par ID
export async function getUserById(userId: string): Promise<IUser | null> {
  if (!mongoose.Types.ObjectId.isValid(userId))
    throw new Error("L'ID fourni n'est pas valide.");
  return UserModel.findById(userId).select(
    "+password +password_history +reset_password_token +email_verification_token +email_verification_code +two_factor_secret +two_factor_recovery_codes",
  );
}

// Mise à jour d'un utilisateur par ID
export async function updateUserById(
  userId: string,
  updatedUser: Partial<IUser>,
): Promise<void> {
  if (!mongoose.Types.ObjectId.isValid(userId))
    throw new Error("L'ID fourni n'est pas valide.");
  const FORBIDDEN_UPDATE_FIELDS = ['is_admin', 'is_blocked', 'is_admin_validated', 'password', 'password_history'];
  FORBIDDEN_UPDATE_FIELDS.forEach(f => delete (updatedUser as Record<string, unknown>)[f]);
  const result = await UserModel.updateOne(
    { _id: userId },
    { $set: updatedUser },
  );
  if (result.modifiedCount === 0)
    throw new Error(
      "Aucun utilisateur trouvé avec cet ID ou aucune mise à jour effectuée.",
    );
  userServiceLogger.info("Utilisateur mis à jour avec succès", { userId });
}
