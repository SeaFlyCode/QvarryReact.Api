# Modèles SOS

Fichiers sources : `src/models/sosSession.ts`, `src/models/sosContact.ts`, `src/models/sosEvent.ts`

Le système SOS permet à un utilisateur d'activer une session de sécurité avec timer autoritaire côté serveur. Si l'utilisateur ne donne pas signe de vie (heartbeat) avant l'expiration, des alertes sont escaladées automatiquement.

---

## Architecture d'escalade

```
Session créée (status: ACTIVE)
        │
        ├─ Heartbeat reçu → timer réinitialisé
        │
        └─ Timer expiré (status: EXPIRED) → Stage 0
              │  Alarme locale, log SosEvent STAGE_CHANGE
              │
              └─ Stage 1 (status: ESCALATING)
                    │  Notifications push à la communauté
                    │
                    └─ Stage 2
                          │  SMS Vonage aux SosContacts (format E.164)
                          │
                          └─ resolvedBy: USER | HEARTBEAT_AUTO | ADMIN | CONTACT_CONFIRM
                                        (status: RESOLVED | CANCELLED)
```

---

## Modèle SosSession

### Types

```typescript
export type SosSessionStatus =
  | "ACTIVE" // Session en cours, timer actif
  | "EXPIRED" // Timer expiré, stage 0 déclenché
  | "ESCALATING" // Stages 1-2 en cours
  | "RESOLVED" // Terminée normalement
  | "CANCELLED"; // Annulée par l'utilisateur

export type SosParticipantStatus =
  | "ACTIVE"
  | "DISCONNECTED"
  | "ESCALATING"
  | "LEFT";

export type SosResolvedBy =
  | "USER"
  | "HEARTBEAT_AUTO"
  | "ADMIN"
  | "CONTACT_CONFIRM";
```

### Interface ISosSession

```typescript
export interface ISosSession extends Document {
  userId: mongoose.Types.ObjectId; // Créateur (backward compat)
  status: SosSessionStatus;
  currentStage: number; // -1 à 2 (session globale)
  activatedAt: Date;
  expectedDuration: number; // Durée en minutes (15 à 480)
  expiresAt: Date;
  lastHeartbeatAt?: Date;
  resolvedAt?: Date;
  stage0TriggeredAt?: Date;
  stage1TriggeredAt?: Date;
  stage2TriggeredAt?: Date;
  lastKnownLat?: number;
  lastKnownLng?: number;
  lastKnownAccuracy?: number;
  entryLat?: number; // GPS à l'activation
  entryLng?: number;
  consecutiveHeartbeats: number;
  firstReconnectionAt?: Date;
  surfaceDetectionSent: boolean;
  reconnectionDetectionSent: boolean;
  participants: ISosParticipant[];
  resolvedByUserId?: mongoose.Types.ObjectId;
  sessionContactIds?: mongoose.Types.ObjectId[]; // ref: "SosContact"
  useDefaultContacts: boolean;
  note?: string; // max 500 chars
  siteName?: string; // max 200 chars
  zone?: string; // max 200 chars
  depth?: number; // 0 à 5000 mètres
  heartbeatCount: number;
  extensionCount: number;
  resolvedBy?: SosResolvedBy;
  createdAt: Date;
  updatedAt: Date;
}
```

### Champs principaux

#### Statut et timing

| Champ              | Type     | Contraintes                                       | Description                                  |
| ------------------ | -------- | ------------------------------------------------- | -------------------------------------------- |
| `userId`           | ObjectId | ref User, required, index                         | Créateur de la session                       |
| `status`           | String   | enum, required, index                             | Statut courant                               |
| `currentStage`     | Number   | min -1, max 2, default -1                         | Stage d'escalade global (-1 = pas déclenché) |
| `activatedAt`      | Date     | required                                          | Date d'activation                            |
| `expectedDuration` | Number   | required, min 15, max 480                         | Durée prévue en minutes                      |
| `expiresAt`        | Date     | required, index                                   | Date d'expiration calculée                   |
| `resolvedAt`       | Date     | optional                                          | Date de résolution                           |
| `resolvedBy`       | String   | enum USER\|HEARTBEAT_AUTO\|ADMIN\|CONTACT_CONFIRM | Méthode de résolution                        |
| `resolvedByUserId` | ObjectId | ref User, optional                                | Qui a résolu (traçabilité)                   |

#### Heartbeat et reconnexion

