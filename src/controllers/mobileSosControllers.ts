// ═══════════════════════════════════════════════════════════════════════════
// CONTRÔLEURS SOS MODE (MOBILE)
// ═══════════════════════════════════════════════════════════════════════════
// Endpoints pour le Mode SOS : activation, heartbeat, escalade, contacts
// Toutes les routes nécessitent une authentification mobile
// ═══════════════════════════════════════════════════════════════════════════

import { Request, Response } from "express";
import { sosService } from "../services/sosService";
import { getErrorMessage } from "../utils/errorUtils";

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

    const { expectedDuration, ficheId, note, lat, lng, accuracy } = req.body;

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
      ficheId,
      note,
      lat,
      lng,
      accuracy,
    });

    const duration = Date.now() - startTime;
    console.log(
      `✅ [MOBILE-SOS] Session activée: ${session._id} (${mobileContext?.platform}) en ${duration}ms`,
    );

    res.status(201).json({
      success: true,
      session: {
        id: session._id,
        status: session.status,
        activatedAt: session.activatedAt,
        expiresAt: session.expiresAt,
        expectedDuration: session.expectedDuration,
        currentStage: session.currentStage,
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
    }

    console.error(`❌ [MOBILE-SOS] Erreur activation:`, errorMsg);
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
    console.log(
      `💓 [MOBILE-SOS] Heartbeat reçu: session ${session._id} en ${duration}ms`,
    );

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

    console.error(`❌ [MOBILE-SOS] Erreur heartbeat:`, getErrorMessage(error));
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
    console.log(
      `⏱️ [MOBILE-SOS] Timer prolongé: session ${session._id} (+${additionalMinutes}min) en ${duration}ms`,
    );

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

    console.error(`❌ [MOBILE-SOS] Erreur extension:`, getErrorMessage(error));
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

    const { sessionId } = req.body;

    const session = await sosService.deactivateSession(userId, sessionId);

    const duration = Date.now() - startTime;
    console.log(
      `✅ [MOBILE-SOS] Session désactivée: ${session._id} en ${duration}ms`,
    );

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

    console.error(
      `❌ [MOBILE-SOS] Erreur désactivation:`,
      getErrorMessage(error),
    );
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
            ficheId: session.ficheId,
            note: session.note,
          }
        : null,
    });
  } catch (error) {
    console.error(`❌ [MOBILE-SOS] Erreur statut:`, getErrorMessage(error));
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
    const sessions = await sosService.getSessionHistory(userId, limit);

    res.status(200).json({
      success: true,
      sessions,
      count: sessions.length,
    });
  } catch (error) {
    console.error(`❌ [MOBILE-SOS] Erreur historique:`, getErrorMessage(error));
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
    console.error(
      `❌ [MOBILE-SOS] Erreur sessions actives:`,
      getErrorMessage(error),
    );
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
    console.log(
      `✅ [MOBILE-SOS] Session ${sessionId} confirmée safe par ${userId} en ${duration}ms`,
    );

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

    console.error(
      `❌ [MOBILE-SOS] Erreur confirm-safe:`,
      getErrorMessage(error),
    );
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
    console.log(`📞 [MOBILE-SOS] Contact créé: ${name} en ${duration}ms`);

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

    console.error(
      `❌ [MOBILE-SOS] Erreur création contact:`,
      getErrorMessage(error),
    );
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
    console.error(
      `❌ [MOBILE-SOS] Erreur liste contacts:`,
      getErrorMessage(error),
    );
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
    console.error(
      `❌ [MOBILE-SOS] Erreur mise à jour contact:`,
      getErrorMessage(error),
    );
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
    console.error(
      `❌ [MOBILE-SOS] Erreur suppression contact:`,
      getErrorMessage(error),
    );
    res.status(500).json({
      error: "Erreur lors de la suppression du contact.",
      code: "INTERNAL_ERROR",
    });
  }
}
