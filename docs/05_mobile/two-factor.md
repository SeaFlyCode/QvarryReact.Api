# Double Authentification Mobile — /api/v1/mobile/2fa

## Table des matières

- [Vue d'ensemble](#vue-densemble)
- [POST /mobile/2fa/enable](#post-mobile2faenable)
- [POST /mobile/2fa/confirm](#post-mobile2faconfirm)
- [POST /mobile/2fa/verify](#post-mobile2faverify)
- [POST /mobile/2fa/disable](#post-mobile2fadisable)
- [Flux complet d'activation](#flux-complet-dactivation)

---

## Vue d'ensemble

La double authentification (2FA) utilise des codes **TOTP** (Time-based One-Time Password, RFC 6238) compatibles avec les applications comme Google Authenticator, Authy, ou l'application Qvarry elle-même.

> ⚠️ **Toutes les routes 2FA requièrent un Bearer token valide** (`Authorization: Bearer <token>`).

### Headers obligatoires

```http
Authorization: Bearer eyJhbGci...
X-Platform: ios          (ou android)
X-Device-ID: <UUID v4>
X-App-Version: 2.1.0
Content-Type: application/json
```

### Cycle de vie du 2FA

```
État initial : 2FA désactivé
        │
        ▼
POST /2fa/enable    ← Génère secret TOTP + QR code
        │
        ▼
POST /2fa/confirm   ← Vérifie le premier code TOTP (active définitivement)
        │
        ▼
État : 2FA activé
        │
  ┌─────┴─────┐
  │           │
  ▼           ▼
POST /2fa/verify   POST /2fa/disable
(à chaque login)   (désactivation)
```

---

## POST /mobile/2fa/enable

Lance le processus d'activation du 2FA. Génère un secret TOTP et retourne un QR code à scanner.

### Requête

```http
POST /api/v1/mobile/2fa/enable
Authorization: Bearer eyJhbGci...
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
X-App-Version: 2.1.0
Content-Type: application/json
```

Corps vide ou `{}`.

### Réponse succès `200 OK`

```json
{
  "secret": "JBSWY3DPEHPK3PXP",
  "qrCode": "data:image/png;base64,iVBORw0KGgoAAAANS...",
  "otpauthUrl": "otpauth://totp/Qvarry%3Auser%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Qvarry",
  "backupCodes": [
    "12345-67890",
    "abcde-fghij",
    "11111-22222",
    "33333-44444",
    "55555-66666",
    "77777-88888",
    "99999-00000",
    "aaaaa-bbbbb"
  ]
}
```

| Champ         | Description                                               |
| ------------- | --------------------------------------------------------- |
| `secret`      | Secret TOTP base32 (à stocker de façon sécurisée)         |
| `qrCode`      | Image QR code en base64 PNG à afficher                    |
| `otpauthUrl`  | URL `otpauth://` pour les applications compatibles        |
| `backupCodes` | Codes de secours à usage unique en cas de perte du device |

> ⚠️ Le 2FA n'est **pas encore actif** après cet appel. Il faut confirmer avec `/2fa/confirm`. Le secret est temporairement stocké en attente de confirmation.

> ⚠️ Les **codes de backup** doivent être affichés **une seule fois** à l'utilisateur et ne peuvent pas être récupérés ultérieurement.

### Réponses d'erreur

| HTTP  | Code erreur           | Description              |
| ----- | --------------------- | ------------------------ |
| `400` | `2FA_ALREADY_ENABLED` | Le 2FA est déjà activé   |
| `401` | `UNAUTHORIZED`        | Token invalide ou expiré |

---

## POST /mobile/2fa/confirm

Confirme l'activation du 2FA en vérifiant le premier code TOTP généré par l'application.

### Requête

```http
POST /api/v1/mobile/2fa/confirm
Authorization: Bearer eyJhbGci...
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
X-App-Version: 2.1.0
Content-Type: application/json
```

```json
{
  "code": "123456"
}
```

| Champ  | Type   | Requis | Description                                     |
| ------ | ------ | ------ | ----------------------------------------------- |
| `code` | string | ✅     | Code TOTP à 6 chiffres généré par l'application |

### Réponse succès `200 OK`

```json
{
  "message": "2FA activé avec succès",
  "enabled": true
}
```

Le 2FA est désormais **actif** sur le compte. Tous les prochains logins nécessiteront un code TOTP.

### Réponses d'erreur

| HTTP  | Code erreur               | Description                           |
| ----- | ------------------------- | ------------------------------------- |
| `400` | `INVALID_TOTP_CODE`       | Code TOTP incorrect                   |
| `400` | `2FA_SETUP_NOT_INITIATED` | `/2fa/enable` n'a pas été appelé      |
| `400` | `TOTP_CODE_EXPIRED`       | Code expiré (fenêtre de 30s dépassée) |
| `401` | `UNAUTHORIZED`            | Token invalide                        |

---

## POST /mobile/2fa/verify

Vérifie un code TOTP lors de la connexion (après un login réussi avec email/password, si 2FA est activé).

### Requête

```http
POST /api/v1/mobile/2fa/verify
Authorization: Bearer eyJhbGci...
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
X-App-Version: 2.1.0
Content-Type: application/json
```

```json
{
  "code": "789012"
}
```

| Champ  | Type   | Requis | Description                                                      |
| ------ | ------ | ------ | ---------------------------------------------------------------- |
| `code` | string | ✅     | Code TOTP à 6 chiffres, ou code de backup (format `xxxxx-xxxxx`) |

### Réponse succès `200 OK`

```json
{
  "verified": true,
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 900
}
```

Un **nouveau token JWT complet** (avec le claim `twoFactorVerified: true`) est émis après vérification.

### Flux avec 2FA activé

```
POST /auth/login (email + password)
        │
        ▼
Réponse 200 avec token temporaire :
{
  "requiresTwoFactor": true,
  "tempToken": "eyJ..." ← accès limité, 2FA non vérifié
}
        │
        ▼
POST /2fa/verify (avec code TOTP)
        │
        ▼
Réponse 200 avec token complet :
{
  "verified": true,
  "accessToken": "eyJ..." ← accès complet
}
```

### Réponses d'erreur

| HTTP  | Code erreur                | Description                        |
| ----- | -------------------------- | ---------------------------------- |
| `400` | `INVALID_TOTP_CODE`        | Code TOTP ou code backup incorrect |
| `400` | `BACKUP_CODE_ALREADY_USED` | Code de backup déjà utilisé        |
| `401` | `UNAUTHORIZED`             | Token invalide                     |
| `403` | `2FA_NOT_ENABLED`          | 2FA non activé sur ce compte       |
| `429` | `RATE_LIMIT_EXCEEDED`      | Trop de tentatives                 |

---

## POST /mobile/2fa/disable

Désactive le 2FA sur le compte. Nécessite une vérification par code TOTP pour confirmer.

### Requête

```http
POST /api/v1/mobile/2fa/disable
Authorization: Bearer eyJhbGci...
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
X-App-Version: 2.1.0
Content-Type: application/json
```

```json
{
  "code": "456789",
  "password": "MotDePasseActuel"
}
```

| Champ      | Type   | Requis | Description                                      |
| ---------- | ------ | ------ | ------------------------------------------------ |
| `code`     | string | ✅     | Code TOTP actuel pour confirmer la désactivation |
| `password` | string | ✅     | Mot de passe du compte (double confirmation)     |

### Réponse succès `200 OK`

```json
{
  "message": "2FA désactivé avec succès",
  "enabled": false
}
```

> ⚠️ La désactivation nécessite **à la fois** le code TOTP et le mot de passe pour prévenir les désactivations non autorisées.

Un email de notification (`security-alert-login.html`) est envoyé à l'utilisateur après désactivation.

### Réponses d'erreur

| HTTP  | Code erreur           | Description            |
| ----- | --------------------- | ---------------------- |
| `400` | `INVALID_TOTP_CODE`   | Code TOTP incorrect    |
| `401` | `INVALID_CREDENTIALS` | Mot de passe incorrect |
| `401` | `UNAUTHORIZED`        | Token invalide         |
| `403` | `2FA_NOT_ENABLED`     | 2FA non activé         |

---

## Flux complet d'activation

```
Utilisateur                App Mobile              API Qvarry
     │                         │                       │
     │── Paramètres > 2FA ────▶│                       │
     │                         │── POST /2fa/enable ──▶│
     │                         │                       │ Génère secret TOTP
     │                         │◀── {secret, qrCode} ──│
     │◀── Affiche QR code ─────│                       │
     │                         │                       │
     │── Scanne QR avec ───────│                       │
     │   Google Authenticator  │                       │
     │                         │                       │
     │── Saisit code TOTP ────▶│                       │
     │                         │── POST /2fa/confirm ─▶│
     │                         │   { code: "123456" }  │ Vérifie + active
     │                         │◀── { enabled: true } ─│
     │◀── 2FA activé ! ────────│                       │
     │   Sauvegarde codes ─────│                       │
     │   de backup             │                       │
```

---

_Voir aussi : [auth.md](./auth.md) — [overview.md](./overview.md)_