| Champ                       | Type    | Description                              |
| --------------------------- | ------- | ---------------------------------------- |
| `lastHeartbeatAt`           | Date    | Dernier heartbeat reçu (niveau session)  |
| `heartbeatCount`            | Number  | Nombre total de heartbeats reçus         |
| `extensionCount`            | Number  | Nombre de prolongations manuelles        |
| `consecutiveHeartbeats`     | Number  | Heartbeats consécutifs après reconnexion |
| `firstReconnectionAt`       | Date    | Date de début de la reconnexion          |
| `surfaceDetectionSent`      | Boolean | Alerte déplacement en surface envoyée    |
| `reconnectionDetectionSent` | Boolean | Alerte reconnexion stable envoyée        |

#### Localisation

| Champ               | Type   | Description                               |
| ------------------- | ------ | ----------------------------------------- |
| `lastKnownLat`      | Number | Dernière latitude connue                  |
| `lastKnownLng`      | Number | Dernière longitude connue                 |
| `lastKnownAccuracy` | Number | Précision GPS en mètres                   |
| `entryLat`          | Number | Latitude à l'activation (point de départ) |
| `entryLng`          | Number | Longitude à l'activation                  |

#### Métadonnées du site

| Champ      | Type   | Contraintes         | Description                               |
| ---------- | ------ | ------------------- | ----------------------------------------- |
| `note`     | String | maxlength 500       | Note libre de l'utilisateur               |
| `siteName` | String | maxlength 200, trim | Nom du site (ex: "Carrière de Pont-Réan") |
| `zone`     | String | maxlength 200, trim | Zone dans le site (ex: "Galerie Nord")    |
| `depth`    | Number | min 0, max 5000     | Profondeur estimée en mètres              |

#### Contacts de session

| Champ                | Type       | Description                                              |
| -------------------- | ---------- | -------------------------------------------------------- |
| `sessionContactIds`  | [ObjectId] | ref SosContact — contacts spécifiques pour cette session |
| `useDefaultContacts` | Boolean    | default `true` — utilise tous les contacts permanents    |

### Interface ISosParticipant (sous-document)

Les sessions de groupe intègrent plusieurs participants. Chaque participant a son propre état d'escalade.

```typescript
export interface ISosParticipant {
  userId: mongoose.Types.ObjectId;
  joinedAt: Date;
  leftAt?: Date | null;
  status: SosParticipantStatus;
  currentStage: number; // -1 à 2
  stage0TriggeredAt?: Date | null;
  stage1TriggeredAt?: Date | null;
  stage2TriggeredAt?: Date | null;
  lastHeartbeatAt?: Date | null;
  lastKnownLat?: number | null;
  lastKnownLng?: number | null;
  lastKnownAccuracy?: number | null;
  consecutiveHeartbeats: number;
  firstReconnectionAt?: Date | null;
  surfaceDetectionSent: boolean;
  reconnectionDetectionSent: boolean;
}
```

> Le sous-document participant est défini avec `{ _id: false }`.

### Index SosSession

| Champs                                | Usage                       |
| ------------------------------------- | --------------------------- |
| `userId: 1` (inline)                  | Sessions d'un utilisateur   |
| `status: 1` (inline)                  | Filtrage par statut         |
| `expiresAt: 1` (inline)               | Cron d'expiration           |
| `userId: 1, status: 1, createdAt: -1` | Historique d'un utilisateur |
| `status: 1, expiresAt: 1`             | Cron d'escalade             |
| `status: 1, currentStage: 1`          | Sessions à escalader        |
| `participants.userId: 1, status: 1`   | Sessions d'un participant   |
| `participants.status: 1`              | Cron sur statut participant |

---

## Modèle SosContact

Les contacts d'urgence sont des **personnes externes** (non-utilisateurs Qvarry) qui reçoivent des SMS via Vonage au stage 2.

### Interface TypeScript

```typescript
export interface ISosContact extends Document {
  userId: mongoose.Types.ObjectId; // ref: "User" — propriétaire
  sessionId?: mongoose.Types.ObjectId; // ref: "SosSession" — si contact de session
  name: string; // max 100 chars
  phone: string; // format E.164 (+33612345678)
  relationship?: string; // max 50 chars
  isDefault: boolean;
  lastSmsSentAt?: Date;
  deletedAt?: Date | null;
  version?: number;
  createdAt: Date;
  updatedAt: Date;
}
```

### Schéma

