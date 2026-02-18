# AUDIT COMPLET — Qvarry API v1.1.3

**Date :** 18 février 2026
**Auditeurs :** 5 agents spécialisés (Sécurité, Architecture, Performances, Qualité, Conformité)
**Fichiers analysés :** 91 fichiers TypeScript, 15 modèles, 18 controllers, 16 routes, 15 services

---

## Contexte

**Projet :** API backend pour l'application Qvarry (gestion de fiches, points géographiques, messagerie, contacts)
**Stack :** Express 5 + TypeScript (strict) + MongoDB/Mongoose + Redis (optionnel) + WebSocket
**Infra :** Docker multi-stage avec obfuscation, Cloudflare Turnstile, ProtonMail SMTP
**Structure :**

```
src/
├── config/         → database.ts, cookieConfig.ts, rateLimitConfig.ts, swagger.ts
├── controllers/    → 18 fichiers (authControllers.ts, adminControllers.ts, etc.)
├── middlewares/     → 8 fichiers (authMiddleware.ts, adminMiddleware.ts, etc.)
├── models/         → 15 fichiers (users.ts, fiches.ts, points.ts, etc.)
├── routes/         → 16 fichiers
├── services/       → 15 fichiers (memoryStorageService.ts, sessionService.ts, etc.)
├── templates/      → Templates email HTML
├── types/          → express.d.ts
├── utils/          → 8 fichiers (masterEncryptionUtils.ts, jwtKeyManager.ts, etc.)
└── server.ts       → Point d'entrée (~596 lignes)
```

---

## Resume executif

| Axe                 | Problèmes CRITIQUE |  HAUTE | MOYENNE |  BASSE |
| ------------------- | -----------------: | -----: | ------: | -----: |
| Sécurité            |                  2 |      3 |       5 |      4 |
| Architecture        |                  5 |      5 |       4 |      2 |
| Performances        |                  6 |     14 |      15 |      7 |
| Code Mort / Qualité |                  0 |      4 |       6 |      5 |
| Conformité RGPD     |                  4 |      2 |       3 |      2 |
| **TOTAL**           |             **17** | **28** |  **33** | **20** |

**Score global : 6.5/10**

---

## PARTIE 1 — CORRECTIONS CRITIQUES (Semaine 1)

---

### [CRIT-01] Memory Leak — Maps illimitées dans memoryStorageService

- **Sévérité** : CRITIQUE
- **Axe** : Performances
- **Fichier** : `src/services/memoryStorageService.ts`
- **Lignes** : 9-18, 53-62

**Problème :** Les Maps `points`, `fiches`, `lists`, `conversations`, `contacts` par session utilisateur n'ont AUCUNE limite de taille. Un utilisateur avec 10 000+ points provoquera un crash OOM.

Code actuel :

```typescript
// Ligne 9-18
interface UserSession {
  points: Map<string, IPoint>;
  fiches: Map<string, IFiche>;
  lists: Map<string, IList>;
  conversations: Map<string, IConversation>;
  contacts: Map<string, IContact>;
  encryptionKey: string;
  lastAccessed: Date;
  isDirty: boolean;
}
```

```typescript
// Ligne 53-62 — initSession : crée des Maps sans limites
this.sessions.set(userId, {
  points: new Map(),
  fiches: new Map(),
  lists: new Map(),
  conversations: new Map(),
  contacts: new Map(),
  encryptionKey,
  lastAccessed: new Date(),
  isDirty: false,
});
```

```typescript
// Ligne 114 — storePoint : ajoute sans vérifier la taille
session.points.set(point._id.toString(), point);
```

**Impact :** Crash serveur (OOM) garanti à l'échelle. Chaque utilisateur charge toutes ses données en mémoire sans limite.

**Correction :** Ajouter des limites de taille sur chaque Map et implémenter une éviction LRU.

```typescript
// Ajouter en haut du fichier, après les imports (vers ligne 8)
const MAX_ITEMS_PER_SESSION = {
  points: 5000,
  fiches: 1000,
  lists: 500,
  conversations: 200,
  contacts: 1000
};

// Ajouter une méthode privée dans la classe MemoryStorageService (après le constructor, vers ligne 30)
private enforceLimit(map: Map<string, any>, maxSize: number): void {
  if (map.size >= maxSize) {
    // Supprimer les 10% les plus anciens (FIFO via ordre d'insertion des Maps)
    const toDelete = Math.ceil(maxSize * 0.1);
    const keys = Array.from(map.keys()).slice(0, toDelete);
    for (const key of keys) {
      map.delete(key);
    }
  }
}

// Modifier storePoint (ligne 114) — ajouter avant session.points.set() :
this.enforceLimit(session.points, MAX_ITEMS_PER_SESSION.points);
session.points.set(point._id.toString(), point);

// Appliquer le même pattern pour storeFiche, storeList, storeConversation, storeContact
```

**Tests :** Créer un test unitaire qui insère 6000 points et vérifie que la Map ne dépasse jamais 5000.

---

### [CRIT-02] N+1 Query — getUserByEmail scanne toute la table users

- **Sévérité** : CRITIQUE
- **Axe** : Performances
- **Fichier** : `src/services/userServices.ts`
- **Lignes** : 286-296

**Problème :** Chaque login déclenche un `UserModel.find({})` (charge TOUS les utilisateurs) puis déchiffre chaque email en boucle pour trouver celui qui correspond. Avec 10 000 utilisateurs, c'est 10 000 opérations de déchiffrement AES par login.

Code actuel :

```typescript
// Lignes 286-296
export async function getUserByEmail(email: string): Promise<IUser | null> {
  if (!email || typeof email !== "string")
    throw new Error("L'email fourni n'est pas valide.");
  const users = await UserModel.find({});
  for (const user of users) {
    const decryptedEmail = decrypt(user.email);
    if (decryptedEmail === email) {
      return user;
    }
  }
  return null;
}
```

**Impact :** Temps de login > 5 secondes avec 10 000 utilisateurs. Charge CPU explosive. Bloque le thread Node.js.

**Correction :** Ajouter un champ `emailHash` (SHA-256 du email en clair) au modèle User, créer un index dessus, et chercher par hash.

**Étape 1 — Modifier le modèle User** (`src/models/users.ts`) :

```typescript
// Ajouter dans l'interface IUserBase (après la ligne 11 "email: string;")
emailHash?: string; // SHA-256 de l'email en clair pour recherche indexée

// Ajouter dans le schéma UserSchema (après la ligne 60 "email: { type: String, required: true },")
emailHash: { type: String, index: true },
```

**Étape 2 — Créer un helper de hash** (dans `src/utils/masterEncryptionUtils.ts` ou un nouveau fichier) :

```typescript
import crypto from "crypto";

export function hashEmail(email: string): string {
  return crypto
    .createHash("sha256")
    .update(email.toLowerCase().trim())
    .digest("hex");
}
```

