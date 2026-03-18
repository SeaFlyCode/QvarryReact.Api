# Routes d'authentification

**Préfixe** : `/api/v1/auth`

Ces routes gèrent l'authentification des utilisateurs via JWT stocké en cookie HTTP-only (web) ou Bearer token (mobile). Aucune authentification préalable n'est requise sauf mention contraire.

---

## Sommaire

- [POST /auth/login](#post-authlogin)
- [POST /auth/logout](#post-authlogout)
- [POST /auth/refresh](#post-authrefresh)
- [GET /auth/check](#get-authcheck)
- [GET /auth/ws-token](#get-authws-token)
- [POST /auth/forgot-password](#post-authforgot-password)
- [POST /auth/reset-password](#post-authreset-password)
- [POST /auth/complete-2fa-login](#post-authcomplete-2fa-login)
- [POST /auth/sync](#post-authsync)
- [GET /auth/sync/refresh](#get-authsyncrefresh)

---

## Endpoints

### POST /api/v1/auth/login

**Description** : Authentifie un utilisateur par email et mot de passe. Si la 2FA est activée, retourne un `tempToken` à utiliser avec `/auth/complete-2fa-login`. En cas de succès complet, pose un cookie `accessToken` HTTP-only et un cookie `refreshToken` HTTP-only.

**Auth** : Non requise

**Rate Limit** : `loginLimiter`

**Middleware** : `verifyTurnstile` (validation Cloudflare Turnstile si `turnstileToken` fourni)

#### Corps de la requête

```json
{
  "email": "string (requis)",
  "password": "string (requis)",
  "turnstileToken": "string (optionnel)"
}
```

#### Réponses

- **200 — Connexion réussie**

```json
{
  "message": "Connexion réussie",
  "user": {
    "id": "string",
    "email": "string",
    "username": "string"
  }
}
```

- **200 — 2FA requis**

```json
{
  "requires2FA": true,
  "tempToken": "string (JWT court durée)"
}
```

- **400** : Champs manquants — `{ "error": "Email et mot de passe requis", "code": "MISSING_FIELDS" }`
- **401** : Identifiants invalides — `{ "error": "Identifiants incorrects", "code": "INVALID_CREDENTIALS" }`
- **403** : Compte non vérifié ou bloqué — `{ "error": "...", "code": "ACCOUNT_BLOCKED" | "EMAIL_NOT_VERIFIED" }`
- **429** : Rate limit dépassé — `{ "error": "Trop de tentatives", "code": "RATE_LIMIT", "retryAfter": 60 }`

---

### POST /api/v1/auth/logout

**Description** : Déconnecte l'utilisateur. Invalide les cookies `accessToken` et `refreshToken` côté serveur. L'opération réussit même si le token est invalide ou expiré.

**Auth** : Non requise (opération idempotente)

**Rate Limit** : Aucun

#### Réponses

- **200 — Déconnexion réussie**

```json
{
  "message": "Déconnexion réussie"
}
```

---

### POST /api/v1/auth/refresh

**Description** : Émet un nouvel `accessToken` à partir du `refreshToken` stocké dans le cookie HTTP-only. Implémente la rotation des refresh tokens.

**Auth** : Non requise (utilise le cookie `refreshToken`)

**Rate Limit** : Aucun

#### Réponses

- **200 — Token rafraîchi**

```json
{
  "message": "Token rafraîchi"
}
```

_Un nouveau cookie `accessToken` est posé automatiquement._

- **401** : Refresh token manquant ou invalide — `{ "error": "Refresh token invalide", "code": "INVALID_REFRESH_TOKEN" }`
- **403** : Refresh token révoqué — `{ "error": "Session expirée", "code": "SESSION_REVOKED" }`

---

### GET /api/v1/auth/check

**Description** : Vérifie si l'utilisateur est actuellement authentifié. Ne déclenche pas d'erreur si non authentifié — retourne simplement `authenticated: false`.

**Auth** : Non requise (tente de lire le cookie ou le Bearer token)

**Rate Limit** : Aucun

#### Réponses

- **200 — Authentifié**

```json
{
  "authenticated": true,
  "user": {
    "id": "string",
    "email": "string",
    "username": "string",
    "isAdmin": false
  }
}
```

- **200 — Non authentifié**

```json
{
  "authenticated": false,
  "user": null
}
```

---

### GET /api/v1/auth/ws-token

**Description** : Génère un token temporaire à courte durée de vie (usage unique) pour établir une connexion WebSocket. Ce token est passé en query string lors de l'ouverture du WebSocket.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Réponses

- **200 — Token WebSocket généré**

```json
{
  "wsToken": "string (JWT éphémère, ~30s)"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`

---

### POST /api/v1/auth/forgot-password

**Description** : Initie la procédure de réinitialisation du mot de passe. Envoie un email contenant un lien avec un token de reset. Pour des raisons de sécurité, la réponse est identique que l'email existe ou non.

**Auth** : Non requise

**Rate Limit** : `forgotPasswordLimiter`

#### Corps de la requête

```json
{
  "email": "string (requis)"
}
```

#### Réponses

- **200 — Email envoyé (ou adresse inconnue — réponse identique)**

```json
{
  "message": "Si cet email existe, un lien de réinitialisation a été envoyé."
}
```

- **400** : Email manquant — `{ "error": "Email requis", "code": "MISSING_EMAIL" }`
- **429** : Rate limit — `{ "error": "Trop de demandes", "code": "RATE_LIMIT", "retryAfter": 300 }`

---

### POST /api/v1/auth/reset-password

**Description** : Réinitialise le mot de passe en utilisant le token reçu par email. Le token est à usage unique et a une durée de validité limitée (généralement 1 heure).

**Auth** : Non requise

**Rate Limit** : Aucun

#### Corps de la requête

```json
{
  "token": "string (requis — token reçu par email)",
  "newPassword": "string (requis — minimum 8 caractères)"
}
```

#### Réponses

- **200 — Mot de passe réinitialisé**

```json
{
  "message": "Mot de passe réinitialisé avec succès"
}
```

- **400** : Token ou mot de passe manquant / mot de passe trop faible — `{ "error": "...", "code": "MISSING_FIELDS" | "WEAK_PASSWORD" }`
- **400** : Token invalide ou expiré — `{ "error": "Token invalide ou expiré", "code": "INVALID_RESET_TOKEN" }`

---

### POST /api/v1/auth/complete-2fa-login

**Description** : Finalise la connexion lorsque la 2FA est activée. Nécessite le `tempToken` retourné par `/auth/login` et le code TOTP généré par l'application d'authentification.

**Auth** : Non requise (utilise le `tempToken`)

**Rate Limit** : `twoFALimiter`

#### Corps de la requête

```json
{
  "tempToken": "string (requis — retourné par /auth/login)",
  "totpCode": "string (requis — code à 6 chiffres)"
}
```

#### Réponses

- **200 — Connexion 2FA réussie**

```json
{
  "message": "Connexion réussie",
  "user": {
    "id": "string",
    "email": "string",
    "username": "string"
  }
}
```

_Les cookies `accessToken` et `refreshToken` sont posés._

- **400** : Champs manquants — `{ "error": "...", "code": "MISSING_FIELDS" }`
- **401** : Token temporaire invalide ou expiré — `{ "error": "Session 2FA expirée", "code": "INVALID_TEMP_TOKEN" }`
- **401** : Code TOTP incorrect — `{ "error": "Code invalide", "code": "INVALID_TOTP_CODE" }`
- **429** : Trop de tentatives — `{ "error": "...", "code": "RATE_LIMIT", "retryAfter": 60 }`

---

### POST /api/v1/auth/sync

**Description** : Déclenche une synchronisation manuelle des données de l'utilisateur (profil, contacts, conversations, etc.). Utile après une reconnexion ou une période hors-ligne.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : `syncLimiter`

#### Réponses

- **200 — Synchronisation effectuée**

```json
{
  "message": "Synchronisation réussie",
  "syncedAt": "2026-03-18T10:00:00.000Z"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **429** : Rate limit — `{ "error": "Synchronisation trop fréquente", "code": "RATE_LIMIT", "retryAfter": 30 }`

---

### GET /api/v1/auth/sync/refresh

**Description** : Effectue un refresh incrémental des données modifiées depuis la dernière synchronisation. Retourne uniquement les deltas pour minimiser la bande passante.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de requête (query)

| Paramètre | Type              | Obligatoire | Description                                    |
| --------- | ----------------- | ----------- | ---------------------------------------------- |
| `since`   | string (ISO 8601) | Non         | Date depuis laquelle récupérer les changements |

#### Réponses

- **200 — Delta retourné**

```json
{
  "updatedAt": "2026-03-18T10:00:00.000Z",
  "changes": {
    "profile": {},
    "contacts": [],
    "conversations": []
  }
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
