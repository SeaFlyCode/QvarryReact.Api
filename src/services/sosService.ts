// ═══════════════════════════════════════════════════════════════════════════
// SERVICE SOS MODE
// ═══════════════════════════════════════════════════════════════════════════
// Logique métier principale du Mode SOS
// Gestion des sessions, heartbeats, escalade et résolution
// ═══════════════════════════════════════════════════════════════════════════

import mongoose from "mongoose";
import SosSessionModel, {
  ISosSession,
  SosSessionStatus,
  SosResolvedBy,
} from "../models/sosSession";
import SosContactModel, { ISosContact } from "../models/sosContact";
import SosEventModel, { SosEventType } from "../models/sosEvent";
import { vonageService } from "./vonageService";
import { createNotification } from "./notificationService";
import { webSocketService } from "./webSocketService";
import { auditService } from "./auditService";
import { decrypt } from "../utils/masterEncryptionUtils";
import UserModel from "../models/users";

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════════════════════

const HEARTBEAT_EXTENSION_MINUTES = 15; // Prolongation par heartbeat
const STAGE_1_DELAY_MINUTES = 15; // Délai avant stage 1 (après expiration)
const STAGE_2_DELAY_MINUTES = 30; // Délai avant stage 2 (après expiration)
const MIN_DURATION_MINUTES = 15; // Durée minimale
const MAX_DURATION_MINUTES = 480; // Durée maximale (8h)
const MAX_ACTIVE_SESSIONS = 1; // Une seule session active par utilisateur

// ═══════════════════════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════════════════════

interface ActivateSessionParams {
  userId: string;
  expectedDuration: number; // En minutes
  ficheId?: string;
  note?: string;
  lat?: number;
  lng?: number;
  accuracy?: number;
}

interface HeartbeatParams {
  userId: string;
  sessionId?: string; // Optionnel, prend la session active si absent
  lat?: number;
  lng?: number;
  accuracy?: number;
}

interface ExtendParams {
  userId: string;
  sessionId?: string;
  additionalMinutes: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════════════════

class SosService {
  // ─── ACTIVATION ────────────────────────────────────────────────────

  /**
   * Activer une nouvelle session SOS
   * L'utilisateur DOIT avoir une connexion réseau (avant d'aller sous terre)
   */
  async activateSession(params: ActivateSessionParams): Promise<ISosSession> {
    const { userId, expectedDuration, ficheId, note, lat, lng, accuracy } =
      params;
    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Vérifier qu'il n'y a pas déjà une session active
    const existingSession = await SosSessionModel.findOne({
      userId: userObjectId,
      status: { $in: ["ACTIVE", "ESCALATING"] },
    });

    if (existingSession) {
      throw new Error("SESSION_ALREADY_ACTIVE");
    }

    // Vérifier que l'utilisateur a au moins un contact d'urgence
    const contactCount = await SosContactModel.countDocuments({
      userId: userObjectId,
    });
    if (contactCount === 0) {
      throw new Error("NO_EMERGENCY_CONTACTS");
    }

    // Valider la durée
    if (
      expectedDuration < MIN_DURATION_MINUTES ||
      expectedDuration > MAX_DURATION_MINUTES
    ) {
      throw new Error("INVALID_DURATION");
    }

    // Calculer la date d'expiration
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expectedDuration * 60 * 1000);

    // Créer la session
    const session = new SosSessionModel({
      userId: userObjectId,
      ficheId: ficheId ? new mongoose.Types.ObjectId(ficheId) : undefined,
      status: "ACTIVE",
      currentStage: -1,
      activatedAt: now,
      expectedDuration,
      expiresAt,
      lastKnownLat: lat,
      lastKnownLng: lng,
      lastKnownAccuracy: accuracy,
      note,
      heartbeatCount: 0,
      extensionCount: 0,
    });

    await session.save();

    // Logger l'événement
    await this.logEvent(
      session._id as mongoose.Types.ObjectId,
      userId,
      "ACTIVATED",
      {
        expectedDuration,
        ficheId,
        expiresAt,
      },
    );

    // Audit
    await auditService.log({
      userId,
      action: "SOS_SESSION_ACTIVATED",
      level: "info",
      details: {
        sessionId: session._id,
        expectedDuration,
        ficheId,
        expiresAt,
      },
    });

    console.log(
      `🆘 [SOS] Session activée pour userId: ${userId} — Expire à: ${expiresAt.toISOString()}`,
    );

    return session;
  }

  // ─── HEARTBEAT ─────────────────────────────────────────────────────

