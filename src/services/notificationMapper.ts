import type { NotificationType } from "../models/notifications";

export type PushNotificationType =
  | "message"
  | "new_conversation"
  | "group_update"
  | "group_invitation"
  | "contact"
  | "contact_accepted"
  | "contact_refused"
  | "share"
  | "share_accepted"
  | "share_rejected"
  | "sos_alarm"
  | "sos_alert_stage1"
  | "sos_cancelled"
  | "sos_safe"
  | "sos_participant_added"
  | "sos_participant_left"
  | "sos_surface_detected"
  | "sos_reconnection"
  | "sos_sms_triggered"
  | "system"
  | "login_alert"
  | "admin_notification";

export type NotificationLevel = "P0" | "P1" | "P2" | "P3";

export const FCM_TYPE_MAP: Record<NotificationType, PushNotificationType> = {
  contact_request: "contact",
  contact_accepted: "contact_accepted",
  contact_refused: "contact_refused",
  message: "message",
  group_invite: "group_invitation",
  group_member_added: "group_update",
  group_member_removed: "group_update",
  group_deleted: "group_update",
  share_received: "share",
  share_accepted: "share_accepted",
  share_declined: "share_rejected",
  share_read: "share",
  share_expiring_soon: "share",
  share_expired: "share",
  share_photo_skipped: "share",
  sos_alert: "sos_alarm",
  sos_stage1_alert: "sos_alert_stage1",
  sos_sms_triggered: "sos_sms_triggered",
  sos_confirmed_safe: "sos_safe",
  sos_session_cancelled: "sos_cancelled",
  sos_participant_left: "sos_participant_left",
  sos_surface_detected: "sos_surface_detected",
  sos_reconnection_detected: "sos_reconnection",
  login_new_device: "login_alert",
  admin_notification: "admin_notification",
  // Tous les admin_* routent vers le case "admin_notification" du mobile
  admin_sos_unresolved: "admin_notification",
  admin_security_breach: "admin_notification",
  admin_service_down: "admin_notification",
  admin_critical_audit: "admin_notification",
  admin_user_report: "admin_notification",
  admin_abuse_pattern: "admin_notification",
  admin_quota_exceeded: "admin_notification",
  admin_verification_pending: "admin_notification",
  admin_sos_failed_sms: "admin_notification",
  admin_sentry_high: "admin_notification",
  admin_cron_failed: "admin_notification",
  admin_metrics_anomaly: "admin_notification",
  admin_daily_digest: "admin_notification",
  admin_weekly_report: "admin_notification",
};

export const NOTIFICATION_LEVEL: Record<NotificationType, NotificationLevel> = {
  // P0 — critique sécurité
  sos_alert: "P0",
  sos_stage1_alert: "P0",
  sos_sms_triggered: "P0",
  login_new_device: "P0",

  // P1 — communication directe
  message: "P1",
  contact_request: "P1",
  group_invite: "P1",

  // P2 — action sur données
  share_received: "P2",
  share_accepted: "P2",
  contact_accepted: "P2",
  group_member_added: "P2",
  share_expiring_soon: "P2",
  admin_notification: "P2",
  sos_confirmed_safe: "P2",
  sos_session_cancelled: "P2",

  // P3 — in-app only, pas de push
  share_read: "P3",
  share_declined: "P3",
  share_expired: "P3",
  share_photo_skipped: "P3",
  contact_refused: "P3",
  sos_surface_detected: "P3",
  sos_reconnection_detected: "P3",
  sos_participant_left: "P3",
  group_member_removed: "P3",
  group_deleted: "P3",

  // ─── Admin notifications ─────────────────────────────────────────────
  // P0 — critique, push immédiat sans throttle d'agrégation
  admin_sos_unresolved: "P0",
  admin_security_breach: "P0",
  admin_service_down: "P0",
  admin_critical_audit: "P0",

  // P1 — important, push direct
  admin_user_report: "P1",
  admin_abuse_pattern: "P1",
  admin_quota_exceeded: "P1",
  admin_verification_pending: "P1",
  admin_sos_failed_sms: "P1",

  // P2 — push agrégé (soft throttle si > 5/h)
  admin_sentry_high: "P2",
  admin_cron_failed: "P2",
  admin_metrics_anomaly: "P2",

  // P3 — digest in-app uniquement
  admin_daily_digest: "P3",
  admin_weekly_report: "P3",
};

export function mapNotificationTypeForFCM(
  type: NotificationType,
): PushNotificationType {
  return FCM_TYPE_MAP[type] ?? "system";
}

export function getNotificationLevel(type: NotificationType): NotificationLevel {
  return NOTIFICATION_LEVEL[type] ?? "P2";
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION CATEGORIES — pour iOS UNNotificationCategory + Android Notifee actions
// ═══════════════════════════════════════════════════════════════════════════
// Indique au mobile quelles actions afficher dans la notification.
// Le mobile lit data.actionCategory pour mapper sur ses categories natives.
// Les actions natives (button labels, behavior) sont déclarées côté mobile.
// ═══════════════════════════════════════════════════════════════════════════

export type ActionCategory =
  | "message_actions"
  | "contact_request_actions"
  | "share_actions"
  | "sos_actions";

export const ACTION_CATEGORY_MAP: Partial<
  Record<NotificationType, ActionCategory>
> = {
  message: "message_actions",
  contact_request: "contact_request_actions",
  share_received: "share_actions",
  sos_alert: "sos_actions",
  sos_stage1_alert: "sos_actions",
};

export function getActionCategoryForType(
  type: NotificationType,
): ActionCategory | null {
  return ACTION_CATEGORY_MAP[type] ?? null;
}
