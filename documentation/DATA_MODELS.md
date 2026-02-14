# 📊 Modèles de Données Qvarry

Documentation complète de tous les modèles MongoDB utilisés dans le projet Qvarry.

---

## Table des matières

1. [Données Utilisateur](#1-données-utilisateur)
   - [User](#user)
   - [Keys](#keys)
   - [RefreshToken](#refreshtoken)
2. [Données Métier](#2-données-métier)
   - [Fiche](#fiche)
   - [Point](#point)
   - [List](#list)
3. [Messagerie & Social](#3-messagerie--social)
   - [Contact](#contact)
   - [Conversation](#conversation)
   - [Message](#message)
4. [Partage de Données](#4-partage-de-données)
   - [DataShare](#datashare)
5. [Notifications](#5-notifications)
   - [Notification](#notification)
6. [Sécurité & Audit](#6-sécurité--audit)
   - [AuditLog](#auditlog)
   - [BlockedIp](#blockedip)
7. [Système](#7-système)
   - [Maintenance](#maintenance)
   - [DeletedData](#deleteddata)
8. [Relations entre modèles](#8-relations-entre-modèles)

---

## 1. Données Utilisateur

### User

Représente un utilisateur du système.

| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| `name` | String | ✅ | Prénom de l'utilisateur |
| `surname` | String | ✅ | Nom de famille |
| `pseudo` | String | ❌ | Pseudo optionnel |
| `showPseudo` | Boolean | ❌ | Si `true`, affiche le pseudo au lieu du nom réel |
| `password` | String | ✅ | Mot de passe hashé (bcrypt) |
| `password_history` | String[] | ❌ | Historique des 5 derniers mots de passe hashés |
| `email` | String | ✅ | Email chiffré (AES-256) |
| `ip_creation` | String | ✅ | IP lors de l'inscription |
| `ip_last_connection` | String | ✅ | IP de la dernière connexion |
| `creation_date` | Date | ✅ | Date de création du compte |
| `last_connection` | Date | ✅ | Date de dernière connexion |
| `is_admin` | Boolean | ✅ | Administrateur du système |
| `is_blocked` | Boolean | ✅ | Compte bloqué |
| `blocked_at` | Date | ❌ | Date du blocage |
| `blocked_reason` | String | ❌ | Raison du blocage |
| `contact_code` | Number | ✅ | Code unique à 6 chiffres pour ajouter en contact |
| `reset_password_token` | String | ❌ | Token de réinitialisation de mot de passe |
| `reset_password_expires` | Date | ❌ | Expiration du token de reset |
| `is_verified` | Boolean | ✅ | Email vérifié |
| `is_auth` | Boolean | ✅ | Authentifié |
| `email_verification_token` | String | ❌ | Token de vérification email |
| `email_verification_code` | String | ❌ | Code de vérification (6 chiffres) |
| `email_verification_expires` | Date | ❌ | Expiration du code |
| `is_admin_validated` | Boolean | ✅ | Compte validé par un admin |
| `admin_validated_at` | Date | ❌ | Date de validation |
| `admin_validated_by` | String | ❌ | ID de l'admin validateur |
| `admin_validation_rejected` | Boolean | ❌ | Compte refusé |
| `admin_rejection_reason` | String | ❌ | Raison du refus |
| `gdpr_consent` | Boolean | ✅ | Consentement RGPD (CGU) |
| `gdpr_consent_date` | Date | ❌ | Date du consentement |
| `gdpr_consent_version` | String | ❌ | Version des CGU acceptées |
| `gdpr_marketing_consent` | Boolean | ❌ | Consentement marketing |
| `gdpr_marketing_consent_date` | Date | ❌ | Date consentement marketing |
| `two_factor_enabled` | Boolean | ✅ | 2FA activé |
| `two_factor_secret` | String | ❌ | Secret TOTP chiffré (AES-256-GCM) |
| `two_factor_confirmed_at` | Date | ❌ | Date d'activation 2FA |
| `two_factor_recovery_codes` | String[] | ❌ | Codes de récupération hashés |
| `login_notifications_enabled` | Boolean | ❌ | Notifications de connexion par email |

---

### Keys

Stocke les clés de chiffrement utilisateur (AES-256).

| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| `userId` | ObjectId | ❌ | Référence vers User (optionnel pour clés système) |
| `key` | String | ✅ | Clé chiffrée avec la clé maître |
| `type` | String | ❌ | Type de clé: `user`, `db`, `system` |
| `date` | Date | ✅ | Date de création |

**Types de clés:**
- `user` : Clé AES pour chiffrer les données de l'utilisateur
- `rsa_public` / `rsa_private` : Paire RSA pour le partage E2E

---

### RefreshToken

Gère les tokens de rafraîchissement JWT.

| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| `tokenId` | String | ✅ | JTI du JWT (unique) |
| `userId` | ObjectId | ✅ | Référence vers User |
| `token` | String | ✅ | Hash du refresh token |
| `ipAddress` | String | ❌ | IP de création |
| `userAgent` | String | ❌ | User-Agent du navigateur/app |
| `deviceFingerprint` | String | ❌ | Empreinte de l'appareil |
| `expiresAt` | Date | ✅ | Date d'expiration |
| `createdAt` | Date | ✅ | Date de création |
| `lastUsedAt` | Date | ✅ | Dernière utilisation |
| `revoked` | Boolean | ✅ | Token révoqué |
| `revokedAt` | Date | ❌ | Date de révocation |
| `revokedReason` | String | ❌ | Raison de révocation |
| `tokenFamily` | String | ❌ | Pour détecter le vol de token |

**Index TTL:** Les tokens expirés sont automatiquement supprimés.

---

## 2. Données Métier

### Fiche

Représente un site/lieu souterrain documenté.

| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| `name` | String | ✅ | Nom du site (chiffré) |
| `ville` | String | ✅ | Ville/Commune (chiffré) |
| `type` | String | ✅ | Type de lieu (chiffré) |
| `etat` | String | ✅ | État d'exploration (chiffré) |
| `userId` | ObjectId | ✅ | Propriétaire de la fiche |
| `difficulte_acces` | String | ✅ | Difficulté d'accès (chiffré) |
| `risque_oxygene` | String | ✅ | Niveau de risque O2 (chiffré) |
| `acces_souterrain` | String | ✅ | Type d'accès (chiffré) |
| `praticite_souterrain` | String | ✅ | Praticabilité (chiffré) |
| `etat_general` | String | ✅ | État général (chiffré) |
| `commentaire` | String | ❌ | Commentaires (chiffré) |
| `points_ids` | ObjectId[] | ❌ | Points d'accès associés |
| `date_creation` | Date | ✅ | Date de création |
| `date_modification` | Date | ✅ | Dernière modification |
| `equipement_conseille` | String[] | ❌ | Équipements recommandés |
| `surface` | String[] | ❌ | Types de surface |
| `type_galeries` | String[] | ❌ | Types de galeries |
| `interets` | String | ❌ | Points d'intérêt (chiffré) |

**🔐 Chiffrement:** Tous les champs textuels sensibles sont chiffrés avec la clé AES de l'utilisateur.

---

### Point

Représente un point d'accès géolocalisé.

| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| `userId` | ObjectId | ✅ | Propriétaire du point |
| `name` | String | ✅ | Nom du point (chiffré) |
| `description` | String | ❌ | Description (chiffré) |
| `location_encrypted` | String | ✅ | Coordonnées GPS chiffrées (JSON) |
| `ficheId` | ObjectId | ❌ | Fiche associée |
| `location` | GeoJSON | ❌ | Coordonnées pour requêtes géo (approximatives) |
| `accessType` | String | ❌ | Type d'accès (vertical, horizontal, etc.) |
| `createdAt` | Date | ✅ | Date de création |
| `updatedAt` | Date | ✅ | Dernière modification |

**Format `location_encrypted`:**
```json
{
  "type": "Point",
  "coordinates": [2.3522, 48.8566]
}
```

**🔐 Sécurité:** Les coordonnées exactes sont chiffrées. Le champ `location` (optionnel) peut contenir des coordonnées floues pour les recherches géographiques.

---

### List

Listes personnalisées de points.

| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| `userId` | ObjectId | ✅ | Propriétaire de la liste |
| `name` | String | ✅ | Nom de la liste |
| `description` | String | ❌ | Description |
| `points` | ObjectId[] | ❌ | Points dans la liste |
| `color` | String | ❌ | Couleur (hex, défaut: `#000000`) |
| `icon` | String | ❌ | Icône (défaut: `default-icon`) |
| `createdAt` | Date | ✅ | Date de création |
| `updatedAt` | Date | ✅ | Dernière modification |

---

## 3. Messagerie & Social

### Contact

Relation de contact entre utilisateurs.

| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| `userId` | ObjectId | ✅ | Utilisateur qui a initié |
| `contactId` | ObjectId | ✅ | Utilisateur ciblé |
| `contactCode` | String | ❌ | Code contact utilisé |
| `isBlocked` | Boolean | ✅ | Contact bloqué |
| `status` | String | ✅ | `pending` ou `accepted` |
| `createdAt` | Date | ✅ | Date de création |

---

### Conversation

Conversation (1:1 ou groupe).

| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| `name` | String | ❌ | Nom du groupe (null si 1:1) |
| `isGroup` | Boolean | ✅ | Conversation de groupe |
| `creatorId` | ObjectId | ❌ | Créateur du groupe |
| `participants` | Participant[] | ✅ | Liste des participants |
| `lastMessage` | ObjectId | ❌ | Dernier message |
| `deletedBy` | ObjectId[] | ❌ | Utilisateurs ayant "supprimé" la conversation |
| `createdAt` | Date | ✅ | Date de création |
| `updatedAt` | Date | ✅ | Dernière activité |

**Type Participant:**
```typescript
{
  userId: ObjectId;
  role: 'admin' | 'member';
  joinedAt: Date;
  leftAt?: Date;
}
```

---

### Message

Message dans une conversation.

| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| `conversationId` | ObjectId | ✅ | Conversation parente |
| `senderId` | ObjectId | ✅ | Auteur du message |
| `content` | String | ✅ | Contenu (chiffré E2E) |
| `type` | String | ✅ | `text` ou `system` |
| `readBy` | ObjectId[] | ❌ | Utilisateurs ayant lu |
| `replies` | Reply[] | ❌ | Réponses en thread |
| `metadata` | Object | ❌ | Métadonnées |
| `createdAt` | Date | ✅ | Date d'envoi |
| `updatedAt` | Date | ✅ | Dernière modification |

**Type Reply:**
```typescript
{
  userId: ObjectId;
  content: string;
  createdAt: Date;
}
```

**Type Metadata:**
```typescript
{
  mentions?: ObjectId[];
  edited?: boolean;
  deleted?: boolean;
}
```

---

## 4. Partage de Données

### DataShare

Partage chiffré de données entre utilisateurs (E2E).

| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| `senderId` | ObjectId | ✅ | Émetteur du partage |
| `receiverIds` | ObjectId[] | ✅ | Destinataires |
| `dataType` | String | ✅ | `fiche`, `point`, ou `liste` |
| `dataId` | ObjectId | ✅ | ID de l'entité partagée |
| `encryptedDataPerReceiver` | Object[] | ✅ | Données chiffrées par destinataire |
| `signature` | String | ✅ | Signature RSA de l'émetteur |
| `dataHash` | String | ✅ | Hash SHA-256 des données |
| `relatedPointsIds` | ObjectId[] | ❌ | Points liés (pour fiches/listes) |
| `messagePerReceiver` | Object[] | ❌ | Message chiffré par destinataire |
| `sharedAt` | Date | ✅ | Date de partage |
| `expiresAt` | Date | ✅ | Expiration (sharedAt + 20 jours) |
| `notificationSent` | Boolean | ✅ | Notification envoyée |
| `readBy` | ReadReceipt[] | ❌ | Accusés de réception |
| `isActive` | Boolean | ✅ | Partage actif |

**Type EncryptedDataPerReceiver:**
```typescript
{
  receiverId: ObjectId;
  encryptedData: string; // Chiffré avec clé publique RSA
  status: 'pending' | 'read' | 'accepted' | 'declined';
}
```

**Type ReadReceipt:**
```typescript
{
  receiverId: ObjectId;
  readAt: Date;
  ipAddress?: string;
}
```

---

## 5. Notifications

### Notification

Notifications temps réel (WebSocket + stockage).

| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| `userId` | ObjectId | ✅ | Destinataire |
| `type` | String | ✅ | Type de notification (voir ci-dessous) |
| `contactId` | ObjectId | ❌ | Contact concerné |
| `conversationId` | ObjectId | ❌ | Conversation concernée |
| `messageId` | ObjectId | ❌ | Message concerné |
| `shareId` | ObjectId | ❌ | Partage concerné |
| `senderId` | ObjectId | ❌ | Émetteur |
| `title` | String | ✅ | Titre de la notification |
| `message` | String | ✅ | Contenu |
| `read` | Boolean | ✅ | Lue |
| `readAt` | Date | ❌ | Date de lecture |
| `createdAt` | Date | ✅ | Date de création |
| `expiresAt` | Date | ❌ | Date d'expiration |
| `relatedEntityId` | String | ❌ | ID générique (anti-doublon) |

**Types de notification:**
| Type | Description |
|------|-------------|
| `contact_request` | Nouvelle demande de contact |
| `contact_accepted` | Demande acceptée |
| `message` | Nouveau message |
| `group_invite` | Invitation groupe |
| `data_share` | Partage de données |
| `share_received` | Données partagées reçues |
| `share_accepted` | Partage accepté |
| `share_declined` | Partage refusé |
| `share_read` | Partage lu |
| `share_expiring_soon` | Expiration dans 2 jours |
| `share_expired` | Partage expiré |

---

## 6. Sécurité & Audit

### AuditLog

Journal d'audit des actions de sécurité.

| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| `userId` | ObjectId | ❌ | Utilisateur concerné |
| `action` | String | ✅ | Type d'action (ex: `LOGIN_SUCCESS`) |
| `level` | String | ✅ | `info`, `warning`, `error`, `critical` |
| `ipAddress` | String | ❌ | IP de l'action |
| `userAgent` | String | ❌ | User-Agent |
| `details` | Mixed | ❌ | Détails supplémentaires |
| `timestamp` | Date | ✅ | Date de l'événement |

**Index TTL:** Logs supprimés après **90 jours**.

**Actions courantes:**
- `LOGIN_SUCCESS` / `LOGIN_FAILED`
- `LOGOUT`
- `PASSWORD_CHANGE`
- `TWO_FACTOR_ENABLED` / `TWO_FACTOR_DISABLED`
- `MOBILE_LOGIN_SUCCESS`
- `PRIVILEGE_ESCALATION_ATTEMPT`
- `REFRESH_TOKEN_CREATED` / `REFRESH_TOKEN_REVOKED`

---

### BlockedIp

IPs bloquées (automatique ou manuel).

| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| `ipAddress` | String | ✅ | Adresse IP |
| `reason` | String | ✅ | Raison du blocage |
| `blockedAt` | Date | ✅ | Date du blocage |
| `blockedUntil` | Date | ❌ | Fin du blocage (null = permanent) |
| `blockedBy` | String | ✅ | `auto` ou `admin` |
| `attackType` | String | ✅ | Type d'attaque détectée |
| `attemptCount` | Number | ✅ | Nombre de tentatives |
| `relatedUserId` | ObjectId | ❌ | Utilisateur lié |
| `isActive` | Boolean | ✅ | Blocage actif |
| `metadata` | Object | ❌ | Métadonnées supplémentaires |

**Types d'attaque:**
- `BRUTE_FORCE`
- `RATE_LIMIT_EXCEEDED`
- `SUSPICIOUS_ACTIVITY`
- `MANUAL_BLOCK`

---

## 7. Système

### Maintenance

Mode maintenance du système (singleton).

| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| `isActive` | Boolean | ✅ | Mode maintenance actif |
| `message` | String | ❌ | Message affiché aux utilisateurs |
| `activatedBy` | ObjectId | ❌ | Admin ayant activé |
| `activatedAt` | Date | ❌ | Date d'activation |
| `deactivatedAt` | Date | ❌ | Date de désactivation |
| `estimatedEndTime` | Date | ❌ | Fin estimée |
| `updatedAt` | Date | ✅ | Dernière mise à jour |

**Note:** Une seule entrée existe dans cette collection (singleton pattern).

---

### DeletedData

Archive des données supprimées (soft delete pour audit).

| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| `entityType` | String | ✅ | Type d'entité supprimée |
| `entityId` | ObjectId | ✅ | ID de l'entité |
| `data` | Object | ✅ | Données complètes au moment de la suppression |
| `deletedBy` | ObjectId | ✅ | Utilisateur ayant supprimé |
| `deletedAt` | Date | ✅ | Date de suppression |
| `deletionReason` | String | ❌ | Raison de suppression |
| `deletionContext` | Object | ❌ | Contexte (IP, UA, requestId) |
| `parentEntityType` | String | ❌ | Type de l'entité parente (cascade) |
| `parentEntityId` | ObjectId | ❌ | ID de l'entité parente |
| `isRestored` | Boolean | ✅ | Données restaurées |
| `restoredAt` | Date | ❌ | Date de restauration |
| `restoredBy` | ObjectId | ❌ | Admin ayant restauré |

**Types d'entité:**
`fiche`, `point`, `list`, `user`, `message`, `conversation`, `contact`, `notification`, `dataShare`, `maintenance`

---

## 8. Relations entre modèles

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            SCHÉMA DES RELATIONS                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────┐                                                                │
│  │   User   │◄──────────────────────────────────────────────────┐           │
│  └────┬─────┘                                                    │           │
│       │                                                          │           │
│       │ 1:N                                                      │           │
│       ├───────────────┬───────────────┬───────────────┐         │           │
│       ▼               ▼               ▼               ▼         │           │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌──────────────┐  │           │
│  │  Fiche  │    │  Point  │    │  List   │    │ RefreshToken │  │           │
│  └────┬────┘    └────┬────┘    └────┬────┘    └──────────────┘  │           │
│       │              │              │                            │           │
│       │ 1:N          │              │ N:M                        │           │
│       └──────────────┼──────────────┘                            │           │
│                      │                                           │           │
│                      ▼                                           │           │
│               ┌─────────────┐                                    │           │
│               │  DataShare  │────────────────────────────────────┘           │
│               └──────┬──────┘                                                │
│                      │                                                       │
│                      ▼                                                       │
│               ┌─────────────┐     ┌─────────────┐                           │
│               │Notification │     │  AuditLog   │                           │
│               └─────────────┘     └─────────────┘                           │
│                                                                              │
│  ┌─────────┐      ┌─────────────┐      ┌─────────┐                          │
│  │ Contact │──────│Conversation │──────│ Message │                          │
│  └─────────┘      └─────────────┘      └─────────┘                          │
│                                                                              │
│  ┌─────────┐      ┌─────────────┐      ┌─────────────┐                      │
│  │  Keys   │      │ Maintenance │      │ DeletedData │                      │
│  └─────────┘      └─────────────┘      └─────────────┘                      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Relations principales

| Relation | Description |
|----------|-------------|
| User → Fiche | 1:N - Un utilisateur possède plusieurs fiches |
| User → Point | 1:N - Un utilisateur possède plusieurs points |
| User → List | 1:N - Un utilisateur possède plusieurs listes |
| Fiche → Point | 1:N - Une fiche contient plusieurs points |
| List → Point | N:M - Une liste contient plusieurs points |
| User → Keys | 1:N - Un utilisateur a plusieurs clés |
| User → RefreshToken | 1:N - Un utilisateur a plusieurs tokens |
| User ↔ Contact | N:M - Relation bidirectionnelle de contact |
| User → Conversation | N:M via Participant - Conversations |
| Conversation → Message | 1:N - Messages dans une conversation |
| User → DataShare | N:M - Partages envoyés/reçus |
| User → Notification | 1:N - Notifications destinées à l'utilisateur |
| * → AuditLog | Toute action génère des logs d'audit |
| * → DeletedData | Toute suppression est archivée |

---

## Index et performances

### Index principaux

| Collection | Index | Type | Usage |
|------------|-------|------|-------|
| User | `email` | Unique | Recherche par email |
| Point | `userId` | Simple | Filtrage par utilisateur |
| Fiche | `userId` | Simple | Filtrage par utilisateur |
| RefreshToken | `tokenId` | Unique | Validation de token |
| RefreshToken | `expiresAt` | TTL | Cleanup automatique |
| AuditLog | `timestamp` | TTL (90j) | Cleanup automatique |
| Notification | `userId` | Simple | Notifications par utilisateur |

### TTL (Time-To-Live)

| Collection | Champ | Durée | Description |
|------------|-------|-------|-------------|
| RefreshToken | `expiresAt` | Variable | Selon configuration |
| AuditLog | `timestamp` | 90 jours | Rétention des logs |
| DataShare | `expiresAt` | 20 jours | Expiration des partages |

---

## Chiffrement

### Données chiffrées

| Modèle | Champs chiffrés | Algorithme |
|--------|-----------------|------------|
| User | `email` | AES-256 (clé maître) |
| User | `two_factor_secret` | AES-256-GCM (clé maître) |
| Fiche | Tous les champs texte | AES-256 (clé utilisateur) |
| Point | `name`, `description`, `location_encrypted` | AES-256 (clé utilisateur) |
| Message | `content` | RSA + AES (E2E) |
| DataShare | `encryptedData` | RSA (clé publique receveur) |

### Hiérarchie des clés

```
Master Key (ENCRYPTION_KEY env var)
    └── User Keys (stockées chiffrées dans Keys)
            ├── Chiffre: Fiches, Points
            └── Utilisé pour: Déchiffrement local
    └── RSA Key Pairs (par utilisateur)
            └── Utilisé pour: Partage E2E, Messages
```

