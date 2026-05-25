// ═══════════════════════════════════════════════════════════════════════════
// CONTRÔLEURS SOS MODE (MOBILE)
// ═══════════════════════════════════════════════════════════════════════════
// Endpoints pour le Mode SOS : activation, heartbeat, escalade, contacts
// Toutes les routes nécessitent une authentification mobile
// ═══════════════════════════════════════════════════════════════════════════

import { Request, Response } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { sosService } from "../services/sosService";
import { getErrorMessage } from "../utils/errorUtils";
import { logger } from "../services/loggerService";

const mobileSosLogger = logger.child({ service: "mobile-sos" });

// ═══════════════════════════════════════════════════════════════════════════
// SCHÉMAS ZOD PARTAGÉS POUR LES PAYLOADS SOS
// ═══════════════════════════════════════════════════════════════════════════

const sosCoordsSchema = z.object({
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  accuracy: z.number().min(0).optional(),
});

const sessionContactsSchema = z
  .object({
    permanentContactIds: z.array(z.string()).optional(),
    additionalContacts: z
      .array(
        z.object({
          name: z.string().min(1).max(100),
          phone: z.string().min(1).max(50),
          relationship: z.string().max(100).optional(),
        }),
      )
      .optional(),
  })
  .optional();

// Schéma d'activation : durée stricte + coordonnées GPS bornées.
// Le client mobile envoie parfois lastKnownLat/Lng/Accuracy : on accepte les
// deux formes en passthrough et on résout dans le handler.
const sosActivateSchema = z
  .object({
    expectedDuration: z.number().int().min(1).max(480),
    note: z.string().max(500).optional(),
    siteName: z.string().max(200).optional(),
    zone: z.string().max(200).optional(),
    depth: z.number().min(0).max(10000).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    accuracy: z.number().min(0).optional(),
    lastKnownLat: z.number().min(-90).max(90).optional(),
    lastKnownLng: z.number().min(-180).max(180).optional(),
    lastKnownAccuracy: z.number().min(0).optional(),
    sessionContacts: sessionContactsSchema,
    participantIds: z.array(z.string()).optional(),
  })
  .passthrough();

const sosHeartbeatSchema = sosCoordsSchema.extend({
  sessionId: z.string().optional(),
});

