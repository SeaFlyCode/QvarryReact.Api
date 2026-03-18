# Authentification à deux facteurs (2FA)

## Vue d'ensemble

L'API Qvarry implémente le **TOTP** (Time-based One-Time Password) selon la RFC 6238, via la bibliothèque `otpauth`. Le secret TOTP est chiffré en AES-256-GCM avant stockage en base de données.

---

## Flow 2FA — Web

```
Navigateur                          API Qvarry                    Redis
    │                                   │                            │
    │  POST /auth/login                 │                            │
    │  { email, password, turnstile }   │                            │
    │ ─────────────────────────────────>│                            │
    │                                   │  Vérif credentials OK      │
    │                                   │  Vérif 2FA activé → OUI   │
    │                                   │  Génération tempToken      │
    │                                   │  (durée : ~5 min)          │
    │                                   │  Stockage tempToken ───────>
    │                                   │  Redis (TTL court)         │
    │  401 {                            │                            │
    │    require2FA: true,              │                            │
    │    tempToken: "<jwt_court>"       │                            │
    │  }                                │                            │
    │ <─────────────────────────────────│                            │
    │                                   │                            │
    │  [Saisie code TOTP par l'user]    │                            │
    │                                   │                            │
    │  POST /auth/complete-2fa-login    │                            │
    │  { tempToken, code: "123456" }    │                            │
    │ ─────────────────────────────────>│                            │
    │                                   │  Vérif tempToken Redis ───>│
    │                                   │  Vérif code TOTP           │
    │                                   │  (déchiffrement secret AES)│
    │                                   │  Invalide tempToken ───────>
    │                                   │  Génération access token   │
    │                                   │  Génération refresh token  │
    │                                   │  Stockage session ─────────>
    │  200 Set-Cookie: qvarry_jwt       │                            │
    │  { user, accessToken }            │                            │
    │ <─────────────────────────────────│                            │
```

⚠️ Le `tempToken` est à usage unique. Il est invalidé immédiatement après vérification, qu'elle réussisse ou échoue (après épuisement des tentatives).

---

## Flow 2FA — Mobile

```
Client mobile                        API Qvarry                    Redis
    │                                   │                            │
    │  POST /mobile/auth/login          │                            │
    │  { email, password, deviceId }    │                            │
    │ ─────────────────────────────────>│                            │
    │                                   │  Vérif credentials OK      │
    │                                   │  Vérif 2FA activé → OUI   │
    │  401 {                            │                            │
    │    require2FA: true,              │                            │
    │    tempToken: "<jwt_court>"       │                            │
    │  }                                │                            │
    │ <─────────────────────────────────│                            │
    │                                   │                            │
    │  POST /mobile/2fa/verify          │                            │
    │  Authorization: Bearer <tempToken>│                            │
    │  { code: "123456" }               │                            │
    │ ─────────────────────────────────>│                            │
    │                                   │  Vérif tempToken           │
    │                                   │  Vérif code TOTP           │
    │                                   │  Génération access token   │
    │                                   │  Génération refresh token  │
    │                                   │  Stockage session Redis ───>
    │  200 {                            │                            │
    │    accessToken,                   │                            │
    │    refreshToken,                  │                            │
    │    user                           │                            │
    │  }                                │                            │
    │ <─────────────────────────────────│                            │
```

---

## Setup 2FA — Activation

### Étape 1 : Initiation (`POST /api/v1/2fa/enable` ou `/mobile/2fa/enable`)

```
Requête :
  POST /api/v1/2fa/enable
  Authorization: Cookie qvarry_jwt (web) / Bearer (mobile)

Réponse :
{
  "secret": "<base32_secret>",
  "otpauthUrl": "otpauth://totp/Qvarry:user@example.com?secret=XXXXX&issuer=Qvarry",
  "qrCodeDataUrl": "data:image/png;base64,..."
}
```

- Un secret TOTP temporaire est généré (`otpauth.Secret.generate()`)
- Le QR Code est généré via la bibliothèque `qrcode`
- Le secret n'est **pas encore** stocké en base (en attente de confirmation)

### Étape 2 : Confirmation (`POST /api/v1/2fa/confirm` ou `/mobile/2fa/confirm`)

```
Requête :
{
  "code": "123456",
  "secret": "<base32_secret>"
}

Réponse (succès) :
{
  "success": true,
  "recoveryCodes": [
    "ABCD-EFGH-IJKL",
    "MNOP-QRST-UVWX",
    ...
  ]
}
```

- Vérification du code TOTP avec le secret fourni
- Si valide : chiffrement du secret en AES-256-GCM et stockage en base
- Génération de 10 codes de récupération
- Les codes de récupération sont hashés (bcrypt) avant stockage
- Les codes en clair sont retournés **une seule fois** — ils ne peuvent pas être régénérés sans désactiver la 2FA

