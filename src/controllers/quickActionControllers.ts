// ═══════════════════════════════════════════════════════════════════════════
// QUICK ACTION CONTROLLERS
// ═══════════════════════════════════════════════════════════════════════════
// Endpoints appelés depuis les boutons d'action des notifications mobiles.
// Auth standard JWT. Validation Zod sur le body. Idempotents.
// ═══════════════════════════════════════════════════════════════════════════

import type { Request, Response } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { logger } from "../services/loggerService";
import {
  quickActionSosConfirmSafe,
  quickActionContactAccept,
  quickActionContactRefuse,
  quickActionShareAccept,
  quickActionShareRefuse,
} from "../services/quickActionService";
import { getErrorMessage } from "../utils/errorUtils";

const quickActionLogger = logger.child({ service: "quick-action-ctrl" });

// ─── Schemas Zod ─────────────────────────────────────────────────────────

const objectIdSchema = z
  .string()
  .refine((v) => mongoose.Types.ObjectId.isValid(v), {
    message: "Identifiant invalide",
  });

const sosConfirmSafeSchema = z.object({
  sessionId: objectIdSchema,
});

const contactActionSchema = z.object({
  contactId: objectIdSchema,
});

const shareActionSchema = z.object({
  shareId: objectIdSchema,
});

// ─── Helper de réponse erreur ─────────────────────────────────────────────

function sendValidationError(res: Response, error: z.ZodError): void {
  res.status(400).json({
    error: "Données invalides",
    details: error.issues.map((i) => ({ path: i.path, message: i.message })),
  });
}

function requireAuth(req: Request, res: Response): string | null {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Authentification requise" });
    return null;
  }
  return userId;
}

// ─── Handlers ────────────────────────────────────────────────────────────

/** POST /quick-actions/sos/confirm-safe — body { sessionId } */
export async function handleQuickActionSosConfirmSafe(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const parsed = sosConfirmSafeSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  try {
    const result = await quickActionSosConfirmSafe(
      parsed.data.sessionId,
      userId,
    );
    res.status(200).json(result);
  } catch (error) {
    const msg = getErrorMessage(error);
    if (msg === "NOT_AUTHORIZED_TO_CONFIRM") {
      res.status(403).json({ error: "Action non autorisée" });
      return;
    }
    quickActionLogger.error("[quick-action] sos/confirm-safe failed", {
      userId,
      sessionId: parsed.data.sessionId,
      error: msg,
    });
    res.status(500).json({ error: "Erreur lors de la confirmation" });
  }
}

/** POST /quick-actions/contact/accept — body { contactId } */
export async function handleQuickActionContactAccept(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const parsed = contactActionSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  try {
    const result = await quickActionContactAccept(
      parsed.data.contactId,
      userId,
    );
    res.status(200).json(result);
  } catch (error) {
    const msg = getErrorMessage(error);
    if (msg === "CONTACT_NOT_FOUND") {
      res.status(404).json({ error: "Demande de contact introuvable" });
      return;
    }
    if (msg === "CONTACT_INVALID_STATE") {
      res.status(409).json({ error: "Le contact ne peut plus être accepté" });
      return;
    }
    quickActionLogger.error("[quick-action] contact/accept failed", {
      userId,
      contactId: parsed.data.contactId,
      error: msg,
    });
    res.status(500).json({ error: "Erreur lors de l'acceptation" });
  }
}

/** POST /quick-actions/contact/refuse — body { contactId } */
export async function handleQuickActionContactRefuse(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const parsed = contactActionSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  try {
    const result = await quickActionContactRefuse(
      parsed.data.contactId,
      userId,
    );
    res.status(200).json(result);
  } catch (error) {
    quickActionLogger.error("[quick-action] contact/refuse failed", {
      userId,
      contactId: parsed.data.contactId,
      error: getErrorMessage(error),
    });
    res.status(500).json({ error: "Erreur lors du refus" });
  }
}

/** POST /quick-actions/share/accept — body { shareId } */
export async function handleQuickActionShareAccept(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const parsed = shareActionSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  try {
    const result = await quickActionShareAccept(parsed.data.shareId, userId);
    res.status(200).json(result);
  } catch (error) {
    const msg = getErrorMessage(error);
    if (msg === "SHARE_NOT_FOUND") {
      res.status(404).json({ error: "Partage introuvable" });
      return;
    }
    quickActionLogger.error("[quick-action] share/accept failed", {
      userId,
      shareId: parsed.data.shareId,
      error: msg,
    });
    res.status(500).json({ error: "Erreur lors de l'acceptation du partage" });
  }
}

/** POST /quick-actions/share/refuse — body { shareId } */
export async function handleQuickActionShareRefuse(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const parsed = shareActionSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  try {
    const result = await quickActionShareRefuse(parsed.data.shareId, userId);
    res.status(200).json(result);
  } catch (error) {
    const msg = getErrorMessage(error);
    if (msg === "SHARE_NOT_FOUND") {
      res.status(404).json({ error: "Partage introuvable" });
      return;
    }
    quickActionLogger.error("[quick-action] share/refuse failed", {
      userId,
      shareId: parsed.data.shareId,
      error: msg,
    });
    res.status(500).json({ error: "Erreur lors du refus du partage" });
  }
}