function zodErrorResponse(res: Response, error: z.ZodError) {
  const issue = error.issues[0];
  const path = issue?.path?.join(".") || "body";
  return res.status(400).json({
    error: `Champ invalide: ${path} — ${issue?.message ?? "valeur incorrecte"}`,
    code: "INVALID_PAYLOAD",
    details: error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    })),
  });
}

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

    const parsed = sosActivateSchema.safeParse(req.body);
    if (!parsed.success) {
      return zodErrorResponse(res, parsed.error);
    }

    const {
      expectedDuration,
      note,
      lat,
      lastKnownLat,
      lng,
      lastKnownLng,
      accuracy,
      lastKnownAccuracy,
      siteName,
      zone,
      depth,
      sessionContacts,
      participantIds,
    } = parsed.data;

    const resolvedLat = lat ?? lastKnownLat;
    const resolvedLng = lng ?? lastKnownLng;
    const resolvedAccuracy = accuracy ?? lastKnownAccuracy;

    const session = await sosService.activateSession({
      userId,
      expectedDuration,
      note,
      lat: resolvedLat,
      lng: resolvedLng,
      accuracy: resolvedAccuracy,
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

    // Logger le VRAI message d'erreur (pas le message masqué retourné au client
    // par getErrorMessage en prod) — sinon Loki affiche juste "Une erreur
    // interne est survenue" et le diag est impossible. Ces infos restent
    // côté serveur, ne sont jamais envoyées au client.
    mobileSosLogger.error("Erreur activation", {
      error: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : undefined,
      stack:
        error instanceof Error && error.stack
          ? error.stack.split("\n").slice(0, 6).join(" | ")
          : undefined,
      maskedMessage: errorMsg,
    });
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

    const parsed = sosHeartbeatSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return zodErrorResponse(res, parsed.error);
    }
    const { sessionId, lat, lng, accuracy } = parsed.data;

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

    if (
      error instanceof Error &&
      error.message === "NOT_AUTHORIZED_TO_DEACTIVATE_ALL"
    ) {
      return res.status(403).json({
        error: "Seul le créateur de la session peut la désactiver pour tous.",
        code: "NOT_AUTHORIZED_TO_DEACTIVATE_ALL",
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

    mobileSosLogger.debug("[DEBUG-STATUS] handleSosStatus résultat", {
      userId,
      active: session !== null,
      sessionId: session?._id?.toString(),
      sessionStatus: session?.status,
    });

    res.status(200).json({
      success: true,
      active: session !== null,
      session: session
        ? {
            id: session._id,
            userId: session.userId,
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
            // Coordonnées GPS : retournées uniquement au créateur de la session
            lastKnownLat: userId === session.userId.toString() ? (session.lastKnownLat ?? 0) : null,
            lastKnownLng: userId === session.userId.toString() ? (session.lastKnownLng ?? 0) : null,
            lastKnownAccuracy: userId === session.userId.toString() ? (session.lastKnownAccuracy ?? 0) : null,
            // Contacts (champs manquants côté client au boot → crash)
            contactIds: (session.sessionContactIds ?? []).map((c: any) =>
              typeof c === "string"
                ? c
                : (c._id?.toString?.() ?? c.id?.toString?.() ?? String(c)),
            ),
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

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: AJOUTER UN PARTICIPANT À UNE SESSION ACTIVE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/mobile/sos/add-participant
 * Ajouter un participant à une session SOS déjà active.
 * Seul le créateur de la session peut appeler cette route.
 */
export async function handleSosAddParticipant(req: Request, res: Response) {
  const startTime = Date.now();

  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    }

    const { targetUserId, sessionId } = req.body;

    if (!targetUserId || !Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({
        error: "ID utilisateur invalide.",
        code: "INVALID_USER_ID",
      });
    }

    if (!sessionId || !Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({
        error: "ID session invalide.",
        code: "INVALID_SESSION_ID",
      });
    }

    const session = await sosService.addParticipantToSession(
      userId,
      targetUserId,
      sessionId,
    );

    const duration = Date.now() - startTime;
    mobileSosLogger.info("Participant ajouté à la session SOS", {
      sessionId: session._id,
      addedBy: userId,
      targetUserId,
      duration: `${duration}ms`,
    });

    res.status(200).json({
      success: true,
      session: {
        id: session._id,
        status: session.status,
        participants: session.participants.map((p) => ({
          userId: p.userId,
          status: p.status,
          joinedAt: p.joinedAt,
          leftAt: p.leftAt,
        })),
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "NO_ACTIVE_SESSION") {
        return res.status(404).json({
          error: "Aucune session SOS active trouvée pour ce créateur.",
          code: "NO_ACTIVE_SESSION",
        });
      }
      if (error.message === "INVALID_PARTICIPANT_IDS") {
        return res.status(400).json({
          error: "L'utilisateur cible est introuvable.",
          code: "INVALID_PARTICIPANT_IDS",
        });
      }
      if (error.message === "ALREADY_PARTICIPANT") {
        return res.status(409).json({
          error: "Cet utilisateur est déjà participant actif de la session.",
          code: "ALREADY_PARTICIPANT",
        });
      }
      if (error.message === "SESSION_ALREADY_ACTIVE") {
        return res.status(409).json({
          error: "Cet utilisateur a déjà une session SOS active.",
          code: "SESSION_ALREADY_ACTIVE",
        });
      }
    }

    mobileSosLogger.error("Erreur ajout participant", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Erreur lors de l'ajout du participant.",
      code: "INTERNAL_ERROR",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER: RETIRER UN PARTICIPANT D'UNE SESSION ACTIVE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/mobile/sos/remove-participant
 * Retirer un participant d'une session SOS active.
 * N'importe quel participant actif peut retirer n'importe qui (soi-même inclus).
 */
export async function handleSosRemoveParticipant(req: Request, res: Response) {
  const startTime = Date.now();

  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        error: "Authentification requise.",
        code: "UNAUTHORIZED",
      });
    }

    const { targetUserId, sessionId } = req.body;

    if (!targetUserId || !Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({
        error: "ID utilisateur invalide.",
        code: "INVALID_USER_ID",
      });
    }

    if (!sessionId || !Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({
        error: "ID session invalide.",
        code: "INVALID_SESSION_ID",
      });
    }

    const session = await sosService.removeParticipantFromSession(
      userId,
      targetUserId,
      sessionId,
    );

    const duration = Date.now() - startTime;
    mobileSosLogger.info("Participant retiré de la session SOS", {
      sessionId: session._id,
      removedBy: userId,
      targetUserId,
      duration: `${duration}ms`,
    });

    res.status(200).json({
      success: true,
      session: {
        id: session._id,
        status: session.status,
        resolvedAt: session.resolvedAt,
        resolvedBy: session.resolvedBy,
        participants: session.participants.map((p) => ({
          userId: p.userId,
          status: p.status,
          joinedAt: p.joinedAt,
          leftAt: p.leftAt,
        })),
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
      if (error.message === "PARTICIPANT_NOT_FOUND") {
        return res.status(404).json({
          error:
            "Le participant cible est introuvable ou a déjà quitté la session.",
          code: "PARTICIPANT_NOT_FOUND",
        });
      }
    }

    mobileSosLogger.error("Erreur retrait participant", {
      error: getErrorMessage(error),
    });
    res.status(500).json({
      error: "Erreur lors du retrait du participant.",
      code: "INTERNAL_ERROR",
    });
  }
}
