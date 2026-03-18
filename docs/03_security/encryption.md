# Chiffrement

## Vue d'ensemble

L'API Qvarry utilise plusieurs mécanismes cryptographiques selon la nature des données à protéger :

| Mécanisme   | Usage                                       | Bibliothèque             |
| ----------- | ------------------------------------------- | ------------------------ |
| AES-256-GCM | Données sensibles utilisateurs, secrets 2FA | Node.js `crypto` (natif) |
| AES-256-GCM | Messages et conversations                   | Node.js `crypto` (natif) |
| RSA         | Échanges de clés asymétriques               | Node.js `crypto` (natif) |
| bcrypt      | Hash des mots de passe                      | `bcrypt`                 |
| HMAC-SHA256 | Hash des emails                             | Node.js `crypto` (natif) |

---

## AES-256-GCM — Données sensibles utilisateurs

### Description de l'algorithme

**AES-256-GCM** (Advanced Encryption Standard, 256 bits, Galois/Counter Mode) est un algorithme de chiffrement authentifié (AEAD — Authenticated Encryption with Associated Data).

Propriétés :

- **Confidentialité** : les données sont chiffrées et illisibles sans la clé
- **Intégrité** : l'`authTag` (tag d'authentification) détecte toute altération des données chiffrées
- **Authenticité** : garantit que les données proviennent d'une source possédant la clé

### Format de sortie

Les données chiffrées sont stockées dans un format concaténé en hexadécimal :

```
<iv_hex>:<authTag_hex>:<encrypted_hex>

Exemple :
a1b2c3d4e5f67890abcd1234:f1e2d3c4b5a6978869504132:9a8b7c6d5e4f3021...

Composants :
  IV         : 12 bytes  → 24 caractères hexadécimaux
  AuthTag    : 16 bytes  → 32 caractères hexadécimaux
  Encrypted  : variable  → dépend de la taille des données
```

### Implémentation

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// Chiffrement
function encrypt(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex"); // 32 bytes depuis 64 hex chars
  const iv = randomBytes(12); // IV aléatoire, 12 bytes

  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag(); // 16 bytes

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

// Déchiffrement
function decrypt(encryptedData: string, keyHex: string): string {
  const [ivHex, authTagHex, encryptedHex] = encryptedData.split(":");

  const key = Buffer.from(keyHex, "hex");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag); // Vérification d'intégrité

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8",
  );
}
```

⚠️ Un IV **différent** doit être généré pour **chaque opération de chiffrement**. La réutilisation d'un IV avec la même clé compromet la sécurité de l'ensemble des données chiffrées avec ce IV.

### Données chiffrées avec `ENCRYPTION_KEY_MASTER`

- Secrets TOTP (2FA)
- Données personnelles sensibles des utilisateurs (selon le modèle User)
- Tokens de récupération de compte

### Génération de la clé

```bash
# Génère une clé AES-256 (32 bytes = 256 bits) en hexadécimal
openssl rand -hex 32

# Exemple de sortie :
# a3f8c2e1d4b7906f5e2a1c8d3b6e9f0a4c7d2b5e8f1a6c9d0e3b7f2a5c8e1d4
```

---

## AES-256-GCM — Communications (Messages & Conversations)

Identique à la section précédente, mais utilisant une **clé dédiée** séparée.

### Séparation des clés

La séparation des clés de chiffrement respecte le principe de **moindre privilège cryptographique** : une compromission de la clé communication n'expose pas les données personnelles utilisateurs, et vice-versa.

| Clé               | Variable                       | Usage                             |
| ----------------- | ------------------------------ | --------------------------------- |
| Clé principale    | `ENCRYPTION_KEY_MASTER`        | Données personnelles, secrets 2FA |
| Clé communication | `ENCRYPTION_KEY_COMMUNICATION` | Messages, conversations           |

---

## RSA — Chiffrement asymétrique

RSA est utilisé pour les **échanges de clés** entre clients, permettant un chiffrement de bout en bout pour certaines fonctionnalités.

### Principe

```
Génération côté client :
  - Paire de clés RSA générée par le client (clé publique + clé privée)
  - Clé publique envoyée et stockée sur le serveur
  - Clé privée jamais envoyée au serveur

Échange de clé symétrique :
  - L'expéditeur chiffre une clé symétrique avec la clé publique du destinataire
  - Seul le destinataire (possesseur de la clé privée) peut déchiffrer la clé symétrique
  - La clé symétrique déchiffrée permet de lire les messages
