# 🔐 Checklist secrets — Qvarry API

> **REFONTE §4.2.1** : factoriser/documenter les secrets à configurer dans les 3 environnements (dev, staging, prod) — chacun avec ses propres valeurs.

Cette checklist couvre **tous les secrets** que tu dois définir avant de booter le backend en production (le boot échoue via `validateEnv.ts` si les essentiels sont placeholder, cf. Vague 4).

---

## 🚨 Règle d'or

**Jamais réutiliser un secret entre environnements.** Chaque secret doit être :
1. Unique par environnement (dev, staging, prod)
2. Généré avec `openssl rand` (jamais saisi à la main)
3. Stocké dans le secret manager du déploiement (AWS Secrets Manager, GCP Secret Manager, Vault, ou variables d'environnement de l'hébergeur) — **jamais commité**

Le backend rejette le boot prod si l'un de ces secrets correspond à une valeur placeholder du `.env.example` (Vague 4 `validateEnv.ts`, patterns : `GENERATE_WITH`, `CHANGE_ME`, `TODO`, `XXX`, `REPLACE_ME`, `YOUR_`, `SET_`).

---

## ✅ Checklist obligatoire — bloque le boot si manquant

### Crypto & JWT

| Variable | Génération | Vérif |
|---|---|---|
| `JWT_SECRET` | `openssl rand -base64 64` | ≥ 32 chars (warning si < 32, bloque si placeholder) |
| `JWT_REFRESH_SECRET` | `openssl rand -base64 64` | **Doit être DIFFÉRENT de `JWT_SECRET`** |
| `ENCRYPTION_KEY_MASTER` | `openssl rand -hex 32` | **64 chars hex** exactement (AES-256) |
| `ENCRYPTION_KEY_COMMUNICATION` | `openssl rand -hex 32` | **64 chars hex** exactement, différent de MASTER |
| `EMAIL_HMAC_KEY` | `openssl rand -hex 32` | Hash des emails (anti rainbow table) |
| `IP_HASH_SECRET` | `openssl rand -hex 32` | Hash IPs dans logs audit (RGPD) |

### Base de données

| Variable | Format | Vérif |
|---|---|---|
| `DB_CONN_STRING` | `mongodb+srv://user:pass@host/?appName=...` | **Toujours utiliser un user dédié par env** |
| `DB_NAME` | `QvarryStorage` | ⚠️ Sans dbName explicite, mongoose connecte à `test` (DB par défaut Atlas) — bug observé sur scripts de seeding hors backend |

### Cloudflare Turnstile (CAPTCHA)

