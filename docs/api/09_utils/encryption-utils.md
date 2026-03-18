# Utilitaires de chiffrement

Ce document couvre les quatre modules de chiffrement du projet. Tous utilisent AES-256-GCM (AEAD) pour le chiffrement symétrique et RSA-4096 pour le chiffrement asymétrique.

## Vue d'ensemble

| Module        | Fichier                           | Usage                                | Clé                                                           |
| ------------- | --------------------------------- | ------------------------------------ | ------------------------------------------------------------- |
| Master        | `masterEncryptionUtils.ts`        | Chiffrement des clés en BDD          | `ENCRYPTION_KEY_MASTER` (env)                                 |
| Communication | `communicationEncryptionUtils.ts` | Chiffrement des messages             | `ENCRYPTION_KEY_COMMUNICATION` (env)                          |
| RSA           | `rsaEncryptionUtils.ts`           | Chiffrement des données partagées    | Clés RSA-4096 par utilisateur                                 |
| User          | `userEncryptionUtils.ts`          | Chiffrement des données personnelles | Clé AES par utilisateur (stockée en BDD, chiffrée par master) |

---

## masterEncryptionUtils

Chiffrement AES-256-GCM utilisant `ENCRYPTION_KEY_MASTER`. Sert à chiffrer les clés des autres modules stockées en BDD (clés utilisateurs, clés RSA privées).

**Format de sortie** : `iv:authTag:encrypted` (hex séparé par `:`).

### Fonctions

```typescript
export function encrypt(text: string): string;
```

Chiffre un texte en clair. Génère un IV de 12 bytes aléatoires. Retourne `iv:authTag:encrypted`.

```typescript
export function decrypt(text: string): string;
```

Déchiffre une chaîne au format `iv:authTag:encrypted`. Lève une exception si les données ont été modifiées (vérification du tag GCM). Lève une exception si le format est invalide.

```typescript
export function hashEmail(email: string): string;
```

Hash HMAC-SHA256 d'un email (normalisé en minuscule + trim) avec `EMAIL_HMAC_KEY`. Utilisé pour le lookup d'email en BDD sans stocker l'email en clair. Protection contre les rainbow tables.

> ⚠️ Changer `EMAIL_HMAC_KEY` invalide **tous** les hash d'emails existants en BDD.

### Variables d'environnement

| Variable                | Format                  | Description                      |
| ----------------------- | ----------------------- | -------------------------------- |
| `ENCRYPTION_KEY_MASTER` | Hex 64 chars (32 bytes) | Clé maître AES-256               |
| `EMAIL_HMAC_KEY`        | Chaîne arbitraire       | Clé secrète pour HMAC des emails |

---

## communicationEncryptionUtils

Chiffrement AES-256-GCM utilisant `ENCRYPTION_KEY_COMMUNICATION`. Sert à chiffrer les contenus de messages et de conversations.

**Format de sortie** : `iv:authTag:encrypted` (hex séparé par `:`).

### Fonctions

```typescript
export function encrypt(text: string): string;
```

Identique à `masterEncryptionUtils.encrypt`, avec `ENCRYPTION_KEY_COMMUNICATION`.

```typescript
export function decrypt(text: string): string;
```

Déchiffre au format `iv:authTag:encrypted`. Lève une exception si le format est invalide (doit avoir exactement 3 parties) ou si la vérification d'intégrité GCM échoue.

### Variable d'environnement

| Variable                       | Format                  | Description                    |
| ------------------------------ | ----------------------- | ------------------------------ |
| `ENCRYPTION_KEY_COMMUNICATION` | Hex 64 chars (32 bytes) | Clé AES-256 des communications |

---

## rsaEncryptionUtils

Chiffrement RSA-4096 + hybride AES-256-GCM. Utilisé par `DataShare` pour chiffrer les données partagées individuellement pour chaque destinataire.

### Fonctions

```typescript
export function generateRSAKeyPair(): { publicKey: string; privateKey: string };
```

Génère une paire RSA-4096 au format PEM (SPKI pour la publique, PKCS8 pour la privée).

```typescript
export function encryptPrivateKey(privateKey: string): string;
export function decryptPrivateKey(encryptedPrivateKey: string): string;
```

