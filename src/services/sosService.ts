// ═══════════════════════════════════════════════════════════════════════════
// SERVICE SOS MODE
// ═══════════════════════════════════════════════════════════════════════════
// Logique métier principale du Mode SOS
// Gestion des sessions, heartbeats, escalade et résolution
// ═══════════════════════════════════════════════════════════════════════════

import mongoose from "mongoose";
import SosSessionModel, {
  ISosSession,
  ISosParticipant,
  SosParticipantStatus,
} from "../models/sosSession";
import SosContactModel, { ISosContact } from "../models/sosContact";
import SosEventModel, { SosEventType } from "../models/sosEvent";
import { vonageService } from "./vonageService";
import { createNotification } from "./notificationService";
import { webSocketService } from "./webSocketService";
import { auditService } from "./auditService";
import { decrypt } from "../utils/masterEncryptionUtils";
import UserModel from "../models/users";
import { logger } from "./loggerService";

// Create child logger for sos service
const sosLogger = logger.child({ service: "sos" });

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════════════════════

const HEARTBEAT_EXTENSION_MINUTES = 15; // Prolongation par heartbeat
const STAGE_1_DELAY_MINUTES = 15; // Délai avant stage 1 (après expiration)
const STAGE_2_DELAY_MINUTES = 30; // Délai avant stage 2 (après expiration)
const MIN_DURATION_MINUTES = 15; // Durée minimale
const MAX_DURATION_MINUTES = 480; // Durée maximale (8h)

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
  participantIds?: string[]; // Array of user IDs to add as participants (group session)
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

  /**
   * Envoyer une notification SOS critique avec retry
   * SAFETY-CRITICAL: Pour les notifications d'escalade SOS
   * Retry 3 fois avec délai de 2 secondes entre chaque tentative
   * @returns true si au moins une tentative a réussi, false si toutes ont échoué
   */
  private async sendSosNotificationWithRetry(params: {
    userId: string;
    title: string;
    message: string;
    type: string;
    data: any;
    maxRetries?: number;
  }): Promise<boolean> {
    const { userId, title, message, type, data, maxRetries = 3 } = params;
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const sessionId = data.sosSessionId?.toString() || "unknown";

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await createNotification(
          userObjectId,
          type as any,
          title,
          message,
          data,
        );

        sosLogger.info("SOS notification sent successfully", {
          userId,
          sessionId,
          attempt,
          type,
        });

        return true;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        sosLogger.warn(
          `[SOS-CRITICAL] Failed to send escalation notification (attempt ${attempt}/${maxRetries})`,
          {
            userId,
            sessionId,
            attempt,
            type,
            error: lastError.message,
          },
        );

        // Attendre 2 secondes avant de réessayer (sauf pour la dernière tentative)
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    }

    // Toutes les tentatives ont échoué
    sosLogger.error(
      `[SOS-CRITICAL] All notification attempts failed after ${maxRetries} retries`,
      {
        userId,
        sessionId,
        type,
        title,
        error: lastError?.message || "Unknown error",
      },
    );

    return false;
  }

  /**
   * Envoyer une notification WebSocket avec gestion d'erreur
   * SAFETY-CRITICAL: Pour les notifications d'escalade SOS
   * Ne lève pas d'exception - log uniquement
   */
  private sendSosWebSocketNotification(
    userId: string,
    notification: any,
    context: { sessionId: string; stage: number },
  ): void {
    try {
      webSocketService.sendNotificationToUser(userId, notification);

      sosLogger.info("SOS WebSocket notification sent", {
        userId,
        sessionId: context.sessionId,
        stage: context.stage,
        notificationType: notification.type,
      });
    } catch (error) {
      sosLogger.error(`[SOS-CRITICAL] Failed to send WebSocket notification`, {
        userId,
        sessionId: context.sessionId,
        stage: context.stage,
        notificationType: notification.type,
        error: error instanceof Error ? error.message : String(error),
      });
      // Ne pas lever l'exception - l'escalade doit continuer
    }
  }

  // ─── ACTIVATION ────────────────────────────────────────────────────

  /**
   * Activer une nouvelle session SOS
   * L'utilisateur DOIT avoir une connexion réseau (avant d'aller sous terre)
   * Support des sessions de groupe avec participantIds
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
      participantIds,
    } = params;
    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Collecter tous les IDs de participants (créateur + participants ajoutés)
    const allParticipantIds = [userId];
    if (participantIds && participantIds.length > 0) {
      allParticipantIds.push(...participantIds);
    }

    // Vérifier qu'aucun des participants n'a déjà une session active
    const participantObjectIds = allParticipantIds.map(
      (id) => new mongoose.Types.ObjectId(id),
    );

    const existingSessions = await SosSessionModel.find({
      status: { $in: ["ACTIVE", "ESCALATING"] },
      "participants.userId": { $in: participantObjectIds },
      "participants.status": { $ne: "LEFT" },
    });

    if (existingSessions.length > 0) {
      throw new Error("SESSION_ALREADY_ACTIVE");
    }

    // Vérifier que les participants existent dans la base de données
    if (participantIds && participantIds.length > 0) {
      const participantUsers = await UserModel.find({
        _id: {
          $in: participantIds.map((id) => new mongoose.Types.ObjectId(id)),
        },
      }).select("_id");

      if (participantUsers.length !== participantIds.length) {
        throw new Error("INVALID_PARTICIPANT_IDS");
      }
    }

    // Gérer les contacts de session (override)
    let useDefaultContacts = true;
    const sessionContactIds: mongoose.Types.ObjectId[] = [];

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
            $in: (sessionContacts.permanentContactIds || []).map(
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
          (sessionContacts.permanentContactIds || []).length
        ) {
          throw new Error("INVALID_CONTACT_IDS");
        }

        sessionContactIds.push(
          ...permanentContacts.map((c) => c._id as mongoose.Types.ObjectId),
        );
      }

      // Valider les contacts supplémentaires temporaires
      if (hasAdditionalContacts) {
        for (const additionalContact of sessionContacts.additionalContacts ||
          []) {
          // Validation format téléphone
          if (!/^\+[1-9]\d{6,14}$/.test(additionalContact.phone)) {
            throw new Error("INVALID_PHONE_FORMAT");
          }
        }
      }
    } else {
      // Mode par défaut : vérifier qu'au moins UN participant a des contacts d'urgence
      let hasEmergencyContacts = false;

      for (const participantId of allParticipantIds) {
        const contactCount = await SosContactModel.countDocuments({
          userId: new mongoose.Types.ObjectId(participantId),
          sessionId: { $exists: false },
        });
        if (contactCount > 0) {
          hasEmergencyContacts = true;
          break;
        }
      }

      if (!hasEmergencyContacts) {
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

    // Créer les participants
    const participants: ISosParticipant[] = allParticipantIds.map(
      (participantId) => ({
        userId: new mongoose.Types.ObjectId(participantId),
        joinedAt: now,
        leftAt: null,
        status: "ACTIVE" as SosParticipantStatus,
        currentStage: -1,
        stage0TriggeredAt: null,
        stage1TriggeredAt: null,
        stage2TriggeredAt: null,
        lastHeartbeatAt: null,
        lastKnownLat: lat,
        lastKnownLng: lng,
        lastKnownAccuracy: accuracy,
        consecutiveHeartbeats: 0,
        firstReconnectionAt: null,
        surfaceDetectionSent: false,
        reconnectionDetectionSent: false,
      }),
    );

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
      participants,
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

    // Récupérer le nom du créateur pour les notifications
    const creator = await UserModel.findById(userObjectId).lean();
    const creatorName = creator ? decrypt(creator.name) : "Un utilisateur";

    // Notifier les participants ajoutés (tous sauf le créateur)
    if (participantIds && participantIds.length > 0) {
      for (const participantId of participantIds) {
        try {
          // Push notification
          await createNotification(
            new mongoose.Types.ObjectId(participantId),
            "sos_alert",
            "🆘 Tu as été ajouté à une session SOS",
            `${creatorName} t'a ajouté à une session SOS de groupe.`,
            {
              sosSessionId: session._id,
            },
          );

          // WebSocket notification
          webSocketService.sendNotificationToUser(participantId, {
            type: "sos_participant_added",
            sessionId: (session._id as mongoose.Types.ObjectId).toString(),
            creatorName,
            creatorId: userId,
            message: `Tu as été ajouté à une session SOS par ${creatorName}`,
          });

          // Logger l'événement
          await this.logEvent(
            session._id as mongoose.Types.ObjectId,
            participantId,
            "PARTICIPANT_ADDED",
            {
              addedBy: userId,
              creatorName,
            },
          );

          sosLogger.info("Participant added to SOS session", {
            participantId,
            sessionId: session._id?.toString(),
            addedBy: userId,
          });
        } catch (error) {
          sosLogger.error("Failed to notify participant", {
            participantId,
            sessionId: session._id?.toString(),
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
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

    sosLogger.info("SOS session activated", {
      userId,
      sessionId: session._id?.toString(),
      expectedDuration,
      expiresAt,
      useDefaultContacts,
      contactCount: sessionContactIds.length || undefined,
      participantCount: participants.length,
    });

    return session;
  }

  // ─── HEARTBEAT ─────────────────────────────────────────────────────

  /**
   * Recevoir un signe de vie (heartbeat)
   * Prolonge le timer de +15 minutes
   * Support des sessions de groupe - met à jour uniquement le participant appelant
   */
  async heartbeat(params: HeartbeatParams): Promise<ISosSession> {
    const { userId, sessionId, lat, lng, accuracy } = params;
    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Trouver la session active où l'utilisateur est participant
    const session = sessionId
      ? await SosSessionModel.findOne({
          _id: new mongoose.Types.ObjectId(sessionId),
          status: { $in: ["ACTIVE", "ESCALATING"] },
          "participants.userId": userObjectId,
          "participants.status": { $ne: "LEFT" },
        })
      : await SosSessionModel.findOne({
          status: { $in: ["ACTIVE", "ESCALATING"] },
          "participants.userId": userObjectId,
          "participants.status": { $ne: "LEFT" },
        });

    if (!session) {
      throw new Error("NO_ACTIVE_SESSION");
    }

    // Trouver le participant dans le tableau
    const participant = session.participants.find(
      (p) => p.userId.toString() === userId && p.status !== "LEFT",
    );

    if (!participant) {
      throw new Error("NO_ACTIVE_SESSION");
    }

    const now = new Date();

    // Mettre à jour les données du participant
    participant.lastHeartbeatAt = now;
    if (lat !== undefined) participant.lastKnownLat = lat;
    if (lng !== undefined) participant.lastKnownLng = lng;
    if (accuracy !== undefined) participant.lastKnownAccuracy = accuracy;

    // Si le participant était en escalade, le remettre en ACTIVE
    if (
      participant.status === "ESCALATING" ||
      participant.status === "DISCONNECTED"
    ) {
      participant.status = "ACTIVE";
      participant.currentStage = -1;
      sosLogger.info("Participant reactivated after heartbeat", {
        userId,
        sessionId: session._id?.toString(),
      });
    }

    // ─── DÉTECTION GPS DE SURFACE (par participant) ───
    if (
      lat !== undefined &&
      lng !== undefined &&
      session.entryLat &&
      session.entryLng &&
      !participant.surfaceDetectionSent
    ) {
      const distance = this.calculateDistance(
        session.entryLat,
        session.entryLng,
        lat,
        lng,
      );
      if (distance > SURFACE_DISTANCE_THRESHOLD_METERS) {
        participant.surfaceDetectionSent = true;

        // Envoyer suggestion via WebSocket
        webSocketService.sendNotificationToUser(userId, {
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

        sosLogger.info("Surface detected for participant", {
          userId,
          sessionId: session._id?.toString(),
          distance: Math.round(distance),
        });
      }
    }

    // ─── DÉTECTION DE RECONNEXION PROLONGÉE (par participant) ───
    participant.consecutiveHeartbeats += 1;

    if (!participant.firstReconnectionAt) {
      participant.firstReconnectionAt = now;
    }

    if (!participant.reconnectionDetectionSent) {
      const timeSinceFirstReconnection =
        now.getTime() - participant.firstReconnectionAt.getTime();
      if (
        timeSinceFirstReconnection >= RECONNECTION_THRESHOLD_MS &&
        participant.consecutiveHeartbeats >= MIN_HEARTBEATS_FOR_RECONNECTION
      ) {
        participant.reconnectionDetectionSent = true;

        webSocketService.sendNotificationToUser(userId, {
          type: "sos_reconnection_detected",
          sessionId: (session._id as mongoose.Types.ObjectId).toString(),
          message:
            "Tu sembles avoir une connexion stable depuis plus de 5 minutes. Désactiver le Mode SOS ?",
          connectedSince: participant.firstReconnectionAt,
          heartbeatCount: participant.consecutiveHeartbeats,
        });

        await this.logEvent(
          session._id as mongoose.Types.ObjectId,
          userId,
          "RECONNECTION_DETECTED",
          {
            connectedSince: participant.firstReconnectionAt,
            consecutiveHeartbeats: participant.consecutiveHeartbeats,
          },
        );

        sosLogger.info("Reconnection detected for participant", {
          userId,
          sessionId: session._id?.toString(),
          connectedSince: participant.firstReconnectionAt,
          heartbeatCount: participant.consecutiveHeartbeats,
        });
      }
    }

    // Calculer le nouveau expiresAt basé sur le participant avec le dernier heartbeat le plus récent
    const activeParticipants = session.participants.filter(
      (p) => p.status === "ACTIVE" && p.lastHeartbeatAt,
    );

    if (activeParticipants.length > 0) {
      const mostRecentHeartbeat = Math.max(
        ...activeParticipants
          .map((p) => p.lastHeartbeatAt?.getTime())
          .filter((t): t is number => t !== undefined),
      );
      const newExpiresAt = new Date(
        mostRecentHeartbeat + HEARTBEAT_EXTENSION_MINUTES * 60 * 1000,
      );
      session.expiresAt = newExpiresAt;
    }

    // Session-level fields (backward compat)
    session.lastHeartbeatAt = now;
    session.heartbeatCount += 1;
    if (lat !== undefined) session.lastKnownLat = lat;
    if (lng !== undefined) session.lastKnownLng = lng;
    if (accuracy !== undefined) session.lastKnownAccuracy = accuracy;

    await session.save();

    // Logger l'événement
    await this.logEvent(
      session._id as mongoose.Types.ObjectId,
      userId,
      "HEARTBEAT",
      {
        newExpiresAt: session.expiresAt,
        heartbeatCount: session.heartbeatCount,
        lat,
        lng,
      },
    );

    sosLogger.info("Heartbeat received", {
      userId,
      sessionId: session._id?.toString(),
      newExpiresAt: session.expiresAt,
      heartbeatCount: session.heartbeatCount,
    });

    return session;
  }

  // ─── EXTENSION MANUELLE ────────────────────────────────────────────

  /**
   * Prolonger manuellement le timer
   * Tout participant peut prolonger pour l'ensemble de la session
   */
  async extendSession(params: ExtendParams): Promise<ISosSession> {
    const { userId, sessionId, additionalMinutes } = params;
    const userObjectId = new mongoose.Types.ObjectId(userId);

    if (additionalMinutes < 15 || additionalMinutes > 480) {
      throw new Error("INVALID_EXTENSION_DURATION");
    }

    // Trouver la session où l'utilisateur est participant
    const session = sessionId
      ? await SosSessionModel.findOne({
          _id: new mongoose.Types.ObjectId(sessionId),
          status: { $in: ["ACTIVE", "ESCALATING"] },
          "participants.userId": userObjectId,
          "participants.status": { $ne: "LEFT" },
        })
      : await SosSessionModel.findOne({
          status: { $in: ["ACTIVE", "ESCALATING"] },
          "participants.userId": userObjectId,
          "participants.status": { $ne: "LEFT" },
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

    // Si la session était en escalade, remettre tous les participants ESCALATING en ACTIVE
    if (session.status === "ESCALATING") {
      session.status = "ACTIVE";
      session.currentStage = -1;

      session.participants.forEach((p) => {
        if (p.status === "ESCALATING" || p.status === "DISCONNECTED") {
          p.status = "ACTIVE";
          p.currentStage = -1;
        }
      });
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

    sosLogger.info("SOS session extended", {
      userId,
      sessionId: session._id?.toString(),
      additionalMinutes,
      newExpiresAt,
      extensionCount: session.extensionCount,
    });

    return session;
  }

  // ─── DÉSACTIVATION ─────────────────────────────────────────────────

  /**
   * Désactiver une session SOS (l'utilisateur est en sécurité)
   * Scope "self": quitte uniquement le participant appelant
   * Scope "all": désactive pour tous les participants
   */
  async deactivateSession(
    userId: string,
    sessionId?: string,
    scope: "self" | "all" = "all",
  ): Promise<ISosSession> {
    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Trouver la session où l'utilisateur est participant
    const session = sessionId
      ? await SosSessionModel.findOne({
          _id: new mongoose.Types.ObjectId(sessionId),
          status: { $in: ["ACTIVE", "ESCALATING"] },
          "participants.userId": userObjectId,
          "participants.status": { $ne: "LEFT" },
        })
      : await SosSessionModel.findOne({
          status: { $in: ["ACTIVE", "ESCALATING"] },
          "participants.userId": userObjectId,
          "participants.status": { $ne: "LEFT" },
        });

    if (!session) {
      throw new Error("NO_ACTIVE_SESSION");
    }

    const now = new Date();

    // Récupérer les infos de l'utilisateur pour les notifications
    const user = await UserModel.findById(userObjectId).lean();
    const userName = user ? decrypt(user.name) : "Un utilisateur";

    if (scope === "self") {
      // ─── SCOPE "SELF" : Quitter uniquement soi-même ───

      const participant = session.participants.find(
        (p) => p.userId.toString() === userId && p.status !== "LEFT",
      );

      if (!participant) {
        throw new Error("NO_ACTIVE_SESSION");
      }

      // Marquer le participant comme LEFT
      participant.status = "LEFT";
      participant.leftAt = now;

      // Logger l'événement
      await this.logEvent(
        session._id as mongoose.Types.ObjectId,
        userId,
        "PARTICIPANT_LEFT",
        {
          userName,
          leftAt: now,
        },
      );

      // Vérifier s'il reste des participants actifs
      const remainingActiveParticipants = session.participants.filter(
        (p) => p.status !== "LEFT",
      );

      if (remainingActiveParticipants.length === 0) {
        // C'était le dernier participant → résoudre la session
        session.status = "RESOLVED";
        session.resolvedAt = now;
        session.resolvedBy = "USER";
        session.resolvedByUserId = userObjectId;

        await session.save();

        // Nettoyer les contacts temporaires
        await this.cleanupSessionContacts(session._id.toString());

        sosLogger.info("Session resolved - last participant left", {
          sessionId: session._id?.toString(),
          userId,
        });
      } else {
        // Il reste des participants → session continue
        await session.save();

        // Notifier les autres participants
        for (const otherParticipant of remainingActiveParticipants) {
          const otherUserId = otherParticipant.userId.toString();
          webSocketService.sendNotificationToUser(otherUserId, {
            type: "sos_participant_left",
            sessionId: (session._id as mongoose.Types.ObjectId).toString(),
            userName,
            userId,
            message: `${userName} a quitté la session SOS`,
          });
        }

        sosLogger.info("Participant left SOS session", {
          sessionId: session._id?.toString(),
          userId,
          remainingParticipants: remainingActiveParticipants.length,
        });
      }

      // Audit
      await auditService.log({
        userId,
        action: "SOS_SESSION_PARTICIPANT_LEFT",
        level: "info",
        details: {
          sessionId: session._id,
          scope: "self",
          remainingParticipants: remainingActiveParticipants.length,
        },
      });
    } else {
      // ─── SCOPE "ALL" : Désactiver pour tous ───

      // Marquer tous les participants comme LEFT
      session.participants.forEach((p) => {
        if (p.status !== "LEFT") {
          p.status = "LEFT";
          p.leftAt = now;
        }
      });

      // Marquer la session comme résolue
      session.status = "RESOLVED";
      session.resolvedAt = now;
      session.resolvedBy = "USER";
      session.resolvedByUserId = userObjectId;

      await session.save();

      // Nettoyer les contacts temporaires
      await this.cleanupSessionContacts(session._id.toString());

      // Logger l'événement
      await this.logEvent(
        session._id as mongoose.Types.ObjectId,
        userId,
        "SESSION_DEACTIVATED_ALL",
        {
          resolvedBy: "USER",
          userName,
          participantCount: session.participants.length,
        },
      );

      // Notifier tous les autres participants
      for (const participant of session.participants) {
        const participantId = participant.userId.toString();
        if (participantId !== userId) {
          webSocketService.sendNotificationToUser(participantId, {
            type: "sos_session_deactivated_all",
            sessionId: (session._id as mongoose.Types.ObjectId).toString(),
            userName,
            userId,
            message: `La session SOS a été désactivée par ${userName}`,
          });
        }
      }

      // Audit
      await auditService.log({
        userId,
        action: "SOS_SESSION_DEACTIVATED",
        level: "info",
        details: {
          sessionId: session._id,
          resolvedBy: "USER",
          scope: "all",
          participantCount: session.participants.length,
        },
      });

      sosLogger.info("SOS session deactivated for all participants", {
        sessionId: session._id?.toString(),
        deactivatedBy: userId,
        participantCount: session.participants.length,
      });
    }

    return session;
  }

  // ─── CONFIRMATION PAR UN CONTACT ───────────────────────────────────

  /**
   * Un autre utilisateur Qvarry confirme que la personne est en sécurité
   * Résout la session pour TOUS les participants (scope "all")
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

    const now = new Date();

    // Marquer tous les participants comme LEFT
    session.participants.forEach((p) => {
      if (p.status !== "LEFT") {
        p.status = "LEFT";
        p.leftAt = now;
      }
    });

    session.status = "RESOLVED";
    session.resolvedAt = now;
    session.resolvedBy = "CONTACT_CONFIRM";
    session.resolvedByUserId = new mongoose.Types.ObjectId(confirmerId);

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
        participantCount: session.participants.length,
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
        participantCount: session.participants.length,
      },
    });

    sosLogger.info("SOS session confirmed safe by contact", {
      sessionId: session._id?.toString(),
      confirmerId,
      participantCount: session.participants.length,
    });

    return session;
  }

  // ─── LECTURE ────────────────────────────────────────────────────────

  /**
   * Obtenir la session active d'un utilisateur
   * Cherche où l'utilisateur est participant et n'a pas LEFT
   */
  async getActiveSession(userId: string): Promise<ISosSession | null> {
    return SosSessionModel.findOne({
      status: { $in: ["ACTIVE", "ESCALATING"] },
      "participants.userId": new mongoose.Types.ObjectId(userId),
      "participants.status": { $ne: "LEFT" },
    });
  }

  /**
   * Obtenir l'historique des sessions d'un utilisateur avec statistiques enrichies
   * Inclut les sessions où l'utilisateur est créateur OU participant
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
    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Récupérer les sessions (limitées pour l'affichage)
    // Sessions où l'utilisateur est créateur OU participant
    const sessions = await SosSessionModel.find({
      $or: [{ userId: userObjectId }, { "participants.userId": userObjectId }],
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    // Calculer les stats sur TOUTES les sessions de l'utilisateur (pas juste la page courante)
    const allSessions = await SosSessionModel.find({
      $or: [{ userId: userObjectId }, { "participants.userId": userObjectId }],
    })
      .select(
        "expectedDuration heartbeatCount status currentStage siteName activatedAt resolvedAt",
      )
      .lean();

    const totalSessions = allSessions.length;

    // Calcul des durées réelles (resolvedAt - activatedAt en minutes)
    const durations = allSessions
      .filter((s) => s.resolvedAt)
      .map((s) => {
        if (!s.resolvedAt) return 0;
        return Math.round(
          (new Date(s.resolvedAt).getTime() -
            new Date(s.activatedAt).getTime()) /
            60000,
        );
      });

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
   * Exclut les sessions où l'utilisateur est participant
   */
  async getActiveSessions(userId: string): Promise<any[]> {
    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Pour le MVP, on retourne toutes les sessions en escalade (stage 1+)
    // Exclut les sessions où l'utilisateur est participant
    return SosSessionModel.find({
      status: "ESCALATING",
      currentStage: { $gte: 1 },
      "participants.userId": { $ne: userObjectId },
    })
      .populate("userId", "name surname")
      .sort({ createdAt: -1 })
      .lean();
  }

  // ─── ESCALADE (appelé par le cron job) ─────────────────────────────

  /**
   * Traiter les sessions expirées et déclencher l'escalade (par participant)
   * Appelé toutes les 60 secondes par le cron job
   */
  async processExpiredSessions(): Promise<void> {
    const now = new Date();

    // Trouver toutes les sessions ACTIVE ou ESCALATING
    const activeSessions = await SosSessionModel.find({
      status: { $in: ["ACTIVE", "ESCALATING"] },
    });

    for (const session of activeSessions) {
      let sessionModified = false;

      // Parcourir tous les participants actifs
      for (const participant of session.participants) {
        if (participant.status === "LEFT") {
          continue; // Ignorer les participants qui ont quitté
        }

        // Vérifier si le heartbeat du participant a expiré
        const heartbeatExpired = participant.lastHeartbeatAt
          ? participant.lastHeartbeatAt.getTime() +
              HEARTBEAT_EXTENSION_MINUTES * 60 * 1000 <
            now.getTime()
          : session.expiresAt.getTime() < now.getTime();

        if (!heartbeatExpired) {
          continue; // Ce participant est encore dans les temps
        }

        // Le heartbeat de ce participant a expiré, vérifier les stages
        if (participant.currentStage === -1) {
          // Stage 0: première expiration
          await this.triggerStage0(session, participant);
          sessionModified = true;
        } else if (participant.currentStage === 0) {
          // Vérifier si 15 minutes se sont écoulées depuis stage 0
          const stage0Threshold = new Date(
            now.getTime() - STAGE_1_DELAY_MINUTES * 60 * 1000,
          );
          if (
            participant.stage0TriggeredAt &&
            participant.stage0TriggeredAt <= stage0Threshold
          ) {
            await this.triggerStage1(session, participant);
            sessionModified = true;
          }
        } else if (participant.currentStage === 1) {
          // Vérifier si 30 minutes se sont écoulées depuis le début de l'escalade (stage 0)
          const stage2Threshold = new Date(
            now.getTime() - STAGE_2_DELAY_MINUTES * 60 * 1000,
          );
          if (
            participant.stage0TriggeredAt &&
            participant.stage0TriggeredAt <= stage2Threshold
          ) {
            await this.triggerStage2(session, participant);
            sessionModified = true;
          }
        }
      }

      // Après avoir traité tous les participants, mettre à jour le statut de la session
      if (sessionModified) {
        const activeParticipants = session.participants.filter(
          (p) => p.status !== "LEFT",
        );
        const escalatingParticipants = activeParticipants.filter(
          (p) => p.status === "ESCALATING" || p.status === "DISCONNECTED",
        );

        if (escalatingParticipants.length > 0) {
          session.status = "ESCALATING";

          // Définir le currentStage de la session au maximum des stages des participants
          const maxStage = Math.max(
            ...activeParticipants.map((p) => p.currentStage),
          );
          session.currentStage = maxStage;

          // Mettre à jour les timestamps de session avec les plus anciennes dates des participants
          const stage0Dates = activeParticipants
            .filter((p) => p.stage0TriggeredAt)
            .map((p) => p.stage0TriggeredAt as Date)
            .map((d) => d.getTime());
          if (stage0Dates.length > 0) {
            session.stage0TriggeredAt = new Date(Math.min(...stage0Dates));
          }

          const stage1Dates = activeParticipants
            .filter((p) => p.stage1TriggeredAt)
            .map((p) => p.stage1TriggeredAt as Date)
            .map((d) => d.getTime());
          if (stage1Dates.length > 0) {
            session.stage1TriggeredAt = new Date(Math.min(...stage1Dates));
          }

          const stage2Dates = activeParticipants
            .filter((p) => p.stage2TriggeredAt)
            .map((p) => p.stage2TriggeredAt as Date)
            .map((d) => d.getTime());
          if (stage2Dates.length > 0) {
            session.stage2TriggeredAt = new Date(Math.min(...stage2Dates));
          }
        }

        await session.save();
      }
    }
  }

  // ─── STAGES D'ESCALADE ─────────────────────────────────────────────

  /**
   * Stage 0: Push notification au participant + alarme locale
   */
  private async triggerStage0(
    session: ISosSession,
    participant: ISosParticipant,
  ): Promise<void> {
    const sessionId = session._id as mongoose.Types.ObjectId;
    const participantUserId = participant.userId.toString();

    // Marquer le participant comme DISCONNECTED
    participant.status = "DISCONNECTED";
    participant.currentStage = 0;
    participant.stage0TriggeredAt = new Date();

    // Envoyer notification push au participant avec retry
    await this.sendSosNotificationWithRetry({
      userId: participantUserId,
      title: "🆘 Alerte SOS - Timer expiré",
      message:
        "Votre timer SOS a expiré ! Donnez un signe de vie ou l'escalade va se déclencher.",
      type: "sos_alert",
      data: {
        sosSessionId: sessionId,
      },
    });

    // Envoyer via WebSocket pour alarme immédiate (avec gestion d'erreur)
    this.sendSosWebSocketNotification(
      participantUserId,
      {
        type: "sos_alarm",
        stage: 0,
        sessionId: sessionId.toString(),
        message: "Timer SOS expiré — Donnez un signe de vie !",
      },
      { sessionId: sessionId.toString(), stage: 0 },
    );

    await this.logEvent(sessionId, participantUserId, "STAGE_CHANGE", {
      stage: 0,
      previousStage: -1,
      participantId: participantUserId,
    });

    sosLogger.info("Stage 0 triggered for participant", {
      sessionId: sessionId.toString(),
      participantId: participantUserId,
    });
  }

  /**
   * Stage 1: Notifier TOUS les utilisateurs Qvarry (sauf tous les participants de la session)
   */
  private async triggerStage1(
    session: ISosSession,
    participant: ISosParticipant,
  ): Promise<void> {
    const sessionId = session._id as mongoose.Types.ObjectId;
    const participantUserId = participant.userId.toString();

    // Marquer le participant comme ESCALATING
    participant.status = "ESCALATING";
    participant.currentStage = 1;
    participant.stage1TriggeredAt = new Date();

    // Récupérer le nom du participant en danger
    const user = await UserModel.findById(participant.userId).lean();
    const userName = user ? decrypt(user.name) : "Un utilisateur";

    // Envoyer notification WebSocket au participant (rappel) - avec gestion d'erreur
    this.sendSosWebSocketNotification(
      participantUserId,
      {
        type: "sos_alarm",
        stage: 1,
        sessionId: sessionId.toString(),
        message: "Escalade Stage 1 — D'autres utilisateurs sont notifiés !",
      },
      { sessionId: sessionId.toString(), stage: 1 },
    );

    // Notifier TOUS les utilisateurs Qvarry vérifiés (sauf TOUS les participants de la session)
    const allVerifiedUsers = await UserModel.find({
      _id: {
        $nin: session.participants.map((p) => p.userId),
      },
      isVerified: true,
    })
      .select("_id name")
      .lean();

    sosLogger.info("Stage 1 triggered - notifying all users", {
      sessionId: sessionId.toString(),
      participantId: participantUserId,
      notifiedCount: allVerifiedUsers.length,
    });

    // Envoyer les notifications à chaque utilisateur avec retry
    let successCount = 0;
    let failCount = 0;

    for (const targetUser of allVerifiedUsers) {
      // Push notification avec retry
      const pushSuccess = await this.sendSosNotificationWithRetry({
        userId: targetUser._id.toString(),
        title: "🆘 Alerte SOS",
        message: `${userName} a besoin d'aide ! Consultez la carte SOS.`,
        type: "sos_stage1_alert",
        data: {
          sosSessionId: sessionId,
        },
      });

      if (pushSuccess) {
        successCount++;
      } else {
        failCount++;
      }

      // WebSocket notification avec gestion d'erreur
      this.sendSosWebSocketNotification(
        targetUser._id.toString(),
        {
          type: "sos_alert_stage1",
          stage: 1,
          sessionId: sessionId.toString(),
          userName,
          participantId: participantUserId,
          message: `${userName} a besoin d'aide ! Consultez la carte SOS.`,
        },
        { sessionId: sessionId.toString(), stage: 1 },
      );
    }

    await this.logEvent(sessionId, participantUserId, "STAGE_CHANGE", {
      stage: 1,
      previousStage: 0,
      userName,
      participantId: participantUserId,
    });

    await this.logEvent(sessionId, participantUserId, "NOTIFICATION_SENT", {
      stage: 1,
      target: "all_users",
      notifiedCount: allVerifiedUsers.length,
      successCount,
      failCount,
      participantId: participantUserId,
    });

    sosLogger.info("Stage 1 completed", {
      sessionId: sessionId.toString(),
      participantId: participantUserId,
      notifiedCount: allVerifiedUsers.length,
      successCount,
      failCount,
    });
  }

  /**
   * Stage 2: Envoyer SMS aux contacts d'urgence de TOUS les participants via Vonage
   */
  private async triggerStage2(
    session: ISosSession,
    participant: ISosParticipant,
  ): Promise<void> {
    const sessionId = session._id as mongoose.Types.ObjectId;
    const participantUserId = participant.userId.toString();

    // Marquer le participant en stage 2
    participant.currentStage = 2;
    participant.stage2TriggeredAt = new Date();

    // Récupérer le nom du participant en danger
    const user = await UserModel.findById(participant.userId).lean();
    const userName = user
      ? `${decrypt(user.name)} ${decrypt(user.surname)}`
      : "Un utilisateur Qvarry";

    // ═══════════════════════════════════════════════════════════════════════════
    // SAFETY-CRITICAL: Vérifier que Vonage est configuré AVANT d'envoyer les SMS
    // ═══════════════════════════════════════════════════════════════════════════
    if (!vonageService.isReady()) {
      sosLogger.error(
        "[SOS-CRITICAL] Stage 2 escalation: Cannot send SMS - Vonage not configured. Emergency contacts will NOT be notified by SMS.",
        {
          sessionId: sessionId.toString(),
          participantId: participantUserId,
          userName,
        },
      );

      // Logger l'événement d'échec critique
      await this.logEvent(sessionId, participantUserId, "SMS_FAILED", {
        stage: 2,
        reason: "VONAGE_NOT_CONFIGURED",
        participantId: participantUserId,
        critical: true,
      });

      // Alarme WebSocket pour notifier l'utilisateur
      webSocketService.sendNotificationToUser(participantUserId, {
        type: "sos_alarm",
        stage: 2,
        sessionId: sessionId.toString(),
        message:
          "ERREUR CRITIQUE: Les SMS d'urgence ne peuvent pas être envoyés (Vonage non configuré) !",
        error: true,
      });

      // Audit critique
      await auditService.log({
        userId: participantUserId,
        action: "SOS_STAGE_2_FAILED_VONAGE_NOT_CONFIGURED",
        level: "critical",
        details: {
          sessionId: sessionId,
          participantId: participantUserId,
          userName,
          reason: "Vonage SMS service not configured",
        },
      });

      return; // On ne peut pas envoyer les SMS, on arrête ici
    }

    // Récupérer les contacts d'urgence de TOUS les participants de la session
    let allContacts: any[] = [];

    if (session.useDefaultContacts) {
      // Utiliser les contacts permanents de TOUS les participants
      const participantUserIds = session.participants.map((p) => p.userId);
      allContacts = await SosContactModel.find({
        userId: { $in: participantUserIds },
        sessionId: { $exists: false },
      }).lean();
    } else {
      // Utiliser les contacts sélectionnés pour cette session
      allContacts = await SosContactModel.find({
        _id: { $in: session.sessionContactIds },
      }).lean();
    }

    if (allContacts.length === 0) {
      sosLogger.error("No emergency contacts for stage 2", {
        sessionId: sessionId.toString(),
        participantId: participantUserId,
      });
      await this.logEvent(sessionId, participantUserId, "SMS_FAILED", {
        stage: 2,
        reason: "NO_CONTACTS",
        participantId: participantUserId,
      });
      return;
    }

    // Dédupliquer les contacts par numéro de téléphone
    const uniqueContactsMap = new Map();
    allContacts.forEach((contact) => {
      if (!uniqueContactsMap.has(contact.phone)) {
        uniqueContactsMap.set(contact.phone, contact);
      }
    });
    const contacts = Array.from(uniqueContactsMap.values());

    // Préparer la localisation depuis le participant
    const location =
      participant.lastKnownLat && participant.lastKnownLng
        ? { lat: participant.lastKnownLat, lng: participant.lastKnownLng }
        : session.lastKnownLat && session.lastKnownLng
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
        await this.logEvent(sessionId, participantUserId, "SMS_SENT", {
          contactId: contact._id,
          contactName: contact.name,
          messageId: result.messageId,
          participantId: participantUserId,
        });

        // Mettre à jour la date du dernier SMS envoyé
        await SosContactModel.findByIdAndUpdate(contact._id, {
          lastSmsSentAt: new Date(),
        });
      } else {
        await this.logEvent(sessionId, participantUserId, "SMS_FAILED", {
          contactId: contact._id,
          contactName: contact.name,
          error: result.error,
          participantId: participantUserId,
        });
      }
    }

    // Alarme WebSocket avec gestion d'erreur
    this.sendSosWebSocketNotification(
      participantUserId,
      {
        type: "sos_alarm",
        stage: 2,
        sessionId: sessionId.toString(),
        message: "Escalade Stage 2 — SMS envoyés aux contacts d'urgence !",
      },
      { sessionId: sessionId.toString(), stage: 2 },
    );

    // Audit critique
    await auditService.log({
      userId: participantUserId,
      action: "SOS_STAGE_2_SMS_SENT",
      level: "critical",
      details: {
        sessionId: sessionId,
        participantId: participantUserId,
        contactCount: contacts.length,
        successCount: results.filter((r) => r.success).length,
        failCount: results.filter((r) => !r.success).length,
      },
    });

    sosLogger.info("Stage 2 completed - SMS sent to emergency contacts", {
      sessionId: sessionId.toString(),
      participantId: participantUserId,
      contactCount: contacts.length,
      successCount: results.filter((r) => r.success).length,
      failCount: results.filter((r) => !r.success).length,
    });
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

    sosLogger.info("Emergency contact added", {
      userId,
      contactName: data.name,
    });

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
   * Helper: enrichir une session avec les infos participants pour l'admin
   * Décrypte les noms, calcule urgence basée sur le pire participant
   */
  private enrichSessionForAdmin(session: any): any {
    const now = new Date();
    const expiresAt = new Date(session.expiresAt);
    const timeRemaining = Math.floor(
      (expiresAt.getTime() - now.getTime()) / 1000,
    );
    const timeSinceExpired = timeRemaining < 0 ? Math.abs(timeRemaining) : null;

    // Calculer le niveau d'urgence basé sur le PIRE participant
    let urgencyLevel = "low";
    const participants = session.participants || [];
    const activeParticipants = participants.filter(
      (p: any) => p.status !== "LEFT",
    );

    if (activeParticipants.length > 0) {
      const worstStage = Math.max(
        ...activeParticipants.map((p: any) => p.currentStage ?? -1),
      );
      const hasEscalating = activeParticipants.some(
        (p: any) => p.status === "ESCALATING" || p.status === "DISCONNECTED",
      );

      if (worstStage >= 2) urgencyLevel = "critical";
      else if (worstStage === 1) urgencyLevel = "high";
      else if (worstStage === 0 || hasEscalating) urgencyLevel = "medium";
    } else if (session.status === "ESCALATING") {
      // Fallback session-level
      if (session.currentStage >= 2) urgencyLevel = "critical";
      else if (session.currentStage === 1) urgencyLevel = "high";
      else urgencyLevel = "medium";
    }

    // Construire l'aperçu des participants avec noms décryptés
    const participantsOverview = participants.map((p: any) => {
      const userInfo =
        p.userId && typeof p.userId === "object" ? p.userId : null;
      return {
        userId: userInfo ? userInfo._id?.toString() : p.userId?.toString(),
        name: userInfo?.name ? decrypt(userInfo.name) : null,
        surname: userInfo?.surname ? decrypt(userInfo.surname) : null,
        status: p.status,
        currentStage: p.currentStage,
        lastHeartbeatAt: p.lastHeartbeatAt,
        joinedAt: p.joinedAt,
        leftAt: p.leftAt,
      };
    });

    return {
      ...session,
      user:
        session.userId && typeof session.userId === "object"
          ? {
              id: session.userId._id,
              name: decrypt(session.userId.name),
              surname: decrypt(session.userId.surname),
            }
          : null,
      participantCount: participants.length,
      isGroupSession: participants.length > 1,
      participantsOverview,
      timeRemaining: Math.max(0, timeRemaining),
      timeSinceExpired,
      urgencyLevel,
    };
  }

  /**
   * Dashboard admin - Vue d'ensemble des sessions SOS
   * Inclut les infos de groupe et les compteurs de participants à risque
   */
  async getAdminDashboard(): Promise<{
    activeSessions: number;
    escalatingSessions: number;
    groupSessions: number;
    totalParticipantsAtRisk: number;
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
      .populate("participants.userId", "name surname")
      .sort({ status: -1, currentStage: -1, activatedAt: 1 })
      .lean();

    // Compteurs de groupe
    let groupSessions = 0;
    let totalParticipantsAtRisk = 0;

    // Décrypter les noms et enrichir les données
    const enrichedSessions = sessions.map((session: any) => {
      const participants = session.participants || [];
      if (participants.length > 1) groupSessions++;

      // Compter les participants à risque (DISCONNECTED ou ESCALATING)
      participants.forEach((p: any) => {
        if (p.status === "DISCONNECTED" || p.status === "ESCALATING") {
          totalParticipantsAtRisk++;
        }
      });

      return this.enrichSessionForAdmin(session);
    });

    return {
      activeSessions,
      escalatingSessions,
      groupSessions,
      totalParticipantsAtRisk,
      resolvedToday,
      totalSessions24h,
      sessions: enrichedSessions,
    };
  }

  /**
   * Récupérer toutes les sessions actives (admin)
   * Inclut les infos de participants pour chaque session
   */
  async getAllActiveSessions(): Promise<any[]> {
    // Récupérer TOUTES les sessions ACTIVE + ESCALATING
    const sessions = await SosSessionModel.find({
      status: { $in: ["ACTIVE", "ESCALATING"] },
    })
      .populate("userId", "name surname")
      .populate("participants.userId", "name surname")
      .sort({ status: -1, currentStage: -1, activatedAt: 1 })
      .lean();

    // Décrypter les noms et enrichir les données
    const enrichedSessions = sessions.map((session: any) =>
      this.enrichSessionForAdmin(session),
    );

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

    const now = new Date();
    session.status = "RESOLVED";
    session.resolvedAt = now;
    session.resolvedBy = "ADMIN";

    // Marquer tous les participants comme LEFT
    session.participants.forEach((p) => {
      if (p.status !== "LEFT") {
        p.status = "LEFT";
        p.leftAt = now;
      }
    });

    await session.save();

    // Notifier tous les participants que la session a été annulée par un admin
    for (const participant of session.participants) {
      try {
        webSocketService.sendNotificationToUser(participant.userId.toString(), {
          type: "sos_session_cancelled_admin",
          sessionId: (session._id as mongoose.Types.ObjectId).toString(),
          message: "Votre session SOS a été annulée par un administrateur.",
          reason,
        });
      } catch (error) {
        sosLogger.error("Failed to notify participant of admin cancellation", {
          participantId: participant.userId.toString(),
          sessionId: session._id?.toString(),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

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

    sosLogger.info("Admin cancelled SOS session", {
      sessionId,
      adminId,
      reason,
    });

    return session;
  }

  /**
   * Récupérer les détails complets d'une session (admin)
   * Inclut les participants détaillés, contacts de tous les participants, events
   */
  async getSessionDetails(sessionId: string): Promise<any> {
    const session = await SosSessionModel.findById(
      new mongoose.Types.ObjectId(sessionId),
    )
      .populate("userId", "name surname email")
      .populate("participants.userId", "name surname email")
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

    const participants = (session as any).participants || [];
    const participantUserIds = participants
      .map((p: any) => {
        if (p.userId && typeof p.userId === "object") return p.userId._id;
        return p.userId;
      })
      .filter(Boolean);

    // Récupérer les contacts d'urgence de TOUS les participants
    const allContacts = await SosContactModel.find({
      userId: { $in: participantUserIds },
    })
      .sort({ isDefault: -1, createdAt: -1 })
      .lean();

    // Grouper les contacts par participant userId
    const contactsByParticipant: Record<string, any[]> = {};
    const phonesSeen = new Set<string>();
    const deduplicatedContacts: any[] = [];

    allContacts.forEach((contact: any) => {
      const uid = contact.userId?.toString();
      if (!contactsByParticipant[uid]) contactsByParticipant[uid] = [];
      contactsByParticipant[uid].push(contact);

      // Déduplication par téléphone
      const phone = contact.phone?.toString()?.trim();
      if (phone && !phonesSeen.has(phone)) {
        phonesSeen.add(phone);
        deduplicatedContacts.push(contact);
      }
    });

    // Construire les détails de chaque participant
    const participantsDetails = participants.map((p: any) => {
      const userInfo =
        p.userId && typeof p.userId === "object" ? p.userId : null;
      const uid = userInfo ? userInfo._id?.toString() : p.userId?.toString();
      return {
        userId: uid,
        name: userInfo?.name ? decrypt(userInfo.name) : null,
        surname: userInfo?.surname ? decrypt(userInfo.surname) : null,
        email: userInfo?.email ? decrypt(userInfo.email) : null,
        status: p.status,
        currentStage: p.currentStage,
        joinedAt: p.joinedAt,
        leftAt: p.leftAt,
        lastHeartbeatAt: p.lastHeartbeatAt,
        lastKnownLat: p.lastKnownLat,
        lastKnownLng: p.lastKnownLng,
        lastKnownAccuracy: p.lastKnownAccuracy,
        stage0TriggeredAt: p.stage0TriggeredAt,
        stage1TriggeredAt: p.stage1TriggeredAt,
        stage2TriggeredAt: p.stage2TriggeredAt,
        consecutiveHeartbeats: p.consecutiveHeartbeats,
        surfaceDetectionSent: p.surfaceDetectionSent,
        reconnectionDetectionSent: p.reconnectionDetectionSent,
        contacts: contactsByParticipant[uid || ""] || [],
      };
    });

    // Calculer des métriques utiles
    const now = new Date();
    const expiresAt = new Date(session.expiresAt);
    const timeRemaining = Math.floor(
      (expiresAt.getTime() - now.getTime()) / 1000,
    );
    const timeSinceExpired = timeRemaining < 0 ? Math.abs(timeRemaining) : null;

    // Calculer le niveau d'urgence basé sur le pire participant
    let urgencyLevel = "low";
    const activeParticipants = participants.filter(
      (p: any) => p.status !== "LEFT",
    );
    if (activeParticipants.length > 0) {
      const worstStage = Math.max(
        ...activeParticipants.map((p: any) => p.currentStage ?? -1),
      );
      const hasEscalating = activeParticipants.some(
        (p: any) => p.status === "ESCALATING" || p.status === "DISCONNECTED",
      );
      if (worstStage >= 2) urgencyLevel = "critical";
      else if (worstStage === 1) urgencyLevel = "high";
      else if (worstStage === 0 || hasEscalating) urgencyLevel = "medium";
    } else if (session.status === "ESCALATING") {
      if (session.currentStage >= 2) urgencyLevel = "critical";
      else if (session.currentStage === 1) urgencyLevel = "high";
      else urgencyLevel = "medium";
    }

    return {
      session: {
        ...session,
        user:
          (session as any).userId && typeof (session as any).userId === "object"
            ? {
                id: (session as any).userId._id,
                name: decrypt((session as any).userId.name),
                surname: decrypt((session as any).userId.surname),
                email: decrypt((session as any).userId.email),
              }
            : null,
        participantCount: participants.length,
        isGroupSession: participants.length > 1,
        timeRemaining: Math.max(0, timeRemaining),
        timeSinceExpired,
        urgencyLevel,
      },
      participantsDetails,
      events,
      contacts: allContacts,
      deduplicatedContacts,
      contactsByParticipant,
    };
  }

  /**
   * Récupérer l'historique de toutes les sessions (admin)
   * Supporte la recherche par userId comme créateur OU participant
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
      const userObjectId = new mongoose.Types.ObjectId(userId);
      // Chercher dans userId (créateur) OU dans participants.userId
      query.$or = [
        { userId: userObjectId },
        { "participants.userId": userObjectId },
      ];
    }

    const sessions = await SosSessionModel.find(query)
      .populate("userId", "name surname")
      .populate("participants.userId", "name surname")
      .sort({ createdAt: -1 })
      .limit(Math.min(limit, 100))
      .lean();

    // Décrypter les noms et enrichir avec infos participants
    const enrichedSessions = sessions.map((session: any) => {
      const participants = session.participants || [];
      const participantsOverview = participants.map((p: any) => {
        const userInfo =
          p.userId && typeof p.userId === "object" ? p.userId : null;
        return {
          userId: userInfo ? userInfo._id?.toString() : p.userId?.toString(),
          name: userInfo?.name ? decrypt(userInfo.name) : null,
          surname: userInfo?.surname ? decrypt(userInfo.surname) : null,
          status: p.status,
        };
      });

      return {
        ...session,
        user:
          session.userId && typeof session.userId === "object"
            ? {
                id: session.userId._id,
                name: decrypt(session.userId.name),
                surname: decrypt(session.userId.surname),
              }
            : null,
        participantCount: participants.length,
        isGroupSession: participants.length > 1,
        participantsOverview,
      };
    });

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
          groupSessions: {
            $sum: {
              $cond: [
                { $gt: [{ $size: { $ifNull: ["$participants", []] } }, 1] },
                1,
                0,
              ],
            },
          },
          soloSessions: {
            $sum: {
              $cond: [
                { $lte: [{ $size: { $ifNull: ["$participants", []] } }, 1] },
                1,
                0,
              ],
            },
          },
          totalParticipants: {
            $sum: { $size: { $ifNull: ["$participants", []] } },
          },
          groupParticipantsTotal: {
            $sum: {
              $cond: [
                { $gt: [{ $size: { $ifNull: ["$participants", []] } }, 1] },
                { $size: { $ifNull: ["$participants", []] } },
                0,
              ],
            },
          },
        },
      },
    ];

    const overviewResult = await SosSessionModel.aggregate(overviewPipeline);
    const overviewRaw = overviewResult[0] || {
      totalSessions: 0,
      activeSessions: 0,
      escalatingSessions: 0,
      resolvedSessions: 0,
      groupSessions: 0,
      soloSessions: 0,
      totalParticipants: 0,
      groupParticipantsTotal: 0,
    };
    delete overviewRaw._id;

    const overview = {
      totalSessions: overviewRaw.totalSessions,
      activeSessions: overviewRaw.activeSessions,
      escalatingSessions: overviewRaw.escalatingSessions,
      resolvedSessions: overviewRaw.resolvedSessions,
      groupSessions: overviewRaw.groupSessions,
      soloSessions: overviewRaw.soloSessions,
    };

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

    const sms = {
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
    // Compter les sessions par participant (via $unwind sur participants)
    // pour inclure les participations (pas juste les sessions créées)
    const usersPipeline: any[] = [
      { $match: dateFilter },
      { $unwind: { path: "$participants", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: {
            $ifNull: ["$participants.userId", "$userId"],
          },
          sessionCount: { $sum: 1 },
          asCreator: {
            $sum: {
              $cond: [{ $eq: ["$participants.userId", "$userId"] }, 1, 0],
            },
          },
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
          asCreator: 1,
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

    // ─── STATISTIQUES DE GROUPE ───────────────────────────────────────
    const groupStatsPipeline: any[] = [
      { $match: dateFilter },
      {
        $addFields: {
          participantCount: { $size: { $ifNull: ["$participants", []] } },
        },
      },
      {
        $match: { participantCount: { $gt: 1 } },
      },
      {
        $group: {
          _id: null,
          totalGroupSessions: { $sum: 1 },
          avgGroupSize: { $avg: "$participantCount" },
          maxGroupSize: { $max: "$participantCount" },
          totalGroupParticipants: { $sum: "$participantCount" },
        },
      },
    ];

    const groupStatsResult =
      await SosSessionModel.aggregate(groupStatsPipeline);

    // Compter le taux d'escalation par participant
    const participantEscalationPipeline: any[] = [
      { $match: dateFilter },
      { $unwind: "$participants" },
      {
        $group: {
          _id: null,
          totalParticipants: { $sum: 1 },
          escalatedParticipants: {
            $sum: {
              $cond: [{ $gte: ["$participants.currentStage", 0] }, 1, 0],
            },
          },
        },
      },
    ];

    const participantEscResult = await SosSessionModel.aggregate(
      participantEscalationPipeline,
    );

    const groupStatsData = groupStatsResult[0] || {
      totalGroupSessions: 0,
      avgGroupSize: 0,
      maxGroupSize: 0,
      totalGroupParticipants: 0,
    };

    const partEscData = participantEscResult[0] || {
      totalParticipants: 0,
      escalatedParticipants: 0,
    };

    const groupStats = {
      totalGroupSessions: groupStatsData.totalGroupSessions,
      totalSoloSessions: overviewRaw.soloSessions,
      averageGroupSize:
        Math.round((groupStatsData.avgGroupSize || 0) * 10) / 10,
      maxGroupSize: groupStatsData.maxGroupSize || 0,
      participantEscalationRate:
        partEscData.totalParticipants > 0
          ? Math.round(
              (partEscData.escalatedParticipants /
                partEscData.totalParticipants) *
                100 *
                10,
            ) / 10
          : 0,
    };

    // ─── RÉSULTAT FINAL ────────────────────────────────────────────────
    const duration = Date.now() - startTime;
    sosLogger.info("Admin SOS stats calculated", {
      durationMs: duration,
      totalSessions: overview.totalSessions,
    });

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
      groupStats,
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
        sosLogger.info("Session contacts cleaned up", {
          sessionId,
          deletedCount: result.deletedCount,
        });
      }
    } catch (error) {
      sosLogger.error("Failed to cleanup session contacts", {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
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
      sosLogger.error("Failed to log SOS event", {
        sessionId: sessionId.toString(),
        userId,
        type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

// Export singleton
export const sosService = new SosService();
