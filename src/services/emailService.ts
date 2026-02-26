import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { maskEmail, anonymizeIp } from "../utils/logUtils";
import { logger } from "./loggerService";

const emailLogger = logger.child({ service: "email" });

// ═══════════════════════════════════════════════════════════════════════════
// SERVICE D'ENVOI D'EMAILS - QVARRY
// ═══════════════════════════════════════════════════════════════════════════

interface EmailOptions {
  to: string;
  subject: string;
  template: EmailTemplate;
  variables: Record<string, string>;
}

export type EmailTemplate =
  | "welcome"
  | "email-verification"
  | "password-reset"
  | "password-changed"
  | "security-alert-login"
  | "security-alert-admin"
  | "share-notification"
  | "contact-request"
  | "contact-accepted"
  | "account-approved"
  | "account-rejected"
  | "admin-pending-validation";

// ═══════════════════════════════════════════════════════════════════════════
// SYSTÈME DE DÉDUPLICATION DES EMAILS
// Empêche l'envoi de plusieurs emails identiques dans un court laps de temps
// ═══════════════════════════════════════════════════════════════════════════

interface EmailDeduplicationEntry {
  hash: string;
  timestamp: number;
  count: number;
}

// Cache de déduplication : clé = hash de l'email, valeur = timestamp + count
const emailDeduplicationCache: Map<string, EmailDeduplicationEntry> = new Map();

// Délai minimum entre deux emails identiques (en ms)
const EMAIL_DEDUP_DELAY = 30000; // 30 secondes