Wrapper autour de `masterEncryptionUtils` pour stocker la clé privée RSA chiffrée en BDD.

```typescript
export function encryptWithPublicKey(data: string, publicKey: string): string;
```

**Chiffrement hybride** :

1. Génère une clé AES-256 aléatoire
2. Chiffre les données avec AES-256-GCM
3. Chiffre la clé AES avec RSA-OAEP-SHA256

Format de sortie : `encryptedAESKey:iv:authTag:encryptedData` (4 parties en hex).

```typescript
export function decryptWithPrivateKey(
  encryptedData: string,
  privateKey: string,
): string;
```

Inverse de `encryptWithPublicKey`. Déchiffre la clé AES avec la clé privée RSA, puis déchiffre les données.

```typescript
export function createDataHash(data: string): string;
```

Hash SHA-256 d'une chaîne. Retourne l'hex. Utilisé pour `DataShare.dataHash`.

```typescript
export function signData(data: string, privateKey: string): string;
```

Signature RSA-SHA256 avec horodatage anti-replay. Format : `signature:timestamp` (hex:ms Unix). La signature couvre `data|timestamp`.

```typescript
export function verifySignature(
  data: string,
  signatureWithTimestamp: string,
  publicKey: string,
  maxAgeMs?: number, // défaut: 5 minutes
): boolean;
```

Vérifie la signature et la fraîcheur du timestamp. Rejette les signatures expirées (> `maxAgeMs`) ou dans le futur (tolérance 30s). Protection anti-replay.

```typescript
export function isValidPublicKey(publicKey: string): boolean;
export function isValidPrivateKey(privateKey: string): boolean;
```

Valide qu'une clé PEM est RSA et d'au moins 4096 bits. Effectue un test fonctionnel (chiffrement/signature) pour confirmer l'utilisabilité.

### Padding RSA

Tous les chiffrements RSA utilisent `RSA_PKCS1_OAEP_PADDING` avec hash `sha256`.

---

## userEncryptionUtils

Chiffrement AES-256-GCM avec des clés **par utilisateur** stockées en BDD (chiffrées avec `masterEncryptionUtils`). Utilisé pour les données personnelles des utilisateurs (fiches, listes, profil).

### Cache des clés

Les clés déchiffrées sont mises en cache en mémoire avec un TTL de **15 minutes** (CRYPT-009 : limiter l'exposition en mémoire). Un `setInterval` toutes les 5 minutes nettoie les entrées expirées.

```typescript
// TTL : 15 min
const CACHE_TTL_MS = 15 * 60 * 1000;
```

### Fonctions

```typescript
export function encryptWithKey(text: string, userKey: string): string;
export function decryptWithKey(text: string, userKey: string): string;
```

Chiffrement/déchiffrement AES-256-GCM avec une clé fournie directement (hex 64 chars). Format `iv:authTag:encrypted`. Ces fonctions sont **synchrones** et n'accèdent pas à la BDD.

```typescript
export async function encryptUserKeys(
  userId: IUser["_id"],
  text: string,
): Promise<string>;
export async function decryptUserKeys(
  userId: IUser["_id"],
  text: string,
): Promise<string>;
```

Versions asynchrones qui récupèrent automatiquement la clé AES de l'utilisateur depuis la BDD (ou le cache). La clé est stockée dans `KeysModel` avec `type: "user"`, chiffrée par `masterEncryptionUtils`.

```typescript
export function clearUserKeyCache(userId: string): void;
```

Supprime la clé déchiffrée du cache. À appeler lors du logout pour éviter qu'une clé reste en mémoire après déconnexion.

### Chargement de la clé utilisateur

```
1. Vérifier le cache (Map<userId, { key, expiresAt }>)
2. Si miss ou expiré → KeysModel.findOne({ userId, type: "user" })
3. Vérifier que la clé n'est pas une clé RSA (ne contient pas "-----BEGIN")
4. Déchiffrer avec masterEncryptionUtils.decrypt()
5. Mettre en cache (TTL 15 min)
```

> ⚠️ Si la clé récupérée est une clé RSA PEM (contient `-----BEGIN`), une exception est levée — protection contre une confusion de type de clé.
