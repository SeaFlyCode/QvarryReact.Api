# Authentification Mobile — /api/v1/mobile/auth

## Table des matières

- [Vue d'ensemble](#vue-densemble)
- [POST /mobile/auth/login](#post-mobileauthlogin)
- [POST /mobile/auth/register](#post-mobileauthregister)
- [POST /mobile/auth/refresh](#post-mobileauthrefresh)
- [POST /mobile/auth/logout](#post-mobileauthlogout)
- [POST /mobile/auth/forgot-password](#post-mobileauthforgot-password)
- [POST /mobile/auth/verify-email](#post-mobileauthverify-email)
- [Codes d'erreur](#codes-derreur)

---

## Vue d'ensemble

Les routes d'authentification mobile utilisent un système de **Bearer token JWT** (contrairement aux routes web qui utilisent des cookies HTTP-only). Deux tokens sont émis :

- **`accessToken`** : courte durée de vie (~15 minutes), utilisé dans le header `Authorization`
- **`refreshToken`** : longue durée de vie, utilisé pour renouveler l'access token

> ⚠️ **Aucun Cloudflare Turnstile** n'est requis sur les routes mobiles. La sécurité anti-abus est assurée par `mobileSecurityMiddleware` et le rate limiting Redis.

### Headers obligatoires pour toutes les routes

```http
X-Platform: ios          (ou android)
X-Device-ID: <UUID v4>
X-App-Version: 2.1.0
Content-Type: application/json
```

### Rate limiting Auth mobile

| Environnement | Limite      | Fenêtre    | Blocage    |
| ------------- | ----------- | ---------- | ---------- |
| Production    | 5 requêtes  | 15 minutes | 30 minutes |
| Développement | 50 requêtes | 15 minutes | —          |

L'identificateur de rate limit est **composite** : `IP + X-Device-ID`.

---

## POST /mobile/auth/login

Authentifie un utilisateur et retourne un couple access/refresh token.

### Requête

```http
POST /api/v1/mobile/auth/login
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
X-App-Version: 2.1.0
Content-Type: application/json
```

```json
{
  "email": "user@example.com",
  "password": "motdepasse"
}
```

| Champ      | Type   | Requis | Description                    |
| ---------- | ------ | ------ | ------------------------------ |
| `email`    | string | ✅     | Adresse email de l'utilisateur |
| `password` | string | ✅     | Mot de passe                   |

### Réponse succès `200 OK`

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 900,
  "user": {
    "id": "64a1b2c3d4e5f6789012345",
    "email": "user@example.com",
    "firstName": "Jean",
    "lastName": "Dupont",
    "emailVerified": true
  }
}
```

### Réponses d'erreur

| HTTP  | Code erreur           | Description                           |
| ----- | --------------------- | ------------------------------------- |
| `400` | `VALIDATION_ERROR`    | Email ou mot de passe manquant        |
| `401` | `INVALID_CREDENTIALS` | Email ou mot de passe incorrect       |
| `403` | `EMAIL_NOT_VERIFIED`  | Email non vérifié                     |
| `403` | `ACCOUNT_SUSPENDED`   | Compte suspendu                       |
| `403` | `ACCOUNT_PENDING`     | Compte en attente de validation admin |
| `426` | `UPDATE_REQUIRED`     | Version de l'app obsolète             |
| `429` | `RATE_LIMIT_EXCEEDED` | Trop de tentatives                    |

---

## POST /mobile/auth/register

Inscrit un nouvel utilisateur depuis l'application mobile.

### Requête

```http
POST /api/v1/mobile/auth/register
X-Platform: android
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
X-App-Version: 2.1.0
Content-Type: application/json
```

```json
{
  "email": "nouveau@example.com",
  "password": "MotDePasse123!",
  "firstName": "Marie",
  "lastName": "Martin"
}
```

| Champ       | Type   | Requis | Description                     |
| ----------- | ------ | ------ | ------------------------------- |
| `email`     | string | ✅     | Adresse email                   |
| `password`  | string | ✅     | Mot de passe (min 8 caractères) |
| `firstName` | string | ✅     | Prénom                          |
| `lastName`  | string | ✅     | Nom                             |

### Réponse succès `201 Created`

```json
{
  "message": "Compte créé. Vérifiez votre email.",
  "userId": "64a1b2c3d4e5f6789012345"
}
```

Un email de vérification est automatiquement envoyé (template `email-verification.html`).

### Réponses d'erreur

| HTTP  | Code erreur            | Description               |
| ----- | ---------------------- | ------------------------- |
| `400` | `VALIDATION_ERROR`     | Données invalides         |
| `409` | `EMAIL_ALREADY_EXISTS` | Email déjà utilisé        |
| `426` | `UPDATE_REQUIRED`      | Version de l'app obsolète |
| `429` | `RATE_LIMIT_EXCEEDED`  | Trop de tentatives        |

---

## POST /mobile/auth/refresh

Renouvelle l'access token à partir du refresh token.

### Requête

```http
POST /api/v1/mobile/auth/refresh
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
X-App-Version: 2.1.0
Content-Type: application/json
```

```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

| Champ          | Type   | Requis | Description                      |
| -------------- | ------ | ------ | -------------------------------- |
| `refreshToken` | string | ✅     | Refresh token émis lors du login |

### Réponse succès `200 OK`

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 900
}
```

> ⚠️ Le refresh token est à **usage unique** (rotation). L'ancien est invalidé après usage et un nouveau est émis si la politique de rotation est activée.

### Réponses d'erreur

| HTTP  | Code erreur             | Description              |
| ----- | ----------------------- | ------------------------ |
| `400` | `VALIDATION_ERROR`      | Refresh token manquant   |
| `401` | `INVALID_REFRESH_TOKEN` | Token invalide ou expiré |
| `401` | `TOKEN_BLACKLISTED`     | Token révoqué            |

---

## POST /mobile/auth/logout

Déconnecte l'utilisateur en révoquant ses tokens.

### Requête

```http
POST /api/v1/mobile/auth/logout
Authorization: Bearer eyJhbGci...
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
X-App-Version: 2.1.0
Content-Type: application/json
```

```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

| Champ          | Type   | Requis | Description                           |
| -------------- | ------ | ------ | ------------------------------------- |
| `refreshToken` | string | ⬜     | Refresh token à révoquer (recommandé) |

### Réponse succès `200 OK`

```json
{
  "message": "Déconnexion réussie"
}
```

L'access token est ajouté à la **blacklist Redis** (invalidation immédiate). Le push token FCM associé à cet appareil est optionnellement supprimé.

---

## POST /mobile/auth/forgot-password

Envoie un email de réinitialisation de mot de passe.

### Requête

```http
POST /api/v1/mobile/auth/forgot-password
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
X-App-Version: 2.1.0
Content-Type: application/json
```

```json
{
  "email": "user@example.com"
}
```

| Champ   | Type   | Requis | Description             |
| ------- | ------ | ------ | ----------------------- |
| `email` | string | ✅     | Adresse email du compte |

### Réponse succès `200 OK`

```json
{
  "message": "Si cet email existe, un lien de réinitialisation a été envoyé."
}
```

> ⚠️ La réponse est **intentionnellement générique** pour éviter l'énumération d'emails. Un email utilisant le template `password-reset.html` est envoyé si l'adresse existe.

### Réponses d'erreur

| HTTP  | Code erreur           | Description                |
| ----- | --------------------- | -------------------------- |
| `400` | `VALIDATION_ERROR`    | Email manquant ou invalide |
| `429` | `RATE_LIMIT_EXCEEDED` | Trop de tentatives         |

---

## POST /mobile/auth/verify-email

Vérifie l'adresse email d'un utilisateur via le code reçu par email.

### Requête

```http
POST /api/v1/mobile/auth/verify-email
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
X-App-Version: 2.1.0
Content-Type: application/json
```

```json
{
  "token": "abc123def456",
  "email": "user@example.com"
}
```

| Champ   | Type   | Requis | Description                               |
| ------- | ------ | ------ | ----------------------------------------- |
| `token` | string | ✅     | Code/token de vérification reçu par email |
| `email` | string | ✅     | Email à vérifier                          |

### Réponse succès `200 OK`

```json
{
  "message": "Email vérifié avec succès",
  "accessToken": "eyJhbGci...",
  "refreshToken": "eyJhbGci...",
  "expiresIn": 900
}
```

Les tokens sont automatiquement émis après vérification pour éviter une étape de connexion supplémentaire.

### Réponses d'erreur

| HTTP  | Code erreur              | Description              |
| ----- | ------------------------ | ------------------------ |
| `400` | `VALIDATION_ERROR`       | Token ou email manquant  |
| `400` | `INVALID_TOKEN`          | Token invalide ou expiré |
| `409` | `EMAIL_ALREADY_VERIFIED` | Email déjà vérifié       |

---

## Codes d'erreur

Récapitulatif de tous les codes d'erreur possibles sur les routes d'auth mobile :

| Code                     | HTTP | Description                                         |
| ------------------------ | ---- | --------------------------------------------------- |
| `VALIDATION_ERROR`       | 400  | Données de requête invalides                        |
| `INVALID_PLATFORM`       | 400  | Header X-Platform manquant ou invalide              |
| `INVALID_DEVICE_ID`      | 400  | Header X-Device-ID manquant ou format UUID invalide |
| `INVALID_CREDENTIALS`    | 401  | Email ou mot de passe incorrect                     |
| `INVALID_REFRESH_TOKEN`  | 401  | Refresh token invalide ou expiré                    |
| `TOKEN_BLACKLISTED`      | 401  | Token révoqué                                       |
| `EMAIL_NOT_VERIFIED`     | 403  | Email non vérifié                                   |
| `ACCOUNT_SUSPENDED`      | 403  | Compte suspendu par un admin                        |
| `ACCOUNT_PENDING`        | 403  | Compte en attente de validation                     |
| `EMAIL_ALREADY_EXISTS`   | 409  | Adresse email déjà utilisée                         |
| `EMAIL_ALREADY_VERIFIED` | 409  | Email déjà vérifié                                  |
| `UPDATE_REQUIRED`        | 426  | Version de l'application trop ancienne              |
| `RATE_LIMIT_EXCEEDED`    | 429  | Trop de requêtes (rate limit atteint)               |

---

_Voir aussi : [two-factor.md](./two-factor.md) — [overview.md](./overview.md) — [security-middleware.md](./security-middleware.md)_
