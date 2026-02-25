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

// Détection de surface et reconnexion
const SURFACE_DISTANCE_THRESHOLD_METERS = 200; // Seuil de déplacement pour suggestion surface
const RECONNECTION_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes de connexion stable
const MIN_HEARTBEATS_FOR_RECONNECTION = 5; // Minimum de heartbeats pour considérer une reconnexion

// ═══════════════════════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════════════════════

interface SessionContactOverride {
  permanentContactIds?: string[]; // IDs des contacts permanents à utiliser
  additionalContacts?: Array<{
    // Contacts supplémentaires temporaires
    name: string;
    phone: string;
    relationship?: string;
  }>;
}

interface ActivateSessionParams {
  userId: string;
  expectedDuration: number; // En minutes
  note?: string;
  lat?: number;
  lng?: number;
  accuracy?: number;
  siteName?: string;
  zone?: string;
  depth?: number;
  sessionContacts?: SessionContactOverride; // Override des contacts pour cette session
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
  // ─── UTILITAIRES PRIVÉS ────────────────────────────────────────────

  /**
   * Calculer la distance entre deux points GPS (formule de Haversine)
   * Retourne la distance en mètres
   */
  private calculateDistance(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): number {
    const R = 6371e3; // Rayon de la terre en mètres
    const toRad = (deg: number) => deg * (Math.PI / 180);
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // ─── ACTIVATION ────────────────────────────────────────────────────

  /**
   * Activer une nouvelle session SOS
   * L'utilisateur DOIT avoir une connexion réseau (avant d'aller sous terre)
   */
  async activateSession(params: ActivateSessionParams): Promise<ISosSession> {
    const {
      userId,
      expectedDuration,
      note,
      lat,
      lng,
      accuracy,
      siteName,
      zone,
      depth,
      sessionContacts,
    } = params;
    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Vérifier qu'il n'y a pas déjà une session active
    const existingSession = await SosSessionModel.findOne({
      userId: userObjectId,
      status: { $in: ["ACTIVE", "ESCALATING"] },
    });

    if (existingSession) {
      throw new Error("SESSION_ALREADY_ACTIVE");
    }

    // Gérer les contacts de session (override)
    let useDefaultContacts = true;
    let sessionContactIds: mongoose.Types.ObjectId[] = [];

    if (sessionContacts) {
      useDefaultContacts = false;

      // Valider qu'au moins un contact sera alerté
      const hasPermanentContacts =
        sessionContacts.permanentContactIds &&
        sessionContacts.permanentContactIds.length > 0;
      const hasAdditionalContacts =
        sessionContacts.additionalContacts &&
        sessionContacts.additionalContacts.length > 0;

      if (!hasPermanentContacts && !hasAdditionalContacts) {
        throw new Error("NO_EMERGENCY_CONTACTS");
      }

      // Ajouter les contacts permanents sélectionnés
      if (hasPermanentContacts) {
        // Vérifier que les contacts permanents existent et appartiennent à l'utilisateur
        const permanentContacts = await SosContactModel.find({
          _id: {
            $in: sessionContacts.permanentContactIds!.map(
              (id) => new mongoose.Types.ObjectId(id),
            ),
          },
          userId: userObjectId,
          sessionId: { $exists: false }, // Uniquement les contacts permanents
        })
          .select("_id")
          .lean();

        if (
          permanentContacts.length !==
          sessionContacts.permanentContactIds!.length
        ) {
          throw new Error("INVALID_CONTACT_IDS");
        }

        sessionContactIds.push(
          ...permanentContacts.map((c) => c._id as mongoose.Types.ObjectId),
        );
      }

      // Valider les contacts supplémentaires temporaires
      if (hasAdditionalContacts) {
        for (const additionalContact of sessionContacts.additionalContacts!) {
          // Validation format téléphone
          if (!/^\+[1-9]\d{6,14}$/.test(additionalContact.phone)) {
            throw new Error("INVALID_PHONE_FORMAT");
          }
        }
      }
    } else {
      // Mode par défaut : vérifier qu'il y a au moins un contact permanent
      const contactCount = await SosContactModel.countDocuments({
        userId: userObjectId,
        sessionId: { $exists: false },
      });
      if (contactCount === 0) {
        throw new Error("NO_EMERGENCY_CONTACTS");
      }
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
      status: "ACTIVE",
      currentStage: -1,
      activatedAt: now,
      expectedDuration,
      expiresAt,
      lastKnownLat: lat,
      lastKnownLng: lng,
      lastKnownAccuracy: accuracy,
      entryLat: lat,
      entryLng: lng,
      note,
      siteName,
      zone,
      depth,
      heartbeatCount: 0,
      extensionCount: 0,
      consecutiveHeartbeats: 0,
      surfaceDetectionSent: false,
      reconnectionDetectionSent: false,
      useDefaultContacts,
      sessionContactIds:
        sessionContactIds.length > 0 ? sessionContactIds : undefined,
    });
    await session.save();

    // Créer les contacts supplémentaires temporaires maintenant qu'on a un sessionId
    if (
      sessionContacts?.additionalContacts &&
      sessionContacts.additionalContacts.length > 0
    ) {
      for (const additionalContact of sessionContacts.additionalContacts) {
        const tempContact = new SosContactModel({
          userId: userObjectId,
          sessionId: session._id,
          name: additionalContact.name,
          phone: additionalContact.phone,
          relationship: additionalContact.relationship,
          isDefault: false,
        });

        await tempContact.save();
        sessionContactIds.push(tempContact._id as mongoose.Types.ObjectId);
      }

      // Mettre à jour la session avec tous les IDs de contacts
      session.sessionContactIds = sessionContactIds;
      await session.save();
    }

    // Logger l'événement
    await this.logEvent(
      session._id as mongoose.Types.ObjectId,
      userId,
      "ACTIVATED",
      {
        expectedDuration,
        expiresAt,
        useDefaultContacts,
        contactCount: sessionContactIds.length || undefined,
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
        expiresAt,
        useDefaultContacts,
      },
    });

