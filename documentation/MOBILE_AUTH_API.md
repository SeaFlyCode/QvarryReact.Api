# API Mobile - Endpoints d'authentification

## Base URL

```
Production : https://api.qvarry.fr/api/mobile/auth
Développement : http://localhost:3000/api/mobile/auth
```

---

## Headers obligatoires (toutes les requêtes)

| Header | Type | Obligatoire | Format | Description |
|--------|------|-------------|--------|-------------|
| `Content-Type` | string | ✅ | `application/json` | Type de contenu |
| `X-Platform` | string | ✅ | `ios` \| `android` | Plateforme de l'appareil |
| `X-Device-ID` | string | ✅ | UUID (32-64 chars) | Identifiant unique de l'appareil |
| `X-App-Version` | string | ❌ | `1.0.0` | Version de l'application |
| `X-Device-Attestation` | string | ❌ | Base64 | Token d'attestation (sécurité renforcée) |

---

## 1. POST `/login` — Connexion

### Paramètres Body (JSON)

| Paramètre | Type | Obligatoire | Contraintes | Description |
|-----------|------|-------------|-------------|-------------|
| `email` | string | ✅ | Format email valide | Adresse email de l'utilisateur |
| `password` | string | ✅ | Min 8 caractères | Mot de passe |

### Exemple requête

```http
POST /api/mobile/auth/login
Content-Type: application/json
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000

{
  "email": "user@example.com",
  "password": "MonMotDePasse123!"
}
```

### Réponses

**✅ Succès (200)**
```json
{
  "success": true,
  "userId": "60d5ec49f1b2c72b8c8b4567",
  "email": "user@example.com",
  "isAdmin": false,
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "a1b2c3d4e5f6g7h8i9j0...",
  "tokenExpiresIn": 900,
  "refreshTokenExpiresIn": 172800
}
```

**🔐 2FA requis (200)**
```json
{
  "requiresTwoFactor": true,
  "userId": "60d5ec49f1b2c72b8c8b4567",
  "message": "Code 2FA requis",
  "code": "TWO_FACTOR_REQUIRED"
}
```

**❌ Erreurs possibles**

| HTTP | Code | Cause |
|------|------|-------|
| 400 | `MISSING_CREDENTIALS` | Email ou mot de passe manquant |
| 400 | `INVALID_EMAIL_FORMAT` | Format email invalide |
| 400 | `INVALID_PLATFORM` | Header X-Platform manquant/invalide |
| 400 | `INVALID_DEVICE_ID` | Header X-Device-ID manquant/invalide |
| 401 | `INVALID_CREDENTIALS` | Email ou mot de passe incorrect |
| 403 | `ACCOUNT_BLOCKED` | Compte suspendu |
| 403 | `EMAIL_NOT_VERIFIED` | Email non vérifié |
| 403 | `PENDING_VALIDATION` | Compte en attente validation admin |
| 403 | `ACCOUNT_REJECTED` | Compte refusé par admin |
| 403 | `DEVICE_BLOCKED` | Appareil bloqué |
| 429 | `TOO_MANY_ATTEMPTS` | Trop de tentatives (rate limit) |
| 503 | `MAINTENANCE_MODE` | Site en maintenance |

---

## 2. POST `/register` — Inscription

### Paramètres Body (JSON)

| Paramètre | Type | Obligatoire | Contraintes | Description |
|-----------|------|-------------|-------------|-------------|
| `name` | string | ✅ | 2-50 caractères | Prénom |
| `surname` | string | ✅ | 2-50 caractères | Nom de famille |
| `email` | string | ✅ | Format email valide | Adresse email |
| `password` | string | ✅ | Min 8 chars, 1 maj, 1 min, 1 chiffre | Mot de passe |

### Exemple requête

```http
POST /api/mobile/auth/register
Content-Type: application/json
X-Platform: android
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000

{
  "name": "Jean",
  "surname": "Dupont",
  "email": "jean.dupont@example.com",
  "password": "MonMotDePasse123!"
}
```

### Réponses

**✅ Succès (201)**
```json
{
  "success": true,
  "message": "Compte créé ! Vérifiez votre email.",
  "userId": "60d5ec49f1b2c72b8c8b4567",
  "contact_code": "@123456",
  "requiresEmailVerification": true
}
```

**❌ Erreurs possibles**

| HTTP | Code | Cause |
|------|------|-------|
| 400 | `MISSING_FIELDS` | Champs obligatoires manquants |
| 400 | `INVALID_EMAIL` | Email invalide ou domaine bloqué |
| 400 | `WEAK_PASSWORD` | Mot de passe trop faible |
| 400 | `INVALID_PLATFORM` | Header X-Platform manquant/invalide |
| 400 | `INVALID_DEVICE_ID` | Header X-Device-ID manquant/invalide |
| 429 | `RATE_LIMIT_EXCEEDED` | Trop de créations de compte |

---

## 3. POST `/forgot-password` — Mot de passe oublié

### Paramètres Body (JSON)

| Paramètre | Type | Obligatoire | Contraintes | Description |
|-----------|------|-------------|-------------|-------------|
| `email` | string | ✅ | Format email valide | Adresse email du compte |

### Exemple requête

```http
POST /api/mobile/auth/forgot-password
Content-Type: application/json
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000

{
  "email": "user@example.com"
}
```

### Réponses

