# Déploiement — IHM Qvarry

## Vue d'ensemble

L'IHM Qvarry est déployée via Docker sur un serveur Linux. Le build est effectué localement puis poussé vers un registry Docker privé.

---

## Workflow de déploiement

```
1. Développement local
         │
         ▼
2. Build Next.js
   npm run build:prod
         │
         ▼
3. Build image Docker
   npm run docker:build
         │
         ▼
4. Push registry privé
   npm run docker:push
   → docker.matheovieilleville.fr/qvarry-client:latest
   → docker.matheovieilleville.fr/qvarry-client:<version>
         │
         ▼
5. Déploiement serveur
   docker pull + docker run
         │
         ▼
6. Smoke test
   npm run smoke-test
```

---

## Commande tout-en-un

```bash
npm run docker:release
```

Équivaut à `docker:build` + `docker:push`.

---

## Dockerfile

Multi-stage build pour optimiser la taille de l'image :

| Stage | Base | Rôle |
|-------|------|------|
| `deps` | `node:20-alpine` | Installation des dépendances npm |
| `builder` | `node:20-alpine` | Build Next.js |
| `runner` | `node:20-alpine` | Image finale légère (production) |

L'image finale ne contient que le `.next/standalone` + les assets publics, sans les `node_modules` complets.

**Port exposé** : `3001`

---

## Variables d'environnement en production

Les variables sont injectées au démarrage du conteneur via `--env-file` :

```bash
docker run -d \
  -p 3001:3001 \
  --env-file .env.production \
  --name qvarry-client \
  docker.matheovieilleville.fr/qvarry-client:latest
```

Variables requises en production :

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | URL de l'API back-end (ex: `https://qvarry.fr/api`) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Clé publique Cloudflare Turnstile |
| `NEXT_PUBLIC_ENV` | `production` |
| `SENTRY_DSN` | DSN Sentry (monitoring) |

---

## Monitoring

### Vérification de santé

```bash
# Vérification manuelle
npm run health
# → curl http://localhost:3001/

# Ou via Docker
docker logs qvarry-client
```

### Sentry

Sentry est configuré pour capturer les erreurs en production :
- **Client** : `sentry.client.config.ts`
- **Serveur** : `sentry.server.config.ts`
- **Edge** : `sentry.edge.config.ts`
- **Instrumentation** : `instrumentation.ts`, `instrumentation-client.ts`

### Logs Docker

```bash
npm run docker:logs
# → docker logs -f qvarry-client
```

---

## Analyse du bundle

Pour identifier les modules les plus lourds et optimiser le bundle :

```bash
npm run analyze
```

Ouvre un rapport interactif dans le navigateur (via `@next/bundle-analyzer`).

---

## Smoke Tests

Tests de fumée post-déploiement pour vérifier que l'application répond correctement :

```bash
# Test rapide (serveur local sur port 3001)
npm run smoke-test

# Test avec host/port personnalisé
npm run smoke-test:wait localhost 3001
```

Le script `scripts/smoke-test.sh` vérifie :
- `GET /` → 200 OK
- Headers de sécurité présents

---

## Notes de mise en production

1. **Cookie `__Host-token`** : Le back-end doit être configuré pour émettre des cookies avec le préfixe `__Host-` (requis par le middleware IHM en production).
2. **HTTPS obligatoire** : Le préfixe `__Host-` et la directive `Secure` du cookie nécessitent HTTPS. Un proxy inverse (Nginx/Caddy) avec TLS est requis devant le conteneur.
3. **CORS** : L'URL du front-end doit être dans la liste `CLIENT_URL` / `FRONTEND_URL` du back-end.
4. **CSP** : La directive `connect-src` du middleware inclut l'`API_ORIGIN` et le `wsOrigin`. Ils sont calculés dynamiquement depuis `NEXT_PUBLIC_API_URL`.
