import { getErrorMessage } from "../utils/errorUtils";
import { Request, Response } from "express";
import {
  createUser,
  deleteUserById,
  updateUserById,
  getUserByEmail,
} from "../services/userService";
import bcrypt from "bcrypt";
import crypto from "crypto";
import UserModel, { IUser, IUserBase } from "../models/users";
import { encrypt, decrypt, hashEmail } from "../utils/masterEncryptionUtils";
import {
  validatePasswordStrength,
  isPasswordInHistory,
  addToPasswordHistory,
} from "../utils/passwordUtils";
import { validateEmail } from "../utils/emailUtils";
import {
  sendWelcomeEmail,
  generateVerificationCode,
  sendVerificationEmail,
  sendAdminPendingValidationEmail,
  formatEmailDate,
} from "../services/emailService";
import { refreshTokenService } from "../services/refreshTokenService";
import { redisSessionService } from "../services/redisSessionService";
import { auditService } from "../services/auditService";
import { logger } from "../services/loggerService";
import { z } from "zod";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
} from "../services/notificationPreferencesService";
import { webSocketService } from "../services/webSocketService";
import {
  serializeUserForApi,
  serializeUsersForApi,
  SENSITIVE_FIELDS as USER_SERIALIZER_SENSITIVE_FIELDS,
} from "../utils/userSerializer";

const userLogger = logger.child({ service: "users" });

/**
 * Helper : récupère le deviceId origin depuis le header `x-device-id`
 * pour éviter qu'un device se notifie lui-même via sync_update.
 */
function getOriginDeviceId(req: Request): string | undefined {
  const raw = req.headers["x-device-id"];
  if (typeof raw === "string" && raw.length > 0 && raw.length <= 128) {
    return raw;
  }
  return undefined;
}

// §4.1.5 B: utilise SENSITIVE_FIELDS canoniques de userSerializer pour le
// .select() Mongoose (cohérence avec la sanitize côté response).
const EXCLUDED_USER_FIELDS = USER_SERIALIZER_SENSITIVE_FIELDS;

/**
 * Génère un code de contact cryptographiquement sûr
 * Utilise crypto.randomBytes() qui est un CSPRNG
 */
function generateSecureContactCode(): number {
  // Générer 4 bytes aléatoires (32 bits)
  const randomBytes = crypto.randomBytes(4);

  // Convertir en nombre non signé
  const randomNumber = randomBytes.readUInt32BE(0);

  // Mapper dans la plage 100000-999999 (6 chiffres)
  return (randomNumber % 900000) + 100000;
}

// Alternative: Code alphanumérique plus sécurisé
function generateSecureAlphanumericCode(length: number = 8): string {
  const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Sans I, O, 0, 1 pour lisibilité
  const bytes = crypto.randomBytes(length);
  let code = "";

  for (let i = 0; i < length; i++) {
    code += charset[bytes[i] % charset.length];
  }

  return code; // Ex: "K7M2P9XN"
}

