# Modèles Notifications

Fichiers sources : `src/models/notifications.ts`, `src/models/pushToken.ts`, `src/models/pendingNotification.ts`

---

## Modèle Notification

Notifications in-app et push reçues par les utilisateurs. Les notifications expirent automatiquement après 30 jours via un TTL index MongoDB.

### Types de notifications

```typescript
export type NotificationType =
  // Contacts
  | "contact_request" // Nouvelle demande de contact
  | "contact_accepted" // Demande acceptée
  | "contact_refused" // Demande refusée
  // Messagerie
  | "message" // Nouveau message
  | "group_invite" // Invitation à un groupe
  | "group_member_added" // Ajouté à un groupe existant
  | "group_member_removed" // Retiré d'un groupe
  | "group_deleted" // Groupe supprimé
  // Partage de données
  | "data_share" // Partage générique
  | "share_received" // Nouvelles données reçues
  | "share_accepted" // Partage accepté
  | "share_declined" // Partage refusé
  | "share_read" // Partage lu
  | "share_expiring_soon" // Expire dans 2 jours
  | "share_expired" // Expiré
  // SOS
  | "sos_alert" // Alerte SOS stage 0
  | "sos_stage1_alert" // Alerte SOS stage 1
  | "sos_stage2_sms" // Suivi SMS stage 2
  | "sos_resolved" // Session résolue
  | "sos_confirmed_safe" // Contact confirmé en sécurité
  | "sos_session_cancelled" // Session annulée
  | "sos_participant_left" // Participant quitté la session
  | "sos_surface_detected" // Déplacement surface détecté
  | "sos_reconnection_detected" // Reconnexion stable
  | "sos_sms_triggered" // SMS d'urgence envoyés
  // Système
  | "login_new_device" // Connexion nouveau appareil
  | "admin_notification"; // Notification admin
```

### Interface TypeScript

```typescript
export interface INotification extends Document {
  userId: mongoose.Types.ObjectId;
  type: NotificationType;
  contactId?: mongoose.Types.ObjectId;
  conversationId?: mongoose.Types.ObjectId;
  messageId?: mongoose.Types.ObjectId;
  shareId?: mongoose.Types.ObjectId;
  senderId?: mongoose.Types.ObjectId;
  sosSessionId?: mongoose.Types.ObjectId;
  title: string;
  message: string;
  read: boolean;
  readAt?: Date;
  createdAt: Date;
  expiresAt?: Date;
  relatedEntityId?: string;
}
```

### Schéma

#### Destinataire et type

| Champ    | Type             | Contraintes               | Description          |
| -------- | ---------------- | ------------------------- | -------------------- |
| `userId` | ObjectId         | ref User, required, index | Destinataire         |
| `type`   | NotificationType | required                  | Type de notification |

#### Références contextuelles

| Champ             | Type     | Description                     |
| ----------------- | -------- | ------------------------------- |
| `contactId`       | ObjectId | ref Contact                     |
| `conversationId`  | ObjectId | ref Conversation                |
| `messageId`       | ObjectId | ref Message                     |
| `shareId`         | ObjectId | ref DataShare                   |
| `senderId`        | ObjectId | ref User — émetteur             |
| `sosSessionId`    | ObjectId | ref SosSession                  |
| `relatedEntityId` | String   | ID générique pour déduplication |

#### Contenu

| Champ     | Type    | Contraintes            | Description              |
| --------- | ------- | ---------------------- | ------------------------ |
| `title`   | String  | required               | Titre affiché            |
| `message` | String  | required               | Corps de la notification |
| `read`    | Boolean | default `false`, index | Statut de lecture        |
| `readAt`  | Date    | optional               | Date de lecture          |

#### Cycle de vie

| Champ       | Type | Description                                           |
| ----------- | ---- | ----------------------------------------------------- |
| `createdAt` | Date | default `Date.now`, index                             |
| `expiresAt` | Date | default `Date.now + 30 jours` — TTL index automatique |

### Index Notification

| Champs                              | Options                     | Usage                                                        |
| ----------------------------------- | --------------------------- | ------------------------------------------------------------ |
| `userId: 1, read: 1, createdAt: -1` | —                           | Notifications non lues d'un utilisateur (requête principale) |
| `userId: 1, type: 1, createdAt: -1` | —                           | Notifications par type pour un utilisateur                   |
| `expiresAt: 1`                      | TTL `expireAfterSeconds: 0` | Suppression automatique à l'expiration                       |

