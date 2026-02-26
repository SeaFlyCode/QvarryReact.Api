// server/src/controllers/adminControllers.ts
import { Request, Response } from "express";
import UserModel from "../models/users";
import PointModel from "../models/points";
import FicheModel from "../models/fiches";
import ListModel from "../models/lists";
import DataShareModel from "../models/dataShare";
import ConversationModel from "../models/conversations";
import MessageModel from "../models/messages";
import AuditLogModel from "../models/auditLogs";
import { auditService } from "../services/auditService";
import { securityAlertService } from "../services/securityAlertService";
import { refreshTokenService } from "../services/refreshTokenService";
import { decrypt } from "../utils/masterEncryptionUtils";
import { maskEmail } from "../utils/logUtils";
import mongoose from "mongoose";
import { logger } from "../services/loggerService";

const adminLogger = logger.child({ service: "admin" });

// ═══════════════════════════════════════════════════════════════════════════
// CACHE DES STATISTIQUES ADMIN (HIGH-08, MEDIUM-9)
// ═══════════════════════════════════════════════════════════════════════════
let statsCache: { data: any; timestamp: number } | null = null;
const STATS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// MEDIUM-9: Protection contre les race conditions lors du rafraîchissement du cache
// Évite que plusieurs requêtes simultanées déclenchent plusieurs calculs coûteux
let statsCacheLoading: Promise<any> | null = null;

/**
 * Fonction utilitaire pour déchiffrer les données utilisateur de manière sécurisée
 */