| Variable | Source | Vérif |
|---|---|---|
| `TURNSTILE_SECRET_KEY` | Dashboard Cloudflare > Turnstile > Site | Required en prod (validateEnv bloque) |
| `TURNSTILE_SITE_KEY` (front) | Dashboard Cloudflare > Turnstile > Site | À configurer dans web (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`) et mobile |

**Valeurs test Cloudflare** (dev seulement) :
- Secret "Always passes" : `1x0000000000000000000000000000000AA`
- Site "Always passes" (visible) : `1x00000000000000000000AA`

---

## 🟠 Production-only — bloque le boot si false/placeholder

| Variable | Valeur prod | Notes |
|---|---|---|
| `COOKIE_SECURE` | `true` | Bloque si `!== "true"` en prod |
| `BYPASS_CAPTCHA` | `false` (ou non défini) | **Bloque le boot si `true`** en prod |
| `CLIENT_URL` | `https://app.qvarry.fr` | URL frontend pour CORS + email links |
| `FRONTEND_URL` | `https://app.qvarry.fr` | Idem (legacy alias) |
| `NEXT_PUBLIC_SITE_URL` (web) | `https://app.qvarry.fr` | Throw au build si manquant en prod (Vague 5 web) |

---

## 🟡 Services tiers — selon features activées

### Firebase / Push notifications

| Variable | Source | Si activé |
|---|---|---|
| `FIREBASE_PROJECT_ID` | Console Firebase | Service account JSON |
| `FIREBASE_PRIVATE_KEY` | Console Firebase > Service Accounts | Multi-line, échapper `\n` |
| `FIREBASE_CLIENT_EMAIL` | Console Firebase | Idem |
| `APP_CHECK_ENABLED` | `false` | Mettre `true` après provisioning App Attest iOS + SHA-256 Android |
| `APP_CHECK_DEBUG_TOKEN` (mobile) | Console Firebase > App Check > Debug tokens | UUID, voir `.env.example` mobile |

### Vonage SMS

| Variable | Source |
|---|---|
| `VONAGE_API_KEY` | Dashboard Vonage |
| `VONAGE_API_SECRET` | Dashboard Vonage |
| `VONAGE_SIGNATURE_SECRET` | Dashboard Vonage > Settings > Signed webhooks (optionnel mais recommandé) |
| `VONAGE_SMS_FROM` | Texte sender ID (max 11 chars alphanumériques) |

### SMTP (emails)

| Variable | Notes |
|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Sendgrid / Mailgun / SES / autre |
| `EMAIL_FROM` | Adresse `noreply@qvarry.fr` (vérifiée DNS pour DMARC) |

### Sentry (error tracking)

| Variable | Notes |
|---|---|
| `SENTRY_DSN` | Dashboard Sentry > Project > DSN |
| `SENTRY_ENVIRONMENT` | `production` / `staging` / `development` |

### Redis (clustering WebSocket + sessions persistantes)

| Variable | Notes |
|---|---|
| `REDIS_ENABLED` | `true` en prod, `false` en dev (fallback mémoire) |
| `REDIS_URL` | `rediss://user:pass@host:6379` (TLS obligatoire en prod) |
| `REDIS_PASSWORD` | Si pas inclus dans `REDIS_URL` |
| `REDIS_TLS` | `true` en prod, warning sinon |
| `REDIS_PUBSUB_ENABLED` | `true` pour clustering multi-instance |

---

## 🟢 Optionnels — defaults sains

| Variable | Default | Modifier si... |
|---|---|---|
| `PORT` | `3000` | Conflict / config infra |
| `LOG_LEVEL` | `info` (prod) / `debug` (dev) | Tuning verbosité |
| `JWT_EXPIRES_IN` | `15m` | Sessions plus longues |
| `REFRESH_TOKEN_EXPIRES_IN` | `48` (heures) | Sessions plus longues |
| `JSON_BODY_LIMIT` | `10mb` | Upload plus gros (attention multipart à part) |
| `MAX_SESSIONS_PER_USER` | `5` | Multi-device support |
| `WS_TOKEN_DEDUP_WINDOW_MS` | `3000` | Tolérance retry réseau WS auth (Vague 4) |
| `WS_APP_HEARTBEAT_INTERVAL_MS` | `30000` | Heartbeat applicatif Vague 3 |
| `WS_APP_HEARTBEAT_TIMEOUT_MS` | `60000` | Timeout pong client |
| `METRICS_TOKEN` | (absent → 404) | Activer endpoint `/metrics` Prometheus |
| `MONGO_SLOW_QUERY_MS` | `100` | Profiling Mongo prod |

---

## 🛠️ Commandes utiles

### Générer tous les secrets en une fois
```bash
bash scripts/generate-secrets.sh
# ou
npm run generate:secrets
```

### Vérifier l'env avant boot
```bash
NODE_ENV=production node -e "
require('dotenv').config();
const { assertValidEnv } = require('./dist/config/validateEnv');
assertValidEnv();
console.log('✓ Env OK');
"
```

### Auditer la force des secrets
```bash
# Le SecretsManagerService log automatiquement au boot :
#   [MED-005] Audit des secrets:
#     - JWT_SECRET: strong/weak
#     - ENCRYPTION_KEY_MASTER: strong/weak
#     - ... etc
```

---

## 📋 Procédure rotation secret (incident response)

Si un secret est compromis (ex: JWT_SECRET fuite dans un log) :

1. **Générer le nouveau** avec `openssl rand`
2. **Rotation JWT** (sans invalider les tokens actifs) :
   - Renommer l'ancien `JWT_SECRET` → `JWT_SECRET_V1`
   - Mettre le nouveau dans `JWT_SECRET`
   - Le backend valide les anciens tokens via `jwtKeyManager` pendant la fenêtre de transition
   - Après expiration des derniers tokens (15min + 48h refresh = 48h15min), supprimer `JWT_SECRET_V1`
3. **Rotation ENCRYPTION_KEY** : ⚠️ **plus complexe** — re-chiffrer tous les documents avec la nouvelle clé. Hors scope incident standard, à coordonner.
4. **Audit** : vérifier les logs Mongo / Redis / Sentry pour usage de l'ancien secret après rotation.
5. **Documentation** : noter l'incident dans `docs/incidents/` avec timeline.

---

## 🔍 Audit checklist avant déploiement

- [ ] Tous les secrets de la section **obligatoire** sont uniques par env et non-placeholder
- [ ] `BYPASS_CAPTCHA=false` ou non défini en prod
- [ ] `COOKIE_SECURE=true` en prod (HTTPS only)
- [ ] `DB_NAME=QvarryStorage` (sinon mongoose connecte à `test`)
- [ ] Boot prod testé : `NODE_ENV=production node dist/server.js` ne throw pas sur `validateEnv`
- [ ] Sentry DSN actif (vérif erreur intentionnelle remontée au dashboard)
- [ ] Redis joignable + TLS en prod (`rediss://` ou `REDIS_TLS=true`)
- [ ] Firebase service account valide (push P0 SOS testé sur device)
- [ ] Cloudflare Turnstile secret prod (pas la clé test `1x0000...AA`)
- [ ] Mongo Atlas IP whitelist contient les IPs des nodes prod (ou `0.0.0.0/0` derrière VPN)

---

**Dernière mise à jour** : 2026-05-10 (Vague 8 préparation déploiement). Cf. REFONTE §4.2.1 + §V4 commits `295cc27`, `5e3da41`.
