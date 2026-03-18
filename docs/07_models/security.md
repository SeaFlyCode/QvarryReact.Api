# Modèles de sécurité

Fichiers sources : `src/models/auditLogs.ts`, `src/models/blockedIps.ts`, `src/models/refreshTokens.ts`, `src/models/keys.ts`

---

## Modèle AuditLog

Journal centralisé de toutes les actions sensibles : tentatives d'authentification, accès admin, escalades de privilèges, blocages IP, etc. Les logs sont conservés **90 jours** via TTL index, puis purgés automatiquement.

### Interface TypeScript

```typescript
export interface IAuditLog extends Document {
  userId?: mongoose.Types.ObjectId;
  action: string;
  level: "info" | "warning" | "error" | "critical";
  ipAddress?: string;
  userAgent?: string;
  details?: any;
  timestamp: Date;
}
```

### Schéma

| Champ       | Type     | Contraintes                                                  | Description                                                  |
| ----------- | -------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| `userId`    | ObjectId | optional, index                                              | Utilisateur concerné (absent pour actions système)           |
| `action`    | String   | required, index                                              | Identifiant de l'action (ex: `PRIVILEGE_ESCALATION_ATTEMPT`) |
| `level`     | String   | enum info\|warning\|error\|critical, default `"info"`, index | Niveau de sévérité                                           |
| `ipAddress` | String   | optional                                                     | IP de l'auteur                                               |
| `userAgent` | String   | optional                                                     | User-Agent du navigateur/application                         |
| `details`   | Mixed    | optional, sanitisé                                           | Données contextuelles (path, method, tokenJti, etc.)         |
| `timestamp` | Date     | default `Date.now`                                           | Date de l'événement                                          |

> Le champ `details` utilise un setter qui sanitise les opérateurs MongoDB et tronque à 10 000 caractères.

### Index AuditLog

| Champs                               | Options      | Usage                                     |
| ------------------------------------ | ------------ | ----------------------------------------- |
| `userId: 1` (inline)                 | —            | Historique d'un utilisateur               |
| `action: 1` (inline)                 | —            | Recherche par type d'action               |
| `level: 1` (inline)                  | —            | Filtrage par sévérité                     |
| `userId: 1, timestamp: -1`           | —            | Historique chronologique d'un utilisateur |
| `action: 1, level: 1, timestamp: -1` | —            | Recherche d'actions critiques             |
| `timestamp: 1`                       | TTL 90 jours | Purge automatique des logs anciens        |

### Actions notables

| Action                          | Niveau   | Déclencheur                                     |
| ------------------------------- | -------- | ----------------------------------------------- |
| `PRIVILEGE_ESCALATION_ATTEMPT`  | critical | Token prétend être admin mais DB dit non        |
| `ADMIN_ACCESS_DENIED`           | warning  | Tentative d'accès à une route admin sans droits |
| `BLOCKED_IP_ACCESS_ATTEMPT`     | warning  | IP bloquée tente d'accéder à l'API              |
| `BLOCKED_DEVICE_ACCESS_ATTEMPT` | warning  | Device bloqué tente d'accéder                   |
| `MOBILE_ATTESTATION_FAILED`     | warning  | Attestation device invalide                     |
| `DEVICE_BLOCKED`                | warning  | Device ajouté à la blocklist                    |
| `MOBILE_RATE_LIMIT_TRIGGERED`   | warning  | Rate limit mobile déclenché                     |

---

## Modèle BlockedIp

Stocke les adresses IP bloquées, soit automatiquement (attaques détectées) soit manuellement par un admin. Supporte les blocages temporaires (avec `blockedUntil`) et permanents (`blockedUntil = null`).

### Interface TypeScript

```typescript
export interface IBlockedIp extends Document {
  ipAddress: string;
  reason: string;
  blockedAt: Date;
  blockedUntil?: Date; // null = blocage permanent
  blockedBy: "auto" | "admin";
  attackType: string;
  attemptCount: number;
  relatedUserId?: mongoose.Types.ObjectId;
  isActive: boolean;
  metadata?: {
    userAgents?: string[];
    targetedEndpoints?: string[];
    geoLocation?: string;
  };
}
```

### Schéma

| Champ                        | Type     | Contraintes                        | Description                                     |
| ---------------------------- | -------- | ---------------------------------- | ----------------------------------------------- |
| `ipAddress`                  | String   | required, index                    | Adresse IP bloquée                              |
| `reason`                     | String   | required                           | Raison du blocage                               |
| `blockedAt`                  | Date     | default `Date.now`, index          | Date du blocage                                 |
| `blockedUntil`               | Date     | default `null`                     | Expiration — `null` = permanent                 |
| `blockedBy`                  | String   | enum auto\|admin, default `"auto"` | Origine du blocage                              |
| `attackType`                 | String   | required, index                    | Type d'attaque (ex: brute_force, rate_limit)    |
| `attemptCount`               | Number   | default `1`                        | Nombre de tentatives ayant déclenché le blocage |
| `relatedUserId`              | ObjectId | ref User, optional                 | Utilisateur cible des attaques                  |
| `isActive`                   | Boolean  | default `true`, index              | Blocage actif ou levé                           |
| `metadata.userAgents`        | [String] | —                                  | User-Agents observés                            |
| `metadata.targetedEndpoints` | [String] | —                                  | Endpoints ciblés                                |
| `metadata.geoLocation`       | String   | —                                  | Localisation géographique estimée               |

### Index BlockedIp

