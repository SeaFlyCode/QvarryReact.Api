# Docker - Build et Déploiement

## Registre Docker

L'image Docker de l'API Qvarry est publiée sur le registre privé :

```
docker.matheovieilleville.fr/qvarry-api
```

### Tags utilisés

| Tag      | Description                                       |
| -------- | ------------------------------------------------- |
| `latest` | Dernière version stable publiée                   |
| `1.4.2`  | Version sémantique correspondant à `package.json` |

Chaque release publie **deux tags** simultanément : `latest` et la version sémantique. Cela permet de déployer une version précise (`1.4.2`) ou toujours la dernière (`latest`).

---

## Commandes Docker disponibles

### Build de l'image

```bash
# Build standard (avec cache)
npm run docker:build
# Equivalent :
docker build --platform linux/amd64 \
  -t docker.matheovieilleville.fr/qvarry-api:latest \
  -t docker.matheovieilleville.fr/qvarry-api:1.4.2 \
  .

# Build sans cache (force la reconstruction complète)
npm run docker:build:no-cache
# Equivalent :
docker build --platform linux/amd64 --no-cache \
  -t docker.matheovieilleville.fr/qvarry-api:latest \
  .
```

> ⚠️ Le flag `--platform linux/amd64` est obligatoire pour assurer la compatibilité avec les serveurs Linux x86_64, même si le build est effectué sur un Mac Apple Silicon (ARM).

### Push vers le registre privé

```bash
npm run docker:push
# Equivalent :
docker push docker.matheovieilleville.fr/qvarry-api:latest
docker push docker.matheovieilleville.fr/qvarry-api:1.4.2
```

S'authentifier au préalable si nécessaire :

```bash
docker login docker.matheovieilleville.fr
```

### Release complète (build + push)

```bash
npm run docker:release
```

Enchaîne `docker:build` puis `docker:push` en une seule commande.

### Démarrer un conteneur local

```bash
npm run docker:run
# Equivalent :
docker run -d \
  -p 3000:3000 \
  --env-file .env \
  --name qvarry-api \
  docker.matheovieilleville.fr/qvarry-api:latest
```

Le conteneur démarre en mode détaché (`-d`), écoute sur le port `3000`, et charge les variables d'environnement depuis le fichier `.env`.

### Arrêter et supprimer le conteneur

```bash
npm run docker:stop
# Equivalent :
docker stop qvarry-api && docker rm qvarry-api
```

### Suivre les logs en temps réel

```bash
npm run docker:logs
# Equivalent :
docker logs -f qvarry-api
```

---

## Dockerfile (multi-stage)

Le `Dockerfile` utilise un build multi-stage pour produire une image finale légère :

```
Stage 1 : builder
├── Image de base : node:18-alpine
├── Copie du code source et des fichiers de configuration
├── npm ci --only=production  (installation des dépendances)
├── npm run build             (compilation TypeScript → dist/)
└── npm run obfuscate         (obfuscation du JavaScript compilé)

Stage 2 : runtime
├── Image de base : node:18-alpine (image fraîche, sans outils de build)
├── Copie uniquement :
│   ├── dist/                 (code compilé et obfusqué)
│   ├── node_modules/         (dépendances de production uniquement)
│   └── package.json
├── USER node                 (utilisateur non-root)
├── EXPOSE 3000
└── CMD ["node", "dist/server.js"]
```

### Avantages du multi-stage

- L'image finale ne contient pas le code source TypeScript ni les outils de développement
- Le code est obfusqué avant d'être inclus dans l'image
- L'image tourne sous un utilisateur non-root (sécurité)
- La taille de l'image est réduite (pas de devDependencies, pas de ts-node)

---

## Variables d'environnement dans Docker

### En local avec `--env-file`

```bash
docker run -d \
  -p 3000:3000 \
  --env-file .env \
  --name qvarry-api \
  docker.matheovieilleville.fr/qvarry-api:latest
```

### En production (variables injectées par l'orchestrateur)

En production (Kubernetes, Portainer, Docker Swarm, etc.), les variables d'environnement sont injectées par la plateforme de déploiement, jamais via un fichier `.env` embarqué dans l'image.

```bash
# Exemple avec docker run et variables individuelles
docker run -d \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e DB_CONN_STRING="mongodb+srv://..." \
  -e JWT_SECRET="..." \
  --name qvarry-api \
  docker.matheovieilleville.fr/qvarry-api:1.4.2
```

> ⚠️ Ne jamais embarquer le fichier `.env` dans l'image Docker (`COPY .env .`). Les secrets ne doivent jamais être inclus dans une image, même privée. Utiliser des secrets Docker, des variables d'environnement injectées au runtime, ou un gestionnaire de secrets (Vault, etc.).

---

## Workflow de release typique

```bash
# 1. S'assurer que le build TypeScript est propre
npm run type-check

# 2. Lancer les tests
npm test

# 3. Bumper la version dans package.json (manuellement ou via npm version)
# npm version patch   # 1.4.2 → 1.4.3
# npm version minor   # 1.4.2 → 1.5.0
# npm version major   # 1.4.2 → 2.0.0

# 4. Build et push Docker (inclut compilation + obfuscation + push)
npm run docker:release
```

Le script `docker:build` lit automatiquement la version depuis `package.json` pour tagger l'image :

```bash
docker.matheovieilleville.fr/qvarry-api:latest
docker.matheovieilleville.fr/qvarry-api:1.4.2   # ← version lue dynamiquement
```
