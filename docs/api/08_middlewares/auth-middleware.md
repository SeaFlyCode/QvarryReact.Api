# authMiddleware

Middleware d'authentification unifié pour les clients **web** (cookie HTTP-only) et **mobile** (Bearer token). Il exécute 11 étapes de vérification avant d'accorder l'accès à une route protégée.

## Signature

```typescript
export const authMiddleware: (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<void>;
```

## Flux d'exécution

### Étape 1 — Récupération du token

Priorité : cookie HTTP-only `JWT_COOKIE_NAME` → header `Authorization: Bearer <token>`

```
Cookie HTTP-only  (web, prioritaire)
Authorization: Bearer <token>  (mobile)
```

Les vecteurs supprimés (vulnérabilité VULN-010) : `req.query.token`, `req.body.token`.

### Étape 2 — Présence du token

Si aucun token trouvé :

```json
{
  "message": "Authentification requise. Aucun token fourni.",
  "code": "NO_TOKEN"
}
```

→ `401`

### Étape 3 — Vérification de la blacklist Redis

Le token est vérifié contre `redisSessionService.isTokenBlacklisted()` (CRIT-10 : le `Set` en mémoire a été supprimé, Redis est la seule source de vérité).

Si blacklisté :

```json
{
  "message": "Token révoqué. Veuillez vous reconnecter.",
  "code": "TOKEN_REVOKED",
  "tokenBlacklisted": true
}
```

→ `401`

### Étape 4 — Vérification et décodage JWT (REM-003 : Key Versioning)

Le payload est d'abord décodé **sans vérification** pour lire le champ `kv` (key version). La clé JWT correspondante est alors chargée depuis `jwtKeyManager`. Si la version n'existe pas, fallback sur `JWT_SECRET`.

Le token est ensuite vérifié avec `algorithm: HS256`.

```typescript
interface DecodedToken {
  id: string;
  isAdmin?: boolean;
  iat?: number;
  exp?: number;
  jti?: string;
  kv?: string; // Key Version (REM-003)
  platform?: "mobile" | "web";
}
```

### Étape 5 — Détection du type de token (web vs mobile)

Un token est considéré **mobile** si :

- `decoded.platform === "mobile"`, ou
- Header `X-Platform: ios`, ou
- Header `X-Platform: android`

### Étape 6 — Vérification de la session

**Web** : vérifie que `memoryStorage.hasSession(userId)` est vrai. Si non :

- Si `ALLOW_SESSION_RECOVERY !== "false"` → tente `loadAndDecryptUserData(userId)` (récupération automatique)
- Sinon → `401 SESSION_EXPIRED`

**Mobile** : vérifie `redisSessionService.validateSessionJti(userId, jti, "mobile")`. Si invalide → `401 SESSION_EXPIRED`.

**Mobile — lazy-load** : si `memoryStorage` n'a pas encore de session pour cet utilisateur, `loadAndDecryptUserData()` est appelé à la volée pour initialiser la session en mémoire (compatibilité avec les routes classiques).

### Étape 7 — Validation du JTI (web uniquement)

Pour les tokens web avec `jti`, `redisSessionService.validateSessionJti(userId, jti, "web")` est appelé. Un JTI invalide (token remplacé par un refresh) retourne `401 JTI_INVALID`.

### Étape 8 — Vérification `isAdmin` en base (AUTHZ-001)

Si le token contient `isAdmin: true`, la valeur réelle est lue depuis MongoDB (`User.is_admin`). Si le token prétend être admin alors que la BDD dit non :

1. L'incident est loggé via `auditService` (action `PRIVILEGE_ESCALATION_ATTEMPT`, niveau `critical`)
2. Le token est immédiatement blacklisté (TTL 24h)
3. `403 PRIVILEGE_ESCALATION_BLOCKED` est retourné

> ⚠️ Cette étape empêche l'escalade de privilèges par modification du payload JWT. La valeur `isAdmin` injectée dans `req.user` provient toujours de la base de données, jamais du token.

### Étape 9 — Touch de session

Pour les clients web, `memoryStorage.touchSession(userId)` est appelé pour réinitialiser le TTL de la session en mémoire.

### Étape 10 — Injection dans `req.user`

```typescript
req.user = {
  id: decoded.id,
  isAdmin: verifiedIsAdmin, // valeur DB (AUTH-008)
  tokenIssuedAt: decoded.iat,
  tokenId: decoded.jti,
  clientType: isMobileToken ? "mobile" : "web",
};
```

Le contexte de corrélation est aussi enrichi via `setRequestContext({ userId, sessionId, clientType })`.

### Étape 11 — Contexte mobile

Pour les tokens mobile, `req.authType = "mobile"` et `req.mobileContext` sont injectés :

```typescript
req.mobileContext = {
  platform: decoded.platform || req.headers["x-platform"],
  deviceId: req.headers["x-device-id"],
  tokenType: "mobile",
};
```

## Codes de réponse

| Code                           | Statut | Condition                                              |
| ------------------------------ | ------ | ------------------------------------------------------ |
| `NO_TOKEN`                     | 401    | Aucun token trouvé                                     |
| `TOKEN_REVOKED`                | 401    | Token blacklisté dans Redis                            |
| `KEY_VERSION_INVALID`          | 401    | Version de clé JWT inconnue                            |
| `SESSION_EXPIRED`              | 401    | Session memoryStorage ou JTI invalide                  |
| `SESSION_RECOVERY_FAILED`      | 401    | Récupération automatique de session échouée            |
| `SESSION_INIT_ERROR`           | 500    | Erreur lors du lazy-load mobile                        |
| `JTI_INVALID`                  | 401    | JTI web invalide                                       |
| `USER_NOT_FOUND`               | 401    | Utilisateur absent en BDD                              |
| `ACCOUNT_BLOCKED`              | 403    | Compte suspendu (`is_blocked: true`)                   |
| `PRIVILEGE_ESCALATION_BLOCKED` | 403    | Token admin mais BDD dit non                           |
| `AUTH_FAILED`                  | 401    | Exception JWT (expiré ou invalide) — message générique |

## Variables d'environnement

| Variable                            | Usage                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| `JWT_SECRET`                        | Clé JWT principale (version 1)                                                 |
| `JWT_SECRET_V2`, `JWT_SECRET_V3`, … | Clés versionnées (rotation, REM-003)                                           |
| `REQUIRE_ACTIVE_SESSION`            | Désactiver la vérification de session (`"false"` pour bypass)                  |
| `ALLOW_SESSION_RECOVERY`            | Activer la récupération automatique de session web (`"false"` pour désactiver) |
| `LOG_AUTH_ACCESS`                   | Logger les accès autorisés (`"true"`)                                          |