function safeDecrypt(value: string | undefined): string {
  if (!value) return "";
  try {
    return decrypt(value);
  } catch (e) {
    adminLogger.warn("[ADMIN] Erreur déchiffrement", {
      error: e instanceof Error ? e.message : String(e),
    });
    return "[Données indisponibles]"; // Ne jamais retourner la valeur chiffrée
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FONCTIONS DE SÉCURITÉ ANTI-INJECTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * INJ-001: Limite maximale pour les chaînes de recherche
 * Prévient les attaques DoS via payloads volumineux et ReDoS
 */
const MAX_SEARCH_LENGTH = 100;

/**
 * Échappe les caractères spéciaux pour éviter les injections regex (ReDoS)
 * INJ-001 CORRIGÉ: Applique également une limite de taille
 * @param str - Chaîne à échapper
 * @param maxLength - Longueur maximale (défaut: MAX_SEARCH_LENGTH)
 */
function escapeRegex(
  str: string,
  maxLength: number = MAX_SEARCH_LENGTH,
): string {
  // INJ-001: Limiter la taille pour éviter DoS
  const truncated = str.substring(0, maxLength);
  return truncated.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whitelist des champs autorisés pour le tri des utilisateurs
 */
const ALLOWED_USER_SORT_FIELDS = [
  "creation_date",
  "last_connection",
  "name",
  "surname",
  "email",
  "_id",
  "is_admin",
  "is_blocked",
  "is_verified",
];

/**
 * Whitelist des actions autorisées pour le filtre des logs d'audit
 */
const ALLOWED_AUDIT_ACTIONS = [
  "LOGIN",
  "LOGOUT",
  "REGISTER",
  "PASSWORD_CHANGE",
  "PASSWORD_RESET",
  "EMAIL_CHANGE",
  "PROFILE_UPDATE",
  "ACCOUNT_DELETE",
  "POINT_CREATE",
  "POINT_UPDATE",
  "POINT_DELETE",
  "FICHE_CREATE",
  "FICHE_UPDATE",
  "FICHE_DELETE",
  "LIST_CREATE",
  "LIST_UPDATE",
  "LIST_DELETE",
  "SHARE_CREATE",
  "SHARE_ACCEPT",
  "SHARE_REJECT",
  "ADMIN_ACTION",
  "SECURITY_ALERT",
];

/**
 * Whitelist des niveaux de log valides
 */
const VALID_LOG_LEVELS = ["info", "warning", "error", "critical"];

// ═══════════════════════════════════════════════════════════════════════════
// STATISTIQUES GÉNÉRALES (DASHBOARD)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtenir les statistiques globales de la plateforme
 * Aucune donnée personnelle n'est exposée
 * MEDIUM-9: Protection contre les race conditions avec lock sur le rafraîchissement
 */
export async function getGlobalStats(req: Request, res: Response) {
  try {
    // HIGH-08 + MEDIUM-9: Vérifier le cache avant de recalculer
    const now = Date.now();
    const isCacheValid =
      statsCache && now - statsCache.timestamp < STATS_CACHE_TTL;

    if (isCacheValid && statsCache) {
      return res.json(statsCache.data);
    }

    // MEDIUM-9: Si un rafraîchissement est déjà en cours, attendre son résultat
    if (statsCacheLoading) {
      const data = await statsCacheLoading;
      return res.json(data);
    }

    // MEDIUM-9: Marquer qu'un rafraîchissement est en cours
    statsCacheLoading = (async () => {
      try {
        const computedStats = await computeGlobalStats();

        // HIGH-08: Stocker en cache
        statsCache = { data: computedStats, timestamp: Date.now() };

        return computedStats;
      } finally {
        // MEDIUM-9: Libérer le lock une fois terminé
        statsCacheLoading = null;
      }
    })();

    const stats = await statsCacheLoading;
    res.status(200).json(stats);
  } catch (error) {
    adminLogger.error("[ADMIN] Erreur stats globales", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res
      .status(500)
      .json({ error: "Erreur lors de la récupération des statistiques" });
  }
}

/**
 * MEDIUM-9: Fonction utilitaire pour calculer les statistiques
 * Séparée de getGlobalStats pour faciliter le locking
 */
async function computeGlobalStats() {
  const now = new Date();
  const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const today = new Date(now.setHours(0, 0, 0, 0));

  // Statistiques utilisateurs
  const [
    totalUsers,
    verifiedUsers,
    blockedUsers,
    adminUsers,
    usersLast30Days,
    usersLast7Days,
    usersToday,
  ] = await Promise.all([
    UserModel.countDocuments().maxTimeMS(5000),
    UserModel.countDocuments({ is_verified: true }).maxTimeMS(5000),
    UserModel.countDocuments({ is_blocked: true }).maxTimeMS(5000),
    UserModel.countDocuments({ is_admin: true }).maxTimeMS(5000),
    UserModel.countDocuments({
      creation_date: { $gte: last30Days },
    }).maxTimeMS(5000),
    UserModel.countDocuments({
      creation_date: { $gte: last7Days },
    }).maxTimeMS(5000),
    UserModel.countDocuments({ creation_date: { $gte: today } }).maxTimeMS(
      5000,
    ),
  ]);

  // Statistiques contenu
  const [
    totalPoints,
    totalFiches,
    totalLists,
    pointsLast30Days,
    fichesLast30Days,
  ] = await Promise.all([
    PointModel.countDocuments().maxTimeMS(5000),
    FicheModel.countDocuments().maxTimeMS(5000),
    ListModel.countDocuments().maxTimeMS(5000),
    PointModel.countDocuments({ createdAt: { $gte: last30Days } }).maxTimeMS(
      5000,
    ),
    FicheModel.countDocuments({
      date_creation: { $gte: last30Days },
    }).maxTimeMS(5000),
  ]);

  // Statistiques partages
  const [totalShares, activeShares, acceptedShares] = await Promise.all([
    DataShareModel.countDocuments().maxTimeMS(5000),
    DataShareModel.countDocuments({
      isActive: true,
      expiresAt: { $gt: new Date() },
    }).maxTimeMS(5000),
    DataShareModel.countDocuments({
      "encryptedDataPerReceiver.status": "accepted",
    }).maxTimeMS(5000),
  ]);

  // Statistiques messagerie (juste les compteurs)
  const [totalConversations, totalMessages] = await Promise.all([
    ConversationModel.countDocuments().maxTimeMS(5000),
    MessageModel.countDocuments().maxTimeMS(5000),
  ]);

  // Statistiques d'activité (dernière connexion)
  const activeUsersLast24h = await UserModel.countDocuments({
    last_connection: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  }).maxTimeMS(5000);
  const activeUsersLast7Days = await UserModel.countDocuments({
    last_connection: { $gte: last7Days },
  }).maxTimeMS(5000);

  return {
    users: {
      total: totalUsers,
      verified: verifiedUsers,
      blocked: blockedUsers,
      admins: adminUsers,
      newLast30Days: usersLast30Days,
      newLast7Days: usersLast7Days,
      newToday: usersToday,
      activeLast24h: activeUsersLast24h,
      activeLast7Days: activeUsersLast7Days,
    },
    content: {
      points: {
        total: totalPoints,
        last30Days: pointsLast30Days,
      },
      fiches: {
        total: totalFiches,
        last30Days: fichesLast30Days,
      },
      lists: {
        total: totalLists,
      },
    },
    sharing: {
      total: totalShares,
      active: activeShares,
      accepted: acceptedShares,
    },
    messaging: {
      conversations: totalConversations,
      messages: totalMessages,
    },
    generatedAt: new Date(),
  };
}

/**
 * Obtenir l'évolution des inscriptions sur les 30 derniers jours
 */
export async function getRegistrationStats(req: Request, res: Response) {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const registrations = await UserModel.aggregate([
      {
        $match: {
          creation_date: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$creation_date" },
          },
          count: { $sum: 1 },
        },
      },
      {
        $sort: { _id: 1 },
      },
    ]).option({ maxTimeMS: 5000 });

    // Remplir les jours manquants avec 0
    const result: { date: string; count: number }[] = [];
    const currentDate = new Date(startDate);
    const today = new Date();

    while (currentDate <= today) {
      const dateStr = currentDate.toISOString().split("T")[0];
      const found = registrations.find((r) => r._id === dateStr);
      result.push({
        date: dateStr,
        count: found ? found.count : 0,
      });
      currentDate.setDate(currentDate.getDate() + 1);
    }

    res.status(200).json({ registrations: result, days });
  } catch (error) {
    adminLogger.error("[ADMIN] Erreur stats inscriptions", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res
      .status(500)
      .json({ error: "Erreur lors de la récupération des statistiques" });
  }
}

/**
 * Obtenir l'évolution de l'activité (points créés) sur les 30 derniers jours
 */
export async function getActivityStats(req: Request, res: Response) {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const [pointsActivity, fichesActivity] = await Promise.all([
      PointModel.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]).option({ maxTimeMS: 5000 }),
      FicheModel.aggregate([
        { $match: { date_creation: { $gte: startDate } } },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$date_creation" },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]).option({ maxTimeMS: 5000 }),
    ]);

    // Remplir les jours manquants
    const result: { date: string; points: number; fiches: number }[] = [];
    const currentDate = new Date(startDate);
    const today = new Date();

    while (currentDate <= today) {
      const dateStr = currentDate.toISOString().split("T")[0];
      const pointsFound = pointsActivity.find((r) => r._id === dateStr);
      const fichesFound = fichesActivity.find((r) => r._id === dateStr);
      result.push({
        date: dateStr,
        points: pointsFound ? pointsFound.count : 0,
        fiches: fichesFound ? fichesFound.count : 0,
      });
      currentDate.setDate(currentDate.getDate() + 1);
    }

    res.status(200).json({ activity: result, days });
  } catch (error) {
    adminLogger.error("[ADMIN] Erreur stats activité", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res
      .status(500)
      .json({ error: "Erreur lors de la récupération des statistiques" });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GESTION DES UTILISATEURS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lister les utilisateurs avec pagination et filtres
 * Données minimales : id, nom, email, statuts, dates (pas de contenu)
 */
export async function listUsers(req: Request, res: Response) {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const skip = (page - 1) * limit;

    // Filtres
    const filter: any = {};

    if (req.query.search) {
      const rawSearch = req.query.search as string;

      // INJ-001 CORRIGÉ: Validation de la longueur de la recherche
      if (rawSearch.length > MAX_SEARCH_LENGTH) {
        return res.status(400).json({
          error: `La recherche ne peut pas dépasser ${MAX_SEARCH_LENGTH} caractères`,
          code: "SEARCH_TOO_LONG",
          maxLength: MAX_SEARCH_LENGTH,
        });
      }

      const search = escapeRegex(rawSearch);
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { surname: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { pseudo: { $regex: search, $options: "i" } },
      ];
    }

    if (req.query.is_blocked === "true") filter.is_blocked = true;
    if (req.query.is_blocked === "false") filter.is_blocked = false;
    if (req.query.is_verified === "true") filter.is_verified = true;
    if (req.query.is_verified === "false") filter.is_verified = false;
    if (req.query.is_admin === "true") filter.is_admin = true;

    // Tri avec whitelist pour prévenir les injections NoSQL
    const requestedSortField = req.query.sort as string;
    const sortField = ALLOWED_USER_SORT_FIELDS.includes(requestedSortField)
      ? requestedSortField
      : "creation_date";
    const sortOrder = req.query.order === "asc" ? 1 : -1;
    const sort: any = { [sortField]: sortOrder };

    const [users, total] = await Promise.all([
      UserModel.find(filter)
        .select(
          "_id name surname pseudo email is_admin is_blocked is_verified is_admin_validated admin_validation_rejected creation_date last_connection blocked_at blocked_reason",
        )
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean()
        .maxTimeMS(5000),
      UserModel.countDocuments(filter).maxTimeMS(5000),
    ]);

    res.status(200).json({
      users: users.map((u) => ({
        id: u._id,
        name: safeDecrypt(u.name),
        surname: safeDecrypt(u.surname),
        pseudo: u.pseudo ? safeDecrypt(u.pseudo) : undefined,
        email: safeDecrypt(u.email),
        is_admin: u.is_admin,
        is_blocked: u.is_blocked,
        is_verified: u.is_verified,
        is_admin_validated: u.is_admin_validated,
        admin_validation_rejected: u.admin_validation_rejected,
        creation_date: u.creation_date,
        last_connection: u.last_connection,
        blocked_at: u.blocked_at,
        blocked_reason: u.blocked_reason,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    adminLogger.error("[ADMIN] Erreur liste users", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res
      .status(500)
      .json({ error: "Erreur lors de la récupération des utilisateurs" });
  }
}

/**
 * Obtenir les détails d'un utilisateur (sans ses données)
 */
export async function getUserDetails(req: Request, res: Response) {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: "ID utilisateur invalide" });
    }

    const user = await UserModel.findById(userId)
      .select(
        "_id name surname pseudo email is_admin is_blocked is_verified creation_date last_connection blocked_at blocked_reason contact_code",
      )
      .lean();

    if (!user) {
      return res.status(404).json({ error: "Utilisateur non trouvé" });
    }

    // Statistiques de l'utilisateur (compteurs uniquement)
    const [pointsCount, fichesCount, listsCount, sessionsCount] =
      await Promise.all([
        PointModel.countDocuments({ userId: user._id }).maxTimeMS(5000),
        FicheModel.countDocuments({ userId: user._id }).maxTimeMS(5000),
        ListModel.countDocuments({ userId: user._id }).maxTimeMS(5000),
        refreshTokenService
          .getUserActiveSessions(userId)
          .then((s) => s.length)
          .catch(() => 0),
      ]);

    res.status(200).json({
      user: {
        id: user._id,
        name: safeDecrypt(user.name),
        surname: safeDecrypt(user.surname),
        pseudo: user.pseudo ? safeDecrypt(user.pseudo) : undefined,
        email: safeDecrypt(user.email),
        is_admin: user.is_admin,
        is_blocked: user.is_blocked,
        is_verified: user.is_verified,
        creation_date: user.creation_date,
        last_connection: user.last_connection,
        blocked_at: user.blocked_at,
        blocked_reason: user.blocked_reason,
        contact_code: user.contact_code,
      },
      stats: {
        points: pointsCount,
        fiches: fichesCount,
        lists: listsCount,
        activeSessions: sessionsCount,
      },
    });
  } catch (error) {
    adminLogger.error("[ADMIN] Erreur détails user", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res
      .status(500)
      .json({ error: "Erreur lors de la récupération de l'utilisateur" });
  }
}

/**
 * Bloquer un utilisateur
 */
export async function blockUser(req: Request, res: Response) {
  try {
    const { userId } = req.params;
    const { reason } = req.body;
    const adminId = req.user?.id;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: "ID utilisateur invalide" });
    }

    // Ne pas se bloquer soi-même
    if (userId === adminId) {
      return res
        .status(400)
        .json({ error: "Vous ne pouvez pas vous bloquer vous-même" });
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "Utilisateur non trouvé" });
    }

    // Ne pas bloquer un autre admin
    if (user.is_admin) {
      return res
        .status(403)
        .json({ error: "Impossible de bloquer un administrateur" });
    }

    // Bloquer l'utilisateur
    user.is_blocked = true;
    user.blocked_at = new Date();
    user.blocked_reason = reason || "Aucune raison spécifiée";
    await user.save();

    // Révoquer toutes ses sessions
    await refreshTokenService.revokeAllUserTokens(userId, "user_blocked");

    // Log d'audit
    await auditService.log({
      userId: adminId,
      action: "ADMIN_BLOCK_USER",
      level: "warning",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      details: {
        blockedUserId: userId,
        blockedUserEmail: maskEmail(safeDecrypt(user.email)),
        reason: reason || "Aucune raison spécifiée",
      },
    });

    adminLogger.info("[ADMIN] Utilisateur bloqué", {
      email: maskEmail(safeDecrypt(user.email)),
      adminId,
    });

    res.status(200).json({
      success: true,
      message: `Utilisateur ${safeDecrypt(user.email)} bloqué avec succès`,
      user: {
        id: user._id,
        email: safeDecrypt(user.email),
        is_blocked: true,
        blocked_at: user.blocked_at,
        blocked_reason: user.blocked_reason,
      },
    });
  } catch (error) {
    adminLogger.error("[ADMIN] Erreur blocage user", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: "Erreur lors du blocage de l'utilisateur" });
  }
}

/**
 * Débloquer un utilisateur
 */
export async function unblockUser(req: Request, res: Response) {
  try {
    const { userId } = req.params;
    const adminId = req.user?.id;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: "ID utilisateur invalide" });
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "Utilisateur non trouvé" });
    }

    if (!user.is_blocked) {
      return res
        .status(400)
        .json({ error: "Cet utilisateur n'est pas bloqué" });
    }

    // Débloquer l'utilisateur
    user.is_blocked = false;
    user.blocked_at = undefined;
    user.blocked_reason = undefined;
    await user.save();

    // Log d'audit
    await auditService.log({
      userId: adminId,
      action: "ADMIN_UNBLOCK_USER",
      level: "info",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      details: {
        unblockedUserId: userId,
        unblockedUserEmail: maskEmail(safeDecrypt(user.email)),
      },
    });

    adminLogger.info("[ADMIN] Utilisateur débloqué", {
      email: maskEmail(safeDecrypt(user.email)),
      adminId,
    });

    res.status(200).json({
      success: true,
      message: `Utilisateur ${safeDecrypt(user.email)} débloqué avec succès`,
      user: {
        id: user._id,
        email: safeDecrypt(user.email),
        is_blocked: false,
      },
    });
  } catch (error) {
    adminLogger.error("[ADMIN] Erreur déblocage user", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res
      .status(500)
      .json({ error: "Erreur lors du déblocage de l'utilisateur" });
  }
}