    console.log(
      `🆘 [SOS] Session activée pour userId: ${userId} — Expire à: ${expiresAt.toISOString()} — Contacts: ${useDefaultContacts ? "défaut" : `override (${sessionContactIds.length})`}`,
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

    // ─── DÉTECTION GPS DE SURFACE ───
    if (
      lat !== undefined &&
      lng !== undefined &&
      session.entryLat &&
      session.entryLng &&
      !session.surfaceDetectionSent
    ) {
      const distance = this.calculateDistance(
        session.entryLat,
        session.entryLng,
        lat,
        lng,
      );
      if (distance > SURFACE_DISTANCE_THRESHOLD_METERS) {
        session.surfaceDetectionSent = true;

        // Envoyer suggestion via WebSocket
        webSocketService.sendNotificationToUser(session.userId.toString(), {
          type: "sos_surface_detected",
          sessionId: (session._id as mongoose.Types.ObjectId).toString(),
          message:
            "Tu sembles t'être déplacé significativement. Es-tu en surface ?",
          distance: Math.round(distance),
        });

        await this.logEvent(
          session._id as mongoose.Types.ObjectId,
          userId,
          "SURFACE_DETECTED",
          {
            distance: Math.round(distance),
            entryLat: session.entryLat,
            entryLng: session.entryLng,
            currentLat: lat,
            currentLng: lng,
          },
        );

        console.log(
          `📍 [SOS] Déplacement détecté: ${Math.round(distance)}m pour session ${session._id}`,
        );
      }
    }

    // ─── DÉTECTION DE RECONNEXION PROLONGÉE ───
    session.consecutiveHeartbeats += 1;

    if (!session.firstReconnectionAt) {
      session.firstReconnectionAt = now;
    }

    if (!session.reconnectionDetectionSent) {
      const timeSinceFirstReconnection =
        now.getTime() - session.firstReconnectionAt.getTime();
      if (
        timeSinceFirstReconnection >= RECONNECTION_THRESHOLD_MS &&
        session.consecutiveHeartbeats >= MIN_HEARTBEATS_FOR_RECONNECTION
      ) {
        session.reconnectionDetectionSent = true;

        webSocketService.sendNotificationToUser(session.userId.toString(), {
          type: "sos_reconnection_detected",
          sessionId: (session._id as mongoose.Types.ObjectId).toString(),
          message:
            "Tu sembles avoir une connexion stable depuis plus de 5 minutes. Désactiver le Mode SOS ?",
          connectedSince: session.firstReconnectionAt,
          heartbeatCount: session.consecutiveHeartbeats,
        });

        await this.logEvent(
          session._id as mongoose.Types.ObjectId,
          userId,
          "RECONNECTION_DETECTED",
          {
            connectedSince: session.firstReconnectionAt,
            consecutiveHeartbeats: session.consecutiveHeartbeats,
          },
        );

        console.log(
          `📶 [SOS] Reconnexion prolongée détectée pour session ${session._id}`,
        );
      }
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

    // Nettoyer les contacts temporaires
    await this.cleanupSessionContacts(session._id.toString());

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

    // Nettoyer les contacts temporaires
    await this.cleanupSessionContacts(session._id.toString());

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
   * Obtenir l'historique des sessions d'un utilisateur avec statistiques enrichies
   */
  async getSessionHistory(
    userId: string,
    limit: number = 20,
  ): Promise<{
    sessions: any[];
    stats: {
      totalSessions: number;
      totalDuration: number; // Minutes totales passées sous terre
      averageDuration: number; // Durée moyenne en minutes
      longestSession: number; // Plus longue session en minutes
      totalHeartbeats: number; // Total de heartbeats
      escalationRate: number; // % de sessions qui ont atteint l'escalade
      mostVisitedSites: Array<{ siteName: string; count: number }>;
      lastSessionDate: Date | null;
    };
  }> {
    // Récupérer les sessions (limitées pour l'affichage)
    const sessions = await SosSessionModel.find({
      userId: new mongoose.Types.ObjectId(userId),
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    // Calculer les stats sur TOUTES les sessions de l'utilisateur (pas juste la page courante)
    const allSessions = await SosSessionModel.find({
      userId: new mongoose.Types.ObjectId(userId),
    })
      .select(
        "expectedDuration heartbeatCount status currentStage siteName activatedAt resolvedAt",
      )
      .lean();

    const totalSessions = allSessions.length;

    // Calcul des durées réelles (resolvedAt - activatedAt en minutes)
    const durations = allSessions
      .filter((s) => s.resolvedAt)
      .map((s) =>
        Math.round(
          (new Date(s.resolvedAt!).getTime() -
            new Date(s.activatedAt).getTime()) /
            60000,
        ),
      );

    const totalDuration = durations.reduce((sum, d) => sum + d, 0);
    const averageDuration =
      durations.length > 0 ? Math.round(totalDuration / durations.length) : 0;
    const longestSession = durations.length > 0 ? Math.max(...durations) : 0;
    const totalHeartbeats = allSessions.reduce(
      (sum, s) => sum + (s.heartbeatCount || 0),
      0,
    );

    // Taux d'escalade : sessions qui ont atteint ESCALATING / total
    const escalatedSessions = allSessions.filter(
      (s) => s.status === "ESCALATING" || s.currentStage >= 0,
    ).length;
    const escalationRate =
      totalSessions > 0
        ? Math.round((escalatedSessions / totalSessions) * 100)
        : 0;

    // Sites les plus visités
    const siteCounts: Record<string, number> = {};
    allSessions.forEach((s) => {
      if (s.siteName) {
        siteCounts[s.siteName] = (siteCounts[s.siteName] || 0) + 1;
      }
    });
    const mostVisitedSites = Object.entries(siteCounts)
      .map(([siteName, count]) => ({ siteName, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const lastSession = allSessions.length > 0 ? allSessions[0] : null;

    // Enrichir chaque session avec des données calculées
    const enrichedSessions = sessions.map((session: any) => {
      const actualDuration = session.resolvedAt
        ? Math.round(
            (new Date(session.resolvedAt).getTime() -
              new Date(session.activatedAt).getTime()) /
              60000,
          )
        : null;

      return {
        ...session,
        actualDuration, // Durée réelle en minutes (null si pas encore résolu)
        durationOverrun:
          actualDuration && session.expectedDuration
            ? actualDuration - session.expectedDuration
            : null, // Dépassement en minutes (négatif = sorti en avance)
      };
    });

    return {
      sessions: enrichedSessions,
      stats: {
        totalSessions,
        totalDuration,
        averageDuration,
        longestSession,
        totalHeartbeats,
        escalationRate,
        mostVisitedSites,
        lastSessionDate: lastSession ? lastSession.activatedAt : null,
      },
    };
  }

  /**
   * Obtenir les sessions actives visibles par un utilisateur
   * (sessions en escalade visibles par tous les utilisateurs)
   */
  async getActiveSessions(userId: string): Promise<any[]> {
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
      "sos_alert",
      "🆘 Alerte SOS - Timer expiré",
      "Votre timer SOS a expiré ! Donnez un signe de vie ou l'escalade va se déclencher.",
      {
        sosSessionId: sessionId,
      },
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
   * Stage 1: Notifier TOUS les utilisateurs Qvarry
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

    // Notifier TOUS les utilisateurs Qvarry vérifiés (sauf le propriétaire de la session)
    const allVerifiedUsers = await UserModel.find({
      _id: { $ne: session.userId },
      isVerified: true,
    })
      .select("_id name")
      .lean();

    console.log(
      `📣 [SOS] Notification de ${allVerifiedUsers.length} utilisateurs pour session ${sessionId}`,
    );

    // Envoyer les notifications à chaque utilisateur
    for (const targetUser of allVerifiedUsers) {
      try {
        // Push notification
        await createNotification(
          targetUser._id,
          "sos_stage1_alert",
          "🆘 Alerte SOS",
          `${userName} a besoin d'aide ! Consultez la carte SOS.`,
          {
            sosSessionId: sessionId,
          },
        );

        // WebSocket notification
        webSocketService.sendNotificationToUser(targetUser._id.toString(), {
          type: "sos_alert_stage1",
          stage: 1,
          sessionId: sessionId.toString(),
          userName,
          message: `${userName} a besoin d'aide ! Consultez la carte SOS.`,
        });
      } catch (error) {
        console.error(
          `⚠️ [SOS] Erreur notification userId ${targetUser._id}:`,
          error,
        );
        // On continue même si une notification échoue
      }
    }

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
        target: "all_users",
        notifiedCount: allVerifiedUsers.length,
      },
    );

    console.log(
      `🚨🚨 [SOS] Stage 1 déclenché pour session ${sessionId} — Notification à TOUS les utilisateurs (${allVerifiedUsers.length} notifiés)`,
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
    let contacts;
    if (session.useDefaultContacts) {
      // Utiliser tous les contacts permanents
      contacts = await SosContactModel.find({
        userId: session.userId,
        sessionId: { $exists: false },
      }).lean();
    } else {
      // Utiliser les contacts sélectionnés pour cette session
      contacts = await SosContactModel.find({
        _id: { $in: session.sessionContactIds },
      }).lean();
    }

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

  // ─── MÉTHODES ADMIN ────────────────────────────────────────────────

  /**
   * Dashboard admin - Vue d'ensemble des sessions SOS
   */
  async getAdminDashboard(): Promise<{
    activeSessions: number;
    escalatingSessions: number;
    resolvedToday: number;
    totalSessions24h: number;
    sessions: any[];
  }> {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Compter les sessions actives
    const activeSessions = await SosSessionModel.countDocuments({
      status: "ACTIVE",
    });

    // Compter les sessions en escalade
    const escalatingSessions = await SosSessionModel.countDocuments({
      status: "ESCALATING",
    });

    // Compter les sessions résolues dans les dernières 24h
    const resolvedToday = await SosSessionModel.countDocuments({
      status: "RESOLVED",
      resolvedAt: { $gte: yesterday },
    });

    // Compter toutes les sessions créées dans les dernières 24h
    const totalSessions24h = await SosSessionModel.countDocuments({
      activatedAt: { $gte: yesterday },
    });

    // Récupérer les sessions en cours (ACTIVE + ESCALATING)
    const sessions = await SosSessionModel.find({
      status: { $in: ["ACTIVE", "ESCALATING"] },
    })
      .populate("userId", "name surname")
      .sort({ status: -1, currentStage: -1, activatedAt: 1 })
      .lean();

    // Décrypter les noms et enrichir les données
    const enrichedSessions = sessions.map((session: any) => {
      const now = new Date();
      const expiresAt = new Date(session.expiresAt);
      const timeRemaining = Math.floor(
        (expiresAt.getTime() - now.getTime()) / 1000,
      );
      const timeSinceExpired =
        timeRemaining < 0 ? Math.abs(timeRemaining) : null;

      // Calculer le niveau d'urgence
      let urgencyLevel = "low";
      if (session.status === "ESCALATING") {
        if (session.currentStage >= 2) urgencyLevel = "critical";
        else if (session.currentStage === 1) urgencyLevel = "high";
        else urgencyLevel = "medium";
      }

      return {
        ...session,
        user: session.userId
          ? {
              id: session.userId._id,
              name: decrypt(session.userId.name),
              surname: decrypt(session.userId.surname),
            }
          : null,
        timeRemaining: Math.max(0, timeRemaining),
        timeSinceExpired,
        urgencyLevel,
      };
    });

    return {
      activeSessions,
      escalatingSessions,
      resolvedToday,
      totalSessions24h,
      sessions: enrichedSessions,
    };
  }

  /**
   * Récupérer toutes les sessions actives (admin)
   */
  async getAllActiveSessions(): Promise<any[]> {
    // Récupérer TOUTES les sessions ACTIVE + ESCALATING
    const sessions = await SosSessionModel.find({
      status: { $in: ["ACTIVE", "ESCALATING"] },
    })
      .populate("userId", "name surname")
      .sort({ status: -1, currentStage: -1, activatedAt: 1 })
      .lean();

    // Décrypter les noms et enrichir les données
    const enrichedSessions = sessions.map((session: any) => {
      const now = new Date();
      const expiresAt = new Date(session.expiresAt);
      const timeRemaining = Math.floor(
        (expiresAt.getTime() - now.getTime()) / 1000,
      );
      const timeSinceExpired =
        timeRemaining < 0 ? Math.abs(timeRemaining) : null;

      // Calculer le niveau d'urgence
      let urgencyLevel = "low";
      if (session.status === "ESCALATING") {
        if (session.currentStage >= 2) urgencyLevel = "critical";
        else if (session.currentStage === 1) urgencyLevel = "high";
        else urgencyLevel = "medium";
      }

      return {
        ...session,
        user: session.userId
          ? {
              id: session.userId._id,
              name: decrypt(session.userId.name),
              surname: decrypt(session.userId.surname),
            }
          : null,
        timeRemaining: Math.max(0, timeRemaining),
        timeSinceExpired,
        urgencyLevel,
      };
    });

    return enrichedSessions;
  }

  /**
   * Annuler/résoudre une session (admin)
   */
  async adminCancelSession(
    sessionId: string,
    adminId: string,
    reason?: string,
  ): Promise<ISosSession> {
    const session = await SosSessionModel.findOne({
      _id: new mongoose.Types.ObjectId(sessionId),
      status: { $in: ["ACTIVE", "ESCALATING"] },
    });

    if (!session) {
      throw new Error("SESSION_NOT_FOUND");
    }

    session.status = "RESOLVED";
    session.resolvedAt = new Date();
    session.resolvedBy = "ADMIN";

    await session.save();

    // Nettoyer les contacts temporaires
    await this.cleanupSessionContacts(session._id.toString());

    // Logger l'événement
    await this.logEvent(
      session._id as mongoose.Types.ObjectId,
      session.userId.toString(),
      "RESOLVED",
      {
        resolvedBy: "ADMIN",
        adminId,
        reason,
      },
    );

    // Audit critique
    await auditService.log({
      userId: adminId,
      action: "ADMIN_SOS_SESSION_CANCELLED",
      level: "critical",
      details: {
        sessionId: session._id,
        sessionUserId: session.userId,
        reason,
      },
    });

    console.log(
      `🛑 [SOS-ADMIN] Session ${sessionId} annulée par admin ${adminId}`,
    );

    return session;
  }

  /**
   * Récupérer les détails complets d'une session (admin)
   */
  async getSessionDetails(sessionId: string): Promise<any> {
    const session = await SosSessionModel.findById(
      new mongoose.Types.ObjectId(sessionId),
    )
      .populate("userId", "name surname email")
      .lean();

    if (!session) {
      throw new Error("SESSION_NOT_FOUND");
    }

    // Récupérer les événements liés à la session
    const events = await SosEventModel.find({
      sessionId: new mongoose.Types.ObjectId(sessionId),
    })
      .sort({ createdAt: -1 })
      .lean();

    // Récupérer les contacts d'urgence de l'utilisateur
    const contacts = await SosContactModel.find({
      userId: session.userId,
    })
      .sort({ isDefault: -1, createdAt: -1 })
      .lean();

    // Calculer des métriques utiles
    const now = new Date();
    const expiresAt = new Date(session.expiresAt);
    const timeRemaining = Math.floor(
      (expiresAt.getTime() - now.getTime()) / 1000,
    );
    const timeSinceExpired = timeRemaining < 0 ? Math.abs(timeRemaining) : null;

    // Calculer le niveau d'urgence
    let urgencyLevel = "low";
    if (session.status === "ESCALATING") {
      if (session.currentStage >= 2) urgencyLevel = "critical";
      else if (session.currentStage === 1) urgencyLevel = "high";
      else urgencyLevel = "medium";
    }

    return {
      session: {
        ...session,
        user: (session as any).userId
          ? {
              id: (session as any).userId._id,
              name: decrypt((session as any).userId.name),
              surname: decrypt((session as any).userId.surname),
              email: decrypt((session as any).userId.email),
            }
          : null,
        timeRemaining: Math.max(0, timeRemaining),
        timeSinceExpired,
        urgencyLevel,
      },
      events,
      contacts,
    };
  }

  /**
   * Récupérer l'historique de toutes les sessions (admin)
   */
  async getAdminSessionHistory(
    limit: number = 50,
    status?: string,
    userId?: string,
  ): Promise<any[]> {
    const query: any = {};

    if (status) {
      query.status = status;
    }

    if (userId) {
      query.userId = new mongoose.Types.ObjectId(userId);
    }

    const sessions = await SosSessionModel.find(query)
      .populate("userId", "name surname")
      .sort({ createdAt: -1 })
      .limit(Math.min(limit, 100))
      .lean();

    // Décrypter les noms
    const enrichedSessions = sessions.map((session: any) => ({
      ...session,
      user: session.userId
        ? {
            id: session.userId._id,
            name: decrypt(session.userId.name),
            surname: decrypt(session.userId.surname),
          }
        : null,
    }));

    return enrichedSessions;
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * STATISTIQUES ADMIN - RAPPORTS GLOBAUX SOS
   * ═══════════════════════════════════════════════════════════════════════════
   * Agrégation performante via MongoDB pour les rapports admin
   * Analyse des patterns, durées, escalades, SMS et utilisateurs
   */
  async getAdminSosStats(startDate?: Date, endDate?: Date): Promise<any> {
    const startTime = Date.now();

    // ─── CONSTRUCTION DU FILTRE DE DATE ────────────────────────────────
    const dateFilter: any = {};
    if (startDate || endDate) {
      dateFilter.activatedAt = {};
      if (startDate) dateFilter.activatedAt.$gte = startDate;
      if (endDate) dateFilter.activatedAt.$lte = endDate;
    }

    // ─── PÉRIODE ANALYSÉE ──────────────────────────────────────────────
    const period = {
      startDate: startDate || null,
      endDate: endDate || null,
      totalDays:
        startDate && endDate
          ? Math.ceil(
              (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
            )
          : 0,
    };

    // ─── VUE D'ENSEMBLE ────────────────────────────────────────────────
    const overviewPipeline: any[] = [
      { $match: dateFilter },
      {
        $group: {
          _id: null,
          totalSessions: { $sum: 1 },
          activeSessions: {
            $sum: {
              $cond: [{ $eq: ["$status", "ACTIVE"] }, 1, 0],
            },
          },
          escalatingSessions: {
            $sum: {
              $cond: [{ $eq: ["$status", "ESCALATING"] }, 1, 0],
            },
          },
          resolvedSessions: {
            $sum: {
              $cond: [{ $eq: ["$status", "RESOLVED"] }, 1, 0],
            },
          },
        },
      },
    ];

    const overviewResult = await SosSessionModel.aggregate(overviewPipeline);
    const overview = overviewResult[0] || {
      totalSessions: 0,
      activeSessions: 0,
      escalatingSessions: 0,
      resolvedSessions: 0,
    };
    delete overview._id;

    // ─── DURÉES (sessions résolues uniquement) ────────────────────────
    const durationsPipeline: any[] = [
      {
        $match: {
          ...dateFilter,
          status: "RESOLVED",
          resolvedAt: { $exists: true },
        },
      },
      {
        $addFields: {
          durationMinutes: {
            $divide: [
              { $subtract: ["$resolvedAt", "$activatedAt"] },
              60000, // Convertir ms en minutes
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          totalDuration: { $sum: "$durationMinutes" },
          avgDuration: { $avg: "$durationMinutes" },
          maxDuration: { $max: "$durationMinutes" },
          minDuration: { $min: "$durationMinutes" },
          allDurations: { $push: "$durationMinutes" },
        },
      },
    ];

    const durationsResult = await SosSessionModel.aggregate(durationsPipeline);

    let durations = {
      totalDuration: 0,
      averageDuration: 0,
      medianDuration: 0,
      longestSession: 0,
      shortestSession: 0,
    };

    if (durationsResult.length > 0) {
      const durData = durationsResult[0];

      // Calcul de la médiane
      const sortedDurations = durData.allDurations.sort(
        (a: number, b: number) => a - b,
      );
      const mid = Math.floor(sortedDurations.length / 2);
      const median =
        sortedDurations.length % 2 === 0
          ? (sortedDurations[mid - 1] + sortedDurations[mid]) / 2
          : sortedDurations[mid];

      durations = {
        totalDuration: Math.round(durData.totalDuration || 0),
        averageDuration: Math.round(durData.avgDuration || 0),
        medianDuration: Math.round(median || 0),
        longestSession: Math.round(durData.maxDuration || 0),
        shortestSession: Math.round(durData.minDuration || 0),
      };
    }

    // ─── ESCALADE ──────────────────────────────────────────────────────
    const escalationPipeline: any[] = [
      { $match: dateFilter },
      {
        $group: {
          _id: null,
          totalSessions: { $sum: 1 },
          escalatedSessions: {
            $sum: {
              $cond: [{ $gte: ["$currentStage", 0] }, 1, 0],
            },
          },
          // Fausses alertes = sessions escaladées puis résolues par USER ou CONTACT_CONFIRM
          falseAlerts: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ["$currentStage", 0] },
                    {
                      $in: ["$resolvedBy", ["USER", "CONTACT_CONFIRM"]],
                    },
                  ],
                },
                1,
                0,
              ],
            },
          },
          stage0Count: {
            $sum: {
              $cond: [{ $gte: ["$currentStage", 0] }, 1, 0],
            },
          },
          stage1Count: {
            $sum: {
              $cond: [{ $gte: ["$currentStage", 1] }, 1, 0],
            },
          },
          stage2Count: {
            $sum: {
              $cond: [{ $eq: ["$currentStage", 2] }, 1, 0],
            },
          },
        },
      },
    ];

    const escalationResult =
      await SosSessionModel.aggregate(escalationPipeline);

    let escalation = {
      escalationRate: 0,
      falseAlertRate: 0,
      stageDistribution: {
        stage0: 0,
        stage1: 0,
        stage2: 0,
      },
    };

    if (escalationResult.length > 0) {
      const escData = escalationResult[0];
      escalation = {
        escalationRate:
          escData.totalSessions > 0
            ? Math.round(
                (escData.escalatedSessions / escData.totalSessions) * 100 * 10,
              ) / 10
            : 0,
        falseAlertRate:
          escData.escalatedSessions > 0
            ? Math.round(
                (escData.falseAlerts / escData.escalatedSessions) * 100 * 10,
              ) / 10
            : 0,
        stageDistribution: {
          stage0: escData.stage0Count || 0,
          stage1: escData.stage1Count || 0,
          stage2: escData.stage2Count || 0,
        },
      };
    }

    // ─── RÉSOLUTION ────────────────────────────────────────────────────
    const resolutionPipeline: any[] = [
      {
        $match: {
          ...dateFilter,
          status: "RESOLVED",
          resolvedBy: { $exists: true },
        },
      },
      {
        $group: {
          _id: "$resolvedBy",
          count: { $sum: 1 },
        },
      },
    ];

    const resolutionResult =
      await SosSessionModel.aggregate(resolutionPipeline);

    const resolution = {
      byUser: 0,
      byHeartbeatAuto: 0,
      byAdmin: 0,
      byContactConfirm: 0,
    };

    resolutionResult.forEach((item: any) => {
      switch (item._id) {
        case "USER":
          resolution.byUser = item.count;
          break;
        case "HEARTBEAT_AUTO":
          resolution.byHeartbeatAuto = item.count;
          break;
        case "ADMIN":
          resolution.byAdmin = item.count;
          break;
        case "CONTACT_CONFIRM":
          resolution.byContactConfirm = item.count;
          break;
      }
    });

    // ─── SMS (via SosEvent) ────────────────────────────────────────────
    const smsPipeline: any[] = [
      {
        $match: {
          type: { $in: ["SMS_SENT", "SMS_FAILED"] },
          ...(dateFilter.activatedAt && { createdAt: dateFilter.activatedAt }),
        },
      },
      {
        $group: {
          _id: "$type",
          count: { $sum: 1 },
        },
      },
    ];

    const smsResult = await SosEventModel.aggregate(smsPipeline);

    let sms = {
      totalSent: 0,
      totalFailed: 0,
      successRate: 0,
    };

    smsResult.forEach((item: any) => {
      if (item._id === "SMS_SENT") sms.totalSent = item.count;
      if (item._id === "SMS_FAILED") sms.totalFailed = item.count;
    });

    const totalSmsAttempts = sms.totalSent + sms.totalFailed;
    sms.successRate =
      totalSmsAttempts > 0
        ? Math.round((sms.totalSent / totalSmsAttempts) * 100 * 10) / 10
        : 0;

    // ─── TOP SITES ─────────────────────────────────────────────────────
    const topSitesPipeline: any[] = [
      {
        $match: {
          ...dateFilter,
          siteName: { $exists: true, $ne: null, $nin: [null, ""] },
          status: "RESOLVED",
          resolvedAt: { $exists: true },
        },
      },
      {
        $addFields: {
          durationMinutes: {
            $divide: [{ $subtract: ["$resolvedAt", "$activatedAt"] }, 60000],
          },
        },
      },
      {
        $group: {
          _id: "$siteName",
          count: { $sum: 1 },
          avgDuration: { $avg: "$durationMinutes" },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
      {
        $project: {
          _id: 0,
          siteName: "$_id",
          count: 1,
          averageDuration: { $round: ["$avgDuration", 0] },
        },
      },
    ];

    const topSites = await SosSessionModel.aggregate(topSitesPipeline);

    // ─── PATTERNS TEMPORELS ────────────────────────────────────────────
    const dayNames = [
      "Dimanche",
      "Lundi",
      "Mardi",
      "Mercredi",
      "Jeudi",
      "Vendredi",
      "Samedi",
    ];

    // Par jour de la semaine
    const byDayPipeline: any[] = [
      { $match: dateFilter },
      {
        $group: {
          _id: { $dayOfWeek: "$activatedAt" }, // 1=dimanche, 7=samedi
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ];

    const byDayResult = await SosSessionModel.aggregate(byDayPipeline);
    const byDayOfWeek = Array.from({ length: 7 }, (_, i) => ({
      day: i,
      dayName: dayNames[i],
      count: 0,
    }));

    byDayResult.forEach((item: any) => {
      const dayIndex = item._id - 1; // MongoDB retourne 1-7, on veut 0-6
      byDayOfWeek[dayIndex].count = item.count;
    });

    // Par heure
    const byHourPipeline: any[] = [
      { $match: dateFilter },
      {
        $group: {
          _id: { $hour: "$activatedAt" },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ];

    const byHourResult = await SosSessionModel.aggregate(byHourPipeline);
    const byHour = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      count: 0,
    }));

    byHourResult.forEach((item: any) => {
      byHour[item._id].count = item.count;
    });

    const patterns = {
      byDayOfWeek,
      byHour,
    };

    // ─── UTILISATEURS ──────────────────────────────────────────────────
    const usersPipeline: any[] = [
      { $match: dateFilter },
      {
        $group: {
          _id: "$userId",
          sessionCount: { $sum: 1 },
          totalDuration: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$status", "RESOLVED"] },
                    { $ne: ["$resolvedAt", null] },
                  ],
                },
                {
                  $divide: [
                    { $subtract: ["$resolvedAt", "$activatedAt"] },
                    60000,
                  ],
                },
                0,
              ],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          userId: { $toString: "$_id" },
          sessionCount: 1,
          totalDuration: { $round: ["$totalDuration", 0] },
        },
      },
    ];

    const usersResult = await SosSessionModel.aggregate(usersPipeline);

    const topUsers = usersResult
      .sort((a: any, b: any) => b.sessionCount - a.sessionCount)
      .slice(0, 10);

    const uniqueUsers = usersResult.length;
    const averageSessionsPerUser =
      uniqueUsers > 0
        ? Math.round((overview.totalSessions / uniqueUsers) * 10) / 10
        : 0;

    const users = {
      uniqueUsers,
      topUsers,
      averageSessionsPerUser,
    };

    // ─── HEARTBEATS ────────────────────────────────────────────────────
    const heartbeatsPipeline: any[] = [
      {
        $match: {
          type: "HEARTBEAT",
          ...(dateFilter.activatedAt && { createdAt: dateFilter.activatedAt }),
        },
      },
      {
        $group: {
          _id: null,
          totalHeartbeats: { $sum: 1 },
        },
      },
    ];

    const heartbeatsResult = await SosEventModel.aggregate(heartbeatsPipeline);

    const totalHeartbeats =
      heartbeatsResult.length > 0 ? heartbeatsResult[0].totalHeartbeats : 0;
    const averagePerSession =
      overview.totalSessions > 0
        ? Math.round((totalHeartbeats / overview.totalSessions) * 10) / 10
        : 0;

    const heartbeats = {
      totalHeartbeats,
      averagePerSession,
    };

    // ─── RÉSULTAT FINAL ────────────────────────────────────────────────
    const duration = Date.now() - startTime;
    console.log(`📈 [SOS-ADMIN] Stats calculées en ${duration}ms`);

    return {
      period,
      overview,
      durations,
      escalation,
      resolution,
      sms,
      topSites,
      patterns,
      users,
      heartbeats,
    };
  }

  // ─── UTILITAIRES ───────────────────────────────────────────────────

  /**
   * Nettoyer les contacts temporaires d'une session (override)
   * Appelé quand une session est résolue ou annulée
   */
  private async cleanupSessionContacts(sessionId: string): Promise<void> {
    try {
      const result = await SosContactModel.deleteMany({
        sessionId: new mongoose.Types.ObjectId(sessionId),
      });

      if (result.deletedCount > 0) {
        console.log(
          `🧹 [SOS] ${result.deletedCount} contact(s) temporaire(s) supprimé(s) pour session ${sessionId}`,
        );
      }
    } catch (error) {
      console.error(
        `❌ [SOS] Erreur nettoyage contacts session ${sessionId}:`,
        error,
      );
    }
  }

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