```

### Génération d'une paire de clés RSA

```bash
# Clé privée RSA 4096 bits
openssl genrsa -out private.pem 4096

# Clé publique correspondante
openssl rsa -in private.pem -pubout -out public.pem
```

---

## bcrypt — Hash des mots de passe

### Configuration

```typescript
const BCRYPT_ROUNDS = 12;

// Hash
const hashedPassword = await bcrypt.hash(plainPassword, BCRYPT_ROUNDS);

// Vérification
const isValid = await bcrypt.compare(plainPassword, hashedPassword);
```

### Choix du nombre de rounds

| Rounds | Temps approximatif (CPU moderne) | Recommandation                  |
| ------ | -------------------------------- | ------------------------------- |
| 10     | ~100ms                           | Minimum acceptable              |
| 12     | ~400ms                           | Recommandé (utilisé par Qvarry) |
| 14     | ~1.5s                            | Pour données très sensibles     |

Le coût bcrypt est **intentionnellement lent** pour rendre les attaques par force brute prohibitivement longues.

⚠️ Avec 12 rounds, un attaquant ne peut tester qu'environ 2-3 mots de passe par seconde par cœur de CPU. Une attaque sur un dictionnaire de 1 milliard de mots prendrait plusieurs années.

### Données hashées avec bcrypt

- Mots de passe utilisateurs
- Codes de récupération 2FA (chaque code individuellement)

---

## HMAC — Hash des emails

### Problème résolu

Stocker les emails en clair dans la base de données expose les utilisateurs aux fuites de données (rainbow tables, recherche par email).

Stocker un hash simple (SHA-256) est insuffisant car les emails ont un espace de valeurs limité et prévisible, rendant les rainbow tables efficaces.

### Solution : HMAC-SHA256

Le **HMAC** (Hash-based Message Authentication Code) utilise une clé secrète en plus des données à hasher. Sans la clé, il est impossible de calculer le hash d'un email donné, même en connaissant l'algorithme.

```typescript
import { createHmac } from "crypto";

function hashEmail(email: string): string {
  return createHmac("sha256", process.env.EMAIL_HMAC_KEY!)
    .update(email.toLowerCase().trim())
    .digest("hex");
}
```

### Utilisation

- Les emails sont normalisés (lowercase, trim) avant le hash pour garantir la cohérence
- Le hash HMAC est stocké dans un champ indexé `emailHash` de la collection User
- Les recherches par email utilisent le hash, jamais l'email en clair
- L'email en clair peut optionnellement être chiffré avec `ENCRYPTION_KEY_MASTER`

⚠️ `EMAIL_HMAC_KEY` doit être une chaîne aléatoire longue (minimum 32 bytes). Si cette clé est perdue, tous les hash d'emails existants sont inutilisables et une re-indexation complète est nécessaire.

### Génération de la clé HMAC

```bash
openssl rand -hex 32
```

---

## Récapitulatif des clés cryptographiques

| Variable                       | Longueur                | Algorithme  | Usage                                       |
| ------------------------------ | ----------------------- | ----------- | ------------------------------------------- |
| `ENCRYPTION_KEY_MASTER`        | 64 hex chars (32 bytes) | AES-256-GCM | Données sensibles utilisateurs, secrets 2FA |
| `ENCRYPTION_KEY_COMMUNICATION` | 64 hex chars (32 bytes) | AES-256-GCM | Messages, conversations                     |
| `EMAIL_HMAC_KEY`               | 64 hex chars minimum    | HMAC-SHA256 | Hash des emails                             |
| `JWT_SECRET`                   | 64 hex chars recommandé | HS256       | Signature JWT (version 1)                   |
| `JWT_SECRET_V2` ... `V10`      | 64 hex chars recommandé | HS256       | Rotation clés JWT                           |

### Script de génération de toutes les clés

```bash
echo "ENCRYPTION_KEY_MASTER=$(openssl rand -hex 32)"
echo "ENCRYPTION_KEY_COMMUNICATION=$(openssl rand -hex 32)"
echo "EMAIL_HMAC_KEY=$(openssl rand -hex 32)"
echo "JWT_SECRET=$(openssl rand -hex 32)"
```

⚠️ Toutes ces clés doivent être :

1. Générées de façon cryptographiquement aléatoire (`openssl rand` ou équivalent)
2. Stockées dans un gestionnaire de secrets (Vault, AWS Secrets Manager, etc.)
3. Différentes les unes des autres
4. Jamais committées dans le code source
5. Jamais partagées via des canaux non chiffrés