⚠️ Les codes de récupération ne sont affichés qu'une seule fois. L'utilisateur doit les sauvegarder immédiatement.

### Étape 3 : Désactivation (`POST /api/v1/2fa/disable` ou `/mobile/2fa/disable`)

```
Requête :
{
  "code": "123456"
}
```

- Vérification du code TOTP actuel avant désactivation
- Suppression du secret chiffré et des codes de récupération en base

---

## Codes de récupération

- Nombre : 10 codes générés à l'activation
- Format : `XXXX-XXXX-XXXX` (alphanumérique)
- Stockage : hashés individuellement en bcrypt (rounds = 12)
- Usage : un code utilisé est immédiatement marqué comme consommé (usage unique)
- Régénération : possible via `POST /api/v1/2fa/recovery-codes/regenerate` (nécessite code TOTP valide)

```
POST /api/v1/2fa/recovery-codes/use
{
  "recoveryCode": "ABCD-EFGH-IJKL"
}

→ Vérifie le code contre les hashes en base
→ Invalide le code utilisé
→ Connecte l'utilisateur (génération access + refresh token)
```

---

## Stockage sécurisé du secret TOTP

Le secret TOTP est un secret à long terme. Il est chiffré avant toute écriture en base de données.

### Format de stockage

```
Champ en base : twoFactorSecret (string)
Format        : <iv_hex>:<authTag_hex>:<encrypted_hex>

Exemple       : a1b2c3d4e5f6....:f1e2d3c4....:9a8b7c6d....
```

### Algorithme

```
Chiffrement :
  Algorithme : AES-256-GCM
  Clé        : ENCRYPTION_KEY_MASTER (32 bytes, 64 hex chars)
  IV         : aléatoire, 12 bytes, généré à chaque chiffrement
  AuthTag    : 16 bytes (garantie d'intégrité AEAD)

Déchiffrement :
  Lecture des 3 composants séparés par ":"
  Reconstruction du décipher AES-256-GCM
  Vérification de l'authTag (toute altération est détectée)
```

⚠️ Si `ENCRYPTION_KEY_MASTER` est perdu ou altéré, tous les secrets 2FA deviennent irrécupérables. Cette clé doit être sauvegardée dans un gestionnaire de secrets (Vault, AWS Secrets Manager, etc.).

---

## Rate Limiting anti brute-force

| Limiter            | Routes concernées       | Limite     | Fenêtre   |
| ------------------ | ----------------------- | ---------- | --------- |
| `twoFactorLimiter` | `/2fa/*`, `/mobile/2fa` | 5 requêtes | 5 minutes |

- En production : 5 tentatives par IP sur 5 minutes
- En développement : 50 tentatives (multiplicateur x10)
- Réponse en cas de dépassement : `HTTP 429 Too Many Requests`
- Header `Retry-After` inclus dans la réponse

⚠️ Le rate limiting 2FA est par IP. Un attaquant disposant de nombreuses IP différentes peut contourner ce mécanisme. Le verrouillage par compte (après N échecs) est recommandé en complément.

---

## Routes 2FA — Récapitulatif

### Web

| Méthode | Route                                   | Description                      | Auth requise |
| ------- | --------------------------------------- | -------------------------------- | ------------ |
| `POST`  | `/api/v1/2fa/enable`                    | Initier l'activation 2FA         | Oui          |
| `POST`  | `/api/v1/2fa/confirm`                   | Confirmer avec code TOTP         | Oui          |
| `POST`  | `/api/v1/2fa/disable`                   | Désactiver la 2FA                | Oui          |
| `POST`  | `/api/v1/auth/complete-2fa-login`       | Finaliser login avec code TOTP   | Temp token   |
| `POST`  | `/api/v1/2fa/recovery-codes/use`        | Utiliser un code de récupération | Non          |
| `POST`  | `/api/v1/2fa/recovery-codes/regenerate` | Régénérer les codes              | Oui + TOTP   |

### Mobile

| Méthode | Route                        | Description                 | Auth requise |
| ------- | ---------------------------- | --------------------------- | ------------ |
| `POST`  | `/api/v1/mobile/2fa/enable`  | Initier l'activation 2FA    | Oui          |
| `POST`  | `/api/v1/mobile/2fa/confirm` | Confirmer avec code TOTP    | Oui          |
| `POST`  | `/api/v1/mobile/2fa/verify`  | Vérifier code pendant login | Temp token   |
| `POST`  | `/api/v1/mobile/2fa/disable` | Désactiver la 2FA           | Oui          |
