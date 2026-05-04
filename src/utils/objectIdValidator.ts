/**
 * QVARRY API — Helper de validation des ObjectId.
 *
 * Cf. fix.md backend #6a. Centralise la validation des `req.params.id` et
 * `req.body.id` pour éviter les CastError Mongoose qui leak des détails et
 * remontent en 500 alors qu'on devrait répondre 400.
 *
 * Usage :
 *   const id = parseObjectId(req.params.id);
 *   if (!id) return res.status(400).json({ error: 'ID invalide' });
 *
 *   // Ou en assertion (throw 400 directement) :
 *   assertObjectId(req.params.id, res);
 *   // Si on n'a pas return, l'ID est valide.
 */

import mongoose from "mongoose";
import type { Response } from "express";

/**
 * Retourne l'ObjectId si valide, `null` sinon. Ne lève jamais.
 */
export function parseObjectId(value: unknown): mongoose.Types.ObjectId | null {
  if (typeof value !== "string") return null;
  if (!mongoose.Types.ObjectId.isValid(value)) return null;
  return new mongoose.Types.ObjectId(value);
}

/**
 * Vérifie qu'une valeur est un ObjectId valide. Si non, écrit une réponse
 * 400 sur `res` et retourne `false`. Sinon retourne `true`.
 *
 * Le caller doit `return` après un `false` pour éviter de continuer le handler.
 */
export function assertObjectId(
  value: unknown,
  res: Response,
  fieldName = "id",
): boolean {
  if (parseObjectId(value)) return true;
  res.status(400).json({
    error: `Format d'identifiant invalide`,
    field: fieldName,
  });
  return false;
}

/**
 * Variante throw : utile dans les services où on n'a pas accès à `res`.
 */
export class InvalidObjectIdError extends Error {
  public readonly code = "INVALID_OBJECT_ID";
  constructor(public readonly fieldName: string, public readonly value: unknown) {
    super(`Identifiant invalide pour ${fieldName}`);
    this.name = "InvalidObjectIdError";
  }
}

export function requireObjectId(
  value: unknown,
  fieldName = "id",
): mongoose.Types.ObjectId {
  const id = parseObjectId(value);
  if (!id) {
    throw new InvalidObjectIdError(fieldName, value);
  }
  return id;
}
