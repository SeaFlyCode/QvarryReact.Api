# Vue d'ensemble des modèles Mongoose

## Liste des modèles

| Modèle                | Collection MongoDB     | Rôle                                                                |
| --------------------- | ---------------------- | ------------------------------------------------------------------- |
| `User`                | `users`                | Utilisateurs de l'application — authentification, profil, RGPD, 2FA |
| `RefreshToken`        | `refreshtokens`        | Tokens de renouvellement JWT — rotation de sessions                 |
| `AuditLog`            | `auditlogs`            | Journal des actions sensibles — sécurité et conformité              |
| `BlockedIp`           | `blockedips`           | IPs bloquées — protection contre les attaques                       |
| `Contact`             | `contacts`             | Relations entre utilisateurs — demandes et acceptations             |
| `Conversation`        | `conversations`        | Conversations entre utilisateurs — groupes et bilatérales           |
| `Message`             | `messages`             | Messages dans les conversations — contenu chiffré                   |
| `Fiche`               | `fiches`               | Fiches de sites souterrains créées par les utilisateurs             |
| `Point`               | `points`               | Points GPS associés aux fiches — coordonnées chiffrées              |
| `List`                | `lists`                | Listes de points de l'utilisateur                                   |
| `Notification`        | `notifications`        | Notifications in-app — TTL 30 jours                                 |
| `PushToken`           | `pushtokens`           | Tokens FCM Firebase — notifications push par appareil               |
| `PendingNotification` | `pendingnotifications` | File d'attente persistante pour retry de notifications              |
| `DataShare`           | `datashares`           | Partages de données chiffrés RSA entre utilisateurs                 |
| `DeletedData`         | `deleteddatas`         | Archive RGPD des données supprimées — TTL 90 jours                  |
| `CronLock`            | `cronlocks`            | Verrous distribués pour les cron jobs — TTL 5 min                   |
| `Keys`                | `keys`                 | Clés de chiffrement RSA et AES par utilisateur                      |
| `Maintenance`         | `maintenances`         | État de maintenance du serveur — singleton                          |
| `SosSession`          | `sossessions`          | Sessions SOS actives et terminées — escalade autoritaire            |
| `SosContact`          | `soscontacts`          | Contacts d'urgence permanents ou de session — format E.164          |
| `SosEvent`            | `sosevents`            | Journal d'événements SOS — TTL 90 jours                             |
| `SmsDeliveryReceipt`  | `smsdeliveryreceipts`  | Accusés de réception SMS Vonage — TTL 90 jours                      |

---

## Diagramme des relations

```
┌─────────────────────────────────────────────────────────────────────────┐
│                               USER                                       │
│   _id  name  surname  email  is_admin  gdpr_consent  two_factor_enabled  │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │ userId (ref)
        ┌──────────────────────────┼──────────────────────────────────────┐
        │                          │                                       │
        ▼                          ▼                                       ▼
┌───────────────┐       ┌──────────────────┐                  ┌───────────────────┐
│ REFRESH TOKEN │       │    AUDIT LOG     │                  │    PUSH TOKEN     │
│  userId (ref) │       │  userId? (ref)   │                  │   userId (ref)    │
│  tokenId jti  │       │  action  level   │                  │  deviceId  token  │
│  revoked      │       │  timestamp TTL90d│                  │  platform         │
└───────────────┘       └──────────────────┘                  └───────────────────┘

        ▼ userId (ref)                  ▼ userId (ref)
┌───────────────────┐       ┌──────────────────────┐
│    CONTACT        │       │    NOTIFICATION      │
│  userId (ref)     │       │  userId (ref)        │
│  contactId (ref)  │       │  type  title  read   │
│  status pending/  │       │  expiresAt TTL30d    │
│  accepted         │       └──────────────────────┘
└───────────────────┘
        │
        │ userId / participants.userId (ref)
        ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                          CONVERSATION                                      │
│  _id  name?  isGroup  creatorId (ref)  participants[{userId,role,joinedAt}]│
│  lastMessage (ref Message)  deletedBy[]                                    │
└──────────────────────────────────┬────────────────────────────────────────┘
                                   │ conversationId (ref)
                                   ▼
                        ┌─────────────────────────┐
                        │        MESSAGE          │
                        │  conversationId (ref)   │
                        │  senderId (ref User)    │
                        │  content (chiffré)      │
                        │  type text|system       │
                        │  readBy[]  replies[]    │
                        └─────────────────────────┘

┌───────────────────┐        ┌──────────────────────┐
│       FICHE       │        │        LIST          │
│  userId (ref)     │        │  userId (ref)        │
│  name  ville type │        │  name  description   │
│  points_ids[]     │        │  points[] (ref Point)│
│  center_cavite    │        │  color  icon         │
│  deletedAt        │        │  deletedAt           │
└────────┬──────────┘        └──────────────────────┘
         │ ficheId (ref)
         ▼
┌─────────────────────────┐
│         POINT           │
│  userId (ref)           │
│  ficheId? (ref Fiche)   │
│  location_encrypted     │
│  location GeoJSON       │
│  deletedAt              │
└─────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                          SOS SESSION                                     │
│  userId (ref)  status  currentStage  expiresAt  participants[]          │
│  participants[{userId,status,currentStage,lastHeartbeatAt,lastKnownLat}]│
│  sessionContactIds[] (ref SosContact)  resolvedBy                       │
└────────────────────────────┬────────────────────────────────────────────┘
                             │ sessionId (ref)
              ┌──────────────┼──────────────────┐
              ▼              ▼                  ▼
┌─────────────────┐ ┌──────────────┐  ┌──────────────────────┐
│   SOS CONTACT   │ │  SOS EVENT   │  │  SMS DELIVERY RECEIPT│
│  userId (ref)   │ │ sessionId ref│  │  messageId (Vonage)  │
│  phone chiffré  │ │ userId  type │  │  to  status          │
│  isDefault      │ │ metadata     │  │  TTL 90 jours        │
│  sessionId?     │ │ TTL 90 jours │  └──────────────────────┘
└─────────────────┘ └──────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                         DATA SHARE                                    │
│  senderId (ref)  receiverIds[]  dataType  dataId                     │
│  encryptedDataPerReceiver[{receiverId,encryptedData RSA,status}]     │
│  signature RSA  dataHash SHA256  expiresAt (sharedAt + 20j)          │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────┐    ┌──────────────────────┐
│       DELETED DATA       │    │       KEYS            │
│  entityType  entityId    │    │  userId? (ref)        │
│  data (archive JSON)     │    │  key (chiffré)        │
│  deletedBy (ref)         │    │  type master/rsa/...  │
│  TTL 90 jours (RGPD)     │    └──────────────────────┘
└──────────────────────────┘

┌──────────────────────┐    ┌──────────────────────┐
│     CRON LOCK        │    │     MAINTENANCE      │
│  lockName (unique)   │    │  isActive  message   │
│  lockedBy  expiresAt │    │  activatedBy (ref)   │
│  TTL 5 minutes       │    │  estimatedEndTime    │
└──────────────────────┘    └──────────────────────┘
```

---

## Conventions globales

- Tous les ObjectId référençant `User` sont des `ref: "User"`.
- Les champs `deletedAt` implémentent le **soft-delete** : `null` = actif, `Date` = supprimé.
- Les champs `version` (Number, default 1) gèrent les conflits de synchronisation mobile.
- Les **TTL index** MongoDB suppriment automatiquement les documents expirés sans intervention applicative.
- Les données sensibles (coordonnées GPS, messages, numéros de téléphone) sont chiffrées en **AES-256-GCM** avant persistance.