| Champs                         | Options                     | Usage                                                                 |
| ------------------------------ | --------------------------- | --------------------------------------------------------------------- |
| `ipAddress: 1` (inline)        | —                           | Recherche rapide par IP (utilisée dans `ipBlockCheckMiddleware`)      |
| `blockedAt: 1` (inline)        | —                           | Tri chronologique                                                     |
| `attackType: 1` (inline)       | —                           | Filtrage par type d'attaque                                           |
| `isActive: 1` (inline)         | —                           | Blocages actifs uniquement                                            |
| `ipAddress: 1, isActive: 1`    | —                           | Vérification de blocage actif par IP                                  |
| `blockedUntil: 1, isActive: 1` | —                           | Cleanup des blocages expirés                                          |
| `blockedUntil: 1`              | TTL `expireAfterSeconds: 0` | Suppression automatique des documents dont `blockedUntil` est dépassé |

---

## Modèle RefreshToken

Stocke les refresh tokens utilisés pour renouveler les JWT d'accès. Chaque token est hashé avant stockage. La détection de vol de token est supportée via `tokenFamily`.

### Interface TypeScript

```typescript
export interface IRefreshToken extends Document {
  tokenId: string; // jti du JWT access token associé
  userId: mongoose.Types.ObjectId;
  token: string; // Hash du refresh token (bcrypt ou SHA-256)
  ipAddress?: string;
  userAgent?: string;
  deviceFingerprint?: string;
  expiresAt: Date;
  createdAt: Date;
  lastUsedAt: Date;
  revoked: boolean;
  revokedAt?: Date;
  revokedReason?: string;
  tokenFamily?: string; // Détection de vol par rotation
}
```

### Schéma

| Champ               | Type     | Contraintes             | Description                                         |
| ------------------- | -------- | ----------------------- | --------------------------------------------------- |
| `tokenId`           | String   | required, unique, index | JTI du JWT access token associé                     |
| `userId`            | ObjectId | required, index         | Propriétaire                                        |
| `token`             | String   | required, unique        | Hash du refresh token                               |
| `ipAddress`         | String   | optional                | IP à la création                                    |
| `userAgent`         | String   | optional                | User-Agent à la création                            |
| `deviceFingerprint` | String   | optional                | Fingerprint du device                               |
| `expiresAt`         | Date     | required                | Date d'expiration                                   |
| `createdAt`         | Date     | default `Date.now`      | Date de création                                    |
| `lastUsedAt`        | Date     | default `Date.now`      | Dernière utilisation                                |
| `revoked`           | Boolean  | default `false`, index  | Token révoqué                                       |
| `revokedAt`         | Date     | optional                | Date de révocation                                  |
| `revokedReason`     | String   | optional                | Raison de la révocation                             |
| `tokenFamily`       | String   | optional                | Famille de tokens pour détecter le vol par rotation |

> ⚠️ Le `token` (refresh token) est **hashé** avant stockage. En cas de vol de base de données, les refresh tokens ne sont pas utilisables directement.

> ⚠️ `tokenFamily` permet la détection de vol : si un refresh token déjà utilisé est présenté à nouveau, toute la famille est révoquée (indicateur de compromission).

### Index RefreshToken

| Champs                     | Options                     | Usage                                       |
| -------------------------- | --------------------------- | ------------------------------------------- |
| `tokenId: 1` (inline)      | unique                      | Correspondance access token ↔ refresh token |
| `userId: 1` (inline)       | —                           | Refresh tokens d'un utilisateur             |
| `revoked: 1` (inline)      | —                           | Filtrage des tokens actifs                  |
| `userId: 1, revoked: 1`    | —                           | Tokens actifs d'un utilisateur              |
| `expiresAt: 1, revoked: 1` | —                           | Cleanup des tokens expirés                  |
| `expiresAt: 1`             | TTL `expireAfterSeconds: 0` | Suppression automatique des tokens expirés  |

---

## Modèle Keys

Stocke les clés de chiffrement générées pour les utilisateurs (paires RSA, clés dérivées).

### Interface TypeScript

```typescript
export interface IKeys extends Document {
  userId?: mongoose.Types.ObjectId; // ref: "User" — optionnel (clés système)
  key: string; // Clé (format selon type)
  type?: string; // Catégorie de clé
  date: Date;
}
```

### Schéma

| Champ    | Type     | Contraintes                      | Description                             |
| -------- | -------- | -------------------------------- | --------------------------------------- |
| `userId` | ObjectId | ref User, optional               | Propriétaire — `null` pour clés système |
| `key`    | String   | required, maxlength 10000        | Contenu de la clé (chiffré ou public)   |
| `type`   | String   | enum (voir ci-dessous), optional | Catégorie                               |
| `date`   | Date     | default `Date.now`               | Date de génération                      |

Types de clés supportés :

| Valeur          | Description                                            |
| --------------- | ------------------------------------------------------ |
| `master`        | Clé de chiffrement maître                              |
| `communication` | Clé de chiffrement des messages                        |
| `rsa-public`    | Clé publique RSA                                       |
| `rsa-private`   | Clé privée RSA (chiffrée avec `masterEncryptionUtils`) |
| `user`          | Clé dérivée utilisateur                                |
| `db`            | Clé de chiffrement base de données                     |
| `system`        | Clé système générique                                  |

### Index Keys

| Champs               | Usage                                                      |
| -------------------- | ---------------------------------------------------------- |
| `userId: 1, type: 1` | Récupération de la clé d'un type donné pour un utilisateur |

> ⚠️ Les clés privées RSA (`type: "rsa-private"`) sont **chiffrées en AES-256-GCM** avec `masterEncryptionUtils` avant stockage. Le champ `key` ne contient jamais une clé privée en clair.