export async function handleCreateUser(req: Request, res: Response) {
  try {
    const { name, surname, password, email } = req.body;

    // Input validation
    if (!name || !surname || !password || !email) {
      return res.status(400).json({ message: "Tous les champs sont requis." });
    }

    // Déduire l'IP depuis la requête
    const ip_creation =
      req.ip ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress ||
      "unknown";

    // Vérification de l'email
    const emailValidation = validateEmail(email);
    if (!emailValidation.isValid) {
      return res.status(400).json({ message: emailValidation.message });
    }

    //vérification de la force du mot de passe
    const passwordStrength = validatePasswordStrength(password);
    if (!passwordStrength.isValid) {
      return res.status(400).json({ message: passwordStrength.message });
    }

    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({
        message:
          "Si cet email est associé à un compte, vous recevrez un email pour continuer.",
      });
    }

    let contact_code: number = 0;
    let isUnique = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 10;

    while (!isUnique && attempts < MAX_ATTEMPTS) {
      contact_code = generateSecureContactCode();
      const existing = await UserModel.findOne({ contact_code });
      if (!existing) isUnique = true;
      attempts++;
    }

    if (!isUnique) {
      // Fallback: utiliser un code plus long ou alphanumérique
      contact_code = parseInt(generateSecureAlphanumericCode(8), 36);
    }

    // Génération du token et code de vérification d'email
    const emailVerificationToken = crypto.randomBytes(32).toString("hex");
    const emailVerificationCode = generateVerificationCode(6);
    const emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 heures

    // Log sécurisé sans exposer les valeurs sensibles
    userLogger.info("Token de verification genere", {
      tokenLength: emailVerificationToken.length,
    });
    userLogger.info("Code de verification envoye", {
      codeLength: emailVerificationCode.length,
    });

    const passwordHash = await bcrypt.hash(password, 12);
    const newUser: IUserBase = {
      name: encrypt(name),
      surname: encrypt(surname),
      password: passwordHash,
      email: encrypt(email),
      emailHash: hashEmail(email),
      ip_creation: encrypt(ip_creation),
      ip_last_connection: encrypt(ip_creation),
      creation_date: new Date(),
      last_connection: new Date(),
      is_admin: false,
      is_blocked: false,
      contact_code: contact_code, // Toujours stocké en number, usage sous la forme @123456 côté client
      reset_password_token: "",
      reset_password_expires: new Date(),
      is_verified: false,
      is_auth: false,
      // Vérification d'email
      email_verification_token: emailVerificationToken,
      email_verification_code: emailVerificationCode,
      email_verification_expires: emailVerificationExpires,
      // Validation par admin
      is_admin_validated: false,
      admin_validation_rejected: false,
      // RGPD-002: Consentement explicite (devra être géré côté client)
      gdpr_consent: false,
      gdpr_consent_date: undefined,
      gdpr_consent_version: "1.0",
      // 2FA désactivé par défaut
      two_factor_enabled: false,
      // Préférences de notifications (activées par défaut)
      login_notifications_enabled: true,
      // Stockage photos (quota par défaut: 2 Go)
      storage_quota: 2147483648, // 2 GB
      storage_used: 0,
    };

    // Utilise la fonction du service pour créer l'utilisateur
    // Note: Les 3 clés de chiffrement (AES-256, RSA-Public, RSA-Private)
    // sont automatiquement générées dans le service createUser()
    const createdUser = await createUser(newUser);

    userLogger.info("Utilisateur créé avec succès", {
      userId: createdUser._id.toString(),
      action: "create_user",
      emailVerificationRequired: true,
    });

    // Envoi de l'email de bienvenue avec le lien de vérification
    const frontendUrl = process.env.FRONTEND_URL || "https://app.qvarry.fr";
    // Le lien redirige vers la page de connexion avec l'email + le code pré-remplis
    const verificationLink = `${frontendUrl}/login?verify=${encodeURIComponent(email)}&code=${emailVerificationCode}`;

    // Envoi asynchrone (ne bloque pas la réponse)
    sendWelcomeEmail(
      email,
      name,
      verificationLink,
      emailVerificationCode,
    ).catch((err) =>
      userLogger.error("Erreur envoi email bienvenue", {
        error: err instanceof Error ? err.message : String(err),
      }),
    );

    // SEC-043: Ne pas exposer contact_code dans la réponse (donnée sensible)
    res.status(201).json({
      message:
        "Utilisateur créé avec succès ! Un email de vérification a été envoyé.",
      userId: createdUser._id,
      requiresEmailVerification: true,
    });
  } catch (error: unknown) {
    userLogger.error("Erreur creation utilisateur", {
      error: getErrorMessage(error),
    });
    return res.status(500).json({
      message: "Erreur lors de la création de l'utilisateur.",
      error: "Une erreur interne est survenue",
    });
  }
}

