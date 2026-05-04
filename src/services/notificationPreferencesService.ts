import type { NotificationType } from "../models/notifications";

export type NotificationPreferenceCategory =
  | "messages"
  | "contacts"
  | "shares"
  | "groups"
  | "community_sos";

export interface NotificationPreferences {
  messages: boolean;
  contacts: boolean;
  shares: boolean;
  groups: boolean;
  community_sos: boolean;
  quietHours: {
    enabled: boolean;
    start: string;
    end: string;
  };
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  messages: true,
  contacts: true,
  shares: true,
  groups: true,
  community_sos: true,
  quietHours: { enabled: false, start: "22:00", end: "07:00" },
};

/**
 * Types P0 propres au user qui passent TOUJOURS, peu importe les préférences
 * et les quiet hours (sécurité personnelle).
 */
const ALWAYS_ALLOWED_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>([
  "sos_alert",
  "sos_sms_triggered",
  "login_new_device",
]);

/**
 * Mappe un NotificationType vers la catégorie de préférence correspondante.
 * Retourne null si le type n'a pas de catégorie associée (toujours envoyé).
 */
export function mapTypeToPreferenceCategory(
  type: NotificationType,
): NotificationPreferenceCategory | null {
  switch (type) {
    case "message":
    case "group_invite":
      return "messages";
    case "contact_request":
    case "contact_accepted":
    case "contact_refused":
      return "contacts";
    case "share_received":
    case "share_accepted":
    case "share_declined":
    case "share_read":
    case "share_expiring_soon":
    case "share_expired":
      return "shares";
    case "group_member_added":
    case "group_member_removed":
    case "group_deleted":
      return "groups";
    case "sos_stage1_alert":
      return "community_sos";
    default:
      return null;
  }
}

export function isAlwaysAllowedType(type: NotificationType): boolean {
  return ALWAYS_ALLOWED_TYPES.has(type);
}

/**
 * Vérifie si l'utilisateur a opt-out la catégorie correspondante.
 * Retourne true si la notif doit être skipée (push), false sinon.
 */
export function shouldSkipForCategory(
  type: NotificationType,
  prefs: NotificationPreferences | null | undefined,
): boolean {
  if (!prefs) return false;
  if (isAlwaysAllowedType(type)) return false;
  const category = mapTypeToPreferenceCategory(type);
  if (!category) return false;
  return prefs[category] === false;
}

/**
 * Parse 'HH:MM' UTC vers minutes depuis minuit.
 * Retourne null si format invalide.
 */
export function parseHHMM(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Vérifie si l'instant courant (UTC) est dans la plage quiet hours.
 * Supporte les plages qui traversent minuit (ex 22:00 → 07:00).
 */
export function isWithinQuietHours(
  prefs: NotificationPreferences | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!prefs?.quietHours?.enabled) return false;
  const start = parseHHMM(prefs.quietHours.start);
  const end = parseHHMM(prefs.quietHours.end);
  if (start === null || end === null) return false;
  const current = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (start === end) return false;
  if (start < end) {
    return current >= start && current < end;
  }
  // Plage qui traverse minuit
  return current >= start || current < end;
}

/**
 * Décide si un push FCM doit être skipé pour ce user/type.
 * Règles :
 *  - Les types P0 propres au user passent toujours.
 *  - Si quiet hours actives ET niveau P2/P3 → skip.
 *  - Si la catégorie est désactivée → skip.
 */
export function shouldSkipPush(
  type: NotificationType,
  level: "P0" | "P1" | "P2" | "P3",
  prefs: NotificationPreferences | null | undefined,
  now: Date = new Date(),
): { skip: boolean; reason?: "category_disabled" | "quiet_hours" } {
  if (!prefs) return { skip: false };
  if (isAlwaysAllowedType(type)) return { skip: false };

  if (shouldSkipForCategory(type, prefs)) {
    return { skip: true, reason: "category_disabled" };
  }

  if ((level === "P2" || level === "P3") && isWithinQuietHours(prefs, now)) {
    return { skip: true, reason: "quiet_hours" };
  }

  return { skip: false };
}
