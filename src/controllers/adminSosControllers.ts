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
