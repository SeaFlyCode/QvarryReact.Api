# Authentification

## Flow d'authentification complet

### Web (Cookie HTTP-only)

```
Client (navigateur)                  API Qvarry                    Redis / MongoDB
        │                                │                               │
        │  POST /auth/login              │                               │
        │  { email, password, turnstile }│                               │
        │ ──────────────────────────────>│                               │
        │                                │  Vérif HMAC email             │
        │                                │  Vérif bcrypt password        │
        │                                │  Vérif compte actif           │
        │                                │                               │
        │                                │  [Si 2FA activé]              │
        │                                │  ──────────────────────────── │
        │  401 { tempToken, require2FA } │                               │
        │ <──────────────────────────────│                               │
        │                                │                               │
        │  POST /auth/complete-2fa-login │                               │
        │  { tempToken, code }           │                               │
        │ ──────────────────────────────>│                               │
        │                                │  [Si 2FA non activé / après 2FA]
        │                                │  Génération access token (JWT)│
        │                                │  Génération refresh token     │
        │                                │  Stockage session ────────────>
        │                                │  (memoryStorage)              │
        │  200 Set-Cookie: qvarry_jwt    │                               │
        │  { user, accessToken }         │                               │
        │ <──────────────────────────────│                               │
        │                                │                               │
        │  [Requête authentifiée]        │                               │
        │  GET /api/v1/...               │                               │
        │  Cookie: qvarry_jwt=<token>    │                               │
        │ ──────────────────────────────>│                               │
        │                                │  Vérif signature JWT          │
        │                                │  Vérif expiration             │
        │                                │  Vérif blacklist JTI ─────────>
        │                                │                         Redis  │
        │                                │  Vérif session JTI ───────────>
        │                                │  Vérif isAdmin (si nécessaire)│
        │                                │  ────────────> MongoDB        │
        │  200 { data }                  │                               │
        │ <──────────────────────────────│                               │
```

### Mobile (Bearer Token)

```
Client (mobile)                      API Qvarry                    Redis / MongoDB
        │                                │                               │
        │  POST /mobile/auth/login       │                               │
        │  { email, password, deviceId } │                               │
        │ ──────────────────────────────>│                               │
        │                                │  Vérif credentials            │
        │                                │  Vérif mobileSecurityMiddleware
        │                                │  Génération access token      │
        │                                │  Génération refresh token     │
        │                                │  Stockage session ────────────>
        │                                │  (Redis)                      │
        │  200 { accessToken,            │                               │
        │        refreshToken, user }    │                               │
        │ <──────────────────────────────│                               │
        │                                │                               │
        │  [Requête authentifiée]        │                               │
        │  GET /api/v1/...               │                               │
        │  Authorization: Bearer <token> │                               │
        │ ──────────────────────────────>│                               │
        │                                │  Lazy loading session Redis   │
        │                                │  Vérif signature JWT          │
        │                                │  Vérif JTI blacklist ─────────>
        │                                │                         Redis  │
        │  200 { data }                  │                               │
        │ <──────────────────────────────│                               │
```

### Refresh Token

```
Client                               API Qvarry                    Redis
        │                                │                          │
        │  POST /auth/refresh            │                          │
        │  Cookie: qvarry_jwt            │                          │
        │  (ou body: { refreshToken })   │                          │
        │ ──────────────────────────────>│                          │
        │                                │  Vérif refresh token     │
        │                                │  Révocation ancien JTI──>│
        │                                │  (blacklist)             │
        │                                │  Génération nouveau JWT  │
        │                                │  Nouveau JTI en session─>│
        │  200 Set-Cookie: qvarry_jwt    │                          │
        │  (ou body: { accessToken })    │                          │
        │ <──────────────────────────────│                          │
```

---

## JWT — Structure du token

### Payload

```json
{
  "id": "64abc123def456789",
  "isAdmin": false,
  "iat": 1710000000,
  "exp": 1710000900,
  "jti": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "kv": 1,
  "platform": "web"
}
```

| Champ      | Type    | Description                                                       |
| ---------- | ------- | ----------------------------------------------------------------- |
| `id`       | string  | ObjectId MongoDB de l'utilisateur                                 |
| `isAdmin`  | boolean | Rôle administrateur (vérifié en BDD à chaque requête)             |
| `iat`      | number  | Timestamp d'émission (issued at)                                  |
| `exp`      | number  | Timestamp d'expiration                                            |
| `jti`      | string  | Identifiant unique du token (UUID v4) — utilisé pour la blacklist |
| `kv`       | number  | Version de la clé JWT utilisée pour la signature                  |
| `platform` | string  | `"web"` ou `"mobile"`                                             |

### Durées

| Token         | Durée par défaut | Variable d'environnement   |
| ------------- | ---------------- | -------------------------- |
| Access token  | 15 minutes       | `JWT_EXPIRES_IN`           |
| Refresh token | 48 heures        | `REFRESH_TOKEN_EXPIRES_IN` |

### Algorithme de signature

- Algorithme : **HS256** (HMAC-SHA256)
- Clé : déterminée par `kv` (key version) dans le payload

---

## JWT Key Versioning — Rotation des clés

