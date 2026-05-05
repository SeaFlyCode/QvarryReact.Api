// ═══════════════════════════════════════════════════════════════════════════
// HELPERS POUR LES RÉPONSES D'ERREUR AUTH STRUCTURÉES (P1 — 403 ambigu)
// ═══════════════════════════════════════════════════════════════════════════
// Tous les 403 issus du flux auth/access-control utilisent un shape unifié :
//   { error: "FORBIDDEN", code: "<CODE>", message: "..." }
//
// Codes possibles :
//   - BLOCKED              : compte bloqué (admin)
//   - UNVERIFIED           : email non vérifié
//   - PENDING_VALIDATION   : compte en attente de validation manuelle
//   - UNAUTHORIZED         : motif générique (rôle insuffisant, etc.)
//
// Un champ optionnel `details` permet de transmettre les infos spécifiques
// (ex: rejectionReason pour un compte refusé) sans casser le contrat.
// ═══════════════════════════════════════════════════════════════════════════

import { Response } from "express";

export type ForbiddenCode =
  | "BLOCKED"
  | "UNVERIFIED"
  | "PENDING_VALIDATION"
  | "UNAUTHORIZED";

export interface ForbiddenPayload {
  error: "FORBIDDEN";
  code: ForbiddenCode;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Construit le payload normalisé d'une réponse 403.
 */
export function buildForbidden(
  code: ForbiddenCode,
  message: string,
  details?: Record<string, unknown>,
): ForbiddenPayload {
  const payload: ForbiddenPayload = {
    error: "FORBIDDEN",
    code,
    message,
  };
  if (details && Object.keys(details).length > 0) {
    payload.details = details;
  }
  return payload;
}

/**
 * Envoie une réponse 403 structurée.
 * Helper à utiliser dans les middlewares et controllers d'auth.
 */
export function sendForbidden(
  res: Response,
  code: ForbiddenCode,
  message: string,
  details?: Record<string, unknown>,
): Response {
  return res.status(403).json(buildForbidden(code, message, details));
}