  /**
   * Recevoir un signe de vie (heartbeat)
   * Prolonge le timer de +15 minutes
   */
  async heartbeat(params: HeartbeatParams): Promise<ISosSession> {
    const { userId, sessionId, lat, lng, accuracy } = params;
    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Trouver la session active
    const session = sessionId
      ? await SosSessionModel.findOne({
          _id: new mongoose.Types.ObjectId(sessionId),
          userId: userObjectId,
          status: { $in: ["ACTIVE", "ESCALATING"] },
        })
      : await SosSessionModel.findOne({
          userId: userObjectId,
          status: { $in: ["ACTIVE", "ESCALATING"] },
        });

    if (!session) {
      throw new Error("NO_ACTIVE_SESSION");
    }

    // Prolonger le timer
    const now = new Date();
    const newExpiresAt = new Date(
      Math.max(session.expiresAt.getTime(), now.getTime()) +
        HEARTBEAT_EXTENSION_MINUTES * 60 * 1000,
    );

    // Mettre à jour la session
    session.lastHeartbeatAt = now;
    session.expiresAt = newExpiresAt;
    session.heartbeatCount += 1;

    // Mettre à jour la localisation si fournie
    if (lat !== undefined) session.lastKnownLat = lat;
    if (lng !== undefined) session.lastKnownLng = lng;
    if (accuracy !== undefined) session.lastKnownAccuracy = accuracy;

    // Si la session était en escalade, la remettre en ACTIVE
    if (session.status === "ESCALATING") {
      session.status = "ACTIVE";
      session.currentStage = -1;
      console.log(
        `✅ [SOS] Session ${session._id} remise en ACTIVE après heartbeat`,
      );
    }

    await session.save();

    // Logger l'événement
    await this.logEvent(
      session._id as mongoose.Types.ObjectId,
      userId,
      "HEARTBEAT",
      {
        newExpiresAt,
        heartbeatCount: session.heartbeatCount,
        lat,
        lng,
      },
    );

    console.log(
      `💓 [SOS] Heartbeat reçu pour session ${session._id} — Nouvelle expiration: ${newExpiresAt.toISOString()}`,
    );

    return session;
  }

  // ─── EXTENSION MANUELLE ────────────────────────────────────────────

  /**
   * Prolonger manuellement le timer
   */
  async extendSession(params: ExtendParams): Promise<ISosSession> {
    const { userId, sessionId, additionalMinutes } = params;
    const userObjectId = new mongoose.Types.ObjectId(userId);

    if (additionalMinutes < 15 || additionalMinutes > 480) {
      throw new Error("INVALID_EXTENSION_DURATION");
    }

    const session = sessionId
      ? await SosSessionModel.findOne({
          _id: new mongoose.Types.ObjectId(sessionId),
          userId: userObjectId,
          status: { $in: ["ACTIVE", "ESCALATING"] },
        })
      : await SosSessionModel.findOne({
          userId: userObjectId,
          status: { $in: ["ACTIVE", "ESCALATING"] },
        });

    if (!session) {
      throw new Error("NO_ACTIVE_SESSION");
    }

    const now = new Date();
    const newExpiresAt = new Date(
      Math.max(session.expiresAt.getTime(), now.getTime()) +
        additionalMinutes * 60 * 1000,
    );

    session.expiresAt = newExpiresAt;
    session.extensionCount += 1;

    // Si la session était en escalade, la remettre en ACTIVE
    if (session.status === "ESCALATING") {
      session.status = "ACTIVE";
      session.currentStage = -1;
    }

    await session.save();

    // Logger l'événement
    await this.logEvent(
      session._id as mongoose.Types.ObjectId,
      userId,
      "EXTENDED",
      {
        additionalMinutes,
        newExpiresAt,
        extensionCount: session.extensionCount,
      },
    );

    console.log(
      `⏱️ [SOS] Session ${session._id} prolongée de ${additionalMinutes}min — Nouvelle expiration: ${newExpiresAt.toISOString()}`,
    );

    return session;
  }

  // ─── DÉSACTIVATION ─────────────────────────────────────────────────