/**
 * Promouvoir un utilisateur en admin
 */
export async function promoteToAdmin(req: Request, res: Response) {
  try {
    const { userId } = req.params;
    const adminId = req.user?.id;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: "ID utilisateur invalide" });
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "Utilisateur non trouvé" });
    }

    if (user.is_admin) {
      return res
        .status(400)
        .json({ error: "Cet utilisateur est déjà administrateur" });
    }

    if (user.is_blocked) {
      return res
        .status(400)
        .json({ error: "Impossible de promouvoir un utilisateur bloqué" });
    }

    // Promouvoir
    user.is_admin = true;
    await user.save();

    // Log d'audit
    await auditService.log({
      userId: adminId,
      action: "ADMIN_PROMOTE_USER",
      level: "warning",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      details: {
        promotedUserId: userId,
        promotedUserEmail: maskEmail(safeDecrypt(user.email)),
      },
    });

    adminLogger.info("[ADMIN] Utilisateur promu admin", {
      email: maskEmail(safeDecrypt(user.email)),
      adminId,
    });

    res.status(200).json({
      success: true,
      message: `${safeDecrypt(user.email)} est maintenant administrateur`,
      user: {
        id: user._id,
        email: safeDecrypt(user.email),
        is_admin: true,
      },
    });
  } catch (error) {
    adminLogger.error("[ADMIN] Erreur promotion user", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res
      .status(500)
      .json({ error: "Erreur lors de la promotion de l'utilisateur" });
  }
}