La rotation des clés JWT permet de changer la clé de signature sans invalider immédiatement les tokens existants.

### Fonctionnement

```
Variables d'environnement :
  JWT_SECRET       → version 1 (clé de base)
  JWT_SECRET_V2    → version 2
  JWT_SECRET_V3    → version 3
  ...
  JWT_SECRET_V10   → version 10 (maximum)

Règle de sélection :
  → La clé avec le numéro de version le plus élevé signe les nouveaux tokens
  → Un token avec kv=2 est vérifié avec JWT_SECRET_V2
  → Les tokens existants continuent de fonctionner jusqu'à leur expiration
```

### Procédure de rotation

1. Ajouter `JWT_SECRET_V(n+1)` dans les variables d'environnement
2. Redémarrer l'API
3. Les nouveaux tokens sont signés avec la nouvelle clé
4. Les anciens tokens (kv=n) restent valides jusqu'à expiration (15 min max)
5. Après expiration de tous les anciens tokens, l'ancienne clé peut être retirée

⚠️ Ne jamais supprimer une clé versionnée tant que des tokens signés avec cette clé peuvent encore être actifs.

---

## Cookies (Web)

| Attribut | Valeur                                            | Rôle                                  |
| -------- | ------------------------------------------------- | ------------------------------------- |
| Nom      | `qvarry_jwt` (configurable via `JWT_COOKIE_NAME`) | Identification du cookie              |
| HttpOnly | `true`                                            | Inaccessible au JavaScript client     |
| Secure   | `true` (production)                               | HTTPS uniquement                      |
| SameSite | `Strict`                                          | Protection CSRF                       |
| Path     | `/`                                               | Disponible sur toutes les routes      |
| Durée    | Alignée sur `JWT_EXPIRES_IN`                      | Expiration synchronisée avec le token |

⚠️ Le cookie HTTP-only empêche tout accès via `document.cookie`. Il ne peut pas être volé par XSS.

---

## Session Management

### Web — memoryStorage (in-process)

- Stockage en mémoire du processus Node.js
- Clé : `jti` du token
- Valeur : `{ userId, jti, platform, createdAt }`
- Avantage : latence nulle (pas d'I/O réseau)
- Limitation : non partagé entre instances (monolithique)
- **Fallback session recovery** : en cas de redémarrage, les sessions valides peuvent être reconstruites depuis le refresh token

### Mobile — Redis (redisSessionService)

- Stockage persistant dans Redis
- Clé : `session:{userId}:{jti}`
- Durée de vie : `SESSION_TTL` = 3600 secondes (1 heure)
- Partagé entre toutes les instances (compatible multi-instance / cluster)
- Nettoyage automatique par TTL Redis

### Limites de sessions

```
MAX_SESSIONS_PER_USER = 5 (configurable)
```

Lorsque la limite est atteinte, la session la plus ancienne est révoquée (LRU).

### Lazy loading (Mobile → Routes classiques)

Lorsqu'un token mobile accède à une route classique (non mobile), la session est chargée depuis Redis vers memoryStorage à la volée.

---

## Codes d'erreur d'authentification

| Code                           | HTTP | Description                                                          |
| ------------------------------ | ---- | -------------------------------------------------------------------- |
| `NO_TOKEN`                     | 401  | Aucun token fourni (ni cookie ni header Authorization)               |
| `TOKEN_REVOKED`                | 401  | Le JTI du token est présent dans la blacklist Redis                  |
| `KEY_VERSION_INVALID`          | 401  | Le champ `kv` du token référence une clé inconnue                    |
| `SESSION_EXPIRED`              | 401  | La session associée au JTI a expiré ou n'existe plus                 |
| `JTI_INVALID`                  | 401  | Le JTI du token ne correspond à aucune session active                |
| `USER_NOT_FOUND`               | 401  | L'utilisateur référencé dans le token n'existe plus en base          |
| `ACCOUNT_BLOCKED`              | 403  | Le compte de l'utilisateur est suspendu                              |
| `PRIVILEGE_ESCALATION_BLOCKED` | 403  | Le token revendique `isAdmin=true` mais la base indique le contraire |

---

## Variables d'environnement associées

| Variable                             | Obligatoire | Description                      | Exemple                |
| ------------------------------------ | ----------- | -------------------------------- | ---------------------- |
| `JWT_SECRET`                         | Oui         | Clé de signature JWT (version 1) | `openssl rand -hex 32` |
| `JWT_SECRET_V2` ... `JWT_SECRET_V10` | Non         | Clés versionnées pour rotation   | `openssl rand -hex 32` |
| `JWT_EXPIRES_IN`                     | Non         | Durée de vie access token        | `15m`                  |
| `REFRESH_TOKEN_EXPIRES_IN`           | Non         | Durée de vie refresh token       | `48h`                  |
| `JWT_COOKIE_NAME`                    | Non         | Nom du cookie JWT                | `qvarry_jwt`           |
| `MAX_SESSIONS_PER_USER`              | Non         | Sessions simultanées max         | `5`                    |
| `SESSION_TTL`                        | Non         | Durée session Redis (secondes)   | `3600`                 |
