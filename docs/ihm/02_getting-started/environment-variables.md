# Variables d'environnement — IHM Qvarry

## Fichiers d'environnement

| Fichier | Usage |
|---------|-------|
| `.env` | Développement local |
| `.env.example` | Template (commit dans le dépôt) |
| `.env.production` | Production (ne jamais committer avec de vraies valeurs) |

---

## Variables disponibles

### API Back-end

| Variable | Exemple | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:3000/api` | URL de l'API Qvarry (back-end). Préfixe `NEXT_PUBLIC_` = accessible dans le code client. |

### Sécurité

| Variable | Exemple | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | `0x4AAAA...` | Clé publique Cloudflare Turnstile (CAPTCHA). Visible côté client. |

### Environnement

| Variable | `development` \| `production` | Description |
|----------|-------------------------------|-------------|
| `NEXT_PUBLIC_ENV` | `development` | Mode d'exécution. Affecte les comportements CSP, logs, etc. |
| `NODE_ENV` | `production` | Variable Next.js standard (set automatiquement par les commandes npm) |

### Sentry (monitoring)

| Variable | Exemple | Description |
|----------|---------|-------------|
| `SENTRY_DSN` | `https://xxx@sentry.io/...` | DSN Sentry pour la capture d'erreurs |
| `SENTRY_ORG` | `qvarry` | Organisation Sentry |
| `SENTRY_PROJECT` | `qvarry-react` | Projet Sentry |

---

## Exemple de `.env.example`

```env
# API Back-end
NEXT_PUBLIC_API_URL=http://localhost:3000/api

# Cloudflare Turnstile (CAPTCHA)
NEXT_PUBLIC_TURNSTILE_SITE_KEY=your_turnstile_site_key

# Environnement
NEXT_PUBLIC_ENV=development
```

---

## Notes importantes

- Les variables préfixées `NEXT_PUBLIC_` sont **exposées au navigateur** — ne jamais y mettre de secrets (tokens, clés privées, mots de passe).
- Les variables sans `NEXT_PUBLIC_` ne sont accessibles que côté serveur (Server Components, API Routes, middleware).
- En Docker, les variables sont injectées via `--env-file .env` au démarrage du conteneur.
- En production, les variables sont définies dans les secrets de l'environnement de déploiement (CI/CD, Docker secrets, Kubernetes secrets).

---

## Comportement selon l'environnement

### Nom du cookie JWT

Le cookie JWT change de nom selon l'environnement (fichier `src/lib/cookieNames.ts`) :

| Environnement | Nom du cookie |
|---------------|---------------|
| Développement | `token` |
| Production | `__Host-token` (préfixe `__Host-` imposé par le back-end pour la sécurité) |

### CSP (Content Security Policy)

En développement, la directive `upgrade-insecure-requests` est désactivée pour permettre les connexions HTTP locales. En production, elle est activée pour forcer HTTPS.

### Logs console

En production, le `console-interceptor` désactive les logs `console.log` et `console.debug` pour éviter de fuiter des informations sensibles.