// Nettoyage automatique du cache toutes les 5 minutes
setInterval(
  () => {
    const now = Date.now();
    let cleaned = 0;
    for (const [hash, entry] of emailDeduplicationCache.entries()) {
      if (now - entry.timestamp > EMAIL_DEDUP_DELAY * 2) {
        emailDeduplicationCache.delete(hash);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      emailLogger.info("Cache déduplication nettoyé", {
        entriesRemoved: cleaned,
      });
    }
  },
  5 * 60 * 1000,
);

/**
 * Génère un hash unique pour identifier un email
 */
const generateEmailHash = (
  to: string,
  template: EmailTemplate,
  variables: Record<string, string>,
): string => {
  // On inclut les variables importantes mais pas les timestamps
  const relevantVars = { ...variables };
  delete relevantVars.REQUEST_TIME;
  delete relevantVars.REGISTRATION_DATE;

  const data = `${to}:${template}:${JSON.stringify(relevantVars)}`;
  return crypto.createHash("sha256").update(data).digest("hex");
};

/**
 * Vérifie si un email peut être envoyé (pas de doublon récent)
 */
const canSendEmail = (hash: string): { allowed: boolean; reason?: string } => {
  const entry = emailDeduplicationCache.get(hash);

  if (!entry) {
    return { allowed: true };
  }

  const timeSinceLastSend = Date.now() - entry.timestamp;

  if (timeSinceLastSend < EMAIL_DEDUP_DELAY) {
    return {
      allowed: false,
      reason: `Email identique envoyé il y a ${Math.round(timeSinceLastSend / 1000)}s (attendre ${Math.round((EMAIL_DEDUP_DELAY - timeSinceLastSend) / 1000)}s)`,
    };
  }

  return { allowed: true };
};

/**
 * Enregistre l'envoi d'un email dans le cache de déduplication
 */
const recordEmailSent = (hash: string): void => {
  const existing = emailDeduplicationCache.get(hash);
  emailDeduplicationCache.set(hash, {
    hash,
    timestamp: Date.now(),
    count: existing ? existing.count + 1 : 1,
  });
};

// ═══════════════════════════════════════════════════════════════════════════

// Configuration du transporteur
const createTransporter = () => {
  const isDev = process.env.NODE_ENV !== "production";

  if (isDev && !process.env.SMTP_HOST) {
    // Mode développement : utilise Ethereal (fake SMTP)
    emailLogger.info("Mode développement: Les emails seront loggés en console");
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

// Cache des templates
const templateCache: Map<string, string> = new Map();

/**
 * Échappe les caractères HTML pour prévenir les injections XSS
 * @param str - Chaîne à échapper
 * @returns Chaîne échappée
 */
const escapeHtml = (str: string): string => {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

/**
 * Charge un template HTML depuis le système de fichiers
 */
const loadTemplate = (templateName: string): string => {
  if (templateCache.has(templateName)) {
    const cached = templateCache.get(templateName);
    if (cached) return cached;
  }

  const templatePath = path.join(
    __dirname,
    "../templates/emails",
    `${templateName}.html`,
  );

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template email introuvable: ${templateName}`);
  }

  const template = fs.readFileSync(templatePath, "utf-8");
  templateCache.set(templateName, template);

  return template;
};

/**
 * Charge le template de base
 */
const loadBaseTemplate = (): string => {
  return loadTemplate("base");
};

/**
 * Remplace les variables dans un template
 * MEDIUM-6: Échappe les variables utilisateur pour prévenir les injections XSS
 */
const replaceVariables = (
  template: string,
  variables: Record<string, string>,
): string => {
  let result = template;

  // Variables qui ne nécessitent PAS d'échappement HTML (système/URLs)
  const noEscapeVars = new Set([
    "YEAR",
    "FRONTEND_URL",
    "VERIFICATION_LINK",
    "RESET_LINK",
    "VIEW_SHARE_LINK",
    "ACCEPT_LINK",
    "DECLINE_LINK",
    "VIEW_PROFILE_LINK",
    "CONTACT_PROFILE_LINK",
    "MESSAGE_LINK",
    "LOGIN_LINK",
    "ADMIN_PANEL_LINK",
    "SECURE_ACCOUNT_LINK",
    "VERIFICATION_CODE",
    "RESET_CODE",
    "CONTACT_CODE",
  ]);

  // Ajouter les variables globales
  const allVariables: Record<string, string> = {
    ...variables,
    YEAR: new Date().getFullYear().toString(),
    FRONTEND_URL: process.env.FRONTEND_URL || "https://qvarry.com",
  };

  // Remplacer les variables simples {{VAR}}
  for (const [key, value] of Object.entries(allVariables)) {
    const regex = new RegExp(`{{${key}}}`, "g");
    // MEDIUM-6: Échapper les variables utilisateur pour prévenir XSS
    const safeValue = noEscapeVars.has(key)
      ? value || ""
      : escapeHtml(value || "");
    result = result.replace(regex, safeValue);
  }

  // Gérer les conditionnels simples {{#if VAR}}...{{/if}}
  const conditionalRegex = /\{\{#if\s+(\w+)}}([\s\S]*?)\{\{\/if}}/g;
  result = result.replace(conditionalRegex, (match, varName, content) => {
    return allVariables[varName] ? content : "";
  });

  return result;
};

/**
 * Génère le sujet de l'email en fonction du template
 */
const getSubjectForTemplate = (
  template: EmailTemplate,
  variables: Record<string, string>,
): string => {
  const subjects: Record<EmailTemplate, string> = {
    welcome: "🎉 Bienvenue sur QVARRY !",
    "email-verification": "📧 Vérifiez votre adresse email - QVARRY",
    "password-reset": "🔐 Réinitialisation de votre mot de passe - QVARRY",
    "password-changed": "✅ Votre mot de passe a été modifié - QVARRY",
    "security-alert-login": "🔔 Nouvelle connexion détectée - QVARRY",
    "security-alert-admin": `🚨 Alerte Sécurité ${variables.ALERT_LEVEL || "CRITICAL"} - ${variables.ALERT_TYPE || "QVARRY"}`,
    "share-notification": `📤 ${variables.SENDER_NAME || "Un utilisateur"} a partagé des données avec vous - QVARRY`,
    "contact-request": `👋 ${variables.REQUESTER_NAME || "Un utilisateur"} souhaite vous ajouter - QVARRY`,
    "contact-accepted": `🤝 ${variables.CONTACT_NAME || "Votre contact"} a accepté votre demande - QVARRY`,
    "account-approved": "✅ Votre compte QVARRY a été validé !",
    "account-rejected": "❌ Votre demande de compte QVARRY",
    "admin-pending-validation":
      "👤 Nouveau compte en attente de validation - QVARRY",
  };

  return subjects[template] || "Notification QVARRY";
};

/**
 * Construit l'email HTML complet
 */
const buildEmailHtml = (
  template: EmailTemplate,
  variables: Record<string, string>,
): string => {
  const baseTemplate = loadBaseTemplate();
  const contentTemplate = loadTemplate(template);

  // Remplacer les variables dans le contenu
  const content = replaceVariables(contentTemplate, variables);

  // Insérer le contenu dans le template de base
  const title = getSubjectForTemplate(template, variables);
  let fullHtml = baseTemplate.replace("{{CONTENT}}", content);
  fullHtml = replaceVariables(fullHtml, { ...variables, TITLE: title });

  return fullHtml;
};

/**
 * Génère une version texte brut de l'email
 */
const buildEmailText = (
  template: EmailTemplate,
  variables: Record<string, string>,
): string => {
  const contentTemplate = loadTemplate(template);
  let text = replaceVariables(contentTemplate, variables);

  // Supprimer les balises HTML
  text = text.replace(/<[^>]*>/g, "");
  // Nettoyer les espaces multiples
  text = text.replace(/\s+/g, " ").trim();
  // Ajouter des sauts de ligne pour la lisibilité
  text = text.replace(/\.\s/g, ".\n\n");

  return text;
};

/**
 * Envoie un email (avec protection contre les doublons)
 */
export const sendEmail = async (options: EmailOptions): Promise<boolean> => {
  const { to, template, variables } = options;

  try {
    // ─────────────────────────────────────────────────────────────────────
    // VÉRIFICATION DE DÉDUPLICATION
    // ─────────────────────────────────────────────────────────────────────
    const emailHash = generateEmailHash(to, template, variables);
    const dedupCheck = canSendEmail(emailHash);

    if (!dedupCheck.allowed) {
      emailLogger.warn("Envoi bloqué (doublon)", {
        to: maskEmail(to),
        template,
        reason: dedupCheck.reason,
      });
      return true; // Retourne true car ce n'est pas une erreur, juste un doublon évité
    }

    const transporter = createTransporter();
    const subject =
      options.subject || getSubjectForTemplate(template, variables);
    const html = buildEmailHtml(template, variables);
    const text = buildEmailText(template, variables);

    const mailOptions = {
      from: `"QVARRY" <${process.env.EMAIL_FROM || "noreply@qvarry.com"}>`,
      to,
      subject,
      text,
      html,
    };

    // Enregistrer l'envoi AVANT pour éviter les race conditions
    recordEmailSent(emailHash);

    if (!transporter) {
      // Mode développement : afficher l'email dans la console
      emailLogger.info("Email sent (dev mode)", {
        to: maskEmail(to),
        subject,
        template,
        hash: emailHash.substring(0, 8),
        variables,
      });
      return true;
    }

    const info = await transporter.sendMail(mailOptions);
    emailLogger.info("Email envoyé", {
      to: maskEmail(to),
      template,
      messageId: info.messageId,
    });

    return true;
  } catch (error) {
    emailLogger.error("Erreur envoi email", {
      to: maskEmail(to),
      template,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return false;
  }
};

/**
 * Génère un code de vérification aléatoire cryptographiquement sécurisé
 * Utilise le rejection sampling pour éviter le biais modulo
 */
export const generateVerificationCode = (length: number = 6): string => {
  const result: string[] = [];
  while (result.length < length) {
    const byte = crypto.randomBytes(1)[0];
    if (byte < 250) {
      result.push((byte % 10).toString());
    }
  }
  return result.join("");
};

/**
 * Formate une date pour affichage dans les emails
 */
export const formatEmailDate = (date: Date = new Date()): string => {
  return date.toLocaleDateString("fr-FR", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

// ═══════════════════════════════════════════════════════════════════════════
// FONCTIONS HELPER POUR CHAQUE TYPE D'EMAIL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Envoie un email de bienvenue
 */
export const sendWelcomeEmail = async (
  to: string,
  userName: string,
  verificationLink: string,
  verificationCode: string,
): Promise<boolean> => {
  return sendEmail({
    to,
    subject: "🎉 Bienvenue sur QVARRY !",
    template: "welcome",
    variables: {
      USER_NAME: userName,
      USER_EMAIL: to,
      VERIFICATION_LINK: verificationLink,
      VERIFICATION_CODE: verificationCode,
      REGISTRATION_DATE: formatEmailDate(),
    },
  });
};

/**
 * Envoie un email de vérification
 */
export const sendVerificationEmail = async (
  to: string,
  userName: string,
  verificationLink: string,
  verificationCode: string,
  expiryTime: string = "24 heures",
): Promise<boolean> => {
  return sendEmail({
    to,
    subject: "📧 Vérifiez votre adresse email - QVARRY",
    template: "email-verification",
    variables: {
      USER_NAME: userName,
      VERIFICATION_LINK: verificationLink,
      VERIFICATION_CODE: verificationCode,
      EXPIRY_TIME: expiryTime,
    },
  });
};

/**
 * Envoie un email de réinitialisation de mot de passe
 */
export const sendPasswordResetEmail = async (
  to: string,
  userName: string,
  resetLink: string,
  resetCode: string,
  ipAddress: string,
  deviceInfo: string,
  expiryTime: string = "1 heure",
): Promise<boolean> => {
  return sendEmail({
    to,
    subject: "🔐 Réinitialisation de votre mot de passe - QVARRY",
    template: "password-reset",
    variables: {
      USER_NAME: userName,
      RESET_LINK: resetLink,
      RESET_CODE: resetCode,
      EXPIRY_TIME: expiryTime,
      IP_ADDRESS: anonymizeIp(ipAddress),
      DEVICE_INFO: deviceInfo,
      REQUEST_TIME: formatEmailDate(),
    },
  });
};

/**
 * Envoie un email de confirmation de changement de mot de passe
 */
export const sendPasswordChangedEmail = async (
  to: string,
  userName: string,
  ipAddress: string,
  deviceInfo: string,
): Promise<boolean> => {
  return sendEmail({
    to,
    subject: "✅ Votre mot de passe a été modifié - QVARRY",
    template: "password-changed",
    variables: {
      USER_NAME: userName,
      CHANGE_TIME: formatEmailDate(),
      IP_ADDRESS: anonymizeIp(ipAddress),
      DEVICE_INFO: deviceInfo,
      SECURE_ACCOUNT_LINK: `${process.env.FRONTEND_URL || "https://qvarry.com"}/profil/security`,
    },
  });
};

/**
 * Envoie une alerte de sécurité pour nouvelle connexion
 */
export const sendSecurityAlertEmail = async (
  to: string,
  userName: string,
  ipAddress: string,
  deviceInfo: string,
  location: string,
): Promise<boolean> => {
  return sendEmail({
    to,
    subject: "🔔 Nouvelle connexion détectée - QVARRY",
    template: "security-alert-login",
    variables: {
      USER_NAME: userName,
      IP_ADDRESS: anonymizeIp(ipAddress),
      DEVICE_INFO: deviceInfo,
      LOCATION: location,
      LOGIN_TIME: formatEmailDate(),
      SECURE_ACCOUNT_LINK: `${process.env.FRONTEND_URL || "https://qvarry.com"}/profil/security`,
    },
  });
};

/**
 * Envoie une notification de partage
 */
export const sendShareNotificationEmail = async (
  to: string,
  userName: string,
  senderName: string,
  shareType: string,
  viewShareLink: string,
  shareDescription?: string,
  itemsCount: number = 1,
  expiryDate?: string,
): Promise<boolean> => {
  return sendEmail({
    to,
    subject: `📤 ${senderName} a partagé des données avec vous - QVARRY`,
    template: "share-notification",
    variables: {
      USER_NAME: userName,
      SENDER_NAME: senderName,
      SHARE_TYPE: shareType,
      SHARE_DESCRIPTION: shareDescription || "",
      ITEMS_COUNT: itemsCount.toString(),
      EXPIRY_DATE: expiryDate || "7 jours",
      VIEW_SHARE_LINK: viewShareLink,
      SHARE_TIME: formatEmailDate(),
    },
  });
};

/**
 * Envoie une notification de demande de contact
 */
export const sendContactRequestEmail = async (
  to: string,
  userName: string,
  requesterName: string,
  acceptLink: string,
  requesterMessage?: string,
  declineLink?: string,
  viewProfileLink?: string,
): Promise<boolean> => {
  const frontendUrl = process.env.FRONTEND_URL || "https://qvarry.com";
  return sendEmail({
    to,
    subject: `👋 ${requesterName} souhaite vous ajouter - QVARRY`,
    template: "contact-request",
    variables: {
      USER_NAME: userName,
      REQUESTER_NAME: requesterName,
      REQUESTER_MESSAGE: requesterMessage || "",
      ACCEPT_LINK: acceptLink,
      DECLINE_LINK: declineLink || acceptLink,
      VIEW_PROFILE_LINK: viewProfileLink || `${frontendUrl}/contacts`,
    },
  });
};

/**
 * Envoie une notification de contact accepté
 */
export const sendContactAcceptedEmail = async (
  to: string,
  userName: string,
  contactName: string,
  contactProfileLink?: string,
  messageLink?: string,
): Promise<boolean> => {
  const frontendUrl = process.env.FRONTEND_URL || "https://qvarry.com";
  return sendEmail({
    to,
    subject: `🤝 ${contactName} a accepté votre demande - QVARRY`,
    template: "contact-accepted",
    variables: {
      USER_NAME: userName,
      CONTACT_NAME: contactName,
      CONTACT_PROFILE_LINK: contactProfileLink || `${frontendUrl}/contacts`,
      MESSAGE_LINK: messageLink || `${frontendUrl}/conversations`,
    },
  });
};

/**
 * Envoie un email de notification d'approbation de compte
 */
export const sendAccountApprovedEmail = async (
  to: string,
  userName: string,
): Promise<boolean> => {
  const frontendUrl = process.env.FRONTEND_URL || "https://qvarry.com";
  return sendEmail({
    to,
    subject: "✅ Votre compte QVARRY a été validé !",
    template: "account-approved",
    variables: {
      USER_NAME: userName,
      USER_EMAIL: to,
      APPROVAL_DATE: formatEmailDate(),
      LOGIN_LINK: `${frontendUrl}/`,
    },
  });
};

/**
 * Envoie un email de notification de refus de compte
 */
export const sendAccountRejectedEmail = async (
  to: string,
  userName: string,
  rejectionReason?: string,
): Promise<boolean> => {
  const contactEmail = process.env.CONTACT_EMAIL || "contact@qvarry.com";
  return sendEmail({
    to,
    subject: "❌ Votre demande de compte QVARRY",
    template: "account-rejected",
    variables: {
      USER_NAME: userName,
      USER_EMAIL: to,
      REJECTION_DATE: formatEmailDate(),
      REJECTION_REASON: rejectionReason || "",
      NO_REASON: rejectionReason ? "" : "true",
      CONTACT_EMAIL: contactEmail,
    },
  });
};

/**
 * Envoie un email aux admins pour un nouveau compte en attente de validation
 */
export const sendAdminPendingValidationEmail = async (
  adminEmail: string,
  adminName: string,
  newUserName: string,
  newUserEmail: string,
  registrationDate: string,
): Promise<boolean> => {
  const frontendUrl = process.env.FRONTEND_URL || "https://qvarry.com";
  return sendEmail({
    to: adminEmail,
    subject: "👤 Nouveau compte en attente de validation - QVARRY",
    template: "admin-pending-validation",
    variables: {
      ADMIN_NAME: adminName,
      NEW_USER_NAME: newUserName,
      NEW_USER_EMAIL: newUserEmail,
      REGISTRATION_DATE: registrationDate,
      ADMIN_PANEL_LINK: `${frontendUrl}/admin/users/pending`,
    },
  });
};

// ═══════════════════════════════════════════════════════════════════════════
// INVALIDATION DU CACHE (pour développement)
// ═══════════════════════════════════════════════════════════════════════════

export const clearTemplateCache = (): void => {
  templateCache.clear();
};

export default {
  sendEmail,
  sendWelcomeEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
  sendSecurityAlertEmail,
  sendShareNotificationEmail,
  sendContactRequestEmail,
  sendContactAcceptedEmail,
  sendAccountApprovedEmail,
  sendAccountRejectedEmail,
  sendAdminPendingValidationEmail,
  generateVerificationCode,
  formatEmailDate,
  clearTemplateCache,
};