export async function handleGetAllUsers(req: Request, res: Response) {
  try {
    // Pagination
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(
      Math.max(1, parseInt(req.query.limit as string) || 50),
      200,
    );
    const skip = (page - 1) * limit;

    // SEC-044: Exclure les champs sensibles de la query Mongoose
    const selectFields = EXCLUDED_USER_FIELDS.map((field) => `-${field}`).join(
      " ",
    );

    // Récupérer les utilisateurs avec pagination depuis MongoDB
    const [users, total] = await Promise.all([
      UserModel.find()
        .select(selectFields)
        .sort({ creation_date: -1 })
        .skip(skip)
        .limit(limit),
      UserModel.countDocuments(),
    ]);

    // §4.1.5 B: serializeUsersForApi (déchiffre + supprime sensibles + IPs)
    const sanitizedUsers = serializeUsersForApi(users);

    res.status(200).json({
      data: sanitizedUsers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: unknown) {
    userLogger.error("Erreur recuperation utilisateurs", {
      error: getErrorMessage(error),
    });
    return res.status(500).json({
      message: "Erreur lors de la récupération des utilisateurs.",
      error: "Une erreur interne est survenue",
    });
  }
}

/**
 * Récupère un utilisateur par son ID depuis MongoDB et retourne le profil décrypté et sanitisé.
 * Extraction de la logique commune utilisée par handleGetUserById et handleGetMe.
 */
async function fetchAndFormatUser(
  userId: string,
): Promise<ReturnType<typeof serializeUserForApi> | null> {
  // SEC-044 + §4.1.5 B: query Mongoose .select(-sensitive) pour bandwidth,
  // puis serializeUserForApi (déchiffre + supprime sensibles + IPs).
  const selectFields = EXCLUDED_USER_FIELDS.map((field) => `-${field}`).join(
    " ",
  );

  const user = await UserModel.findById(userId).select(selectFields);
  if (!user) {
    return null;
  }

  return serializeUserForApi(user);
}

export async function handleGetUserById(req: Request, res: Response) {
  try {
    const userId = req.params.id;
    if (!userId) {
      return res.status(400).json({ message: "ID utilisateur requis" });
    }

    // SEC-033: Vérifier que l'utilisateur peut accéder à ce profil
    const requestingUser = (req as any).user;
    if (!requestingUser) {
      return res.status(401).json({ message: "Authentification requise" });
    }

    // Autoriser si: même utilisateur OU admin
    if (requestingUser.id !== userId && !requestingUser.isAdmin) {
      return res.status(403).json({
        message: "Vous n'êtes pas autorisé à accéder à ce profil.",
      });
    }

    const sanitized = await fetchAndFormatUser(userId);
    if (!sanitized) {
      return res.status(404).json({ message: "Utilisateur non trouvé." });
    }

    res.status(200).json(sanitized);
  } catch (error: unknown) {
    userLogger.error("Erreur recuperation utilisateur", {
      userId: req.params.id,
      error: getErrorMessage(error),
    });
    return res.status(500).json({ message: "Une erreur interne est survenue" });
  }
}

/**
 * GET /users/me
 * Retourne le profil de l'utilisateur connecté.
 * Équivalent de handleGetUserById mais sans vérification d'autorisation
 * puisque l'utilisateur accède toujours à son propre profil.
 */
export async function handleGetMe(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentification requise" });
    }

    const sanitized = await fetchAndFormatUser(userId);
    if (!sanitized) {
      return res.status(404).json({ message: "Utilisateur non trouvé." });
    }

    res.status(200).json(sanitized);
  } catch (error: unknown) {
    userLogger.error("Erreur recuperation profil utilisateur connecté", {
      userId: req.user?.id,
      error: getErrorMessage(error),
    });
    return res.status(500).json({ message: "Une erreur interne est survenue" });
  }
}

export async function handleDeleteUser(req: Request, res: Response) {
  try {
    const userId = req.params.id;
    if (!userId) {
      return res.status(400).json({ message: "ID utilisateur requis" });
    }

    // SEC-035: Vérifier que l'utilisateur peut supprimer ce compte
    const requestingUser = (req as any).user;
    if (!requestingUser) {
      return res.status(401).json({ message: "Authentification requise" });
    }

    // Autoriser si: même utilisateur OU admin
    if (requestingUser.id !== userId && !requestingUser.isAdmin) {
      return res.status(403).json({
        message: "Vous n'êtes pas autorisé à supprimer ce compte.",
      });
    }

    await deleteUserById(userId);

    userLogger.info("Utilisateur supprimé avec succès", {
      userId,
      action: "delete_user",
      deletedBy: requestingUser.id,
    });

    res.status(200).json({ message: "Utilisateur supprimé avec succès." });
  } catch (error: unknown) {
    userLogger.error("Erreur suppression utilisateur", {
      userId: req.params.id,
      error: getErrorMessage(error),
    });
    return res.status(400).json({ message: "Une erreur interne est survenue" });
  }
}

