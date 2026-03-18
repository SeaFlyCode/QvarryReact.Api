# Installation et Setup Local

## Prérequis

| Outil   | Version minimale | Notes                                        |
| ------- | ---------------- | -------------------------------------------- |
| Node.js | 18.x LTS         | Utiliser nvm ou fnm pour gérer les versions  |
| npm     | 9.x              | Fourni avec Node.js                          |
| MongoDB | 6.x              | Instance locale ou MongoDB Atlas             |
| Redis   | 7.x              | Optionnel en développement (voir ci-dessous) |
| Git     | 2.x              | Pour cloner le dépôt                         |

### MongoDB en développement

Une instance MongoDB locale suffit. Vous pouvez utiliser MongoDB Community Edition ou démarrer un conteneur Docker :

```bash
docker run -d -p 27017:27017 --name mongodb-local mongo:6
```

### Redis en développement

Redis est optionnel en développement. Si `REDIS_ENABLED=false` dans le `.env`, l'application utilise un stockage en mémoire (`memoryStorageService`) comme fallback. Les sessions et le rate limiting fonctionneront mais ne persisteront pas entre les redémarrages.

---

## Étapes d'installation

### 1. Cloner le dépôt

```bash
git clone <url-du-depot> QvarryReact.Api
cd QvarryReact.Api
```

### 2. Installer les dépendances

```bash
npm install
```

### 3. Configurer les variables d'environnement

```bash
cp .env.example .env
```

Ouvrir `.env` et renseigner au minimum les variables requises (voir section suivante).

---

## Configuration minimale pour démarrer

Les variables indispensables pour lancer l'API en développement :

```env
# Environnement
NODE_ENV=development
PORT=3000
CLIENT_URL=http://localhost:5173
FRONTEND_URL=http://localhost:5173

# Secrets JWT (générer avec : openssl rand -hex 32)
JWT_SECRET=votre_secret_jwt_64_hex_chars_minimum
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=48

# Chiffrement (générer avec : openssl rand -hex 32)
ENCRYPTION_KEY_MASTER=<64 hex chars>
ENCRYPTION_KEY_COMMUNICATION=<64 hex chars>
IP_HASH_SECRET=<32 hex chars>
EMAIL_HMAC_KEY=<32 hex chars>

# Base de données
DB_CONN_STRING=mongodb://localhost:27017
DB_NAME=QvarryStorage
DB_SSL=false

# Redis (désactiver en dev si non installé)
REDIS_ENABLED=false

# CAPTCHA (désactiver en dev)
BYPASS_CAPTCHA=true

# Email (optionnel en dev, utiliser un service SMTP de test)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=dev@example.com
SMTP_PASS=password
EMAIL_FROM=noreply@qvarry.fr

# Logging
LOG_LEVEL=debug
LOG_DIR=logs
```

> ⚠️ Ne jamais commiter le fichier `.env` dans le dépôt Git. Il est listé dans `.gitignore`.

---

## Commandes de démarrage

### Développement (avec hot-reload)

```bash
npm run dev
```

Lance `nodemon` sur `src/server.ts`. L'application redémarre automatiquement à chaque modification de fichier TypeScript.

### Développement avec debug

```bash
npm run dev:debug
```

Lance nodemon avec le flag `--inspect` et active tous les logs de debug (`DEBUG=*`). Se connecter via Chrome DevTools ou VSCode Debugger sur `ws://localhost:9229`.

### Production (après build)

```bash
npm run build        # Compile TypeScript vers dist/
npm run start:prod   # Lance dist/server.js avec NODE_ENV=production
```

---

## Vérification que l'API fonctionne

Une fois le serveur démarré, tester l'endpoint de health check :

```bash
curl http://localhost:3000/health
```

Réponse attendue :

```json
{
  "status": "ok",
  "uptime": 12.5,
  "timestamp": "2026-03-18T12:00:00.000Z"
}
```

Si la réponse est `200 OK` avec `"status": "ok"`, l'API est opérationnelle.

### Vérifier la connexion MongoDB

Les logs au démarrage indiquent l'état de la connexion :

```
[INFO] Connexion MongoDB établie - QvarryStorage
```

### Accéder à la documentation Swagger

```
http://localhost:3000/api-docs
```

> ⚠️ La documentation Swagger est disponible uniquement en mode `development`. Elle est désactivée en production pour ne pas exposer la structure de l'API.