/**
 * Rétrograder un admin en utilisateur normal
 */
export async function demoteFromAdmin(req: Request, res: Response) {
  try {
    const { userId } = req.params;
    const adminId = req.user?.id;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: "ID utilisateur invalide" });
    }

    // Ne pas se rétrograder soi-même
    if (userId === adminId) {
      return res
        .status(400)
        .json({ error: "Vous ne pouvez pas vous rétrograder vous-même" });
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "Utilisateur non trouvé" });
    }

    if (!user.is_admin) {
      return res
        .status(400)
        .json({ error: "Cet utilisateur n'est pas administrateur" });
    }

    // Vérifier qu'il reste au moins un admin
    const adminCount = await UserModel.countDocuments({
      is_admin: true,
    }).maxTimeMS(5000);
    if (adminCount <= 1) {
      return res
        .status(400)
        .json({ error: "Impossible de rétrograder le dernier administrateur" });
    }

    // Rétrograder
    user.is_admin = false;
    await user.save();

    // Log d'audit
    await auditService.log({
      userId: adminId,
      action: "ADMIN_DEMOTE_USER",
      level: "warning",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      details: {
        demotedUserId: userId,
        demotedUserEmail: maskEmail(safeDecrypt(user.email)),
      },
    });

    adminLogger.info("[ADMIN] Admin rétrogradé", {
      email: maskEmail(safeDecrypt(user.email)),
      adminId,
    });

    res.status(200).json({
      success: true,
      message: `${safeDecrypt(user.email)} n'est plus administrateur`,
      user: {
        id: user._id,
        email: safeDecrypt(user.email),
        is_admin: false,
      },
    });
  } catch (error) {
    adminLogger.error("[ADMIN] Erreur rétrogradation user", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res
      .status(500)
      .json({ error: "Erreur lors de la rétrogradation de l'utilisateur" });
  }
}