export async function handleUpdateUser(req: Request, res: Response) {
  try {
    const userId = req.params.id;
    const {
      name,
      surname,
      password,
      email,
      pseudo,
      showPseudo,
      currentPassword,
      login_notifications_enabled,
    } = req.body;

    // SEC-034: Vérifier que l'utilisateur peut modifier ce compte
    const requestingUser = (req as any).user;
    if (!requestingUser) {
      return res.status(401).json({ message: "Authentification requise" });
    }

    // Autoriser si: même utilisateur OU admin
    if (requestingUser.id !== userId && !requestingUser.isAdmin) {
      return res.status(403).json({
        message: "Vous n'êtes pas autorisé à modifier ce compte.",
      });
    }

    // Vérification obligatoire du mot de passe actuel
    if (!currentPassword) {
      return res.status(400).json({
        message:
          "Veuillez entrer votre mot de passe actuel pour modifier votre profil.",
        requiresCurrentPassword: true,
      });
    }

    // Récupérer l'utilisateur pour vérifier le mot de passe
    const user = await UserModel.findById(userId).select(
      "+password +password_history",
    );
    if (!user) {
      return res.status(404).json({ message: "Utilisateur non trouvé." });
    }

    // Vérifier que le mot de passe actuel est correct
    const isPasswordValid = await bcrypt.compare(
      currentPassword,
      user.password,
    );
    if (!isPasswordValid) {
      await auditService.log({
        userId,
        action: "PROFILE_UPDATE_FAILED",
        level: "warning",
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.headers["user-agent"],
        details: { reason: "invalid_current_password" },
      });
      return res.status(401).json({
        message: "Mot de passe actuel incorrect.",
        invalidPassword: true,
      });
    }

    // email validation
    if (email) {
      const emailValidation = validateEmail(email);
      if (!emailValidation.isValid) {
        return res.status(400).json({ message: emailValidation.message });
      }
    }

    // password validation (nouveau mot de passe)
    if (password) {
      const passwordStrength = validatePasswordStrength(password);
      if (!passwordStrength.isValid) {
        return res.status(400).json({ message: passwordStrength.message });
      }
    }

    if (!userId) {
      return res.status(400).json({ message: "ID utilisateur requis" });
    }

    // REM-006: Si un mot de passe est fourni, vérifier l'historique
    if (password) {
      // Vérifier que le nouveau mot de passe n'est pas dans l'historique des 5 derniers
      const passwordHistory = user.password_history || [];
      const allPasswordsToCheck = [user.password, ...passwordHistory];

      const isInHistory = await isPasswordInHistory(
        password,
        allPasswordsToCheck,
      );
      if (isInHistory) {
        userLogger.warn("Tentative reutilisation ancien mot de passe", {
          userId,
        });
        return res.status(400).json({
          message:
            "Ce mot de passe a déjà été utilisé récemment. Veuillez en choisir un nouveau.",
          passwordReused: true,
        });
      }
    }

    const updatedUser: Partial<IUserBase> = {};

    if (name) updatedUser.name = encrypt(name);
    if (surname) updatedUser.surname = encrypt(surname);
    if (email) updatedUser.email = encrypt(email);
    if (password) {
      // REM-006: Mettre à jour l'historique des mots de passe
      const passwordHistory = user.password_history || [];
      const newPasswordHistory = addToPasswordHistory(
        user.password,
        passwordHistory,
      );

      updatedUser.password = await bcrypt.hash(password, 12);
      (updatedUser as any).password_history = newPasswordHistory;

      // REM-007: Révoquer TOUS les tokens de l'utilisateur pour forcer la reconnexion
      const revokedCount = await refreshTokenService.revokeAllUserTokens(
        userId,
        "password_changed",
      );
      await redisSessionService.deleteSession(userId);

      userLogger.info("Mot de passe change", {
        userId,
        tokensRevoked: revokedCount,
      });

      // Audit de la révocation
      await auditService.log({
        userId,
        action: "PASSWORD_CHANGED",
        level: "warning",
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.headers["user-agent"],
        details: {
          tokensRevoked: revokedCount,
          passwordHistoryUpdated: true,
          changedVia: "profile_update",
        },
      });
    }
    if (pseudo !== undefined)
      updatedUser.pseudo = pseudo ? encrypt(pseudo) : undefined;
    if (showPseudo !== undefined) updatedUser.showPseudo = showPseudo;
    if (login_notifications_enabled !== undefined)
      (updatedUser as any).login_notifications_enabled =
        login_notifications_enabled;

    await updateUserById(userId, updatedUser);

    // Log de succès
    await auditService.log({
      userId,
      action: "PROFILE_UPDATED",
      level: "info",
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.headers["user-agent"],
      details: {
        fieldsUpdated: Object.keys(updatedUser).filter(
          (k) => k !== "password" && k !== "password_history",
        ),
      },
    });

    userLogger.info("Profil utilisateur mis à jour avec succès", {
      userId,
      action: "update_user",
      fieldsUpdated: Object.keys(updatedUser).filter(
        (k) => k !== "password" && k !== "password_history",
      ),
      passwordChanged: !!password,
    });

    // 2026-05-04 §4.2: sync_update multi-device (sans password ni hash)
    const safePayload = Object.fromEntries(
      Object.entries(updatedUser).filter(
        ([k]) => k !== "password" && k !== "password_history",
      ),
    );
    webSocketService.broadcastSyncUpdate(
      userId,
      "user",
      "updated",
      userId,
      safePayload,
      getOriginDeviceId(req),
    );

    res.status(200).json({ message: "Profil mis à jour avec succès." });
  } catch (error: unknown) {
    userLogger.error("Erreur mise a jour utilisateur", {
      userId: req.params.id,
      error: getErrorMessage(error),
    });
    return res.status(400).json({ message: "Une erreur interne est survenue" });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// VÉRIFICATION D'EMAIL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Vérifie l'email via le code à 6 chiffres
 */
export async function handleVerifyEmailByCode(req: Request, res: Response) {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res
        .status(400)
        .json({ message: "Email et code de vérification requis." });
    }

    // Rechercher tous les utilisateurs et décrypter pour trouver celui avec cet email
    const users = await UserModel.find({
      email_verification_code: code,
      email_verification_expires: { $gt: new Date() },
    }).select("+email_verification_token +email_verification_code");

    // Vérifier l'email décrypté
    let targetUser = null;
    for (const user of users) {
      const decryptedEmail = decrypt(user.email);
      if (decryptedEmail.toLowerCase() === email.toLowerCase()) {
        targetUser = user;
        break;
      }
    }

    if (!targetUser) {
      return res.status(400).json({
        message:
          "Code invalide ou expiré. Veuillez vérifier le code ou en demander un nouveau.",
        expired: true,
      });
    }

    // Marquer l'email comme vérifié
    targetUser.is_verified = true;
    targetUser.email_verification_token = "";
    targetUser.email_verification_code = "";
    targetUser.email_verification_expires = undefined;
    await targetUser.save();

    // Notifier les administrateurs qu'un nouveau compte est en attente de validation
    const decryptedUserName = `${decrypt(targetUser.name)} ${decrypt(targetUser.surname)}`;
    const decryptedUserEmail = decrypt(targetUser.email);
    const registrationDate = formatEmailDate(targetUser.creation_date);

    // Récupérer tous les administrateurs pour les notifier
    const admins = await UserModel.find({
      is_admin: true,
      is_blocked: false,
    }).lean();

    for (const admin of admins) {
      const adminName = decrypt(admin.name);
      const adminEmail = decrypt(admin.email);

      // Envoyer l'email de notification à l'admin
      sendAdminPendingValidationEmail(
        adminEmail,
        adminName,
        decryptedUserName,
        decryptedUserEmail,
        registrationDate,
      ).catch((err) => {
        userLogger.error("Erreur envoi notification admin", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    userLogger.info("Email verifie", { adminsNotified: admins.length });

    userLogger.info("Email vérifié avec succès", {
      userId: targetUser._id.toString(),
      action: "verify_email",
      adminsNotified: admins.length,
    });

    // admin_verification_pending : compte vérifié par email, en attente de
    // validation manuelle par un admin (is_admin_validated === false).
    try {
      const { notifyAllAdmins } = await import(
        "../services/adminNotificationService"
      );
      await notifyAllAdmins(
        "admin_verification_pending",
        "🟡 Nouveau compte à valider",
        `${decryptedUserName} (${decryptedUserEmail}) a vérifié son email et attend une validation admin.`,
        {
          userId: targetUser._id.toString(),
          email: decryptedUserEmail,
          dedupKey: `verif-pending:${targetUser._id.toString()}`,
        },
      );
    } catch (notifyErr) {
      userLogger.warn("Échec notif admin_verification_pending", {
        error:
          notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
      });
    }

    res.status(200).json({
      message:
        "Email vérifié avec succès ! Un administrateur doit maintenant valider votre compte. Vous recevrez un email lorsque votre compte sera activé.",
      verified: true,
      pendingAdminValidation: true,
    });
  } catch (error: unknown) {
    userLogger.error("Erreur verification email par code", {
      error: getErrorMessage(error),
    });
    return res.status(500).json({
      message: "Erreur lors de la vérification de l'email.",
      error: "Une erreur interne est survenue",
    });
  }
}

/**
 * Renvoie un nouveau code de vérification
 */
export async function handleResendVerificationEmail(
  req: Request,
  res: Response,
) {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email requis." });
    }

    // Rechercher l'utilisateur par email
    const user = await getUserByEmail(email);

    // Réponse générique pour éviter l'énumération d'utilisateurs
    if (!user) {
      return res.status(200).json({
        message:
          "Si cet email est associé à un compte, un nouveau code de vérification sera envoyé.",
      });
    }

    // Vérifier si l'email est déjà vérifié
    if (user.is_verified) {
      return res.status(400).json({
        message: "Cet email est déjà vérifié. Vous pouvez vous connecter.",
      });
    }

    // Générer un nouveau token et code
    const emailVerificationToken = crypto.randomBytes(32).toString("hex");
    const emailVerificationCode = generateVerificationCode(6);
    const emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 heures

    // Mettre à jour l'utilisateur
    user.email_verification_token = emailVerificationToken;
    user.email_verification_code = emailVerificationCode;
    user.email_verification_expires = emailVerificationExpires;
    await user.save();

    // Récupérer le nom décrypté pour l'email
    const userName = decrypt(user.name);
    const frontendUrl = process.env.FRONTEND_URL || "https://app.qvarry.fr";
    // Le lien redirige vers la page de connexion avec l'email + le code pré-remplis
    const verificationLink = `${frontendUrl}/login?verify=${encodeURIComponent(email)}&code=${emailVerificationCode}`;

    // Envoyer l'email de vérification
    await sendVerificationEmail(
      email,
      userName,
      verificationLink,
      emailVerificationCode,
      "24 heures",
    );

    res.status(200).json({
      message:
        "Si cet email est associé à un compte, un nouveau code de vérification sera envoyé.",
    });
  } catch (error: unknown) {
    userLogger.error("Erreur renvoi email verification", {
      error: getErrorMessage(error),
    });
    return res.status(500).json({
      message: "Erreur lors de l'envoi du code de vérification.",
      error: "Une erreur interne est survenue",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PRÉFÉRENCES DE NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════

const HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

const quietHoursSchema = z
  .object({
    enabled: z.boolean().optional(),
    start: z
      .string()
      .regex(HHMM_REGEX, "Format invalide (attendu HH:MM)")
      .optional(),
    end: z
      .string()
      .regex(HHMM_REGEX, "Format invalide (attendu HH:MM)")
      .optional(),
  })
  .strict();

const notificationPreferencesPatchSchema = z
  .object({
    messages: z.boolean().optional(),
    contacts: z.boolean().optional(),
    shares: z.boolean().optional(),
    groups: z.boolean().optional(),
    community_sos: z.boolean().optional(),
    quietHours: quietHoursSchema.optional(),
  })
  .strict();

function mergePreferences(
  current: NotificationPreferences,
  patch: z.infer<typeof notificationPreferencesPatchSchema>,
): NotificationPreferences {
  return {
    messages: patch.messages ?? current.messages,
    contacts: patch.contacts ?? current.contacts,
    shares: patch.shares ?? current.shares,
    groups: patch.groups ?? current.groups,
    community_sos: patch.community_sos ?? current.community_sos,
    quietHours: {
      enabled: patch.quietHours?.enabled ?? current.quietHours.enabled,
      start: patch.quietHours?.start ?? current.quietHours.start,
      end: patch.quietHours?.end ?? current.quietHours.end,
    },
  };
}

/**
 * GET /users/me/notification-preferences
 */
export async function handleGetNotificationPreferences(
  req: Request,
  res: Response,
) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentification requise" });
    }

    const user = await UserModel.findById(userId)
      .select("notificationPreferences")
      .lean();
    if (!user) {
      return res.status(404).json({ message: "Utilisateur non trouvé." });
    }

    const prefs: NotificationPreferences =
      (user.notificationPreferences as NotificationPreferences | undefined) ??
      DEFAULT_NOTIFICATION_PREFERENCES;

    return res.status(200).json({ notificationPreferences: prefs });
  } catch (error: unknown) {
    userLogger.error("Erreur récupération préférences notifications", {
      userId: req.user?.id,
      error: getErrorMessage(error),
    });
    return res.status(500).json({ message: "Une erreur interne est survenue" });
  }
}

/**
 * PATCH /users/me/notification-preferences
 * Body partiel : n'importe quel sous-ensemble des champs.
 */
export async function handleUpdateNotificationPreferences(
  req: Request,
  res: Response,
) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentification requise" });
    }

    const parsed = notificationPreferencesPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Données de préférences invalides.",
        errors: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    if (Object.keys(parsed.data).length === 0) {
      return res.status(400).json({
        message: "Au moins un champ doit être fourni.",
      });
    }

    const user = await UserModel.findById(userId).select(
      "notificationPreferences",
    );
    if (!user) {
      return res.status(404).json({ message: "Utilisateur non trouvé." });
    }

    const current: NotificationPreferences =
      (user.notificationPreferences as NotificationPreferences | undefined) ??
      DEFAULT_NOTIFICATION_PREFERENCES;
    const merged = mergePreferences(current, parsed.data);

    user.notificationPreferences = merged;
    user.markModified("notificationPreferences");
    await user.save();

    await auditService
      .log({
        userId,
        action: "NOTIFICATION_PREFERENCES_UPDATED",
        level: "info",
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.headers["user-agent"],
        details: {
          fieldsUpdated: Object.keys(parsed.data),
        },
      })
      .catch((err: unknown) => {
        userLogger.warn("Audit log non enregistré (préférences notifs)", {
          error: getErrorMessage(err),
        });
      });

    userLogger.info("Préférences de notifications mises à jour", {
      userId,
      fieldsUpdated: Object.keys(parsed.data),
    });

    return res.status(200).json({
      message: "Préférences de notifications mises à jour.",
      notificationPreferences: merged,
    });
  } catch (error: unknown) {
    userLogger.error("Erreur mise à jour préférences notifications", {
      userId: req.user?.id,
      error: getErrorMessage(error),
    });
    return res.status(500).json({ message: "Une erreur interne est survenue" });
  }
}

// ─── Heartbeat de localisation (filtre géo SOS Stage 1 broadcast) ────────────

const updateLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

/**
 * PATCH /users/me/location
 * Met à jour la dernière position connue de l'utilisateur. Stockée en GeoJSON
 * Point (`lastKnownLocation`) avec index 2dsphere → utilisée par le filtre
 * géographique du broadcast SOS Stage 1 (sosService).
 *
 * Pas d'audit (volume trop élevé), pas de notification. Endpoint léger.
 */
export async function handleUpdateMyLocation(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentification requise" });
    }

    const parsed = updateLocationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Coordonnées invalides.",
        errors: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const { lat, lng } = parsed.data;

    await UserModel.updateOne(
      { _id: userId },
      {
        $set: {
          lastKnownLocation: {
            type: "Point",
            coordinates: [lng, lat],
            updatedAt: new Date(),
          },
        },
      },
    );

    return res.status(204).send();
  } catch (error: unknown) {
    userLogger.error("Erreur mise à jour localisation utilisateur", {
      userId: req.user?.id,
      error: getErrorMessage(error),
    });
    return res.status(500).json({ message: "Une erreur interne est survenue" });
  }
}