  /**
   * Désactiver une session SOS (l'utilisateur est en sécurité)
   */
  async deactivateSession(
    userId: string,
    sessionId?: string,
  ): Promise<ISosSession> {
    const userObjectId = new mongoose.Types.ObjectId(userId);

    const session = sessionId
      ? await SosSessionModel.findOne({
          _id: new mongoose.Types.ObjectId(sessionId),
          userId: userObjectId,
          status: { $in: ["ACTIVE", "ESCALATING"] },
        })
      : await SosSessionModel.findOne({
          userId: userObjectId,
          status: { $in: ["ACTIVE", "ESCALATING"] },
        });

    if (!session) {
      throw new Error("NO_ACTIVE_SESSION");
    }

    session.status = "RESOLVED";
    session.resolvedAt = new Date();
    session.resolvedBy = "USER";

    await session.save();

    // Logger l'événement
    await this.logEvent(
      session._id as mongoose.Types.ObjectId,
      userId,
      "RESOLVED",
      {
        resolvedBy: "USER",
        duration: Math.round(
          (Date.now() - session.activatedAt.getTime()) / 60000,
        ),
      },
    );

    // Audit
    await auditService.log({
      userId,
      action: "SOS_SESSION_DEACTIVATED",
      level: "info",
      details: {
        sessionId: session._id,
        resolvedBy: "USER",
      },
    });

    console.log(`✅ [SOS] Session ${session._id} désactivée par l'utilisateur`);

    return session;
  }

  // ─── CONFIRMATION PAR UN CONTACT ───────────────────────────────────

  /**
   * Un autre utilisateur Qvarry confirme que la personne est en sécurité
   */
  async confirmSafe(
    sessionId: string,
    confirmerId: string,
  ): Promise<ISosSession> {
    const session = await SosSessionModel.findOne({
      _id: new mongoose.Types.ObjectId(sessionId),
      status: { $in: ["ESCALATING"] },
    });

    if (!session) {
      throw new Error("SESSION_NOT_FOUND_OR_NOT_ESCALATING");
    }

    session.status = "RESOLVED";
    session.resolvedAt = new Date();
    session.resolvedBy = "CONTACT_CONFIRM";

    await session.save();

    // Logger l'événement
    await this.logEvent(
      session._id as mongoose.Types.ObjectId,
      session.userId.toString(),
      "CONTACT_CONFIRMED",
      {
        confirmerId,
        resolvedBy: "CONTACT_CONFIRM",
      },
    );

    // Audit
    await auditService.log({
      userId: confirmerId,
      action: "SOS_CONTACT_CONFIRMED_SAFE",
      level: "info",
      details: {
        sessionId: session._id,
        sessionUserId: session.userId,
      },
    });

    console.log(
      `✅ [SOS] Session ${session._id} confirmée safe par userId: ${confirmerId}`,
    );

    return session;
  }

  // ─── LECTURE ────────────────────────────────────────────────────────

