# Déploiement Docker

## Vue d'ensemble

L'image Docker de QvarryReact.Api est construite en **4 stages** (multi-stage build) pour produire une image de production sécurisée, compacte, et avec le code source obfusqué.

```
┌─────────────┐    ┌──────────────┐    ┌─────────┐    ┌────────────┐
│   builder   │───►│  obfuscator  │    │  deps   │    │ production │
│ node:20-alp │    │ node:20-alp  │    │node:20  │    │ node:20-alp│
│             │    │              │    │         │    │            │
│ npm install │    │ dist/ copié  │    │npm i    │    │ dist/ obf. │
│ npm build   │    │ obfuscation  │    │--omit   │    │ node_mods  │
│ → dist/     │    │ vérification │    │=dev     │    │ templates/ │
└─────────────┘    └──────┬───────┘    └────┬────┘    └────────────┘
                          │                 │               ▲▲
                          └─────────────────┴───────────────┘
```

---

## Stage 1 : builder

**Image de base :** `node:20-alpine`

```dockerfile
# Installation des dépendances (sans exécuter les scripts npm)
RUN npm install --ignore-scripts

# Compilation TypeScript
RUN npm run build
```

Ce stage produit le répertoire `dist/` contenant le JavaScript compilé depuis TypeScript. Le flag `--ignore-scripts` empêche l'exécution de scripts potentiellement dangereux lors de l'installation des dépendances.

---

## Stage 2 : obfuscator

**Image de base :** `node:20-alpine`

```dockerfile
# Copie des fichiers compilés depuis le stage builder
COPY --from=builder /app/dist ./dist

# Installation de l'obfuscateur
RUN npm install javascript-obfuscator@4.1.1

# Obfuscation (stack augmentée pour les gros fichiers)
RUN node --stack-size=8192 scripts/obfuscate.js

# Vérification de l'obfuscation
RUN node scripts/verify-obfuscation.js
```

L'option `--stack-size=8192` augmente la pile d'appel Node.js pour gérer les gros fichiers sans Stack Overflow.

---

## Stage 3 : deps

**Image de base :** `node:20-alpine`

```dockerfile
# Uniquement les dépendances de production
RUN npm install --omit=dev --ignore-scripts
```

Ce stage isolé permet de ne pas contaminer l'image finale avec les outils de développement (TypeScript, ts-node, jest, etc.).

---

## Stage 4 : production

**Image de base :** `node:20-alpine`

### Utilisateur non-root

```dockerfile
RUN addgroup -g 1001 nodejs && \
    adduser -u 1001 -G nodejs -s /bin/sh -D appuser

USER appuser
```

L'application tourne sous l'utilisateur `appuser` (UID 1001, groupe `nodejs`), jamais sous `root`.

### Contenu de l'image finale

```
/app/
├── dist/           ← Code JavaScript obfusqué (depuis stage obfuscator)
│   └── templates/  ← Templates d'emails (copiés depuis src/templates/)
└── node_modules/   ← Dépendances production uniquement (depuis stage deps)
```

### Nettoyage de sécurité

Les fichiers suivants sont supprimés de l'image finale :

```
*.ts, *.tsx         — Sources TypeScript
*.map               — Source maps (faciliteraient le débogage)
*.d.ts              — Déclarations TypeScript
.env*               — Variables d'environnement
*.md                — Documentation
.git*               — Métadonnées git
```

### Permissions

```dockerfile
RUN chmod -R 550 /app
```

Les fichiers sont en lecture+exécution uniquement (pas d'écriture), y compris pour le propriétaire.

### Variables d'environnement Docker

| Variable       | Valeur             |
| -------------- | ------------------ |
| `NODE_ENV`     | `production`       |
| `NODE_OPTIONS` | `--no-deprecation` |
| `HOSTNAME`     | `0.0.0.0`          |
| `LOG_DIR`      | `/app/logs`        |

### Port exposé

```dockerfile
EXPOSE 3000
```

### Healthcheck

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --spider http://localhost:3000/health || exit 1
```

| Paramètre      | Valeur                                     |
| -------------- | ------------------------------------------ |
| `interval`     | 30 secondes                                |
| `timeout`      | 10 secondes                                |
| `start-period` | 30 secondes (délai avant le premier check) |
| `retries`      | 3 tentatives avant UNHEALTHY               |

### Commande de démarrage

```dockerfile
CMD ["node", "dist/server.js"]
```

### Labels de sécurité

```dockerfile
LABEL security.obfuscation="enabled"
LABEL security.level="enterprise"
LABEL security.source-code="removed"
LABEL security.source-maps="removed"
```

---

## Registre et tags

- **Registre privé :** `docker.matheovieilleville.fr`
- **Tags générés :**
  - `docker.matheovieilleville.fr/qvarry-api:latest`
  - `docker.matheovieilleville.fr/qvarry-api:<version>` (lu depuis `package.json`)

---

## Commandes npm disponibles

### Build

| Commande                        | Description                                      |
| ------------------------------- | ------------------------------------------------ |
| `npm run docker:build`          | Build pour `linux/amd64`, tag `latest` + version |
| `npm run docker:build:no-cache` | Build sans cache (reconstruction complète)       |

### Publication

| Commande                 | Description                                 |
| ------------------------ | ------------------------------------------- |
| `npm run docker:push`    | Push `latest` + version vers le registre    |
| `npm run docker:release` | Build + push (commande complète de release) |

### Exécution locale

| Commande              | Description                                                   |
| --------------------- | ------------------------------------------------------------- |
| `npm run docker:run`  | Démarre le conteneur avec `.env`, port 3000, nom `qvarry-api` |
| `npm run docker:stop` | Arrête et supprime le conteneur `qvarry-api`                  |
| `npm run docker:logs` | Affiche les logs en temps réel (`--follow`)                   |

### Exemple de run manuel

```bash
docker run -d \
  --name qvarry-api \
  --env-file .env \
  -p 3000:3000 \
  -v $(pwd)/logs:/app/logs \
  docker.matheovieilleville.fr/qvarry-api:latest
```

⚠️ En production, monter le répertoire `/app/logs` comme volume pour persister les logs en dehors du conteneur.