**Étape 3 — Modifier getUserByEmail** (`src/services/userServices.ts`, lignes 286-296) :

```typescript
import { hashEmail } from "../utils/masterEncryptionUtils";

export async function getUserByEmail(email: string): Promise<IUser | null> {
  if (!email || typeof email !== "string")
    throw new Error("L'email fourni n'est pas valide.");

  const emailHashValue = hashEmail(email);

  // Recherche rapide par hash indexé
  const user = await UserModel.findOne({ emailHash: emailHashValue });
  if (user) return user;

  // Fallback : scan pour les anciens utilisateurs sans emailHash (migration)
  const users = await UserModel.find({ emailHash: { $exists: false } });
  for (const u of users) {
    const decryptedEmail = decrypt(u.email);
    if (decryptedEmail === email) {
      // Migrer ce user en ajoutant le hash
      u.emailHash = emailHashValue;
      await u.save();
      return u;
    }
  }
  return null;
}
```

**Étape 4 — Ajouter le hash à la création d'utilisateur** : Dans `src/controllers/authControllers.ts`, lors du `register`, ajouter `emailHash: hashEmail(email)` dans l'objet de création.

**Tests :** Vérifier que le login fonctionne toujours. Vérifier qu'un `getUserByEmail` avec 1000 users prend < 50ms au lieu de > 3 secondes.

---

### [CRIT-03] Index MongoDB manquants sur 5 modèles critiques

- **Sévérité** : CRITIQUE
- **Axe** : Performances / Architecture
- **Fichiers et corrections** :

#### 3a. `src/models/conversations.ts` — Aucun index (ligne 37-38)

Code actuel :

```typescript
// Ligne 35-38 — schema options, pas d'index
}, {
  timestamps: true,
});
export default mongoose.model<IConversation>('Conversation', ConversationSchema);
```

Correction — ajouter avant l'export (entre la ligne 37 et 39) :

```typescript
// Index pour recherche rapide des conversations d'un utilisateur
ConversationSchema.index({ "participants.userId": 1, updatedAt: -1 });
ConversationSchema.index({ creatorId: 1 });
```

#### 3b. `src/models/messages.ts` — Aucun index (ligne 49-52)

Code actuel :

```typescript
// Lignes 47-52
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const MessageModel = mongoose.models.Message || mongoose.model<IMessage>('Message', MessageSchema);
export default MessageModel;
```

Correction — ajouter entre les lignes 49 et 51 :

```typescript
// Index pour chargement des messages par conversation (query principale)
MessageSchema.index({ conversationId: 1, createdAt: -1 });
// Index pour comptage de messages non lus
MessageSchema.index({ conversationId: 1, readBy: 1 });
// Index pour recherche par expéditeur
MessageSchema.index({ senderId: 1 });
```

#### 3c. `src/models/contacts.ts` — Aucun index (ligne 19-21)

Code actuel :

```typescript
// Lignes 18-21
    createdAt: { type: Date, default: Date.now }
});

export default model<IContact>('Contact', ContactSchema);
```

Correction — ajouter entre les lignes 19 et 21 :

```typescript
// Index composé principal
ContactSchema.index({ userId: 1, status: 1, createdAt: -1 });
// Index pour vérification d'existence de contact (empêche doublons logiques)
ContactSchema.index({ userId: 1, contactId: 1 }, { unique: true });
// Index pour recherche inversée (qui m'a en contact)
ContactSchema.index({ contactId: 1, status: 1 });
```

#### 3d. `src/models/keys.ts` — Aucun index (ligne 16-20)

Code actuel :

```typescript
// Lignes 12-20
const keysSchema: Schema<IKeys> = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: false },
  key: { type: String, required: true },
  type: { type: String, required: false },
  date: { type: Date, default: Date.now },
});

const KeysModel: Model<IKeys> =
  mongoose.models.Keys || mongoose.model<IKeys>("Keys", keysSchema);
```

Correction — ajouter entre les lignes 17 et 19 :

```typescript
// Index pour recherche de clés par utilisateur et type
keysSchema.index({ userId: 1, type: 1 });
```

#### 3e. `src/models/users.ts` — Aucun index (ligne 97-99)

Code actuel :

```typescript
// Lignes 96-99
    login_notifications_enabled: { type: Boolean, default: true }
});

export const UserModel: Model<IUser> = mongoose.models.User || mongoose.model<IUser>("User", UserSchema);
```

Correction — ajouter entre les lignes 97 et 99 :

```typescript
// Index pour recherche par email hashé (voir CRIT-02)
UserSchema.index({ emailHash: 1 });
// Index pour les requêtes admin
UserSchema.index({ is_admin_validated: 1, creation_date: -1 });
UserSchema.index({ is_blocked: 1 });
UserSchema.index({ contact_code: 1 }, { unique: true, sparse: true });
UserSchema.index({ creation_date: -1 });
```

**Impact si non corrigé :** Full collection scan sur CHAQUE requête concernant ces modèles. Temps de réponse > 1-5 secondes en production.

**Tests :** Utiliser MongoDB Compass ou `db.collection.getIndexes()` pour vérifier que les index sont créés. Lancer `explain()` sur les queries principales.

---

### [CRIT-04] RGPD — Emails utilisateurs loggés en clair (51 occurrences)

- **Sévérité** : CRITIQUE
- **Axe** : Conformité RGPD
- **Fichiers** : Multiples controllers et services
- **Lignes principales** :
  - `src/services/emailService.ts` : lignes 287, 298, 302
  - `src/controllers/authControllers.ts` : nombreuses occurrences dans le fichier

**Problème :** Les adresses email sont loggées en clair dans `console.log`, `console.warn`, `console.error` à travers tout le code. Violation RGPD Art. 5(1)(f).

Code actuel (exemples) :

```typescript
// emailService.ts ligne 287
console.log(`A: ${to}`);

// emailService.ts ligne 298
console.log(`Email envoye a ${to} (${template}): ${info.messageId}`);

// emailService.ts ligne 302
console.error(`Erreur envoi email a ${to} (${template}):`, error);
```

**Impact :** Emails en clair dans les fichiers de logs Docker/syslog. Exploitables par des tiers. Violation RGPD.

**Correction :** Créer un helper de masquage et l'utiliser partout.

**Étape 1 — Créer le helper** (ajouter dans `src/utils/emailUtils.ts` ou dans un nouveau fichier `src/utils/logUtils.ts`) :

```typescript
/**
 * Masque un email pour les logs : matheo@example.com → ma***@example.com
 */
export function maskEmail(email: string): string {
  if (!email || !email.includes("@")) return "***";
  const [local, domain] = email.split("@");
  const masked =
    local.length <= 2 ? local[0] + "***" : local.substring(0, 2) + "***";
  return `${masked}@${domain}`;
}
```

