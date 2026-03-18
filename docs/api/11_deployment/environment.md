# Variables d'environnement et configurations par environnement

## Vue d'ensemble

Le comportement de QvarryReact.Api varie significativement selon la valeur de `NODE_ENV`. Cette page documente les différences entre les environnements **production** et **développement**, ainsi que toutes les variables d'environnement requises.

---

## Comparaison production vs développement

### Comportement général

| Aspect        | Production                                | Développement           |
| ------------- | ----------------------------------------- | ----------------------- |
| `NODE_ENV`    | `production`                              | `development`           |
| Redis         | Obligatoire (`process.exit(1)` si absent) | Optionnel               |
| Logs format   | JSON uniquement                           | Texte coloré en console |
| Niveau de log | `info`                                    | `debug`                 |
| Source maps   | Absentes (obfusqué)                       | Disponibles             |
| Code          | Obfusqué                                  | TypeScript via ts-node  |

### Sécurité HTTP

| Aspect                     | Production                                 | Développement            |
| -------------------------- | ------------------------------------------ | ------------------------ |
| Cookie `qvarry_jwt` Secure | `true` (HTTPS uniquement)                  | `false` possible         |
| Cookie SameSite            | `Strict`                                   | `Lax` ou `None` possible |
| CORS origines              | Restreint aux origines configurées         | Plus permissif           |
| HSTS                       | Activé (2 ans, preload, includeSubdomains) | Désactivé                |
| TLS MongoDB                | Obligatoire                                | Optionnel                |
| TLS Redis                  | Obligatoire                                | Optionnel                |

### Rate limiting

| Aspect         | Production               | Développement          |
| -------------- | ------------------------ | ---------------------- |
| Multiplicateur | `1x` (valeurs nominales) | `DEV_MULTIPLIER=10`    |
| Exemple login  | 5 tentatives / 15 min    | 50 tentatives / 15 min |

---

## Variables d'environnement complètes

### Serveur

| Variable       | Obligatoire | Exemple                 | Description                    |
| -------------- | ----------- | ----------------------- | ------------------------------ |
| `NODE_ENV`     | Oui         | `production`            | Environnement d'exécution      |
| `PORT`         | Non         | `3000`                  | Port HTTP (défaut: 3000)       |
| `HOSTNAME`     | Non         | `0.0.0.0`               | Adresse d'écoute               |
| `FRONTEND_URL` | Oui         | `https://app.qvarry.fr` | URL du frontend (CORS, emails) |

### Base de données MongoDB

| Variable         | Obligatoire | Description               |
| ---------------- | ----------- | ------------------------- |
| `DB_CONN_STRING` | Oui         | URI de connexion MongoDB  |
| `DB_NAME`        | Oui         | Nom de la base de données |

En production, l'URI doit inclure les options TLS :

```
mongodb+srv://user:pass@cluster.mongodb.net/dbname?tls=true&authSource=admin
```

### Redis

| Variable         | Obligatoire en prod | Description                                |
| ---------------- | ------------------- | ------------------------------------------ |
| `REDIS_ENABLED`  | Oui (`true`)        | Active Redis — `process.exit(1)` si absent |
| `REDIS_HOST`     | Oui                 | Hôte Redis                                 |
| `REDIS_PORT`     | Oui                 | Port Redis (généralement 6379)             |
| `REDIS_PASSWORD` | Oui                 | Mot de passe Redis                         |
| `REDIS_TLS`      | Recommandé          | Active TLS pour Redis                      |

⚠️ Si `REDIS_ENABLED` n'est pas `true` en production, le serveur refuse de démarrer avec `process.exit(1)`.

### Chiffrement

| Variable                       | Obligatoire | Description                            |
| ------------------------------ | ----------- | -------------------------------------- |
| `ENCRYPTION_KEY_MASTER`        | Oui         | Clé AES-256 maître (32 octets minimum) |
| `ENCRYPTION_KEY_COMMUNICATION` | Oui         | Clé pour chiffrement des messages      |
| `EMAIL_HMAC_KEY`               | Oui         | Clé HMAC pour les emails               |

