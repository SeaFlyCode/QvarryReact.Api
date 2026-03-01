// ═══════════════════════════════════════════════════════════════════════════
// CONTRÔLEURS SOS MODE (MOBILE)
// ═══════════════════════════════════════════════════════════════════════════
// Endpoints pour le Mode SOS : activation, heartbeat, escalade, contacts
// Toutes les routes nécessitent une authentification mobile
// ═══════════════════════════════════════════════════════════════════════════

import { Request, Response } from "express";
import { sosService } from "../services/sosService";
import { getErrorMessage } from "../utils/errorUtils";
import { logger } from "../services/loggerService";

const mobileSosLogger = logger.child({ service: "mobile-sos" });

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: ACTIVER UNE SESSION SOS
// ═══════════════════════════════════════════════════════════════════════════

export async function handleSosActivate(req: Request, res: Response) {
  const startTime = Date.now();
  const mobileContext = (req as any).mobileContext;

  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    }

    const {
      expectedDuration,
      note,
      lat,
      lng,
      accuracy,
      siteName,
      zone,
      depth,
      sessionContacts,
      participantIds,
    } = req.body;

    // Validation
    if (!expectedDuration || typeof expectedDuration !== "number") {
      return res.status(400).json({
        error: "Durée attendue requise (en minutes).",
        code: "MISSING_DURATION",
      });
    }

    if (expectedDuration < 15 || expectedDuration > 480) {
      return res.status(400).json({
        error: "La durée doit être entre 15 minutes et 8 heures.",
        code: "INVALID_DURATION",
      });
    }

    const session = await sosService.activateSession({
      userId,
      expectedDuration,
      note,
      lat,
      lng,
      accuracy,
      siteName,
      zone,
      depth,
      sessionContacts,
      participantIds,
    });

    const duration = Date.now() - startTime;
    mobileSosLogger.info("Session activée", {
      sessionId: session._id,
      platform: mobileContext?.platform,
      duration: `${duration}ms`,
    });

    res.status(201).json({
      success: true,
      session: {
        id: session._id,
        status: session.status,
        activatedAt: session.activatedAt,
        expiresAt: session.expiresAt,
        expectedDuration: session.expectedDuration,
        currentStage: session.currentStage,
        participants: session.participants.map((p) => ({
          userId: p.userId,
          status: p.status,
          joinedAt: p.joinedAt,
        })),
      },
    });
  } catch (error) {
    const errorMsg = getErrorMessage(error);

    if (error instanceof Error) {
      if (error.message === "SESSION_ALREADY_ACTIVE") {
        return res.status(409).json({
          error: "Une session SOS est déjà active.",
          code: "SESSION_ALREADY_ACTIVE",
        });
      }
      if (error.message === "NO_EMERGENCY_CONTACTS") {
        return res.status(400).json({
          error:
            "Vous devez ajouter au moins un contact d'urgence avant d'activer le SOS.",
          code: "NO_EMERGENCY_CONTACTS",
        });
      }
      if (error.message === "INVALID_DURATION") {
        return res.status(400).json({
          error: "Durée invalide (15min - 8h).",
          code: "INVALID_DURATION",
        });
      }
      if (error.message === "INVALID_CONTACT_IDS") {
        return res.status(400).json({
          error: "Un ou plusieurs IDs de contacts sont invalides.",
          code: "INVALID_CONTACT_IDS",
        });
      }
      if (error.message === "INVALID_PHONE_FORMAT") {
        return res.status(400).json({
          error: "Format de téléphone invalide pour un contact temporaire.",
          code: "INVALID_PHONE_FORMAT",
        });
      }
      if (error.message === "INVALID_PARTICIPANT_IDS") {
        return res.status(400).json({
          error: "Un ou plusieurs IDs de participants sont invalides.",
          code: "INVALID_PARTICIPANT_IDS",
        });
      }
    }

    mobileSosLogger.error("Erreur activation", { error: errorMsg });
    res.status(500).json({
      error: "Erreur lors de l'activation du SOS.",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: HEARTBEAT (SIGNE DE VIE)
// ═══════════════════════════════════════════════════════════════════════════

export async function handleSosHeartbeat(req: Request, res: Response) {
  const startTime = Date.now();

  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    }

    const { sessionId, lat, lng, accuracy } = req.body;

    const session = await sosService.heartbeat({
      userId,
      sessionId,
      lat,
      lng,
      accuracy,
    });

    const duration = Date.now() - startTime;
    mobileSosLogger.info("Heartbeat reçu", {
      sessionId: session._id,
      duration: `${duration}ms`,
    });

    res.status(200).json({
      success: true,
      session: {
        id: session._id,
        status: session.status,
        expiresAt: session.expiresAt,
        heartbeatCount: session.heartbeatCount,
        currentStage: session.currentStage,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "NO_ACTIVE_SESSION") {
      return res.status(404).json({
        error: "Aucune session SOS active.",
        code: "NO_ACTIVE_SESSION",
      });
    }

    mobileSosLogger.error("Erreur heartbeat", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Erreur lors du heartbeat.",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: PROLONGER LE TIMER
// ═══════════════════════════════════════════════════════════════════════════

export async function handleSosExtend(req: Request, res: Response) {
  const startTime = Date.now();

  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    }

    const { sessionId, additionalMinutes } = req.body;

    if (!additionalMinutes || typeof additionalMinutes !== "number") {
      return res.status(400).json({
        error: "Durée de prolongation requise (en minutes).",
        code: "MISSING_DURATION",
      });
    }

    if (additionalMinutes < 15 || additionalMinutes > 480) {
      return res.status(400).json({
        error: "La prolongation doit être entre 15 minutes et 8 heures.",
        code: "INVALID_EXTENSION_DURATION",
      });
    }

    const session = await sosService.extendSession({
      userId,
      sessionId,
      additionalMinutes,
    });

    const duration = Date.now() - startTime;
    mobileSosLogger.info("Timer prolongé", {
      sessionId: session._id,
      additionalMinutes,
      duration: `${duration}ms`,
    });

    res.status(200).json({
      success: true,
      session: {
        id: session._id,
        status: session.status,
        expiresAt: session.expiresAt,
        extensionCount: session.extensionCount,
        currentStage: session.currentStage,
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "NO_ACTIVE_SESSION") {
        return res.status(404).json({
          error: "Aucune session SOS active.",
          code: "NO_ACTIVE_SESSION",
        });
      }
      if (error.message === "INVALID_EXTENSION_DURATION") {
        return res.status(400).json({
          error: "Durée de prolongation invalide.",
          code: "INVALID_EXTENSION_DURATION",
        });
      }
    }

    mobileSosLogger.error("Erreur extension", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Erreur lors de la prolongation.",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: DÉSACTIVER LE SOS
// ═══════════════════════════════════════════════════════════════════════════

export async function handleSosDeactivate(req: Request, res: Response) {
  const startTime = Date.now();

  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    }

    const { sessionId, scope: rawScope } = req.body;

    // Validation du scope
    const validScopes = ["self", "all"];
    const scope = rawScope || "all";
    if (!validScopes.includes(scope)) {
      return res.status(400).json({
        success: false,
        error: "Scope invalide. Valeurs acceptées: 'self' ou 'all'",
      });
    }

    const session = await sosService.deactivateSession(
      userId,
      sessionId,
      scope,
    );

    const duration = Date.now() - startTime;
    mobileSosLogger.info("Session désactivée", {
      sessionId: session._id,
      scope: scope || "all",
      duration: `${duration}ms`,
    });

    res.status(200).json({
      success: true,
      session: {
        id: session._id,
        status: session.status,
        resolvedAt: session.resolvedAt,
        resolvedBy: session.resolvedBy,
        ...(scope === "self" &&
          session.status === "ACTIVE" && {
            participants: session.participants.map((p) => ({
              userId: p.userId,
              status: p.status,
              joinedAt: p.joinedAt,
              leftAt: p.leftAt,
            })),
          }),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "NO_ACTIVE_SESSION") {
      return res.status(404).json({
        error: "Aucune session SOS active.",
        code: "NO_ACTIVE_SESSION",
      });
    }

    mobileSosLogger.error("Erreur désactivation", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Erreur lors de la désactivation.",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: DÉSACTIVER LE SOS (VIA PARAMÈTRE URL)
// ═══════════════════════════════════════════════════════════════════════════

export async function handleSosDeactivateByParam(req: Request, res: Response) {
  const startTime = Date.now();

  try {
    const userId = (req as any).user?.id;
    if (!userId) {
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

    const { scope: rawScope } = req.body;

    // Validation du scope
    const validScopes = ["self", "all"];
    const scope = rawScope || "all";
    if (!validScopes.includes(scope)) {
      return res.status(400).json({
        success: false,
        error: "Scope invalide. Valeurs acceptées: 'self' ou 'all'",
      });
    }

    const session = await sosService.deactivateSession(
      userId,
      sessionId,
      scope,
    );

    const duration = Date.now() - startTime;
    mobileSosLogger.info("Session désactivée", {
      sessionId: session._id,
      duration: `${duration}ms`,
    });

    res.status(200).json({
      success: true,
      session: {
        id: session._id,
        status: session.status,
        resolvedAt: session.resolvedAt,
        resolvedBy: session.resolvedBy,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "NO_ACTIVE_SESSION") {
      return res.status(404).json({
        error: "Aucune session SOS active.",
        code: "NO_ACTIVE_SESSION",
      });
    }

    mobileSosLogger.error("Erreur désactivation par param", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Erreur lors de la désactivation.",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: STATUT DE LA SESSION ACTIVE
// ═══════════════════════════════════════════════════════════════════════════

export async function handleSosStatus(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    }

    const session = await sosService.getActiveSession(userId);

    res.status(200).json({
      success: true,
      active: session !== null,
      session: session
        ? {
            id: session._id,
            status: session.status,
            activatedAt: session.activatedAt,
            expiresAt: session.expiresAt,
            expectedDuration: session.expectedDuration,
            currentStage: session.currentStage,
            heartbeatCount: session.heartbeatCount,
            extensionCount: session.extensionCount,
            lastHeartbeatAt: session.lastHeartbeatAt,
            note: session.note,
            siteName: session.siteName,
            zone: session.zone,
            depth: session.depth,
            creatorId: session.userId,
            isGroupSession: session.participants.length > 1,
            participants: session.participants.map((p) => ({
              userId: p.userId,
              status: p.status,
              joinedAt: p.joinedAt,
              leftAt: p.leftAt,
              currentStage: p.currentStage,
              lastHeartbeatAt: p.lastHeartbeatAt,
            })),
          }
        : null,
    });
  } catch (error) {
    mobileSosLogger.error("Erreur statut", { error: getErrorMessage(error) });
    res.status(500).json({
      error: "Erreur lors de la récupération du statut.",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: HISTORIQUE DES SESSIONS
// ═══════════════════════════════════════════════════════════════════════════

export async function handleSosHistory(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const result = await sosService.getSessionHistory(userId, limit);

    res.status(200).json({
      success: true,
      sessions: result.sessions,
      stats: result.stats,
      count: result.sessions.length,
    });
  } catch (error) {
    mobileSosLogger.error("Erreur historique", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Erreur lors de la récupération de l'historique.",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: SESSIONS ACTIVES VISIBLES (DASHBOARD)
// ═══════════════════════════════════════════════════════════════════════════

export async function handleSosActiveSessions(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    }

    const sessions = await sosService.getActiveSessions(userId);

    res.status(200).json({
      success: true,
      sessions,
      count: sessions.length,
    });
  } catch (error) {
    mobileSosLogger.error("Erreur désactivation", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Erreur lors de la récupération des sessions actives.",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: CONFIRMER QU'UN UTILISATEUR EST EN SÉCURITÉ
// ═══════════════════════════════════════════════════════════════════════════

export async function handleSosConfirmSafe(req: Request, res: Response) {
  const startTime = Date.now();

  try {
    const userId = (req as any).user?.id;
    if (!userId) {
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

    const session = await sosService.confirmSafe(sessionId, userId);

    const duration = Date.now() - startTime;
    mobileSosLogger.info("Session confirmée safe", {
      sessionId,
      userId,
      duration: `${duration}ms`,
    });

    res.status(200).json({
      success: true,
      session: {
        id: session._id,
        status: session.status,
        resolvedAt: session.resolvedAt,
        resolvedBy: session.resolvedBy,
      },
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "SESSION_NOT_FOUND_OR_NOT_ESCALATING"
    ) {
      return res.status(404).json({
        error: "Session non trouvée ou pas en escalade.",
        code: "SESSION_NOT_FOUND",
      });
    }

    mobileSosLogger.error("Erreur désactivation", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Erreur lors de la confirmation.",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLERS: GESTION DES CONTACTS D'URGENCE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/mobile/sos/contacts - Créer un contact d'urgence
 */
export async function handleSosCreateContact(req: Request, res: Response) {
  const startTime = Date.now();

  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    }

    const { name, phone, relationship, isDefault } = req.body;

    if (!name || !phone) {
      return res.status(400).json({
        error: "Nom et numéro de téléphone requis.",
        code: "MISSING_FIELDS",
      });
    }

    // Validation format téléphone E.164
    if (!/^\+[1-9]\d{6,14}$/.test(phone)) {
      return res.status(400).json({
        error:
          "Format de téléphone invalide. Utilisez le format international (ex: +33612345678).",
        code: "INVALID_PHONE_FORMAT",
      });
    }

    const contact = await sosService.addContact(userId, {
      name,
      phone,
      relationship,
      isDefault,
    });

    const duration = Date.now() - startTime;
    mobileSosLogger.info("Contact créé", { name, duration: `${duration}ms` });

    res.status(201).json({
      success: true,
      contact: {
        id: contact._id,
        name: contact.name,
        phone: contact.phone,
        relationship: contact.relationship,
        isDefault: contact.isDefault,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "MAX_CONTACTS_REACHED") {
      return res.status(400).json({
        error: "Nombre maximum de contacts d'urgence atteint (5).",
        code: "MAX_CONTACTS_REACHED",
      });
    }

    // Erreur de doublon (index unique userId + phone)
    if (error instanceof Error && error.message.includes("duplicate key")) {
      return res.status(409).json({
        error: "Ce numéro de téléphone est déjà dans vos contacts d'urgence.",
        code: "DUPLICATE_PHONE",
      });
    }

    mobileSosLogger.error("Erreur confirm-safe", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Erreur lors de la création du contact.",
      code: "INTERNAL_ERROR",
    });
  }
}

/**
 * GET /api/mobile/sos/contacts - Lister les contacts d'urgence
 */
export async function handleSosGetContacts(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    }

    const contacts = await sosService.getContacts(userId);

    res.status(200).json({
      success: true,
      contacts,
      count: contacts.length,
    });
  } catch (error) {
    mobileSosLogger.error("Erreur sessions actives", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Erreur lors de la récupération des contacts.",
      code: "INTERNAL_ERROR",
    });
  }
}

/**
 * PUT /api/mobile/sos/contacts/:id - Modifier un contact d'urgence
 */
export async function handleSosUpdateContact(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    }

    const { id } = req.params;
    const { name, phone, relationship, isDefault } = req.body;

    // Validation format téléphone si fourni
    if (phone && !/^\+[1-9]\d{6,14}$/.test(phone)) {
      return res.status(400).json({
        error: "Format de téléphone invalide.",
        code: "INVALID_PHONE_FORMAT",
      });
    }

    const contact = await sosService.updateContact(userId, id, {
      ...(name && { name }),
      ...(phone && { phone }),
      ...(relationship !== undefined && { relationship }),
      ...(isDefault !== undefined && { isDefault }),
    });

    if (!contact) {
      return res.status(404).json({
        error: "Contact non trouvé.",
        code: "CONTACT_NOT_FOUND",
      });
    }

    res.status(200).json({
      success: true,
      contact,
    });
  } catch (error) {
    mobileSosLogger.error("Erreur mise à jour contact", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Erreur lors de la mise à jour du contact.",
      code: "INTERNAL_ERROR",
    });
  }
}

/**
 * DELETE /api/mobile/sos/contacts/:id - Supprimer un contact d'urgence
 */
export async function handleSosDeleteContact(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    }

    const { id } = req.params;

    const deleted = await sosService.deleteContact(userId, id);

    if (!deleted) {
      return res.status(404).json({
        error: "Contact non trouvé.",
        code: "CONTACT_NOT_FOUND",
      });
    }

    res.status(200).json({
      success: true,
      message: "Contact d'urgence supprimé.",
    });
  } catch (error) {
    mobileSosLogger.error("Erreur suppression contact", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Erreur lors de la suppression du contact.",
      code: "INTERNAL_ERROR",
    });
  }
}