**✅ Succès (200)** — Toujours 200 pour éviter l'énumération d'emails
```json
{
  "success": true,
  "message": "Si cet email est associé à un compte, un lien de réinitialisation sera envoyé."
}
```

**❌ Erreurs possibles**

| HTTP | Code | Cause |
|------|------|-------|
| 400 | `MISSING_EMAIL` | Email manquant |
| 400 | `INVALID_PLATFORM` | Header X-Platform manquant/invalide |
| 400 | `INVALID_DEVICE_ID` | Header X-Device-ID manquant/invalide |
| 429 | `RATE_LIMIT_EXCEEDED` | Trop de demandes |

---

## 4. POST `/refresh` — Rafraîchissement du token

### Paramètres Body (JSON)

| Paramètre | Type | Obligatoire | Contraintes | Description |
|-----------|------|-------------|-------------|-------------|
| `refreshToken` | string | ✅ | Token valide | Refresh token obtenu au login |

### Exemple requête

```http
POST /api/mobile/auth/refresh
Content-Type: application/json
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000

{
  "refreshToken": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6..."
}
```

### Réponses

**✅ Succès (200)**
```json
{
  "success": true,
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "x1y2z3a4b5c6d7e8f9g0...",
  "tokenExpiresIn": 900,
  "refreshTokenExpiresIn": 172800
}
```

**❌ Erreurs possibles**

| HTTP | Code | Cause |
|------|------|-------|
| 400 | `INVALID_PLATFORM` | Header X-Platform manquant/invalide |
| 400 | `INVALID_DEVICE_ID` | Header X-Device-ID manquant/invalide |
| 401 | `NO_REFRESH_TOKEN` | Refresh token manquant |
| 401 | `INVALID_REFRESH_TOKEN` | Token invalide ou expiré |
| 401 | `TOKEN_THEFT_DETECTED` | Activité suspecte détectée |

---

## Rate Limiting

| Endpoint | Max requêtes | Fenêtre | Durée blocage |
|----------|-------------|---------|---------------|
| `/login` | 5 | 15 min | 30 min |
| `/register` | 5 | 15 min | 30 min |
| `/forgot-password` | 5 | 15 min | 30 min |
| `/refresh` | 20 | 5 min | 10 min |

---

## Champs de réponse — Référence

### Réponse Login/Refresh

| Champ | Type | Description |
|-------|------|-------------|
| `success` | boolean | `true` si succès |
| `userId` | string | ID MongoDB de l'utilisateur |
| `email` | string | Email de l'utilisateur |
| `isAdmin` | boolean | `true` si administrateur |
| `accessToken` | string | JWT pour les requêtes authentifiées (15 min) |
| `refreshToken` | string | Token pour renouveler l'accessToken (48h) |
| `tokenExpiresIn` | number | Durée de validité accessToken en secondes |
| `refreshTokenExpiresIn` | number | Durée de validité refreshToken en secondes |

### Réponse Register

| Champ | Type | Description |
|-------|------|-------------|
| `success` | boolean | `true` si succès |
| `message` | string | Message de confirmation |
| `userId` | string | ID MongoDB du nouvel utilisateur |
| `contact_code` | string | Code de contact unique (@123456) |
| `requiresEmailVerification` | boolean | `true` — email de vérification envoyé |

---

## Codes d'erreur — Référence complète

| Code | HTTP | Description | Action utilisateur |
|------|------|-------------|-------------------|
| `INVALID_PLATFORM` | 400 | Header X-Platform manquant | Ajouter header |
| `INVALID_DEVICE_ID` | 400 | Header X-Device-ID invalide | Générer UUID valide |
| `DEVICE_BLOCKED` | 403 | Appareil bloqué | Contacter support |
| `MISSING_CREDENTIALS` | 400 | Email/password manquant | Remplir les champs |
| `MISSING_FIELDS` | 400 | Champs requis manquants | Remplir tous les champs |
| `MISSING_EMAIL` | 400 | Email manquant | Fournir email |
| `INVALID_EMAIL_FORMAT` | 400 | Format email invalide | Corriger email |
| `INVALID_EMAIL` | 400 | Email non accepté | Utiliser autre email |
| `WEAK_PASSWORD` | 400 | Mot de passe trop faible | Renforcer mot de passe |
| `INVALID_CREDENTIALS` | 401 | Identifiants incorrects | Vérifier email/password |
| `ACCOUNT_BLOCKED` | 403 | Compte suspendu | Contacter support |
| `EMAIL_NOT_VERIFIED` | 403 | Email non vérifié | Vérifier email |
| `PENDING_VALIDATION` | 403 | Attente validation admin | Patienter |
| `ACCOUNT_REJECTED` | 403 | Compte refusé | Contacter support |
| `TOO_MANY_ATTEMPTS` | 429 | Rate limit dépassé | Attendre |
| `RATE_LIMIT_EXCEEDED` | 429 | Trop de requêtes | Attendre |
| `MAINTENANCE_MODE` | 503 | Site en maintenance | Réessayer plus tard |
| `NO_REFRESH_TOKEN` | 401 | Token manquant | Se reconnecter |
| `INVALID_REFRESH_TOKEN` | 401 | Token expiré/invalide | Se reconnecter |
| `TOKEN_THEFT_DETECTED` | 401 | Sécurité compromise | Se reconnecter |
| `TWO_FACTOR_REQUIRED` | 200 | 2FA activé | Saisir code 2FA |
| `INTERNAL_ERROR` | 500 | Erreur serveur | Réessayer |