---

## Modèle PushToken

Stocke les tokens FCM (Firebase Cloud Messaging) pour l'envoi de notifications push. Un utilisateur peut avoir plusieurs tokens (un par appareil).

### Interface TypeScript

```typescript
export type PushTokenPlatform = "ios" | "android";

export interface IPushToken extends Document {
  userId: mongoose.Types.ObjectId;
  deviceId: string;
  token: string;
  platform: PushTokenPlatform;
  createdAt: Date;
  updatedAt: Date;
}
```

### Schéma

| Champ       | Type     | Contraintes                 | Description                      |
| ----------- | -------- | --------------------------- | -------------------------------- |
| `userId`    | ObjectId | ref User, required, index   | Propriétaire du token            |
| `deviceId`  | String   | required, unique, index     | Identifiant unique de l'appareil |
| `token`     | String   | required                    | Token FCM Firebase               |
| `platform`  | String   | enum ios\|android, required | Plateforme de l'appareil         |
| `createdAt` | Date     | auto (timestamps)           | Date d'enregistrement            |
| `updatedAt` | Date     | auto (timestamps)           | Date de mise à jour              |

### Index PushToken

| Champs                   | Options | Usage                                                 |
| ------------------------ | ------- | ----------------------------------------------------- |
| `userId: 1` (inline)     | —       | Tokens d'un utilisateur (envoi multi-appareils)       |
| `deviceId: 1` (inline)   | unique  | Un seul token par appareil                            |
| `userId: 1, deviceId: 1` | unique  | Un utilisateur ne peut avoir qu'un token par appareil |

> Le token FCM est mis à jour à chaque démarrage de l'application mobile. L'unicité sur `deviceId` garantit qu'une mise à jour de token (`upsert`) remplace l'ancien sans créer de doublon.

---

## Modèle PendingNotification

File d'attente persistante pour les notifications qui ont échoué et doivent être réessayées. Critique pour le système SOS : une notification d'urgence ne doit pas être perdue en cas de redémarrage serveur.

### Types

```typescript
export type PendingNotificationStatus = "pending" | "failed";
```

### Interface TypeScript

```typescript
export interface IPendingNotification extends Document {
  userId: mongoose.Types.ObjectId;
  type: string;
  title: string;
  message: string;
  data?: Record<string, any>;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: Date;
  status: PendingNotificationStatus;
  createdAt: Date;
  updatedAt: Date;
}
```

### Schéma

| Champ         | Type     | Contraintes                                      | Description                                       |
| ------------- | -------- | ------------------------------------------------ | ------------------------------------------------- |
| `userId`      | ObjectId | ref User, required, index                        | Destinataire                                      |
| `type`        | String   | required                                         | Type de notification                              |
| `title`       | String   | required                                         | Titre                                             |
| `message`     | String   | required                                         | Corps                                             |
| `data`        | Mixed    | default `{}`                                     | Données supplémentaires pour la notification push |
| `attempts`    | Number   | default 0, min 0                                 | Tentatives effectuées                             |
| `maxAttempts` | Number   | default 5, min 1                                 | Limite de tentatives                              |
| `nextRetryAt` | Date     | required, index                                  | Prochaine tentative planifiée                     |
| `status`      | String   | enum pending\|failed, default `"pending"`, index | Statut courant                                    |
| `createdAt`   | Date     | auto                                             | Date de création                                  |
| `updatedAt`   | Date     | auto                                             | Date de mise à jour                               |

### Index PendingNotification

| Champs                      | Options          | Usage                                                                                 |
| --------------------------- | ---------------- | ------------------------------------------------------------------------------------- |
| `status: 1, nextRetryAt: 1` | —                | Requête principale du cron de retry : notifications pending dont `nextRetryAt <= now` |
| `createdAt: 1`              | TTL 86400s (24h) | Suppression automatique après 24 heures (évite l'accumulation)                        |

> ⚠️ Le TTL de 24h supprime aussi les notifications en statut `"failed"` — une notification qui a dépassé `maxAttempts` reste dans la collection jusqu'à 24h puis est purgée. Aucune intervention manuelle n'est nécessaire.
