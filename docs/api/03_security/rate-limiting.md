# Rate Limiting

## Vue d'ensemble

L'API Qvarry applique plusieurs niveaux de rate limiting, du plus général au plus spécifique. Chaque limiter est indépendant et peut être déclenché séparément.

Les limites sont définies pour la **production**. En développement, un multiplicateur est appliqué automatiquement.

---

## Multiplicateur développement

```
DEV_MULTIPLIER = 10
```

En environnement de développement (`NODE_ENV !== 'production'`), toutes les limites sont multipliées par 10. Exemple : un limiter à 10 req/15 min en production autorise 100 req/15 min en développement.

---

## Tableau complet des rate limiters

| Limiter                | Routes concernées                                         | Limite (prod) | Limite (dev) | Fenêtre    |
| ---------------------- | --------------------------------------------------------- | ------------- | ------------ | ---------- |
| `globalRateLimiter`    | Toutes les routes                                         | 1000 req      | 10 000 req   | 1 minute   |
| `authLimiter`          | `POST /auth/login`, `POST /auth/register`                 | 10 req        | 100 req      | 15 minutes |
| `registerLimiter`      | `POST /users`                                             | 5 req         | 50 req       | 1 heure    |
| `verifyEmailLimiter`   | `GET /users/verify-email`                                 | 5 req         | 50 req       | 15 minutes |
| `resendEmailLimiter`   | `POST /users/resend-verification`                         | 3 req         | 30 req       | 1 heure    |
| `passwordResetLimiter` | `POST /auth/forgot-password`, `POST /auth/reset-password` | 5 req         | 50 req       | 15 minutes |
| `twoFactorLimiter`     | `/2fa/*`, `/mobile/2fa`                                   | 5 req         | 50 req       | 5 minutes  |
| `generalLimiter`       | `/api` (fallback)                                         | 300 req       | 3 000 req    | 1 minute   |
| `highTrafficLimiter`   | `/points`, `/fiches`, `/lists`                            | 500 req       | 5 000 req    | 1 minute   |
| `socialLimiter`        | `/contacts`, `/messages`, `/share`, `/conversations`      | 100 req       | 1 000 req    | 1 minute   |
| `wsConnectionLimiter`  | `/ws`                                                     | 30 req        | 300 req      | 1 minute   |
| `refreshTokenLimiter`  | `POST /auth/refresh`                                      | 10 req        | 100 req      | 1 minute   |
| `adminLimiter`         | `/admin`                                                  | 60 req        | 600 req      | 1 minute   |
| `mobileAuthLimiter`    | `/mobile/auth`, `/mobile/sos`, `/mobile/push-tokens`      | 5 req         | 50 req       | 15 minutes |
| `securityLimiter`      | `/security`                                               | 30 req        | 300 req      | 1 minute   |
| `authCheckLimiter`     | `GET /auth/check`                                         | 60 req        | 600 req      | 1 minute   |
| `maintenanceLimiter`   | `/maintenance`                                            | 30 req        | 300 req      | 1 minute   |
| `usersLimiter`         | `/users`                                                  | 100 req       | 1 000 req    | 1 minute   |
| `notificationsLimiter` | `/notifications`                                          | 60 req        | 600 req      | 1 minute   |
| `healthLimiter`        | `GET /health`                                             | 120 req       | 1 200 req    | 1 minute   |

---

## Hiérarchie d'application

Les limiters sont appliqués dans l'ordre suivant (du plus large au plus spécifique) :

```
Requête entrante
      │
      ▼
globalRateLimiter (1000/min)
      │  Si non dépassé
      ▼
Limiter spécifique à la route
(ex: authLimiter pour /auth/login)
      │  Si non dépassé
      ▼
generalLimiter (fallback /api, 300/min)
      │  Si non dépassé
      ▼
Handler de route
```

Une requête peut être bloquée par le limiter global même si le limiter spécifique n'est pas atteint, et vice-versa.

---

## Comportement en cas de dépassement

### Réponse HTTP

```
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 60
RateLimit-Limit: 10
RateLimit-Remaining: 0
RateLimit-Reset: 1710001800

{
  "error": "Too many requests",
  "message": "Trop de tentatives. Réessayez dans 60 secondes.",
  "retryAfter": 60
}
```

### Headers de rate limit

| Header                | Description                                                           |
| --------------------- | --------------------------------------------------------------------- |
| `RateLimit-Limit`     | Nombre maximum de requêtes autorisées dans la fenêtre                 |
| `RateLimit-Remaining` | Nombre de requêtes restantes dans la fenêtre courante                 |
| `RateLimit-Reset`     | Timestamp UNIX de réinitialisation de la fenêtre                      |
| `Retry-After`         | Secondes avant de pouvoir retenter (présent uniquement en cas de 429) |

Ces headers sont activés via `standardHeaders: true` dans la configuration express-rate-limit.

---

## Rate limiting mobile spécifique

Les routes mobiles disposent de leur propre limiter (`mobileAuthLimiter`) car les clients mobiles n'utilisent pas de cookie et ne sont pas protégés par Turnstile.

```
Routes concernées :
  POST /mobile/auth/login
  POST /mobile/auth/register
  POST /mobile/sos/*
  POST /mobile/push-tokens

Limite prod : 5 req / 15 min par IP
```

Le `mobileSecurityMiddleware` applique des contrôles supplémentaires (device fingerprint, User-Agent, etc.) en complément du rate limiting.

---

## Identification des clients

Le rate limiting est appliqué **par IP source**. En environnement de production derrière Cloudflare :

- L'IP réelle est lue dans `CF-Connecting-IP` (header Cloudflare)
- Fallback sur `X-Forwarded-For` puis `req.ip`

⚠️ Si l'API est déployée derrière un reverse proxy, il est impératif de configurer `trust proxy` dans Express pour que l'IP source soit correctement identifiée et non l'IP du proxy.

```typescript
// Configuration Express
app.set("trust proxy", 1);
```

---

## Variables d'environnement associées

| Variable               | Description                                  | Valeur par défaut |
| ---------------------- | -------------------------------------------- | ----------------- |
| `NODE_ENV`             | Environnement (`production` / `development`) | `development`     |
| `RATE_LIMIT_WINDOW_MS` | Fenêtre globale en ms (optionnel, override)  | `60000`           |