| Champ           | Type         | Contraintes                      | Description                                            |
| --------------- | ------------ | -------------------------------- | ------------------------------------------------------ |
| `userId`        | ObjectId     | ref User, required, index        | Propriétaire du contact                                |
| `sessionId`     | ObjectId     | ref SosSession, optional, index  | Présent si contact spécifique à une session (override) |
| `name`          | String       | required, maxlength 100, trim    | Nom affiché                                            |
| `phone`         | String       | required, trim, validation E.164 | Numéro de téléphone format international               |
| `relationship`  | String       | optional, maxlength 50, trim     | Relation (Conjoint, Parent, etc.)                      |
| `isDefault`     | Boolean      | default `false`                  | Contact prioritaire                                    |
| `lastSmsSentAt` | Date         | optional                         | Traçabilité du dernier SMS envoyé                      |
| `deletedAt`     | Date \| null | default `null`                   | Soft-delete                                            |
| `version`       | Number       | default `1`                      | Versioning sync mobile                                 |

> ⚠️ Validation téléphone : `/^\+[1-9]\d{6,14}$/` — le numéro doit être au format E.164 strict (ex: `+33612345678`). Les numéros non valides sont rejetés à la persistance.

### Index SosContact

| Champs                                    | Options | Usage                                                            |
| ----------------------------------------- | ------- | ---------------------------------------------------------------- |
| `userId: 1` (inline)                      | —       | Contacts d'un utilisateur                                        |
| `sessionId: 1` (inline)                   | —       | Contacts d'une session                                           |
| `userId: 1, isDefault: -1, createdAt: -1` | —       | Liste triée (défaut en premier)                                  |
| `userId: 1, phone: 1, sessionId: 1`       | unique  | Un numéro unique par user ET par contexte (permanent vs session) |
| `deletedAt: 1`                            | —       | Filtrage soft-delete                                             |

---

## Modèle SosEvent

Journal immuable de tous les événements liés aux sessions SOS. Utilisé pour l'audit, le debugging et l'historique de l'escalade.

### Types d'événements

```typescript
export type SosEventType =
  | "ACTIVATED" // Session SOS démarrée
  | "HEARTBEAT" // Signe de vie reçu
  | "EXTENDED" // Timer prolongé manuellement
  | "STAGE_CHANGE" // Changement de stage (0→1→2)
  | "SMS_SENT" // SMS envoyé à un contact
  | "SMS_FAILED" // Échec d'envoi SMS
  | "NOTIFICATION_SENT" // Notification push envoyée
  | "RESOLVED" // Session résolue
  | "CANCELLED" // Session annulée
  | "CONTACT_CONFIRMED" // Contact a confirmé la sécurité
  | "SURFACE_DETECTED" // Déplacement GPS significatif
  | "RECONNECTION_DETECTED" // Reconnexion prolongée détectée
  | "PARTICIPANT_ADDED" // Participant ajouté (groupe)
  | "PARTICIPANT_LEFT" // Participant quitté (scope "self")
  | "PARTICIPANT_DISCONNECTED" // Participant perdu le heartbeat
  | "SESSION_DEACTIVATED_ALL"; // Session désactivée pour tous
```

### Interface TypeScript

```typescript
export interface ISosEvent extends Document {
  sessionId: mongoose.Types.ObjectId; // ref: "SosSession", required, index
  userId: mongoose.Types.ObjectId; // ref: "User", required, index
  type: SosEventType;
  participantId?: mongoose.Types.ObjectId; // ref: "User" — participant concerné
  metadata?: Record<string, any>; // Données additionnelles sanitisées
  createdAt: Date;
}
```

### Schéma

| Champ           | Type         | Contraintes                     | Description                                           |
| --------------- | ------------ | ------------------------------- | ----------------------------------------------------- |
| `sessionId`     | ObjectId     | ref SosSession, required, index | Session concernée                                     |
| `userId`        | ObjectId     | ref User, required, index       | Utilisateur concerné                                  |
| `type`          | SosEventType | required                        | Type d'événement                                      |
| `participantId` | ObjectId     | ref User, optional, index       | Participant spécifique (sessions groupe)              |
| `metadata`      | Mixed        | optional, sanitisé              | Données contextuelles (stage, contactId, smsId, etc.) |
| `createdAt`     | Date         | default `Date.now`              | Timestamp de l'événement                              |

> Le champ `metadata` utilise un setter qui sanitise les opérateurs MongoDB (`$`-prefixed keys) et tronque à 10 000 caractères.

> Le schéma est déclaré avec `timestamps: false` car `updatedAt` n'a pas de sens pour un journal d'événements immuable.

### Index SosEvent

| Champs                                 | Options      | Usage                                  |
| -------------------------------------- | ------------ | -------------------------------------- |
| `sessionId: 1, type: 1, createdAt: -1` | —            | Historique d'une session par type      |
| `userId: 1, createdAt: -1`             | —            | Historique d'un utilisateur            |
| `createdAt: 1`                         | TTL 90 jours | Suppression automatique après 90 jours |
