# Qvarry — Backend API

API REST + WebSocket de l'app Qvarry (spéléologie / cavités souterraines).

## Stack

- **Runtime** : Node.js 20 LTS, TypeScript 5
- **Framework** : Express 5, ws (WebSocket), Mongoose 8 / MongoDB Atlas
- **Cache / pub-sub** : Redis (ioredis + cluster ready)
- **Auth** : JWT HS256 (access + refresh rotation), 2FA TOTP (otpauth), Cloudflare Turnstile
- **Storage** : Sharp images, HEIC convert, multer uploads
- **Notifs push** : Firebase Admin, SMTP nodemailer
- **Monitoring** : Winston JSON + Sentry + prom-client (`/metrics`)
- **Docs** : Swagger/OpenAPI auto via `swagger-jsdoc` (`/api-docs` en dev)

## Quick start

```bash
# Clone + install
npm ci

# Variables d'env (voir docs/secrets-checklist.md pour la liste exhaustive)
cp .env.example .env
# Minimum requis :
#   DB_CONN_STRING=mongodb+srv://...
#   JWT_SECRET=<64 hex random>
#   ENCRYPTION_KEY_MASTER=<32 bytes base64>
#   ENCRYPTION_KEY_COMMUNICATION=<32 bytes base64>

# Dev avec hot reload
npm run dev          # http://localhost:3000

# Type check + lint
npm run type-check
npm run lint:check

# Tests
npm test                          # full suite
npm run test:coverage             # avec coverage
npm run test:clustering:unit      # tests cluster Redis isolés

# Build prod (TypeScript + obfuscation)
npm run build
npm run build:prod                # + obfusqué pour container Docker
```

## Endpoints clés

- `GET /api/health` — liveness probe (toujours 200)
- `GET /api/health/ready` — readiness (200 si DB + Redis OK, 503 sinon)
- `GET /api-docs` — Swagger UI (dev only, ou prod avec `ENABLE_SWAGGER=true`)
- `GET /api-docs.json` — spec OpenAPI brute (161 paths)
- `GET /metrics` — Prometheus metrics (protégé par `METRICS_TOKEN`)

## Documentation interne

- `docs/secrets-checklist.md` — checklist secrets cross-env (dev / staging / prod)
- `docs/backup-mongodb.md` — procédure backup Atlas + DR scenarios
- `REFONTE_2026-05-04.md` — historique de la refonte cross-projet (P0/P1/P2)
- `AUDIT_2026-05-11.md` — audit deep post-refonte + roadmap restante

## Scripts utiles

```bash
npm run export:openapi              # exporte openapi.json (SSOT pour codegen clients)
npm run ws:state:list               # liste sessions WS connectées (Redis)
npm run test:push                   # test envoi push notification
npm run generate:secrets            # génère JWT_SECRET + ENCRYPTION_KEY_* aléatoires
ts-node scripts/create-smoke-test-account.ts   # crée compte E2E smoke-test@qvarry.local
```

## Architecture rapide

- `src/server.ts` — entry point Express + WS upgrade + graceful shutdown
- `src/config/` — database / swagger / metrics / rateLimit / validateEnv
- `src/middlewares/` — auth / CSRF / rateLimit / sanitize / appCheck mobile
- `src/controllers/` — handlers par domaine (auth, fiches, points, lists, sos, conversations…)
- `src/services/webSocketService.ts` — sync_update / session_revoked / typing / heartbeat
- `src/utils/` — crypto (masterEncryption/userEncryption/RSA), JWT, password, sanitization

## CI

`.github/workflows/ci.yml` : lint + type-check + jest sur push `main`/`dev` et PR.

## Repos liés (3-repo project)

- **Backend** : ce repo (`QvarryReact.Api`)
- **Mobile** : `../Qvarry-phone` (React Native 0.84)
- **Web** : `../QvarryReact` (Next.js App Router)

Les 3 clients consomment `openapi.json` de ce repo via `npm run codegen:api` (cf. V6 Niveau 1, `src/types/api.generated.ts` clients).

## Sécurité

Voir `AUDIT_2026-05-11.md` pour l'état sécu actuel et la roadmap. Pour signaler une vulnérabilité : ne pas ouvrir d'issue public, contact privé via security@qvarry.fr.
