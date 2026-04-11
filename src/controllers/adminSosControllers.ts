// ═══════════════════════════════════════════════════════════════════════════
// CONTRÔLEURS SOS MODE (ADMIN)
// ═══════════════════════════════════════════════════════════════════════════
// Endpoints admin pour la gestion du Mode SOS
// Dashboard, surveillance des sessions actives, intervention d'urgence
// Compatible mobile ET desktop
// ═══════════════════════════════════════════════════════════════════════════

import { Request, Response } from "express";
import { sosService } from "../services/sosService";
import { getErrorMessage } from "../utils/errorUtils";
import { logger } from "../services/loggerService";

const adminSosLogger = logger.child({ service: "admin-sos" });

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: DASHBOARD ADMIN SOS
// ═══════════════════════════════════════════════════════════════════════════

export async function handleAdminSosDashboard(req: Request, res: Response) {
  const startTime = Date.now();

  try {
    const adminId = (req as any).user?.id;
    if (!adminId) {
      return res.status(401).json({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    }

    const dashboard = await sosService.getAdminDashboard();

    const duration = Date.now() - startTime;
    adminSosLogger.info("Dashboard récupéré par admin", {
      adminId,
      duration,
    });

    res.status(200).json({
      success: true,
      data: dashboard,
    });
  } catch (error) {
    adminSosLogger.error("Erreur dashboard", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Erreur lors de la récupération du dashboard.",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: LISTE DES SESSIONS ACTIVES
// ═══════════════════════════════════════════════════════════════════════════

export async function handleAdminSosActiveSessions(
  req: Request,
  res: Response,
) {
  const startTime = Date.now();

  try {
    const adminId = (req as any).user?.id;
    if (!adminId) {
      return res.status(401).json({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    }

    const sessions = await sosService.getAllActiveSessions();

    const duration = Date.now() - startTime;
    adminSosLogger.info("Sessions actives récupérées par admin", {
      adminId,
      sessionsCount: sessions.length,
      duration,
    });

    res.status(200).json({
      success: true,
      sessions,
      count: sessions.length,
    });
  } catch (error) {
    adminSosLogger.error("Erreur sessions actives", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Erreur lors de la récupération des sessions actives.",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: DÉTAILS D'UNE SESSION
// ═══════════════════════════════════════════════════════════════════════════

export async function handleAdminSosSessionDetails(
  req: Request,
  res: Response,
) {
  const startTime = Date.now();

  try {
    const adminId = (req as any).user?.id;
    if (!adminId) {
      return res.status(401).json({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    }

    const { sessionId } = req.params;
    if (!sessionId) {
      return res.status(400).json({
        error: "ID de session requis.",
        code: "MISSING_SESSION_ID",
      });
    }

    const details = await sosService.getSessionDetails(sessionId);

    const duration = Date.now() - startTime;
    adminSosLogger.info("Détails session récupérés par admin", {
      adminId,
      sessionId,
      duration,
    });

    res.status(200).json({
      success: true,
      data: details,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "SESSION_NOT_FOUND") {
      return res.status(404).json({
        error: "Session non trouvée.",
        code: "SESSION_NOT_FOUND",
      });
    }

    adminSosLogger.error("Erreur détails session", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Erreur lors de la récupération des détails.",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: ANNULER/RÉSOUDRE UNE SESSION
// ═══════════════════════════════════════════════════════════════════════════

export async function handleAdminSosCancelSession(req: Request, res: Response) {
  const startTime = Date.now();

  try {
    const adminId = (req as any).user?.id;
    if (!adminId) {
      return res.status(401).json({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    }

    const { sessionId } = req.params;
    if (!sessionId) {
      return res.status(400).json({
        error: "ID de session requis.",
        code: "MISSING_SESSION_ID",
      });
    }

    const { reason } = req.body;

    const session = await sosService.adminCancelSession(
      sessionId,
      adminId,
      reason,
    );

    const duration = Date.now() - startTime;
    adminSosLogger.info("Session annulée par admin", {
      adminId,
      sessionId,
      duration,
    });

    res.status(200).json({
      success: true,
      session: {
        id: session._id,
        status: session.status,
        resolvedAt: session.resolvedAt,
        resolvedBy: session.resolvedBy,
        participantCount: session.participants?.length || 0,
        isGroupSession: (session.participants?.length || 0) > 1,
        participants: session.participants?.map((p: any) => ({
          userId: p.userId.toString(),
          status: p.status,
          leftAt: p.leftAt,
        })),
      },
      message: "Session annulée avec succès.",
    });
  } catch (error) {
    if (error instanceof Error && error.message === "SESSION_NOT_FOUND") {
      return res.status(404).json({
        error: "Session non trouvée ou déjà terminée.",
        code: "SESSION_NOT_FOUND",
      });
    }

    adminSosLogger.error("Erreur annulation session", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Erreur lors de l'annulation de la session.",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: HISTORIQUE DES SESSIONS (ADMIN)
// ═══════════════════════════════════════════════════════════════════════════

export async function handleAdminSosHistory(req: Request, res: Response) {
  const startTime = Date.now();

  try {
    const adminId = (req as any).user?.id;
    if (!adminId) {
      return res.status(401).json({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    }

    // Query params — userId OU participantId (le service gère le $or)
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const status = req.query.status as string | undefined;
    const userId =
      (req.query.userId as string) ||
      (req.query.participantId as string) ||
      undefined;

    const sessions = await sosService.getAdminSessionHistory(
      limit,
      status,
      userId,
    );

    const duration = Date.now() - startTime;
    adminSosLogger.info("Historique récupéré par admin", {
      adminId,
      sessionsCount: sessions.length,
      duration,
    });

    res.status(200).json({
      success: true,
      sessions,
      count: sessions.length,
      filters: {
        limit,
        status,
        userId,
      },
    });
  } catch (error) {
    adminSosLogger.error("Erreur historique", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Erreur lors de la récupération de l'historique.",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: STATISTIQUES GLOBALES SOS (ADMIN)
// ═══════════════════════════════════════════════════════════════════════════

export async function handleAdminSosStats(req: Request, res: Response) {
  const startTime = Date.now();

  try {
    const adminId = (req as any).user?.id;
    if (!adminId) {
      return res.status(401).json({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    }

    // Query params pour le filtre de date
    let startDate: Date | undefined;
    let endDate: Date | undefined;

    if (req.query.startDate) {
      startDate = new Date(req.query.startDate as string);
      if (isNaN(startDate.getTime())) {
        return res.status(400).json({
          error: "Date de début invalide.",
          code: "INVALID_START_DATE",
        });
      }
    }

    if (req.query.endDate) {
      endDate = new Date(req.query.endDate as string);
      if (isNaN(endDate.getTime())) {
        return res.status(400).json({
          error: "Date de fin invalide.",
          code: "INVALID_END_DATE",
        });
      }
    }

    const stats = await sosService.getAdminSosStats(startDate, endDate);

    const duration = Date.now() - startTime;
    adminSosLogger.info("Stats récupérées par admin", {
      adminId,
      duration,
    });

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    adminSosLogger.error("Erreur stats", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Erreur lors de la récupération des statistiques.",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: HEARTBEAT POUR UN PARTICIPANT (ADMIN)
// ═══════════════════════════════════════════════════════════════════════════

export async function handleAdminSosHeartbeat(req: Request, res: Response) {
  const startTime = Date.now();

  try {
    const adminId = (req as any).user?.id;
    if (!adminId) {
      return res.status(401).json({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    }

    const { sessionId } = req.params;
    const { userId } = req.body;

    if (!sessionId) {
      return res.status(400).json({
        error: "ID de session requis.",
        code: "MISSING_SESSION_ID",
      });
    }

    if (!userId) {
      return res.status(400).json({
        error: "ID utilisateur requis.",
        code: "MISSING_USER_ID",
      });
    }

    const session = await sosService.adminHeartbeat(sessionId, userId, adminId);

    const duration = Date.now() - startTime;
    adminSosLogger.info("Heartbeat effectué par admin", {
      adminId,
      sessionId,
      userId,
      duration,
    });

    res.status(200).json({
      success: true,
      session: {
        id: session._id,
        status: session.status,
        expiresAt: session.expiresAt,
        heartbeatCount: session.heartbeatCount,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "SESSION_NOT_FOUND") {
      return res.status(404).json({
        error: "Session non trouvée.",
        code: "SESSION_NOT_FOUND",
      });
    }
    if (error instanceof Error && error.message === "PARTICIPANT_NOT_FOUND") {
      return res.status(404).json({
        error: "Participant non trouvé dans cette session.",
        code: "PARTICIPANT_NOT_FOUND",
      });
    }

    adminSosLogger.error("Erreur heartbeat", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Erreur lors de l'envoi du heartbeat.",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: EXTENSION DE DURÉE D'UNE SESSION (ADMIN)
// ═══════════════════════════════════════════════════════════════════════════

export async function handleAdminSosExtendSession(req: Request, res: Response) {
  const startTime = Date.now();

  try {
    const adminId = (req as any).user?.id;
    if (!adminId) {
      return res.status(401).json({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    }

    const { sessionId } = req.params;
    const { additionalMinutes } = req.body;

    if (!sessionId) {
      return res.status(400).json({
        error: "ID de session requis.",
        code: "MISSING_SESSION_ID",
      });
    }

    if (
      !additionalMinutes ||
      typeof additionalMinutes !== "number" ||
      additionalMinutes < 15 ||
      additionalMinutes > 480
    ) {
      return res.status(400).json({
        error: "Durée additionnelle invalide (15-480 minutes).",
        code: "INVALID_EXTENSION_DURATION",
      });
    }

    const session = await sosService.adminExtendSession(
      sessionId,
      additionalMinutes,
      adminId,
    );

    const duration = Date.now() - startTime;
    adminSosLogger.info("Session étendue par admin", {
      adminId,
      sessionId,
      additionalMinutes,
      duration,
    });

    res.status(200).json({
      success: true,
      session: {
        id: session._id,
        status: session.status,
        expiresAt: session.expiresAt,
        extensionCount: session.extensionCount,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "SESSION_NOT_FOUND") {
      return res.status(404).json({
        error: "Session non trouvée.",
        code: "SESSION_NOT_FOUND",
      });
    }
    if (
      error instanceof Error &&
      error.message === "INVALID_EXTENSION_DURATION"
    ) {
      return res.status(400).json({
        error: "Durée d'extension invalide.",
        code: "INVALID_EXTENSION_DURATION",
      });
    }

    adminSosLogger.error("Erreur extension session", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Erreur lors de l'extension de la session.",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: FORCER L'ESCALADE D'UN PARTICIPANT (ADMIN)
// ═══════════════════════════════════════════════════════════════════════════

export async function handleAdminSosForceEscalation(
  req: Request,
  res: Response,
) {
  const startTime = Date.now();

  try {
    const adminId = (req as any).user?.id;
    if (!adminId) {
      return res.status(401).json({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    }

    const { sessionId } = req.params;
    const { userId, targetStage } = req.body;

    if (!sessionId) {
      return res.status(400).json({
        error: "ID de session requis.",
        code: "MISSING_SESSION_ID",
      });
    }

    if (!userId) {
      return res.status(400).json({
        error: "ID utilisateur requis.",
        code: "MISSING_USER_ID",
      });
    }

    if (typeof targetStage !== "number" || ![0, 1, 2].includes(targetStage)) {
      return res.status(400).json({
        error: "Stage cible invalide (0, 1 ou 2).",
        code: "INVALID_STAGE",
      });
    }

    const result: any = await sosService.adminForceEscalation(
      sessionId,
      userId,
      targetStage,
      adminId,
    );

    const duration = Date.now() - startTime;
    adminSosLogger.info("Escalade forcée par admin", {
      adminId,
      sessionId,
      userId,
      targetStage,
      duration,
    });

    res.status(200).json({
      success: true,
      session: {
        id: result.session._id,
        status: result.session.status,
        currentStage: result.session.currentStage,
      },
      participant: {
        userId: result.participant.userId,
        currentStage: result.participant.currentStage,
        escalationHistory: result.participant.escalationHistory,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "SESSION_NOT_FOUND") {
      return res.status(404).json({
        error: "Session non trouvée.",
        code: "SESSION_NOT_FOUND",
      });
    }
    if (error instanceof Error && error.message === "PARTICIPANT_NOT_FOUND") {
      return res.status(404).json({
        error: "Participant non trouvé dans cette session.",
        code: "PARTICIPANT_NOT_FOUND",
      });
    }
    if (error instanceof Error && error.message === "INVALID_STAGE") {
      return res.status(400).json({
        error: "Stage cible invalide.",
        code: "INVALID_STAGE",
      });
    }
    if (error instanceof Error && error.message === "STAGE_ALREADY_REACHED") {
      return res.status(409).json({
        error: "Le participant est déjà à ce stage ou supérieur.",
        code: "STAGE_ALREADY_REACHED",
      });
    }

    adminSosLogger.error("Erreur escalade forcée", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Erreur lors de l'escalade forcée.",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: ACTIVER UNE SESSION SOS (ADMIN)
// ═══════════════════════════════════════════════════════════════════════════

export async function handleAdminSosActivateSession(
  req: Request,
  res: Response,
) {
  const startTime = Date.now();

  try {
    const adminId = (req as any).user?.id;
    if (!adminId) {
      return res.status(401).json({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    }

    const {
      targetUserId,
      expectedDuration,
      note,
      lat,
      lng,
      siteName,
      zone,
      depth,
      participantIds,
    } = req.body;

    if (!targetUserId) {
      return res.status(400).json({
        error: "ID utilisateur cible requis.",
        code: "MISSING_TARGET_USER_ID",
      });
    }

    if (
      !expectedDuration ||
      typeof expectedDuration !== "number" ||
      expectedDuration < 1 ||
      expectedDuration > 480
    ) {
      return res.status(400).json({
        error: "Durée invalide (1-480 minutes).",
        code: "INVALID_DURATION",
      });
    }

    const session = await sosService.adminActivateSession({
      targetUserId,
      adminId,
      expectedDuration,
      note,
      lat,
      lng,
      siteName,
      zone,
      depth,
      participantIds,
    });

    const duration = Date.now() - startTime;
    adminSosLogger.info("Session activée par admin", {
      adminId,
      targetUserId,
      sessionId: session._id,
      duration,
    });

    res.status(201).json({
      success: true,
      session: {
        id: session._id,
        status: session.status,
        activatedAt: session.activatedAt,
        expiresAt: session.expiresAt,
        participants: session.participants?.map((p: any) => ({
          userId: p.userId.toString(),
          status: p.status,
          currentStage: p.currentStage,
        })),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "SESSION_ALREADY_ACTIVE") {
      return res.status(409).json({
        error: "Cet utilisateur a déjà une session active.",
        code: "SESSION_ALREADY_ACTIVE",
      });
    }
    if (error instanceof Error && error.message === "INVALID_DURATION") {
      return res.status(400).json({
        error: "Durée invalide.",
        code: "INVALID_DURATION",
      });
    }
    if (error instanceof Error && error.message === "INVALID_PARTICIPANT_IDS") {
      return res.status(400).json({
        error: "IDs de participants invalides.",
        code: "INVALID_PARTICIPANT_IDS",
      });
    }

    adminSosLogger.error("Erreur activation session", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Erreur lors de l'activation de la session.",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: CONFIRMER QU'UN UTILISATEUR EST EN SÉCURITÉ (ADMIN)
// ═══════════════════════════════════════════════════════════════════════════

export async function handleAdminSosConfirmSafe(req: Request, res: Response) {
  const startTime = Date.now();

  try {
    const adminId = (req as any).user?.id;
    if (!adminId) {
      return res.status(401).json({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    }

    const { sessionId } = req.params;
    const { reason } = req.body;

    if (!sessionId) {
      return res.status(400).json({
        error: "ID de session requis.",
        code: "MISSING_SESSION_ID",
      });
    }

    const session = await sosService.adminConfirmSafe(
      sessionId,
      adminId,
      reason,
    );

    const duration = Date.now() - startTime;
    adminSosLogger.info("Sécurité confirmée par admin", {
      adminId,
      sessionId,
      duration,
    });

    res.status(200).json({
      success: true,
      session: {
        id: session._id,
        status: session.status,
        resolvedAt: session.resolvedAt,
        resolvedBy: session.resolvedBy,
        participantCount: session.participants?.length || 0,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "SESSION_NOT_FOUND") {
      return res.status(404).json({
        error: "Session non trouvée.",
        code: "SESSION_NOT_FOUND",
      });
    }

    adminSosLogger.error("Erreur confirmation sécurité", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Erreur lors de la confirmation de sécurité.",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: AJOUTER UN PARTICIPANT À UNE SESSION (ADMIN)
// ═══════════════════════════════════════════════════════════════════════════

export async function handleAdminSosAddParticipant(
  req: Request,
  res: Response,
) {
  const startTime = Date.now();

  try {
    const adminId = (req as any).user?.id;
    if (!adminId) {
      return res.status(401).json({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    }

    const { sessionId } = req.params;
    const { targetUserId } = req.body;

    if (!sessionId) {
      return res.status(400).json({
        error: "ID de session requis.",
        code: "MISSING_SESSION_ID",
      });
    }

    if (!targetUserId) {
      return res.status(400).json({
        error: "ID utilisateur cible requis.",
        code: "MISSING_TARGET_USER_ID",
      });
    }

    const session = await sosService.adminAddParticipant(
      sessionId,
      targetUserId,
      adminId,
    );

    const duration = Date.now() - startTime;
    adminSosLogger.info("Participant ajouté par admin", {
      adminId,
      sessionId,
      targetUserId,
      duration,
    });

    res.status(200).json({
      success: true,
      session: {
        id: session._id,
        participantCount: session.participants?.length || 0,
        participants: session.participants?.map((p: any) => ({
          userId: p.userId.toString(),
          status: p.status,
          currentStage: p.currentStage,
          joinedAt: p.joinedAt,
        })),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "SESSION_NOT_FOUND") {
      return res.status(404).json({
        error: "Session non trouvée.",
        code: "SESSION_NOT_FOUND",
      });
    }
    if (error instanceof Error && error.message === "USER_NOT_FOUND") {
      return res.status(404).json({
        error: "Utilisateur non trouvé.",
        code: "USER_NOT_FOUND",
      });
    }
    if (error instanceof Error && error.message === "ALREADY_PARTICIPANT") {
      return res.status(409).json({
        error: "Cet utilisateur est déjà participant.",
        code: "ALREADY_PARTICIPANT",
      });
    }
    if (error instanceof Error && error.message === "USER_HAS_ACTIVE_SESSION") {
      return res.status(409).json({
        error: "Cet utilisateur a déjà une session active.",
        code: "USER_HAS_ACTIVE_SESSION",
      });
    }

    adminSosLogger.error("Erreur ajout participant", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Erreur lors de l'ajout du participant.",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: RETIRER UN PARTICIPANT D'UNE SESSION (ADMIN)
// ═══════════════════════════════════════════════════════════════════════════

export async function handleAdminSosRemoveParticipant(
  req: Request,
  res: Response,
) {
  const startTime = Date.now();

  try {
    const adminId = (req as any).user?.id;
    if (!adminId) {
      return res.status(401).json({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    }

    const { sessionId } = req.params;
    const { targetUserId } = req.body;

    if (!sessionId) {
      return res.status(400).json({
        error: "ID de session requis.",
        code: "MISSING_SESSION_ID",
      });
    }

    if (!targetUserId) {
      return res.status(400).json({
        error: "ID utilisateur cible requis.",
        code: "MISSING_TARGET_USER_ID",
      });
    }

    const session = await sosService.adminRemoveParticipant(
      sessionId,
      targetUserId,
      adminId,
    );

    const duration = Date.now() - startTime;
    adminSosLogger.info("Participant retiré par admin", {
      adminId,
      sessionId,
      targetUserId,
      duration,
    });

    res.status(200).json({
      success: true,
      session: {
        id: session._id,
        status: session.status,
        participantCount: session.participants?.length || 0,
        participants: session.participants?.map((p: any) => ({
          userId: p.userId.toString(),
          status: p.status,
          leftAt: p.leftAt,
        })),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "SESSION_NOT_FOUND") {
      return res.status(404).json({
        error: "Session non trouvée.",
        code: "SESSION_NOT_FOUND",
      });
    }
    if (error instanceof Error && error.message === "PARTICIPANT_NOT_FOUND") {
      return res.status(404).json({
        error: "Participant non trouvé dans cette session.",
        code: "PARTICIPANT_NOT_FOUND",
      });
    }
    if (
      error instanceof Error &&
      error.message === "PARTICIPANT_ALREADY_LEFT"
    ) {
      return res.status(409).json({
        error: "Ce participant a déjà quitté la session.",
        code: "PARTICIPANT_ALREADY_LEFT",
      });
    }

    adminSosLogger.error("Erreur retrait participant", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Erreur lors du retrait du participant.",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: DÉCLENCHER L'ENVOI DE SMS D'URGENCE (ADMIN)
// ═══════════════════════════════════════════════════════════════════════════

export async function handleAdminSosTriggerSms(req: Request, res: Response) {
  const startTime = Date.now();

  try {
    const adminId = (req as any).user?.id;
    if (!adminId) {
      return res.status(401).json({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    }

    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({
        error: "ID de session requis.",
        code: "MISSING_SESSION_ID",
      });
    }

    const result = await sosService.adminTriggerSms(sessionId, adminId);

    const duration = Date.now() - startTime;
    adminSosLogger.info("SMS d'urgence déclenchés par admin", {
      adminId,
      sessionId,
      sent: result.sent,
      failed: result.failed,
      duration,
    });

    res.status(200).json({
      success: true,
      sent: result.sent,
      failed: result.failed,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "SESSION_NOT_FOUND") {
      return res.status(404).json({
        error: "Session non trouvée.",
        code: "SESSION_NOT_FOUND",
      });
    }
    if (error instanceof Error && error.message === "NO_CONTACTS_FOUND") {
      return res.status(400).json({
        error: "Aucun contact d'urgence trouvé.",
        code: "NO_CONTACTS_FOUND",
      });
    }

    adminSosLogger.error("Erreur déclenchement SMS", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Erreur lors du déclenchement des SMS.",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: ENVOYER UNE NOTIFICATION À UN PARTICIPANT (ADMIN)
// ═══════════════════════════════════════════════════════════════════════════

export async function handleAdminSosSendNotification(
  req: Request,
  res: Response,
) {
  const startTime = Date.now();

  try {
    const adminId = (req as any).user?.id;
    if (!adminId) {
      return res.status(401).json({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    }

    const { sessionId } = req.params;
    const { targetUserId, message } = req.body;

    if (!sessionId) {
      return res.status(400).json({
        error: "ID de session requis.",
        code: "MISSING_SESSION_ID",
      });
    }

    if (!targetUserId) {
      return res.status(400).json({
        error: "ID utilisateur cible requis.",
        code: "MISSING_TARGET_USER_ID",
      });
    }

    if (!message || typeof message !== "string" || message.trim() === "") {
      return res.status(400).json({
        error: "Message requis et non vide.",
        code: "INVALID_MESSAGE",
      });
    }

    if (message.length > 500) {
      return res.status(400).json({
        error: "Message trop long (maximum 500 caractères).",
        code: "MESSAGE_TOO_LONG",
      });
    }

    await sosService.adminSendNotification(
      sessionId,
      targetUserId,
      message,
      adminId,
    );

    const duration = Date.now() - startTime;
    adminSosLogger.info("Notification envoyée par admin", {
      adminId,
      sessionId,
      targetUserId,
      duration,
    });

    res.status(200).json({
      success: true,
      message: "Notification envoyée.",
    });
  } catch (error) {
    if (error instanceof Error && error.message === "SESSION_NOT_FOUND") {
      return res.status(404).json({
        error: "Session non trouvée.",
        code: "SESSION_NOT_FOUND",
      });
    }
    if (error instanceof Error && error.message === "PARTICIPANT_NOT_FOUND") {
      return res.status(404).json({
        error: "Participant non trouvé dans cette session.",
        code: "PARTICIPANT_NOT_FOUND",
      });
    }

    adminSosLogger.error("Erreur envoi notification", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Erreur lors de l'envoi de la notification.",
      code: "INTERNAL_ERROR",
    });
  }
}