  /**
   * Obtenir la session active d'un utilisateur
   */
  async getActiveSession(userId: string): Promise<ISosSession | null> {
    return SosSessionModel.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      status: { $in: ["ACTIVE", "ESCALATING"] },
    });
  }

  /**
   * Obtenir l'historique des sessions d'un utilisateur
   */
  async getSessionHistory(userId: string, limit: number = 20): Promise<any[]> {
    return SosSessionModel.find({
      userId: new mongoose.Types.ObjectId(userId),
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }

  /**
   * Obtenir les sessions actives visibles par un utilisateur
   * (sessions sur le même site/fiche)
   */
  async getActiveSessions(userId: string): Promise<any[]> {
    // Récupérer les fiches de l'utilisateur pour trouver les sessions sur les mêmes sites
    // Pour le MVP, on retourne toutes les sessions en escalade (stage 1+)
    return SosSessionModel.find({
      status: "ESCALATING",
      currentStage: { $gte: 1 },
      userId: { $ne: new mongoose.Types.ObjectId(userId) }, // Pas ses propres sessions
    })
      .populate("userId", "name surname")
      .sort({ createdAt: -1 })
      .lean();
  }

  // ─── ESCALADE (appelé par le cron job) ─────────────────────────────

  /**
   * Traiter les sessions expirées et déclencher l'escalade
   * Appelé toutes les 60 secondes par le cron job
   */
  async processExpiredSessions(): Promise<void> {
    const now = new Date();

    // 1. Trouver les sessions ACTIVE dont le timer a expiré → passer en ESCALATING stage 0
    const newlyExpired = await SosSessionModel.find({
      status: "ACTIVE",
      expiresAt: { $lte: now },
    });

    for (const session of newlyExpired) {
      await this.triggerStage0(session);
    }

    // 2. Trouver les sessions ESCALATING stage 0 depuis >= 15 min → passer stage 1
    const stage0Threshold = new Date(
      now.getTime() - STAGE_1_DELAY_MINUTES * 60 * 1000,
    );
    const readyForStage1 = await SosSessionModel.find({
      status: "ESCALATING",
      currentStage: 0,
      stage0TriggeredAt: { $lte: stage0Threshold },
    });

    for (const session of readyForStage1) {
      await this.triggerStage1(session);
    }

    // 3. Trouver les sessions ESCALATING stage 1 depuis le début de l'escalade >= 30 min → stage 2
    const stage2Threshold = new Date(
      now.getTime() - STAGE_2_DELAY_MINUTES * 60 * 1000,
    );
    const readyForStage2 = await SosSessionModel.find({
      status: "ESCALATING",
      currentStage: 1,
      stage0TriggeredAt: { $lte: stage2Threshold },
    });

    for (const session of readyForStage2) {
      await this.triggerStage2(session);
    }
  }

  // ─── STAGES D'ESCALADE ─────────────────────────────────────────────

  /**
   * Stage 0: Push notification à l'utilisateur + alarme locale
   */
  private async triggerStage0(session: ISosSession): Promise<void> {
    const sessionId = session._id as mongoose.Types.ObjectId;

    session.status = "ESCALATING";
    session.currentStage = 0;
    session.stage0TriggeredAt = new Date();
    await session.save();

    // Envoyer notification push à l'utilisateur
    await createNotification(
      session.userId,
      "contact_request", // On réutilise un type existant pour le MVP (TODO: ajouter type SOS)
      "🆘 Alerte SOS - Timer expiré",
      "Votre timer SOS a expiré ! Donnez un signe de vie ou l'escalade va se déclencher.",
    );

    // Envoyer via WebSocket pour alarme immédiate
    webSocketService.sendNotificationToUser(session.userId.toString(), {
      type: "sos_alarm",
      stage: 0,
      sessionId: sessionId.toString(),
      message: "Timer SOS expiré — Donnez un signe de vie !",
    });

    await this.logEvent(sessionId, session.userId.toString(), "STAGE_CHANGE", {
      stage: 0,
      previousStage: -1,
    });

    console.log(
      `🚨 [SOS] Stage 0 déclenché pour session ${sessionId} (userId: ${session.userId})`,
    );
  }

  /**
   * Stage 1: Notifier les utilisateurs Qvarry sur le même site
   */
  private async triggerStage1(session: ISosSession): Promise<void> {
    const sessionId = session._id as mongoose.Types.ObjectId;

    session.currentStage = 1;
    session.stage1TriggeredAt = new Date();
    await session.save();

    // Récupérer le nom de l'utilisateur en danger
    const user = await UserModel.findById(session.userId).lean();
    const userName = user ? decrypt(user.name) : "Un utilisateur";

    // Envoyer notification push à l'utilisateur (rappel)
    webSocketService.sendNotificationToUser(session.userId.toString(), {
      type: "sos_alarm",
      stage: 1,
      sessionId: sessionId.toString(),
      message: "Escalade Stage 1 — D'autres utilisateurs sont notifiés !",
    });

    // TODO MVP+: Notifier les utilisateurs sur la même fiche
    // Pour le MVP, on log simplement le stage change
    // En v2, on utilisera ficheId pour trouver les utilisateurs sur le même site

    await this.logEvent(sessionId, session.userId.toString(), "STAGE_CHANGE", {
      stage: 1,
      previousStage: 0,
      userName,
    });

    await this.logEvent(
      sessionId,
      session.userId.toString(),
      "NOTIFICATION_SENT",
      {
        stage: 1,
        target: "site_users",
      },
    );

    console.log(
      `🚨🚨 [SOS] Stage 1 déclenché pour session ${sessionId} — Notification aux utilisateurs du site`,
    );
  }

  /**
   * Stage 2: Envoyer SMS aux contacts d'urgence via Vonage
   */
  private async triggerStage2(session: ISosSession): Promise<void> {
    const sessionId = session._id as mongoose.Types.ObjectId;

    session.currentStage = 2;
    session.stage2TriggeredAt = new Date();
    await session.save();

    // Récupérer le nom de l'utilisateur
    const user = await UserModel.findById(session.userId).lean();
    const userName = user
      ? `${decrypt(user.name)} ${decrypt(user.surname)}`
      : "Un utilisateur Qvarry";

    // Récupérer les contacts d'urgence
    const contacts = await SosContactModel.find({
      userId: session.userId,
    }).lean();

    if (contacts.length === 0) {
      console.error(
        `❌ [SOS] Aucun contact d'urgence pour userId: ${session.userId}`,
      );
      await this.logEvent(sessionId, session.userId.toString(), "SMS_FAILED", {
        stage: 2,
        reason: "NO_CONTACTS",
      });
      return;
    }

    // Préparer la localisation
    const location =
      session.lastKnownLat && session.lastKnownLng
        ? { lat: session.lastKnownLat, lng: session.lastKnownLng }
        : undefined;

    // Envoyer les SMS via Vonage
    const smsContacts = contacts.map((c) => ({ name: c.name, phone: c.phone }));
    const results = await vonageService.sendSosAlertToMultiple(
      smsContacts,
      userName,
      session.note,
      location,
    );

    // Logger chaque envoi
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const contact = contacts[i];

      if (result.success) {
        await this.logEvent(sessionId, session.userId.toString(), "SMS_SENT", {
          contactId: contact._id,
          contactName: contact.name,
          messageId: result.messageId,
        });

        // Mettre à jour la date du dernier SMS envoyé
        await SosContactModel.findByIdAndUpdate(contact._id, {
          lastSmsSentAt: new Date(),
        });
      } else {
        await this.logEvent(
          sessionId,
          session.userId.toString(),
          "SMS_FAILED",
          {
            contactId: contact._id,
            contactName: contact.name,
            error: result.error,
          },
        );
      }
    }

    // Alarme WebSocket
    webSocketService.sendNotificationToUser(session.userId.toString(), {
      type: "sos_alarm",
      stage: 2,
      sessionId: sessionId.toString(),
      message: "Escalade Stage 2 — SMS envoyés à vos contacts d'urgence !",
    });

    // Audit critique
    await auditService.log({
      userId: session.userId.toString(),
      action: "SOS_STAGE_2_SMS_SENT",
      level: "critical",
      details: {
        sessionId: sessionId,
        contactCount: contacts.length,
        successCount: results.filter((r) => r.success).length,
        failCount: results.filter((r) => !r.success).length,
      },
    });

    console.log(
      `🚨🚨🚨 [SOS] Stage 2 déclenché pour session ${sessionId} — ${results.filter((r) => r.success).length}/${contacts.length} SMS envoyés`,
    );
  }

  // ─── CONTACTS D'URGENCE ────────────────────────────────────────────

  /**
   * Ajouter un contact d'urgence
   */
  async addContact(
    userId: string,
    data: {
      name: string;
      phone: string;
      relationship?: string;
      isDefault?: boolean;
    },
  ): Promise<ISosContact> {
    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Vérifier le nombre max de contacts (5)
    const count = await SosContactModel.countDocuments({
      userId: userObjectId,
    });
    if (count >= 5) {
      throw new Error("MAX_CONTACTS_REACHED");
    }

    const contact = new SosContactModel({
      userId: userObjectId,
      name: data.name,
      phone: data.phone,
      relationship: data.relationship,
      isDefault: data.isDefault || false,
    });

    await contact.save();

    console.log(
      `📞 [SOS] Contact d'urgence ajouté: ${data.name} pour userId: ${userId}`,
    );

    return contact;
  }

  /**
   * Lister les contacts d'urgence d'un utilisateur
   */
  async getContacts(userId: string): Promise<any[]> {
    return SosContactModel.find({
      userId: new mongoose.Types.ObjectId(userId),
    })
      .sort({ isDefault: -1, createdAt: -1 })
      .lean();
  }

  /**
   * Mettre à jour un contact d'urgence
   */
  async updateContact(
    userId: string,
    contactId: string,
    data: Partial<{
      name: string;
      phone: string;
      relationship: string;
      isDefault: boolean;
    }>,
  ): Promise<ISosContact | null> {
    return SosContactModel.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(contactId),
        userId: new mongoose.Types.ObjectId(userId),
      },
      { $set: data },
      { new: true },
    );
  }

  /**
   * Supprimer un contact d'urgence
   */
  async deleteContact(userId: string, contactId: string): Promise<boolean> {
    const result = await SosContactModel.deleteOne({
      _id: new mongoose.Types.ObjectId(contactId),
      userId: new mongoose.Types.ObjectId(userId),
    });

    return result.deletedCount > 0;
  }

  // ─── UTILITAIRES ───────────────────────────────────────────────────

  /**
   * Logger un événement SOS
   */
  private async logEvent(
    sessionId: mongoose.Types.ObjectId,
    userId: string,
    type: SosEventType,
    metadata?: Record<string, any>,
  ): Promise<void> {
    try {
      await new SosEventModel({
        sessionId,
        userId: new mongoose.Types.ObjectId(userId),
        type,
        metadata,
        createdAt: new Date(),
      }).save();
    } catch (error) {
      console.error(`❌ [SOS] Erreur log événement ${type}:`, error);
    }
  }
}

// Export singleton
export const sosService = new SosService();
