# Docker — IHM Qvarry

## Image Docker

L'IHM Qvarry est conteneurisée via un `Dockerfile` multi-stage optimisé pour la production.

**Registry** : `docker.matheovieilleville.fr`  
**Image** : `qvarry-client`

---

## Commandes Docker

### Build de l'image

```bash
# Build standard (avec cache Docker)
npm run docker:build

# Build sans cache (rebuild complet)
npm run docker:build:no-cache
```

Ces commandes produisent deux tags :
- `docker.matheovieilleville.fr/qvarry-client:latest`
- `docker.matheovieilleville.fr/qvarry-client:<version>` (issue du `package.json`)

### Push vers le registry

```bash
npm run docker:push
```

### Build + Push en une commande

```bash
npm run docker:release
```

### Démarrage du conteneur

```bash
npm run docker:run
```

→ Lance le conteneur `qvarry-client` sur le port **3001**, avec les variables depuis `.env`.

### Arrêt du conteneur

```bash
npm run docker:stop
```

### Logs en temps réel

```bash
npm run docker:logs
```

---

## Commande manuelle

```bash
docker run -d \
  -p 3001:3001 \
  --env-file .env \
  --name qvarry-client \
  docker.matheovieilleville.fr/qvarry-client:latest
```

---

## Test de production local

```bash
# Build no-cache + run + smoke-test + stop
npm run test:prod

# Test de fumée seul (serveur déjà démarré)
npm run smoke-test

# Test local en mode production simulé
npm run test:local-prod
```

---

## Architecture plateforme

L'image est buildée pour la plateforme `linux/amd64` (compatible x86_64 serveurs Linux, même depuis un Mac Apple Silicon) :

```bash
docker build --platform linux/amd64 ...
```
