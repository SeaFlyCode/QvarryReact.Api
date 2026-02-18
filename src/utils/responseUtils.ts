import { Response } from "express";

export function sendSuccess(res: Response, data: any, status: number = 200) {
  return res.status(status).json(data);
}

export function sendError(
  res: Response,
  status: number,
  message: string,
  code?: string,
) {
  return res
    .status(status)
    .json({ error: message, code: code || `ERROR_${status}` });
}

export function sendUnauthorized(
  res: Response,
  message: string = "Non authentifié",
) {
  return sendError(res, 401, message, "UNAUTHORIZED");
}

export function sendForbidden(res: Response, message: string = "Accès refusé") {
  return sendError(res, 403, message, "FORBIDDEN");
}

export function sendNotFound(
  res: Response,
  message: string = "Ressource non trouvée",
) {
  return sendError(res, 404, message, "NOT_FOUND");
}

export function sendBadRequest(
  res: Response,
  message: string = "Requête invalide",
) {
  return sendError(res, 400, message, "BAD_REQUEST");
}

export function sendServerError(
  res: Response,
  message: string = "Erreur interne du serveur",
) {
  return sendError(res, 500, message, "INTERNAL_ERROR");
}
