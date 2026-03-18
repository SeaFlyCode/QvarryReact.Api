# Routes utilisateurs

**Préfixe** : `/api/v1/users`

Ces routes gèrent la création de compte, la consultation et la modification du profil utilisateur, ainsi que la vérification d'email et la gestion du mot de passe.

---

## Sommaire

- [POST /users](#post-users)
- [GET /users/me](#get-usersme)
- [PUT /users/me](#put-usersme)
- [DELETE /users/me](#delete-usersme)
- [GET /users/verify-email](#get-usersverify-email)
- [POST /users/resend-verification](#post-usersresend-verification)
- [GET /users/:userId](#get-usersuserid)
- [PUT /users/change-password](#put-userschange-password)

---

## Endpoints

### POST /api/v1/users

**Description** : Crée un nouveau compte utilisateur. Envoie un email de vérification après inscription. Équivaut à la route d'inscription (`/auth/register`). Nécessite le consentement RGPD explicite.

**Auth** : Non requise

**Rate Limit** : `registerLimiter`

**Middleware** : `verifyTurnstile` (validation Cloudflare Turnstile obligatoire)

#### Corps de la requête

```json
{
  "name": "string (requis)",
  "surname": "string (requis)",
  "email": "string (requis)",
  "password": "string (requis — minimum 8 caractères)",
  "gdpr_consent": "boolean (requis — doit être true)",
  "gdpr_consent_version": "string (optionnel — ex: '1.2')"
}
```

#### Réponses

- **201 — Compte créé**

```json
{
  "message": "Compte créé. Vérifiez votre email pour activer votre compte.",
  "userId": "string"
}
```

- **400** : Champs manquants ou invalides — `{ "error": "...", "code": "MISSING_FIELDS" | "WEAK_PASSWORD" | "INVALID_EMAIL" }`
- **400** : Consentement RGPD manquant — `{ "error": "Le consentement RGPD est requis", "code": "GDPR_CONSENT_REQUIRED" }`
- **409** : Email déjà utilisé — `{ "error": "Cet email est déjà enregistré", "code": "EMAIL_ALREADY_EXISTS" }`
- **429** : Rate limit — `{ "error": "Trop de demandes", "code": "RATE_LIMIT", "retryAfter": 3600 }`

---

### GET /api/v1/users/me

**Description** : Retourne le profil complet de l'utilisateur actuellement authentifié, incluant les informations personnelles, les préférences et les métadonnées de compte.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Réponses

- **200 — Profil retourné**

```json
{
  "id": "string",
  "email": "string",
  "name": "string",
  "surname": "string",
  "username": "string",
  "pseudo": "string | null",
  "showPseudo": "boolean",
  "contact_code": "string",
  "isAdmin": "boolean",
  "emailVerified": "boolean",
  "login_notifications_enabled": "boolean",
  "twoFactorEnabled": "boolean",
  "createdAt": "2026-03-18T10:00:00.000Z",
  "updatedAt": "2026-03-18T10:00:00.000Z"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`

---

### PUT /api/v1/users/me

**Description** : Met à jour les informations du profil de l'utilisateur connecté. Seuls les champs fournis sont mis à jour (PATCH sémantique).

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Corps de la requête

```json
{
  "name": "string (optionnel)",
  "surname": "string (optionnel)",
  "pseudo": "string (optionnel)",
  "showPseudo": "boolean (optionnel)",
  "login_notifications_enabled": "boolean (optionnel)"
}
```

#### Réponses

- **200 — Profil mis à jour**

```json
{
  "message": "Profil mis à jour",
  "user": {
    "id": "string",
    "email": "string",
    "name": "string",
    "surname": "string",
    "pseudo": "string | null",
    "showPseudo": "boolean",
    "login_notifications_enabled": "boolean"
  }
}
```

- **400** : Données invalides — `{ "error": "...", "code": "INVALID_DATA" }`
- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`

---

### DELETE /api/v1/users/me

**Description** : Supprime définitivement le compte de l'utilisateur connecté, ainsi que toutes les données associées (messages, fiches, contacts, etc.). Cette opération est irréversible.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

⚠️ **Cette opération est irréversible. Toutes les données de l'utilisateur sont supprimées.**

#### Réponses

- **200 — Compte supprimé**

```json
{
  "message": "Compte supprimé avec succès"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`

---

### GET /api/v1/users/verify-email

**Description** : Vérifie l'adresse email de l'utilisateur à partir du token ou du code reçu par email. Peut être appelé depuis un lien email (token) ou depuis l'application (code à 6 chiffres).

**Auth** : Non requise

**Rate Limit** : Aucun

#### Paramètres de requête (query)

| Paramètre | Type   | Obligatoire        | Description                          |
| --------- | ------ | ------------------ | ------------------------------------ |
| `token`   | string | Conditionnellement | Token de vérification (lien email)   |
| `code`    | string | Conditionnellement | Code numérique (vérification in-app) |

_Au moins un des deux paramètres est requis._

#### Réponses

- **200 — Email vérifié**

```json
{
  "message": "Email vérifié avec succès"
}
```

- **400** : Token ou code manquant — `{ "error": "Token ou code requis", "code": "MISSING_VERIFICATION_DATA" }`
- **400** : Token ou code invalide / expiré — `{ "error": "Lien de vérification invalide ou expiré", "code": "INVALID_VERIFICATION_TOKEN" }`
- **409** : Email déjà vérifié — `{ "error": "Cet email est déjà vérifié", "code": "ALREADY_VERIFIED" }`

---

### POST /api/v1/users/resend-verification

**Description** : Renvoi l'email de vérification à l'adresse enregistrée pour le compte. Utile si l'email initial n'a pas été reçu ou a expiré.

**Auth** : Non requise

**Rate Limit** : `resendVerificationLimiter`

#### Corps de la requête

```json
{
  "email": "string (requis)"
}
```

#### Réponses

- **200 — Email renvoyé**

```json
{
  "message": "Email de vérification renvoyé"
}
```

- **400** : Email manquant — `{ "error": "Email requis", "code": "MISSING_EMAIL" }`
- **404** : Compte introuvable — `{ "error": "Aucun compte associé à cet email", "code": "USER_NOT_FOUND" }`
- **409** : Email déjà vérifié — `{ "error": "Cet email est déjà vérifié", "code": "ALREADY_VERIFIED" }`
- **429** : Rate limit — `{ "error": "Trop de demandes", "code": "RATE_LIMIT", "retryAfter": 60 }`

---

### GET /api/v1/users/:userId

**Description** : Retourne le profil public d'un utilisateur à partir de son identifiant. Les informations sensibles (email, etc.) ne sont pas exposées.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de chemin (path)

| Paramètre | Type              | Obligatoire | Description                          |
| --------- | ----------------- | ----------- | ------------------------------------ |
| `userId`  | string (ObjectId) | Oui         | Identifiant MongoDB de l'utilisateur |

#### Réponses

- **200 — Profil public retourné**

```json
{
  "id": "string",
  "username": "string",
  "pseudo": "string | null",
  "showPseudo": "boolean",
  "createdAt": "2026-03-18T10:00:00.000Z"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **404** : Utilisateur introuvable — `{ "error": "Utilisateur introuvable", "code": "USER_NOT_FOUND" }`

---

### PUT /api/v1/users/change-password

**Description** : Modifie le mot de passe de l'utilisateur connecté. Nécessite le mot de passe actuel pour confirmation. Invalide les sessions actives après le changement (sauf la session courante).

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : `changePasswordLimiter`

#### Corps de la requête

```json
{
  "currentPassword": "string (requis)",
  "newPassword": "string (requis — minimum 8 caractères)"
}
```

#### Réponses

- **200 — Mot de passe modifié**

```json
{
  "message": "Mot de passe mis à jour avec succès"
}
```

- **400** : Champs manquants ou nouveau mot de passe trop faible — `{ "error": "...", "code": "MISSING_FIELDS" | "WEAK_PASSWORD" }`
- **401** : Mot de passe actuel incorrect — `{ "error": "Mot de passe actuel incorrect", "code": "INVALID_PASSWORD" }`
- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **429** : Rate limit — `{ "error": "Trop de tentatives", "code": "RATE_LIMIT", "retryAfter": 300 }`