**Étape 2 — Remplacer dans `src/services/emailService.ts`** :

```typescript
// Importer en haut du fichier
import { maskEmail } from "../utils/logUtils";

// Ligne 287 : remplacer
console.log(`A: ${maskEmail(to)}`);

// Ligne 298 : remplacer
console.log(`Email envoye a ${maskEmail(to)} (${template}): ${info.messageId}`);

// Ligne 302 : remplacer
console.error(`Erreur envoi email a ${maskEmail(to)} (${template}):`, error);
```

**Étape 3 — Faire un search & replace** dans tous les fichiers pour chaque `console.log` / `console.warn` / `console.error` contenant `${email}` ou `${to}` et les remplacer par `${maskEmail(email)}` / `${maskEmail(to)}`.

Fichiers à vérifier (liste non exhaustive, faire un grep sur `${email}` et `${to}` dans les console.\*) :

- `src/controllers/authControllers.ts`
- `src/controllers/mobileAuthControllers.ts`
- `src/controllers/adminControllers.ts`
- `src/services/emailService.ts`

**Tests :** Faire un grep sur tout le projet : `grep -rn 'console\.\(log\|warn\|error\).*\${.*email\|${to}' src/` — ne doit plus retourner de résultat avec des emails non masqués.

---

### [CRIT-05] RGPD — Adresses IP en clair dans les emails envoyés aux utilisateurs

- **Sévérité** : CRITIQUE
- **Axe** : Conformité RGPD
- **Fichiers** : `src/services/emailService.ts` lignes 404, 427, et templates HTML
- **Templates** : `src/templates/emails/password-reset.html`, `src/templates/emails/security-alert-login.html`

**Problème :** Les emails de sécurité (reset password, alerte connexion, changement password) contiennent l'IP de l'utilisateur en clair.

Code actuel :

```typescript
// emailService.ts lignes 399-407
variables: {
    USER_NAME: userName,
    RESET_LINK: resetLink,
    RESET_CODE: resetCode,
    EXPIRY_TIME: expiryTime,
    IP_ADDRESS: ipAddress,     // ← IP en clair
    DEVICE_INFO: deviceInfo,
    REQUEST_TIME: formatEmailDate(),
},

// emailService.ts lignes 424-429
variables: {
    USER_NAME: userName,
    CHANGE_TIME: formatEmailDate(),
    IP_ADDRESS: ipAddress,     // ← IP en clair
    DEVICE_INFO: deviceInfo,
    SECURE_ACCOUNT_LINK: `${process.env.FRONTEND_URL || 'https://qvarry.com'}/profil/security`,
},
```

**Impact :** Violation RGPD Art. 5(1)(c) — minimisation des données. Fuite d'infos techniques exploitables.

**Correction :** Anonymiser les IPs avant de les passer aux templates.

```typescript
// Ajouter dans src/utils/logUtils.ts (ou un nouveau fichier)
export function anonymizeIp(ip: string): string {
  if (!ip) return "Inconnue";
  if (ip.includes(":")) {
    // IPv6 : 2001:0db8:85a3::8a2e → 2001:0db8:***
    return ip.split(":").slice(0, 2).join(":") + ":***";
  }
  // IPv4 : 192.168.1.42 → 192.168.1.*
  const parts = ip.split(".");
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.${parts[2]}.*`;
  }
  return "Anonymisée";
}
```

Puis dans `emailService.ts`, remplacer toutes les occurrences de `IP_ADDRESS: ipAddress` par `IP_ADDRESS: anonymizeIp(ipAddress)`.

**Tests :** Envoyer un email de test et vérifier que l'IP est anonymisée dans le contenu reçu.

---

### [CRIT-06] RGPD — IP_HASH_SECRET défini mais jamais utilisé (IPs chiffrées au lieu de hashées dans audit)

- **Sévérité** : CRITIQUE
- **Axe** : Conformité RGPD
- **Fichiers** : `src/services/auditService.ts` lignes 31-38, 63 ; `.env.example` ligne 40

**Problème :** Le `.env.example` définit `IP_HASH_SECRET` (ligne 40) pour le hachage RGPD des IPs. Mais dans `auditService.ts`, les IPs sont CHIFFRÉES (réversibles) avec `encrypt()` au lieu d'être HASHÉES (irréversibles). Le chiffrement permet de retrouver l'IP originale, ce qui est non-conforme RGPD Art. 32.

Code actuel :

```typescript
// auditService.ts lignes 31-38
private encryptIfPresent(value: string | undefined): string | undefined {
    if (!value) return undefined;
    try {
        return encrypt(value);  // ← Chiffrement réversible !
    } catch (error) {
        console.error('[AUDIT] Erreur de chiffrement:', error);
        return undefined;
    }
}

// auditService.ts ligne 63
const encryptedIp = this.encryptIfPresent(options.ipAddress);  // ← Devrait être hashé
```

**Impact :** Non-conformité RGPD sur la pseudonymisation. Les IPs stockées en base peuvent être retrouvées.

**Correction :** Ajouter une méthode de hachage pour les IPs dans les logs d'audit.

```typescript
// Ajouter dans auditService.ts, après la méthode encryptIfPresent (vers ligne 39)

/**
 * Hasher une IP de manière irréversible pour conformité RGPD
 */
private hashIpAddress(ip: string | undefined): string | undefined {
    if (!ip) return undefined;
    const secret = process.env.IP_HASH_SECRET;
    if (!secret) {
        console.warn('[AUDIT] IP_HASH_SECRET non défini, IP non enregistrée');
        return undefined;
    }
    try {
        const crypto = require('crypto');
        return crypto.createHmac('sha256', secret).update(ip).digest('hex').substring(0, 16);
    } catch (error) {
        console.error('[AUDIT] Erreur de hachage IP:', error);
        return undefined;
    }
}

