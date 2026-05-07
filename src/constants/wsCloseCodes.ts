/**
 * Codes de fermeture WebSocket centralisés (RFC 6455 plage privée 4000-4999).
 *
 * Toute fermeture côté serveur DOIT utiliser un de ces codes pour permettre
 * aux clients (mobile + web) d'avoir un mapping unique et stable.
 *
 * Chaque code possède une "raison" courte ASCII (le second argument de
 * `ws.close(code, reason)`) — le client peut s'en servir pour logging/UX
 * sans dépendre du libellé exact.
 *
 * Référence : audit cross-projet 2026-05-04 §4 (P2 dette technique).
 */
export const WS_CLOSE_CODES = {
  /** Pas de message d'auth reçu dans le délai imparti (5 s). */
  AUTH_REQUIRED: 4001,
  /** Token JWT structurellement invalide ou type non attendu. */
  AUTH_INVALID: 4002,
  /** Token JWT expiré — le client doit refresh puis reconnecter. */
  AUTH_EXPIRED: 4003,
  /** Token App Check Firebase rejeté. */
  APP_CHECK_FAILED: 4004,
  /** L'utilisateur n'est pas (ou plus) membre de la ressource ciblée. */
  FORBIDDEN: 4005,
  /** Trop de connexions WS pour cette IP/user. */
  RATE_LIMITED: 4006,
  /** Pas de pong reçu dans le délai (60 s par défaut). */
  HEARTBEAT_TIMEOUT: 4010,
  /** Le serveur redémarre — le client doit reconnecter avec backoff. */
  SERVER_SHUTDOWN: 4011,
  /** Message client mal formé / type non reconnu. */
  PROTOCOL_VIOLATION: 4020,
  /** Erreur fallback non classifiée. */
  UNKNOWN_ERROR: 4029,
} as const;

export type WsCloseCode = (typeof WS_CLOSE_CODES)[keyof typeof WS_CLOSE_CODES];

/**
 * Raisons courtes ASCII (max 123 octets selon RFC 6455 §5.5.1) — utilisées
 * comme second argument de `ws.close(code, reason)`. Stables côté contrat
 * client : les frontends matchent dessus pour décider du comportement
 * (refresh token, retry exponentiel, abandon, etc.).
 */
export const WS_CLOSE_REASONS: Record<WsCloseCode, string> = {
  [WS_CLOSE_CODES.AUTH_REQUIRED]: "auth_required",
  [WS_CLOSE_CODES.AUTH_INVALID]: "auth_invalid",
  [WS_CLOSE_CODES.AUTH_EXPIRED]: "auth_expired",
  [WS_CLOSE_CODES.APP_CHECK_FAILED]: "app_check_failed",
  [WS_CLOSE_CODES.FORBIDDEN]: "forbidden",
  [WS_CLOSE_CODES.RATE_LIMITED]: "rate_limited",
  [WS_CLOSE_CODES.HEARTBEAT_TIMEOUT]: "heartbeat_timeout",
  [WS_CLOSE_CODES.SERVER_SHUTDOWN]: "server_shutdown",
  [WS_CLOSE_CODES.PROTOCOL_VIOLATION]: "protocol_violation",
  [WS_CLOSE_CODES.UNKNOWN_ERROR]: "unknown_error",
};

/**
 * Helper : retourne la raison standard pour un code donné.
 * Fallback "unknown_error" si code non mappé.
 */
export function getWsCloseReason(code: WsCloseCode | number): string {
  return (
    WS_CLOSE_REASONS[code as WsCloseCode] ??
    WS_CLOSE_REASONS[WS_CLOSE_CODES.UNKNOWN_ERROR]
  );
}