/**
 * Forcer la déconnexion de toutes les sessions d'un utilisateur
 */
export async function forceLogoutUser(req: Request, res: Response) {
  try {
    const { userId } = req.params;
    const adminId = req.user?.id;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: "ID utilisateur invalide" });
    }

    const user = await UserModel.findById(userId).select("email");
    if (!user) {
      return res.status(404).json({ error: "Utilisateur non trouvé" });
    }

    // Révoquer toutes les sessions
    const revokedCount = await refreshTokenService.revokeAllUserTokens(
      userId,
      "admin_forced_logout",
    );

    // Log d'audit
    await auditService.log({
      userId: adminId,
      action: "ADMIN_FORCE_LOGOUT",
      level: "info",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      details: {
        targetUserId: userId,
        targetUserEmail: maskEmail(safeDecrypt(user.email)),
        revokedSessions: revokedCount,
      },
    });

    adminLogger.info("[ADMIN] Sessions révoquées", {
      targetUserEmail: maskEmail(safeDecrypt(user.email)),
      adminId,
      revokedCount,
    });

    res.status(200).json({
      success: true,
      message: `Toutes les sessions de ${safeDecrypt(user.email)} ont été révoquées`,
      revokedSessions: revokedCount,
    });
  } catch (error) {
    adminLogger.error("[ADMIN] Erreur force logout", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: "Erreur lors de la déconnexion forcée" });
  }
}

/**
 * Réinitialiser le mot de passe d'un utilisateur
 * Envoie un email de réinitialisation à l'utilisateur
 */