// Modifier la ligne 63 : remplacer
const encryptedIp = this.encryptIfPresent(options.ipAddress);
// par
const encryptedIp = this.hashIpAddress(options.ipAddress);
```

Ajouter `IP_HASH_SECRET` dans le `.env` de développement (générer avec `openssl rand -hex 32`).

**Tests :** Vérifier que les IPs dans la collection `auditlogs` sont bien des hash de 16 caractères hex et non des chaînes déchiffrables.

---

### [CRIT-07] RGPD — Droit à l'oubli incomplet (TTL commenté sur deletedData)

- **Sévérité** : CRITIQUE
- **Axe** : Conformité RGPD
- **Fichier** : `src/models/deletedData.ts`
- **Lignes** : 118-120

**Problème :** Le TTL index qui purge automatiquement les données supprimées est commenté. Les données s'accumulent indéfiniment.

Code actuel :

```typescript
// Lignes 118-120
// TTL index optionnel - garder les données supprimées pendant 2 ans (730 jours)
// Commenté par défaut, décommenter si vous souhaitez une purge automatique
// deletedDataSchema.index({ deletedAt: 1 }, { expireAfterSeconds: 730 * 24 * 60 * 60 });
```

**Impact :** Violation RGPD Art. 17 (droit à l'oubli) et Art. 5(1)(e) (limitation de la conservation). Les données personnelles supprimées restent en base indéfiniment.

**Correction :** Décommenter et réduire à 90 jours (raisonnable pour un backup de récupération).

```typescript
// Remplacer les lignes 118-120 par :
// TTL index — purge automatique des données supprimées après 90 jours (conformité RGPD)
deletedDataSchema.index(
  { deletedAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 },
);
```

**ATTENTION :** Si cet index n'existait pas avant, MongoDB le créera automatiquement au prochain démarrage de l'application. Les données existantes de plus de 90 jours seront progressivement supprimées par le TTL background task de MongoDB.

**Tests :** Vérifier avec `db.deleteddatas.getIndexes()` que l'index TTL est actif.

---

### [CRIT-08] Memory Leak — connectionAttempts Map sans limite dans WebSocket

- **Sévérité** : CRITIQUE
- **Axe** : Performances / Sécurité
- **Fichier** : `src/services/webSocketService.ts`
- **Lignes** : 44, 56, 72, 89

**Problème :** La Map `connectionAttempts` accumule les IPs sans limite de taille. Le nettoyage (ligne 94-103) ne se fait que toutes les heures. Une attaque DDoS peut remplir la mémoire entre deux nettoyages.

Code actuel :

```typescript
// Ligne 44
const connectionAttempts = new Map<string, ConnectionAttempt>();

// Ligne 56 — ajoute des entrées sans vérifier la taille
connectionAttempts.set(ip, { count: 1, firstAttempt: now });

// Ligne 72
connectionAttempts.set(ip, { count: 1, firstAttempt: now });

// Ligne 89
connectionAttempts.set(ip, attempt);
```

**Impact :** 100 000 IPs uniques en 1 heure = ~50 MB de RAM consommée, sans limite.

**Correction :** Ajouter une limite de taille et un nettoyage proactif.

```typescript
// Ajouter après la ligne 46 (après BLOCK_DURATION_MS)
const MAX_TRACKED_IPS = 10000;