### JWT

| Variable             | Obligatoire | Description                    |
| -------------------- | ----------- | ------------------------------ |
| `JWT_SECRET`         | Oui         | Secret pour les access tokens  |
| `JWT_REFRESH_SECRET` | Oui         | Secret pour les refresh tokens |

### Email (SMTP)

| Variable    | Obligatoire | Description        |
| ----------- | ----------- | ------------------ |
| `SMTP_HOST` | Oui         | Serveur SMTP       |
| `SMTP_PORT` | Oui         | Port SMTP          |
| `SMTP_USER` | Oui         | Identifiant SMTP   |
| `SMTP_PASS` | Oui         | Mot de passe SMTP  |
| `SMTP_FROM` | Oui         | Adresse expéditeur |

### Firebase (notifications push)

| Variable                       | Obligatoire | Description                                |
| ------------------------------ | ----------- | ------------------------------------------ |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | Oui         | JSON complet du compte de service Firebase |

Le JSON doit être encodé sur une seule ligne ou en base64.

### Vonage (SMS)

| Variable             | Obligatoire | Description           |
| -------------------- | ----------- | --------------------- |
| `VONAGE_API_KEY`     | Oui         | Clé API Vonage        |
| `VONAGE_API_SECRET`  | Oui         | Secret API Vonage     |
| `VONAGE_FROM_NUMBER` | Oui         | Numéro expéditeur SMS |

### Cloudflare Turnstile (CAPTCHA)

| Variable               | Obligatoire | Description           |
| ---------------------- | ----------- | --------------------- |
| `TURNSTILE_SECRET_KEY` | Oui         | Clé secrète Turnstile |

### Logs

| Variable    | Obligatoire | Défaut                        | Description                     |
| ----------- | ----------- | ----------------------------- | ------------------------------- |
| `LOG_DIR`   | Non         | `logs`                        | Répertoire de stockage des logs |
| `LOG_LEVEL` | Non         | `info` (prod) / `debug` (dev) | Niveau minimum de log           |

---

## Comportement conditionnel dans le code

### Vérification Redis au démarrage

```typescript
// Dans la configuration de démarrage
if (
  process.env.NODE_ENV === "production" &&
  process.env.REDIS_ENABLED !== "true"
) {
  logger.critical("REDIS_ENABLED doit être true en production");
  process.exit(1);
}
```

### Rate limiter avec multiplicateur développement

```typescript
const DEV_MULTIPLIER =
  process.env.NODE_ENV === "production"
    ? 1
    : parseInt(process.env.DEV_MULTIPLIER || "10");

const loginRateLimit = rateLimit({
  max: 5 * DEV_MULTIPLIER, // 5 en prod, 50 en dev
  windowMs: 15 * 60 * 1000,
});
```

### Cookie sécurisé

```typescript
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
  path: "/",
};
```

---

## Fichier .env — exemple minimal développement

```bash
NODE_ENV=development
PORT=3000
FRONTEND_URL=http://localhost:5173

DB_CONN_STRING=mongodb://localhost:27017
DB_NAME=qvarry_dev

REDIS_ENABLED=false

ENCRYPTION_KEY_MASTER=dev-master-key-exactly-32-chars!!
ENCRYPTION_KEY_COMMUNICATION=dev-comm-key-exactly-32-chars!!!
EMAIL_HMAC_KEY=dev-hmac-key

JWT_SECRET=dev-jwt-secret-key
JWT_REFRESH_SECRET=dev-refresh-secret-key

SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_USER=test
SMTP_PASS=test
SMTP_FROM=noreply@localhost
```

⚠️ Ne jamais commiter le fichier `.env` dans git. Utiliser `.env.example` pour documenter les variables requises sans leurs valeurs réelles.