export async function resetUserPassword(req: Request, res: Response) {
  try {
    const { userId } = req.params;
    const adminId = req.user?.id;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: "ID utilisateur invalide" });
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "Utilisateur non trouvé" });
    }

    // Importer les utilitaires nécessaires
    const crypto = await import("crypto");
    const { sendPasswordResetEmail, generateVerificationCode } =
      await import("../services/emailService");

    // Générer un token et un code de réinitialisation
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetCode = generateVerificationCode(6);
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 heure

    // Mettre à jour l'utilisateur
    user.reset_password_token = `${resetToken}:${resetCode}`;
    user.reset_password_expires = resetExpires;
    await user.save();

    // Récupérer les infos pour l'email
    const userEmail = decrypt(user.email);
    const userName = decrypt(user.name);
    const frontendUrl = process.env.FRONTEND_URL || "https://qvarry.com";
    const resetLink = `${frontendUrl}/?reset=${encodeURIComponent(userEmail)}`;

    // Envoyer l'email de réinitialisation
    await sendPasswordResetEmail(
      userEmail,
      userName,
      resetLink,
      resetCode,
      "Admin",
      "Réinitialisation demandée par un administrateur",
      "1 heure",
    );

    // Révoquer toutes les sessions existantes
    await refreshTokenService.revokeAllUserTokens(
      userId,
      "admin_password_reset",
    );

    // Log d'audit
    await auditService.log({
      userId: adminId,
      action: "ADMIN_RESET_PASSWORD",
      level: "warning",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      details: {
        targetUserId: userId,
        targetUserEmail: userEmail,
      },
    });

    adminLogger.info("[ADMIN] Réinitialisation mot de passe", {
      targetUserEmail: maskEmail(userEmail),
      adminId,
    });

    res.status(200).json({
      success: true,
      message: `Un email de réinitialisation a été envoyé à ${userEmail}`,
    });
  } catch (error) {
    adminLogger.error("[ADMIN] Erreur reset password", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res
      .status(500)
      .json({ error: "Erreur lors de la réinitialisation du mot de passe" });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LOGS D'AUDIT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtenir les logs d'audit avec filtres
 */
export async function getAuditLogs(req: Request, res: Response) {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const skip = (page - 1) * limit;

    // Filtres
    const filter: any = {};

    if (req.query.userId) {
      const userIdStr = String(req.query.userId);
      if (mongoose.Types.ObjectId.isValid(userIdStr)) {
        filter.userId = new mongoose.Types.ObjectId(userIdStr);
      }
    }
    if (req.query.action) {
      const requestedAction = (req.query.action as string).toUpperCase();
      // Whitelist pour prévenir les injections regex (ReDoS)
      if (ALLOWED_AUDIT_ACTIONS.includes(requestedAction)) {
        filter.action = requestedAction;
      }
      // Si l'action n'est pas dans la whitelist, on l'ignore pour la sécurité
    }
    if (req.query.level) {
      const level = String(req.query.level);
      if (VALID_LOG_LEVELS.includes(level)) {
        filter.level = level;
      }
      // Si le level n'est pas dans la whitelist, on l'ignore silencieusement
    }
    if (req.query.startDate) {
      filter.timestamp = {
        ...filter.timestamp,
        $gte: new Date(req.query.startDate as string),
      };
    }
    if (req.query.endDate) {
      filter.timestamp = {
        ...filter.timestamp,
        $lte: new Date(req.query.endDate as string),
      };
    }

    const [logs, total] = await Promise.all([
      AuditLogModel.find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .maxTimeMS(5000),
      AuditLogModel.countDocuments(filter).maxTimeMS(5000),
    ]);

    res.status(200).json({
      logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    adminLogger.error("[ADMIN] Erreur logs audit", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: "Erreur lors de la récupération des logs" });
  }
}

/**
 * Obtenir les statistiques des logs d'audit
 */
export async function getAuditStats(req: Request, res: Response) {
  try {
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const last7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Statistiques par niveau
    const [levelStats, actionStats, recentCritical] = await Promise.all([
      AuditLogModel.aggregate([
        { $match: { timestamp: { $gte: last7Days } } },
        { $group: { _id: "$level", count: { $sum: 1 } } },
      ]).option({ maxTimeMS: 5000 }),
      AuditLogModel.aggregate([
        { $match: { timestamp: { $gte: last24h } } },
        { $group: { _id: "$action", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]).option({ maxTimeMS: 5000 }),
      AuditLogModel.find({ level: "critical", timestamp: { $gte: last7Days } })
        .sort({ timestamp: -1 })
        .limit(10)
        .lean()
        .maxTimeMS(5000),
    ]);

    const levelMap: Record<string, number> = {
      info: 0,
      warning: 0,
      error: 0,
      critical: 0,
    };
    levelStats.forEach((l) => {
      levelMap[l._id] = l.count;
    });

    res.status(200).json({
      byLevel: levelMap,
      topActions: actionStats.map((a) => ({ action: a._id, count: a.count })),
      recentCritical,
      period: {
        levelStats: "7 derniers jours",
        actionStats: "24 dernières heures",
      },
    });
  } catch (error) {
    adminLogger.error("[ADMIN] Erreur stats audit", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res
      .status(500)
      .json({ error: "Erreur lors de la récupération des statistiques" });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SÉCURITÉ AVANCÉE - BLOCAGE D'IP & MONITORING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtenir les statistiques de sécurité pour le dashboard de monitoring
 */
export async function getSecurityDashboard(req: Request, res: Response) {
  try {
    const stats = await securityAlertService.getSecurityStats();
    res.status(200).json(stats);
  } catch (error) {
    adminLogger.error("[ADMIN] Erreur dashboard sécurité", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({
      error: "Erreur lors de la récupération des statistiques de sécurité",
    });
  }
}

/**
 * Lister les IPs bloquées
 */
export async function listBlockedIps(req: Request, res: Response) {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    const result = await securityAlertService.listBlockedIps(page, limit);

    res.status(200).json({
      ips: result.ips,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: result.totalPages,
      },
    });
  } catch (error) {
    adminLogger.error("[ADMIN] Erreur liste IPs bloquées", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res
      .status(500)
      .json({ error: "Erreur lors de la récupération des IPs bloquées" });
  }
}

/**
 * Bloquer une IP manuellement
 */
export async function blockIp(req: Request, res: Response) {
  try {
    const adminId = req.user?.id;
    const { ipAddress, reason, durationHours } = req.body;

    if (!ipAddress || !reason) {
      return res.status(400).json({ error: "Adresse IP et raison requises" });
    }

    // Validation basique de l'IP
    const ipRegex =
      /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$|^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::1$/;
    if (
      !ipRegex.test(ipAddress) &&
      ipAddress !== "::1" &&
      !ipAddress.startsWith("::ffff:")
    ) {
      return res.status(400).json({ error: "Format d'adresse IP invalide" });
    }

    const blockedIp = await securityAlertService.blockIp(
      ipAddress,
      reason,
      durationHours ? parseInt(durationHours) : undefined,
      adminId,
    );

    // Log l'action
    await auditService.log({
      userId: adminId,
      action: "ADMIN_IP_BLOCKED",
      level: "warning",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      details: { blockedIp: ipAddress, reason, durationHours },
    });

    res.status(200).json({
      success: true,
      message: `IP ${ipAddress} bloquée avec succès`,
      blockedIp,
    });
  } catch (error) {
    adminLogger.error("[ADMIN] Erreur blocage IP", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: "Erreur lors du blocage de l'IP" });
  }
}

/**
 * Débloquer une IP
 */
export async function unblockIp(req: Request, res: Response) {
  try {
    const adminId = req.user?.id;
    const { ipAddress } = req.params;

    if (!ipAddress) {
      return res.status(400).json({ error: "Adresse IP requise" });
    }

    const success = await securityAlertService.unblockIp(ipAddress);

    if (!success) {
      return res
        .status(404)
        .json({ error: "IP non trouvée ou déjà débloquée" });
    }

    // Log l'action
    await auditService.log({
      userId: adminId,
      action: "ADMIN_IP_UNBLOCKED",
      level: "info",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      details: { unblockedIp: ipAddress },
    });

    res.status(200).json({
      success: true,
      message: `IP ${ipAddress} débloquée avec succès`,
    });
  } catch (error) {
    adminLogger.error("[ADMIN] Erreur déblocage IP", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: "Erreur lors du déblocage de l'IP" });
  }
}

/**
 * Obtenir le score de menace d'une IP
 */
export async function getIpThreatScore(req: Request, res: Response) {
  try {
    const { ipAddress } = req.params;

    if (!ipAddress) {
      return res.status(400).json({ error: "Adresse IP requise" });
    }

    const threatScore = securityAlertService.getThreatScore(ipAddress);
    const blockStatus = await securityAlertService.isIpBlocked(ipAddress);

    res.status(200).json({
      ipAddress,
      threatScore: threatScore || {
        ip: ipAddress,
        score: 0,
        reasons: [],
        lastUpdated: null,
      },
      isBlocked: blockStatus.blocked,
      blockReason: blockStatus.reason,
      blockedUntil: blockStatus.until,
    });
  } catch (error) {
    adminLogger.error("[ADMIN] Erreur threat score", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res
      .status(500)
      .json({ error: "Erreur lors de la récupération du score de menace" });
  }
}

/**
 * Exporter les logs d'audit au format JSON ou CSV
 * LOW-06: Export avec streaming (cursor) pour éviter de charger tout en mémoire
 */
export async function exportAuditLogs(req: Request, res: Response) {
  try {
    const adminId = req.user?.id;
    const format = (req.query.format as string) || "json";
    const startDate = req.query.startDate
      ? new Date(req.query.startDate as string)
      : undefined;
    const endDate = req.query.endDate
      ? new Date(req.query.endDate as string)
      : undefined;
    const level = req.query.level as string | undefined;
    const action = req.query.action as string | undefined;
    // SÉCURITÉ: Limite max pour protection DoS/crash serveur
    const limit = Math.min(parseInt(req.query.limit as string) || 10000, 50000);

    if (format !== "json" && format !== "csv") {
      return res
        .status(400)
        .json({ error: "Format invalide. Utilisez 'json' ou 'csv'" });
    }

    // Log l'export
    await auditService.log({
      userId: adminId,
      action: "AUDIT_LOGS_EXPORTED",
      level: "info",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      details: { format, startDate, endDate, level, action, limit },
    });

    // Construire le filtre
    const filter: any = {};
    if (startDate) filter.timestamp = { ...filter.timestamp, $gte: startDate };
    if (endDate) filter.timestamp = { ...filter.timestamp, $lte: endDate };
    if (level) {
      const levelStr = String(level);
      if (VALID_LOG_LEVELS.includes(levelStr)) {
        filter.level = levelStr;
      }
      // Si le level n'est pas dans la whitelist, on l'ignore silencieusement
    }
    // HIGH-5: Utiliser la whitelist pour prévenir les injections regex
    if (action) {
      const requestedAction = action.toUpperCase();
      // Vérifier si l'action est dans la whitelist
      if (ALLOWED_AUDIT_ACTIONS.includes(requestedAction)) {
        filter.action = requestedAction;
      } else {
        // Si pas dans la whitelist, chercher avec regex échappé
        filter.action = {
          $regex: action.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          $options: "i",
        };
      }
    }

    // Définir les headers pour le téléchargement
    const filename = `audit-logs-${new Date().toISOString().split("T")[0]}.${format}`;
    res.setHeader(
      "Content-Type",
      format === "json" ? "application/json" : "text/csv",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Transfer-Encoding", "chunked");

    if (format === "json") {
      // LOW-06: Streaming JSON avec cursor pour éviter de charger tout en mémoire
      res.write("[");
      let first = true;
      const cursor = AuditLogModel.find(filter)
        .sort({ timestamp: -1 })
        .limit(limit)
        .cursor();

      for await (const doc of cursor) {
        if (!first) res.write(",");
        res.write(JSON.stringify(doc));
        first = false;
      }

      res.write("]");
      res.end();
    } else {
      // CSV: on délègue au service existant (les CSV sont généralement plus petits)
      const data = await securityAlertService.exportAuditLogs({
        format: "csv",
        startDate,
        endDate,
        level,
        action,
        limit,
      });
      res.send(data);
    }
  } catch (error) {
    adminLogger.error("[ADMIN] Erreur export logs", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    // Vérifier si les headers n'ont pas déjà été envoyés
    if (!res.headersSent) {
      res.status(500).json({ error: "Erreur lors de l'export des logs" });
    } else {
      res.end();
    }
  }
}

/**
 * Envoyer une alerte de test aux admins
 */
export async function sendTestAlert(req: Request, res: Response) {
  try {
    const adminId = req.user?.id;

    await securityAlertService.notifyAdmins({
      type: "TEST_ALERT",
      level: "warning",
      ipAddress: req.ip || "N/A",
      userAgent: req.get("user-agent"),
      userId: adminId,
      details: {
        message: "Ceci est une alerte de test",
        triggeredBy: adminId,
        timestamp: new Date().toISOString(),
      },
    });

    // Log l'action
    await auditService.log({
      userId: adminId,
      action: "TEST_ALERT_SENT",
      level: "info",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.status(200).json({
      success: true,
      message: "Alerte de test envoyée à tous les administrateurs",
    });
  } catch (error) {
    adminLogger.error("[ADMIN] Erreur envoi alerte test", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res
      .status(500)
      .json({ error: "Erreur lors de l'envoi de l'alerte de test" });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION DES COMPTES UTILISATEURS
// ═══════════════════════════════════════════════════════════════════════════

import {
  sendAccountApprovedEmail,
  sendAccountRejectedEmail,
} from "../services/emailService";

/**
 * Lister les utilisateurs en attente de validation admin
 */
export async function listPendingUsers(req: Request, res: Response) {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const skip = (page - 1) * limit;

    // Rechercher les utilisateurs vérifiés mais non validés par admin
    const query = {
      is_verified: true,
      is_admin_validated: false,
      admin_validation_rejected: { $ne: true },
    };

    const [users, total] = await Promise.all([
      UserModel.find(query)
        .sort({ creation_date: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .maxTimeMS(5000),
      UserModel.countDocuments(query).maxTimeMS(5000),
    ]);

    // Déchiffrer les données utilisateur
    const decryptedUsers = users.map((user) => ({
      id: user._id.toString(),
      name: safeDecrypt(user.name),
      surname: safeDecrypt(user.surname),
      pseudo: user.pseudo ? safeDecrypt(user.pseudo) : undefined,
      email: safeDecrypt(user.email),
      creation_date: user.creation_date,
      is_verified: user.is_verified,
    }));

    res.status(200).json({
      users: decryptedUsers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    adminLogger.error("[ADMIN] Erreur liste utilisateurs en attente", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({
      error: "Erreur lors de la récupération des utilisateurs en attente",
    });
  }
}

/**
 * Approuver un compte utilisateur
 */
export async function approveUser(req: Request, res: Response) {
  try {
    const { userId } = req.params;
    const adminId = req.user?.id;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: "ID utilisateur invalide" });
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "Utilisateur non trouvé" });
    }

    // Vérifier que l'utilisateur n'est pas déjà validé
    if (user.is_admin_validated) {
      return res.status(400).json({ error: "Cet utilisateur est déjà validé" });
    }

    // Valider le compte
    user.is_admin_validated = true;
    user.admin_validated_at = new Date();
    user.admin_validated_by = adminId;
    user.admin_validation_rejected = false;
    user.admin_rejection_reason = "";
    await user.save();

    // Envoyer l'email de confirmation à l'utilisateur
    const userEmail = safeDecrypt(user.email);
    const userName = `${safeDecrypt(user.name)} ${safeDecrypt(user.surname)}`;

    sendAccountApprovedEmail(userEmail, userName).catch((err) => {
      adminLogger.error("[EMAIL] Erreur envoi email approbation", {
        email: maskEmail(userEmail),
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    });

    // Log l'action
    await auditService.log({
      userId: adminId,
      action: "USER_APPROVED",
      level: "info",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      details: { approvedUserId: userId, approvedUserEmail: userEmail },
    });

    adminLogger.info("[ADMIN] Utilisateur approuvé", {
      approvedUserEmail: maskEmail(userEmail),
      adminId,
    });

    res.status(200).json({
      success: true,
      message: `Le compte de ${userName} a été approuvé. Un email de confirmation a été envoyé.`,
    });
  } catch (error) {
    adminLogger.error("[ADMIN] Erreur approbation utilisateur", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res
      .status(500)
      .json({ error: "Erreur lors de l'approbation de l'utilisateur" });
  }
}

/**
 * Refuser un compte utilisateur
 */
export async function rejectUser(req: Request, res: Response) {
  try {
    const { userId } = req.params;
    const { reason } = req.body;
    const adminId = req.user?.id;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: "ID utilisateur invalide" });
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "Utilisateur non trouvé" });
    }

    // Vérifier que l'utilisateur n'est pas déjà validé
    if (user.is_admin_validated) {
      return res.status(400).json({
        error: "Cet utilisateur est déjà validé, vous ne pouvez pas le refuser",
      });
    }

    // Refuser le compte
    user.is_admin_validated = false;
    user.admin_validation_rejected = true;
    user.admin_rejection_reason = reason || "";
    user.admin_validated_at = new Date();
    user.admin_validated_by = adminId;
    await user.save();

    // Envoyer l'email de refus à l'utilisateur
    const userEmail = safeDecrypt(user.email);
    const userName = `${safeDecrypt(user.name)} ${safeDecrypt(user.surname)}`;

    sendAccountRejectedEmail(userEmail, userName, reason).catch((err) => {
      adminLogger.error("[EMAIL] Erreur envoi email refus", {
        email: maskEmail(userEmail),
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    });

    // Log l'action
    await auditService.log({
      userId: adminId,
      action: "USER_REJECTED",
      level: "warning",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      details: { rejectedUserId: userId, rejectedUserEmail: userEmail, reason },
    });

    adminLogger.info("[ADMIN] Utilisateur refusé", {
      rejectedUserEmail: maskEmail(userEmail),
      adminId,
      reason,
    });

    res.status(200).json({
      success: true,
      message: `Le compte de ${userName} a été refusé. Un email a été envoyé.`,
    });
  } catch (error) {
    adminLogger.error("[ADMIN] Erreur refus utilisateur", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: "Erreur lors du refus de l'utilisateur" });
  }
}

/**
 * Compter les utilisateurs en attente de validation
 */
export async function getPendingUsersCount(req: Request, res: Response) {
  try {
    const count = await UserModel.countDocuments({
      is_verified: true,
      is_admin_validated: false,
      admin_validation_rejected: { $ne: true },
    }).maxTimeMS(5000);

    res.status(200).json({ count });
  } catch (error) {
    adminLogger.error("[ADMIN] Erreur comptage utilisateurs en attente", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res
      .status(500)
      .json({ error: "Erreur lors du comptage des utilisateurs en attente" });
  }
}