// Modifier la fonction canConnect (ligne 51) — ajouter au début :
function canConnect(ip: string): { allowed: boolean; reason?: string } {
    const now = new Date();

    // Protection mémoire : limiter le nombre d'IPs trackées
    if (connectionAttempts.size >= MAX_TRACKED_IPS && !connectionAttempts.has(ip)) {
        // Purger les entrées les plus anciennes non bloquées
        for (const [trackedIp, attempt] of connectionAttempts.entries()) {
            if (!attempt.blockedUntil || attempt.blockedUntil < now) {
                connectionAttempts.delete(trackedIp);
            }
            if (connectionAttempts.size < MAX_TRACKED_IPS * 0.8) break;
        }
    }

    // ... reste de la fonction existante ...
```

**Tests :** Simuler 15 000 connexions d'IPs uniques et vérifier que la Map ne dépasse pas 10 000 entrées.

---

### [CRIT-09] Triple système de sessions conflictuel

- **Sévérité** : CRITIQUE
- **Axe** : Architecture
- **Fichiers** :
  - `src/services/redisSessionService.ts` (564 lignes) — sessions Redis persistantes
  - `src/services/sessionService.ts` (262 lignes) — sessions mémoire avec timeout
  - `src/services/memoryStorageService.ts` (955 lignes) — cache données déchiffrées

**Problème :** 3 systèmes de sessions coexistent, mal synchronisés :

1. `redisSessionService` : persiste dans Redis, source de vérité pour les tokens
2. `sessionService` : sessions in-memory avec LRU (max 10 000), indépendant de Redis
3. `memoryStorageService` : cache des données déchiffrées, timeout 30 min

Le middleware `authMiddleware` vérifie des sessions dans un système, tandis que `mobileAuthMiddleware` en vérifie un autre. Désynchronisation possible.

**Impact :** Sessions inconsistantes entre web et mobile. Un utilisateur peut être déconnecté d'un système mais pas de l'autre.

**Correction :** Unifier en un seul `SessionManager` qui utilise Redis comme source de vérité unique. Le `memoryStorageService` doit rester un CACHE uniquement (pas une source de vérité pour l'authentification). Supprimer `sessionService.ts` et migrer sa logique vers `redisSessionService`.

Plan de migration :

1. Identifier tous les imports de `sessionService` : `grep -rn "sessionService" src/`
2. Remplacer par des appels à `redisSessionService`
3. Supprimer `src/services/sessionService.ts`
4. Clarifier le rôle de `memoryStorageService` = CACHE de données déchiffrées uniquement

**Tests :** Vérifier que login/logout/refresh fonctionnent sur web ET mobile après la migration.

---

### [CRIT-10] Code deprecated non nettoyé — blacklistedTokens et loginAttempts en mémoire

- **Sévérité** : CRITIQUE
- **Axe** : Sécurité / Architecture
- **Fichier** : `src/controllers/authControllers.ts`
- **Lignes** : 46-49 (blacklistedTokens), 76-85 (loginAttempts)

**Problème :** `blacklistedTokens` (Set mémoire, ligne 48) est exporté et utilisé par `mobileAuthMiddleware.ts` (ligne 12). Ce Set perd toutes les données au redémarrage → des tokens révoqués redeviennent valides. De plus, `loginAttempts` (Map mémoire, ligne 85) est marqué DEPRECATED mais toujours instancié.

Code actuel :

```typescript
// Ligne 48 — DEPRECATED mais toujours exporté et utilisé
export const blacklistedTokens: Set<string> = new Set();
const blacklistedTokensDetails: Map<string, BlacklistedToken> = new Map();

// Lignes 76-85 — DEPRECATED mais toujours instancié
// DEPRECATED: loginAttempts en mémoire - maintenant géré par redisSessionService
interface LoginAttempt {
  email: string;
  attempts: number;
  lastAttempt: Date;
  blockedUntil?: Date;
}
// DEPRECATED: Utilisé uniquement pour le nettoyage de l'ancien système
const loginAttempts: Map<string, LoginAttempt> = new Map();
```

Et dans `mobileAuthMiddleware.ts` ligne 12 :

```typescript
import { blacklistedTokens } from "../controllers/authControllers";
```

**Impact :**

- `blacklistedTokens` en mémoire = tokens révoqués perdus au redémarrage
- Import circulaire controller ← middleware = anti-pattern
- `loginAttempts` deprecated consomme de la mémoire pour rien

**Correction :**

**Étape 1** — Dans `authControllers.ts` : supprimer l'export de `blacklistedTokens`. Modifier `isTokenBlacklisted` pour n'utiliser que Redis :

```typescript
// Remplacer les lignes 48-59 par :
// Token blacklist : uniquement via Redis
async function isTokenBlacklisted(token: string): Promise<boolean> {
  return await redisSessionService.isTokenBlacklisted(token);
}
```

**Étape 2** — Supprimer les lignes 78-85 (loginAttempts deprecated).

**Étape 3** — Dans `mobileAuthMiddleware.ts` : supprimer la ligne 12 (`import { blacklistedTokens } ...`) et remplacer par un appel direct à `redisSessionService.isTokenBlacklisted(token)`.

**Étape 4** — Dans `authMiddleware.ts` : même modification, remplacer les vérifications `blacklistedTokens.has(token)` par `await redisSessionService.isTokenBlacklisted(token)`.

**Tests :** Blacklister un token, redémarrer le serveur, vérifier que le token est toujours rejeté.

---

## PARTIE 2 — CORRECTIONS HAUTE PRIORITE (Semaine 2-3)

---

### [HIGH-01] Absence de .lean() sur toutes les queries de lecture

- **Sévérité** : HAUTE
- **Axe** : Performances
- **Fichiers** : Tous les services et controllers qui font des `find()`, `findOne()`, `findById()`

**Problème :** Les queries Mongoose retournent des documents hydratés (avec méthodes `.save()`, `.validate()`, etc.) même quand on ne fait que lire les données. Cela consomme 75% de RAM en plus et est 3-5× plus lent.

**Correction :** Ajouter `.lean()` à toutes les queries qui ne nécessitent pas de modification du document.

Fichiers à modifier (exemples principaux) :

- `src/services/userServices.ts` ligne 282 : `UserModel.find({})` → `UserModel.find({}).lean()`
- `src/services/userServices.ts` ligne 301 : `UserModel.findById(userId)` → `UserModel.findById(userId).lean()`
- `src/services/fichesServices.ts` : toutes les queries `find()` et `findOne()`
- `src/services/notificationService.ts` : toutes les queries
- `src/services/auditService.ts` : toutes les queries de lecture
- Tous les controllers faisant des queries directes

**ATTENTION :** Ne PAS ajouter `.lean()` aux queries suivies d'un `.save()` ou `.updateOne()` sur le même document.

**Tests :** Vérifier que les endpoints retournent les mêmes données qu'avant. Mesurer la différence de temps de réponse.

---

### [HIGH-02] Boucles séquentielles await dans dataShareService

- **Sévérité** : HAUTE
- **Axe** : Performances
- **Fichier** : `src/services/dataShareService.ts`
- **Lignes** : 113-194

**Problème :** Boucles avec opérations RSA séquentielles. Partage vers 10 destinataires = 10 × 500ms = 5 secondes.

**Correction :** Remplacer les boucles `for...of` avec `await` par `Promise.all()`.

```typescript
// AVANT (schéma simplifié du pattern répété)
for (const receiver of receivers) {
  const encryptedData = await encryptForReceiver(receiver, data);
  await saveShare(encryptedData);
}

// APRÈS
await Promise.all(
  receivers.map(async (receiver) => {
    const encryptedData = await encryptForReceiver(receiver, data);
    await saveShare(encryptedData);
  }),
);
```

Appliquer ce pattern à toutes les boucles séquentielles dans `dataShareService.ts`.

**Tests :** Partager des données avec 5 destinataires et mesurer le temps (devrait passer de ~2.5s à ~500ms).

---

### [HIGH-03] N+1 Query — Récupération du dernier message par conversation

- **Sévérité** : HAUTE
- **Axe** : Performances
- **Fichier** : `src/controllers/conversationsControllers.ts`
- **Lignes** : ~327-349 (zone de `listConversations`)

**Problème :** Pour chaque conversation, une query individuelle est faite pour récupérer le dernier message et compter les messages non lus. 50 conversations = 100 queries.

**Correction :** Utiliser une agrégation MongoDB pour récupérer tous les derniers messages en une seule query.

```typescript
// Récupérer les derniers messages de toutes les conversations en 1 query
const conversationIds = conversations.map((c) => c._id);

const lastMessages = await MessageModel.aggregate([
  { $match: { conversationId: { $in: conversationIds } } },
  { $sort: { createdAt: -1 } },
  {
    $group: {
      _id: "$conversationId",
      lastMessage: { $first: "$$ROOT" },
      unreadCount: {
        $sum: {
          $cond: [{ $not: { $in: [userId, "$readBy"] } }, 1, 0],
        },
      },
    },
  },
]);

// Mapper les résultats
const messageMap = new Map(lastMessages.map((m) => [m._id.toString(), m]));
```

**Tests :** Vérifier que `listConversations` retourne les mêmes données et mesurer le temps (devrait passer de ~2s à ~200ms pour 50 conversations).

---

### [HIGH-04] Créer responseUtils.ts — Éliminer 280+ duplications de réponses HTTP

- **Sévérité** : HAUTE
- **Axe** : Qualité / Maintenabilité
- **Fichiers** : Tous les 18 controllers

**Problème :** 123 × `res.status(401).json(...)` et 158 × `res.status(500).json(...)` avec 5 messages différents pour "non authentifié". Incohérence et duplication massive.

**Correction :** Créer `src/utils/responseUtils.ts` :

```typescript
import { Response } from "express";

export function sendSuccess(res: Response, data: any, status: number = 200) {
  return res.status(status).json(data);
}

export function sendError(
  res: Response,
  status: number,
  message: string,
  code?: string,
) {
  return res.status(status).json({
    error: message,
    code: code || `ERROR_${status}`,
  });
}

export function sendUnauthorized(
  res: Response,
  message: string = "Non authentifié",
) {
  return sendError(res, 401, message, "UNAUTHORIZED");
}

export function sendForbidden(res: Response, message: string = "Accès refusé") {
  return sendError(res, 403, message, "FORBIDDEN");
}

export function sendNotFound(
  res: Response,
  message: string = "Ressource non trouvée",
) {
  return sendError(res, 404, message, "NOT_FOUND");
}

export function sendBadRequest(
  res: Response,
  message: string = "Requête invalide",
) {
  return sendError(res, 400, message, "BAD_REQUEST");
}

export function sendServerError(
  res: Response,
  message: string = "Erreur interne du serveur",
) {
  return sendError(res, 500, message, "INTERNAL_ERROR");
}
```

Puis progressivement remplacer dans les controllers :

```typescript
// AVANT
if (!userId)
  return res.status(401).json({ error: "Utilisateur non authentifié" });

// APRÈS
if (!userId) return sendUnauthorized(res);
```

**Tests :** Les réponses HTTP doivent être identiques côté client (format JSON peut légèrement changer, vérifier l'intégration frontend).

---

### [HIGH-05] Swagger potentiellement exposable en production

- **Sévérité** : HAUTE
- **Axe** : Sécurité
- **Fichier** : `src/server.ts`
- **Lignes** : 372-375

**Problème :** Protection Swagger basée uniquement sur `NODE_ENV !== 'production'`. Si `NODE_ENV` est mal configuré, la documentation API est publiquement accessible.

Code actuel :

```typescript
if (NODE_ENV !== "production") {
  const { setupSwagger } = await import("./config/swagger");
  setupSwagger(app);
}
```

**Correction :** Ajouter une double condition :

```typescript
if (NODE_ENV !== "production" && process.env.ENABLE_SWAGGER === "true") {
  const { setupSwagger } = await import("./config/swagger");
  setupSwagger(app);
  console.log("[SWAGGER] Documentation API activée");
}
```

Et ajouter `ENABLE_SWAGGER=true` dans le `.env` de développement uniquement.

**Tests :** Démarrer en production et vérifier que `/api-docs` retourne 404.

---

### [HIGH-06] Absence de compression gzip

- **Sévérité** : HAUTE
- **Axe** : Performances
- **Fichier** : `src/server.ts`

**Problème :** Aucun middleware de compression n'est utilisé. Les réponses JSON sont envoyées non compressées.

**Correction :**

```bash
npm install compression
npm install -D @types/compression
```

Dans `server.ts`, ajouter après les imports :

```typescript
import compression from "compression";
```

Et dans la configuration des middlewares (vers les premières lignes de la config Express) :

```typescript
app.use(compression());
```

**Impact :** Réduction de 60-80% de la bande passante sur les réponses JSON.

**Tests :** Vérifier que les headers de réponse contiennent `Content-Encoding: gzip`.

---

### [HIGH-07] Déchiffrement séquentiel dans adminControllers.listUsers

- **Sévérité** : HAUTE
- **Axe** : Performances
- **Fichier** : `src/controllers/adminControllers.ts`
- **Lignes** : ~352-367

**Problème :** Déchiffrement de `name`, `surname`, `pseudo`, `email` pour chaque utilisateur en boucle séquentielle.

**Correction :** Paralléliser le déchiffrement :

```typescript
// AVANT (schéma simplifié)
const decryptedUsers = [];
for (const user of users) {
  decryptedUsers.push({
    ...user,
    name: decrypt(user.name),
    email: decrypt(user.email),
  });
}

// APRÈS
const decryptedUsers = await Promise.all(
  users.map(async (user) => ({
    ...user,
    name: safeDecrypt(user.name),
    email: safeDecrypt(user.email),
    surname: safeDecrypt(user.surname),
    pseudo: user.pseudo ? safeDecrypt(user.pseudo) : undefined,
  })),
);
```

Où `safeDecrypt` est un wrapper qui retourne la valeur originale en cas d'erreur de déchiffrement (déjà implémenté dans certains endroits du code).

**Tests :** Tester avec 100+ utilisateurs et mesurer la différence de temps.

---

### [HIGH-08] Stats admin recalculées à chaque requête sans cache

- **Sévérité** : HAUTE
- **Axe** : Performances
- **Fichier** : `src/controllers/adminControllers.ts`
- **Lignes** : ~70-179

**Problème :** Le dashboard admin exécute 20+ queries MongoDB à chaque chargement, sans aucun cache.

**Correction :** Ajouter un cache en mémoire avec TTL de 5 minutes :

```typescript
// En haut du fichier adminControllers.ts
let statsCache: { data: any; timestamp: number } | null = null;
const STATS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Dans la fonction getStats
export async function handleGetStats(req: Request, res: Response) {
  if (statsCache && Date.now() - statsCache.timestamp < STATS_CACHE_TTL) {
    return res.json(statsCache.data);
  }

  // ... calcul des stats existant ...

  statsCache = { data: stats, timestamp: Date.now() };
  return res.json(stats);
}
```

**Tests :** Appeler l'endpoint stats 2 fois en moins de 5 minutes. La 2e fois doit être < 10ms.

---

### [HIGH-09] Cookie SECURE forceable à false en production

- **Sévérité** : HAUTE
- **Axe** : Sécurité
- **Fichier** : `src/config/cookieConfig.ts`
- **Lignes** : 17-19

**Problème :** `COOKIE_SECURE` peut être forcé à `'false'` via env même en production, transmettant les cookies JWT en clair sur HTTP.

Code actuel :

```typescript
// Lignes 17-19
const COOKIE_SECURE =
  process.env.COOKIE_SECURE !== undefined
    ? process.env.COOKIE_SECURE === "true"
    : isProduction;
```

**Correction :** Forcer `secure: true` en production peu importe l'env :

```typescript
// Remplacer les lignes 17-19 par :
const COOKIE_SECURE = isProduction
  ? true
  : process.env.COOKIE_SECURE === "true";
```

**Tests :** Démarrer avec `NODE_ENV=production COOKIE_SECURE=false` et vérifier que le cookie a quand même `secure: true`.

---

## PARTIE 3 — CORRECTIONS MOYENNE PRIORITE (Mois 2)

---

### [MED-01] Incohérence de nommage des fichiers

- **Sévérité** : MOYENNE
- **Axe** : Qualité
- **Fichiers** :
  - `src/controllers/syncController.ts` → renommer en `syncControllers.ts` (cohérence avec les 17 autres controllers en pluriel)
  - `src/services/fichesServices.ts` → renommer en `ficheService.ts` (cohérence avec les 12 autres services en singulier)
  - `src/services/pointServices.ts` → renommer en `pointService.ts`
  - `src/services/userServices.ts` → renommer en `userService.ts`

**Correction :** Renommer les fichiers et mettre à jour tous les imports correspondants.

---

### [MED-02] Route dupliquée dans pointsRoutes

- **Sévérité** : MOYENNE
- **Axe** : Qualité / Code mort
- **Fichier** : `src/routes/pointsRoutes.ts`
- **Lignes** : 140-141

**Problème :** Deux routes GET pointent vers le même handler.

Code actuel :

```typescript
router.get("/", authMiddleware, handleGetAllPointsByUserId);
router.get("/user", authMiddleware, handleGetAllPointsByUserId); // ← Doublon
```

**Correction :** Supprimer la ligne 141 (`router.get("/user", ...)`).

---

### [MED-03] compareFingerprints exportée mais jamais utilisée

- **Sévérité** : MOYENNE
- **Axe** : Code mort
- **Fichier** : `src/utils/deviceFingerprint.ts`
- **Ligne** : 57

**Problème :** Fonction exportée mais jamais importée nulle part.

**Correction :** Soit supprimer la fonction, soit l'utiliser dans le processus d'authentification pour comparer le fingerprint du device avec celui stocké en session (ce qui améliorerait la sécurité).

---

### [MED-04] Cron jobs sans mécanisme de locking

- **Sévérité** : MOYENNE
- **Axe** : Architecture
- **Fichier** : `src/services/cronJobs.ts`

**Problème :** Si un cron job prend plus de 24h, il chevauche le suivant.

**Correction :** Ajouter un flag `isRunning` par job :

```typescript
let isCleanupRunning = false;

cron.schedule("0 3 * * *", async () => {
  if (isCleanupRunning) {
    console.log("[CRON] Cleanup déjà en cours, skip");
    return;
  }
  isCleanupRunning = true;
  try {
    await cleanupExpiredDataShares();
  } catch (error) {
    console.error("[CRON] Erreur cleanup:", error);
  } finally {
    isCleanupRunning = false;
  }
});
```

---

### [MED-05] Absence de timeout sur les queries MongoDB

- **Sévérité** : MOYENNE
- **Axe** : Performances
- **Fichiers** : Tous les controllers et services (sauf `fichesServices.ts` qui a déjà `.maxTimeMS()`)

**Correction :** Ajouter `.maxTimeMS(5000)` sur toutes les queries importantes pour éviter les queries infinies.

---

### [MED-06] Refactorer authControllers.ts (1810 lignes)

- **Sévérité** : MOYENNE
- **Axe** : Architecture
- **Fichier** : `src/controllers/authControllers.ts`

**Problème :** Fichier de 1810 lignes contenant login, register, 2FA, password reset, email verification, refresh token, logout.

**Correction :** Découper en modules :

```
src/controllers/auth/
├── loginController.ts       → handleLoginUser, handleRefreshToken
├── registerController.ts    → handleRegisterUser, handleVerifyEmail
├── passwordController.ts    → handleForgotPassword, handleResetPassword
├── logoutController.ts      → handleLogout, handleLogoutAllDevices
└── index.ts                 → Ré-exporte tout
```

---

### [MED-07] Implémenter asyncHandler pour réduire les try/catch

- **Sévérité** : MOYENNE
- **Axe** : Qualité
- **Fichiers** : Tous les controllers (180+ try/catch identiques)

**Correction :** Créer `src/utils/asyncHandler.ts` :

```typescript
import { Request, Response, NextFunction } from "express";

export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>,
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
```

Usage :

```typescript
// AVANT
export async function handleGetPoints(req: Request, res: Response) {
  try {
    // ... logique
  } catch (error) {
    console.error("Erreur:", error);
    res.status(500).json({ error: "Erreur interne" });
  }
}

// APRÈS
export const handleGetPoints = asyncHandler(
  async (req: Request, res: Response) => {
    // ... logique (les erreurs sont catchées automatiquement par le global error handler)
  },
);
```

---

### [MED-08] speakeasy n'est plus maintenu

- **Sévérité** : MOYENNE
- **Axe** : Sécurité / Dépendances
- **Fichier** : `package.json` (ligne 70)

**Problème :** Le package `speakeasy` (dernière release 2017) n'est plus maintenu et peut contenir des vulnérabilités non corrigées.

**Correction :** Migrer vers `otpauth` (activement maintenu) :

```bash
npm uninstall speakeasy @types/speakeasy
npm install otpauth
```

Mettre à jour les imports et l'API dans les fichiers utilisant `speakeasy` (controllers 2FA).

---

### [MED-09] Biais dans la génération de codes de vérification

- **Sévérité** : MOYENNE
- **Axe** : Sécurité
- **Fichier** : `src/services/emailService.ts`
- **Lignes** : 310-317

**Problème :** `byte % 10` introduit un biais : les chiffres 0-5 ont 0.4% plus de chance d'apparaître que 6-9 (car 256 n'est pas divisible par 10).

Code actuel :

```typescript
return Array.from(randomBytes as Buffer)
  .map((byte: number) => (byte % 10).toString())
  .join("");
```

**Correction :** Utiliser la technique du rejet :

```typescript
export const generateVerificationCode = (length: number = 6): string => {
  const crypto = require("crypto");
  const result: string[] = [];
  while (result.length < length) {
    const byte = crypto.randomBytes(1)[0];
    if (byte < 250) {
      // 250 est le plus grand multiple de 10 <= 255
      result.push((byte % 10).toString());
    }
  }
  return result.join("");
};
```

---

## PARTIE 4 — AMELIORATIONS BASSE PRIORITE (Trimestre)

---

### [LOW-01] Logger structuré (remplacer console.log)

Remplacer tous les `console.log/warn/error` par un logger structuré (`winston` ou `pino`) avec niveaux, timestamps, et format JSON pour faciliter le monitoring.

---

### [LOW-02] Versioning API

Ajouter un préfixe `/api/v1/` à toutes les routes pour faciliter l'évolution future sans casser les clients existants.

---

### [LOW-03] Monitoring et métriques

Ajouter un middleware de métriques (temps de réponse, throughput) et exposer un endpoint `/metrics` pour Prometheus.

---

### [LOW-04] Pool MongoDB trop petit pour la production

- **Fichier** : `src/config/database.ts` ligne 35
- `maxPoolSize: 10` → augmenter à 50 pour production
- `minPoolSize: 2` → augmenter à 10 pour production

---

### [LOW-05] Headers de cache HTTP manquants

Aucun header `Cache-Control` sur les réponses. Ajouter `Cache-Control: private, max-age=300` sur les endpoints de lecture pour réduire les requêtes redondantes.

---

### [LOW-06] Export audit logs sans streaming

- **Fichier** : `src/controllers/adminControllers.ts` ~ligne 1091
- Charger tous les logs en mémoire avant export → utiliser un cursor MongoDB et streamer la réponse.

---

### [LOW-07] npm audit — 28 vulnérabilités

```
28 vulnerabilities (9 moderate, 19 high)
```

Principalement dans les dépendances transitives `@aws-sdk` (via MongoDB driver). Exécuter `npm audit fix` et mettre à jour le driver MongoDB.

---

## PARTIE 5 — POINTS POSITIFS (ne pas toucher)

Ces éléments sont bien implémentés et ne doivent PAS être modifiés :

### Sécurité

- **Chiffrement AES-256-GCM** avec IV aléatoires pour les données utilisateurs (`masterEncryptionUtils.ts`)
- **RSA-4096** pour le chiffrement asymétrique de partage de données (`rsaEncryptionUtils.ts`)
- **JWT avec rotation de clés** — `jwtKeyManager.ts` supporte le key versioning (`kv` claim)
- **Mots de passe** : bcrypt, 12 chars minimum, complexité, historique des 5 derniers (`passwordUtils.ts`)
- **2FA/TOTP** complet avec codes de récupération chiffrés
- **Rate limiting** granulaire (15 limiteurs différents) avec `rateLimitConfig.ts`
- **Helmet** bien configuré avec CSP, HSTS, Permissions Policy
- **Cloudflare Turnstile** anti-bot sur endpoints critiques
- **Device fingerprinting** pour détection de vol de token
- **Alertes sécurité** automatisées avec scoring de menace et blocage IP
- **WebSocket** : authentification par token, rate limiting connexions/messages, validation d'origine
- **.env jamais committé** dans l'historique git
- `.gitignore` complet et bien structuré

### Architecture

- Structure MVC claire et cohérente
- TypeScript en mode strict
- Dockerfile multi-stage avec obfuscation et user non-root
- Graceful shutdown handlers dans `server.ts`
- Health check endpoint pour Docker/K8s
- Masquage des credentials dans les logs de connexion DB (`database.ts` ligne 9)

### Base de données

- Aucun modèle mort — les 15 modèles sont tous utilisés
- Index TTL sur `refreshTokens` et `auditLogs` (90 jours)
- Index composés sur `notifications`, `dataShare`, `blockedIps`
- `retryWrites: true` et `w: 'majority'` pour la cohérence

### RGPD

- Champs de consentement explicite (Art. 7) dans le modèle User
- Soft delete avec archivage (`dataArchiveService`, `deletedData`)
- Suppression cascade complète dans `userServices.ts`

---

## ANNEXES

### A. Liste complète des fichiers source (91 fichiers)

```
src/server.ts
src/config/database.ts
src/config/cookieConfig.ts
src/config/rateLimitConfig.ts
src/config/swagger.ts
src/controllers/authControllers.ts
src/controllers/adminControllers.ts
src/controllers/userControllers.ts
src/controllers/fichesControllers.ts
src/controllers/pointsControllers.ts
src/controllers/messagesControllers.ts
src/controllers/conversationsControllers.ts
src/controllers/contactControllers.ts
src/controllers/listsControllers.ts
src/controllers/notificationsControllers.ts
src/controllers/securityControllers.ts
src/controllers/twoFactorControllers.ts
src/controllers/sessionControllers.ts
src/controllers/dataShareControllers.ts
src/controllers/syncController.ts
src/controllers/mobileAuthControllers.ts
src/controllers/mobileTwoFactorControllers.ts
src/controllers/mobileSyncControllers.ts
src/middlewares/authMiddleware.ts
src/middlewares/adminMiddleware.ts
src/middlewares/mobileAuthMiddleware.ts
src/middlewares/mobileSecurityMiddleware.ts
src/middlewares/rateLimitMiddleware.ts
src/middlewares/turnstileMiddleware.ts
src/middlewares/maintenanceMiddleware.ts
src/middlewares/console-interceptor.ts
src/models/users.ts
src/models/fiches.ts
src/models/points.ts
src/models/conversations.ts
src/models/messages.ts
src/models/contacts.ts
src/models/lists.ts
src/models/notifications.ts
src/models/refreshTokens.ts
src/models/auditLogs.ts
src/models/blockedIps.ts
src/models/dataShare.ts
src/models/keys.ts
src/models/maintenance.ts
src/models/deletedData.ts
src/services/memoryStorageService.ts
src/services/sessionService.ts
src/services/redisSessionService.ts
src/services/refreshTokenService.ts
src/services/userServices.ts
src/services/fichesServices.ts
src/services/pointServices.ts
src/services/emailService.ts
src/services/notificationService.ts
src/services/auditService.ts
src/services/securityAlertService.ts
src/services/cronJobs.ts
src/services/syncService.ts
src/services/mobileSyncService.ts
src/services/dataShareService.ts
src/services/dataArchiveService.ts
src/services/validationService.ts
src/services/webSocketService.ts
src/utils/errorUtils.ts
src/utils/masterEncryptionUtils.ts
src/utils/communicationEncryptionUtils.ts
src/utils/userEncryptionUtils.ts
src/utils/rsaEncryptionUtils.ts
src/utils/passwordUtils.ts
src/utils/jwtKeyManager.ts
src/utils/deviceFingerprint.ts
src/utils/emailUtils.ts
src/routes/authRoutes.ts
src/routes/adminRoutes.ts
src/routes/userRoutes.ts
src/routes/fichesRoutes.ts
src/routes/pointsRoutes.ts
src/routes/messagesRoutes.ts
src/routes/conversationsRoutes.ts
src/routes/contactRoutes.ts
src/routes/listsRoutes.ts
src/routes/notificationsRoutes.ts
src/routes/securityRoutes.ts
src/routes/twoFactorRoutes.ts
src/routes/dataShareRoutes.ts
src/routes/maintenanceRoutes.ts
src/routes/mobileAuthRoutes.ts
src/routes/mobileTwoFactorRoutes.ts
src/routes/mobileSyncRoutes.ts
src/types/express.d.ts
src/templates/ (templates email HTML)
```

### B. Dépendances et vulnérabilités

```
28 vulnerabilities (9 moderate, 19 high)
Principalement : @aws-sdk (transitif via mongodb driver)
Commande : npm audit fix
```

Dépendance obsolète : `speakeasy` (dernière release 2017) → migrer vers `otpauth`

### C. Checklist de vérification post-correction

```
[ ] CRIT-01 : Maps limitées dans memoryStorageService (tester avec 6000+ items)
[ ] CRIT-02 : getUserByEmail utilise emailHash (tester login avec 1000+ users)
[ ] CRIT-03 : Tous les index créés (vérifier avec db.collection.getIndexes())
[ ] CRIT-04 : Aucun email en clair dans les logs (grep console.*email src/)
[ ] CRIT-05 : IPs anonymisées dans les emails (envoyer un email de test)
[ ] CRIT-06 : IPs hashées dans auditLogs (vérifier en DB)
[ ] CRIT-07 : TTL activé sur deletedData (vérifier l'index)
[ ] CRIT-08 : connectionAttempts limité à 10000 (stress test WebSocket)
[ ] CRIT-09 : Session unifiée (tester login/logout web + mobile)
[ ] CRIT-10 : blacklistedTokens supprimé de mémoire (tester blacklist + restart)
[ ] HIGH-01 : .lean() ajouté (comparer temps de réponse avant/après)
[ ] HIGH-02 : dataShareService parallélisé (tester partage multi-destinataires)
[ ] HIGH-03 : N+1 conversations corrigé (tester avec 50+ conversations)
[ ] HIGH-04 : responseUtils.ts créé et utilisé (vérifier format réponses API)
[ ] HIGH-05 : Swagger non accessible en production
[ ] HIGH-06 : Compression gzip active (vérifier Content-Encoding header)
[ ] HIGH-07 : Déchiffrement admin parallélisé (tester avec 100+ users)
[ ] HIGH-08 : Cache stats admin fonctionnel (2 appels < 5 min)
[ ] HIGH-09 : Cookie secure forcé en production
[ ] npm audit : 0 high vulnerabilities
[ ] Build : npm run build sans erreur
[ ] Type-check : npm run type-check sans erreur
[ ] Tests : npm test (si existants) passent
```

---

**Fin de l'audit — 18 février 2026**
