# Variables d'Environnement

## Générer les secrets

Avant de configurer le fichier `.env`, générer les secrets cryptographiques requis :

```bash
# Secret JWT (minimum 32 octets recommandé, 64 hex chars = 32 bytes)
openssl rand -hex 32

# Clés de chiffrement AES-256 (64 hex chars = 32 bytes = 256 bits)
openssl rand -hex 32

# Secrets HMAC
openssl rand -hex 32
```

> ⚠️ Chaque secret doit être **unique** par environnement (développement, staging, production). Ne jamais réutiliser les mêmes valeurs entre environnements.

---

## Tableau complet des variables

### Général

| Variable       | Obligatoire | Description                        | Exemple                      |
| -------------- | ----------- | ---------------------------------- | ---------------------------- |
| `NODE_ENV`     | Oui         | Environnement d'exécution          | `development` / `production` |
| `PORT`         | Non         | Port d'écoute du serveur           | `3000`                       |
| `CLIENT_URL`   | Oui         | URL du client web (CORS)           | `https://app.qvarry.fr`      |
| `FRONTEND_URL` | Oui         | URL alternative du frontend (CORS) | `https://qvarry.fr`          |

### Secrets et Authentification

| Variable                       | Obligatoire | Description                                 | Exemple                      |
| ------------------------------ | ----------- | ------------------------------------------- | ---------------------------- |
| `JWT_SECRET`                   | Oui         | Secret de signature des JWT                 | `a3f8...` (64 hex chars min) |
| `JWT_EXPIRES_IN`               | Non         | Durée de vie des access tokens              | `15m`                        |
| `ENCRYPTION_KEY_MASTER`        | Oui         | Clé AES-256 pour les données au repos       | `a3f8...` (64 hex chars)     |
| `ENCRYPTION_KEY_COMMUNICATION` | Oui         | Clé AES-256 pour les messages               | `b7e2...` (64 hex chars)     |
| `IP_HASH_SECRET`               | Oui         | HMAC pour le hachage des adresses IP        | `c9d1...` (64 hex chars)     |
| `EMAIL_HMAC_KEY`               | Oui         | HMAC pour le masquage des emails en logs    | `d4a5...` (64 hex chars)     |
| `REFRESH_TOKEN_EXPIRES_IN`     | Non         | Durée de vie des refresh tokens (en heures) | `48`                         |

> ⚠️ `ENCRYPTION_KEY_MASTER` et `ENCRYPTION_KEY_COMMUNICATION` doivent faire exactement 64 caractères hexadécimaux (32 bytes). Une valeur incorrecte provoque une erreur au démarrage.

### Base de données

| Variable         | Obligatoire | Description                               | Exemple                                       |
| ---------------- | ----------- | ----------------------------------------- | --------------------------------------------- |
| `DB_CONN_STRING` | Oui         | URI de connexion MongoDB                  | `mongodb+srv://user:pass@cluster.mongodb.net` |
| `DB_NAME`        | Non         | Nom de la base de données                 | `QvarryStorage`                               |
| `DB_SSL`         | Non         | Activer SSL/TLS pour la connexion MongoDB | `true`                                        |

### Redis

| Variable         | Obligatoire       | Description                              | Exemple             |
| ---------------- | ----------------- | ---------------------------------------- | ------------------- |
| `REDIS_ENABLED`  | Non               | Activer Redis (false = fallback mémoire) | `true`              |
| `REDIS_HOST`     | Si Redis activé   | Hôte Redis                               | `redis.example.com` |
| `REDIS_PORT`     | Non               | Port Redis                               | `6379`              |
| `REDIS_PASSWORD` | Si Redis sécurisé | Mot de passe Redis                       | `secret_password`   |
| `REDIS_DB`       | Non               | Index de la base Redis                   | `0`                 |
| `REDIS_TLS`      | Non               | Activer TLS pour la connexion Redis      | `true`              |

### CAPTCHA

| Variable               | Obligatoire   | Description                            | Exemple      |
| ---------------------- | ------------- | -------------------------------------- | ------------ |
| `TURNSTILE_SECRET_KEY` | En production | Clé secrète Cloudflare Turnstile       | `0x4AAAA...` |
| `BYPASS_CAPTCHA`       | Non           | Désactiver le CAPTCHA (dev uniquement) | `false`      |

> ⚠️ `BYPASS_CAPTCHA=true` ne doit jamais être utilisé en production. Cette valeur désactive entièrement la protection CAPTCHA sur les routes d'authentification.

### Email (SMTP)

| Variable     | Obligatoire | Description        | Exemple                   |
| ------------ | ----------- | ------------------ | ------------------------- |
| `SMTP_HOST`  | Oui         | Serveur SMTP       | `smtp.mailgun.org`        |
| `SMTP_PORT`  | Non         | Port SMTP          | `587`                     |
| `SMTP_USER`  | Oui         | Identifiant SMTP   | `postmaster@mg.qvarry.fr` |
| `SMTP_PASS`  | Oui         | Mot de passe SMTP  | `key-xxxxx`               |
| `EMAIL_FROM` | Non         | Adresse expéditeur | `noreply@qvarry.fr`       |

### Mobile

| Variable               | Obligatoire | Description                       | Exemple         |
| ---------------------- | ----------- | --------------------------------- | --------------- |
| `MIN_IOS_VERSION`      | Non         | Version iOS minimale acceptée     | `2.1.0`         |
| `MIN_ANDROID_VERSION`  | Non         | Version Android minimale acceptée | `2.1.0`         |
| `MOBILE_BUNDLE_ID_IOS` | Non         | Bundle ID de l'app iOS            | `fr.qvarry.app` |

### SOS / Vonage

| Variable            | Obligatoire        | Description           | Exemple          |
| ------------------- | ------------------ | --------------------- | ---------------- |
| `VONAGE_API_KEY`    | Oui (si SOS actif) | Clé API Vonage        | `12345678`       |
| `VONAGE_API_SECRET` | Oui (si SOS actif) | Secret API Vonage     | `abcdefXXXXXXXX` |
| `VONAGE_SMS_FROM`   | Non                | Numéro expéditeur SMS | `Qvarry`         |

### Firebase (Push Notifications)

| Variable                   | Obligatoire         | Description                                     | Exemple                          |
| -------------------------- | ------------------- | ----------------------------------------------- | -------------------------------- |
| `FIREBASE_SERVICE_ACCOUNT` | Oui (si push actif) | JSON du compte de service Firebase (stringifié) | `{"type":"service_account",...}` |

> ⚠️ `FIREBASE_SERVICE_ACCOUNT` contient le JSON complet du fichier de clé de service Firebase. Il doit être passé comme une chaîne JSON sur une seule ligne. Ne jamais commiter ce fichier ou cette valeur dans le code source.

### Sessions

| Variable                 | Obligatoire | Description                                            | Exemple |
| ------------------------ | ----------- | ------------------------------------------------------ | ------- |
| `REQUIRE_ACTIVE_SESSION` | Non         | Exiger une session Redis active pour valider un JWT    | `true`  |
| `SESSION_TTL`            | Non         | Durée de vie d'une session (secondes)                  | `3600`  |
| `MAX_SESSIONS_PER_USER`  | Non         | Nombre maximum de sessions simultanées par utilisateur | `5`     |

### Logging

| Variable    | Obligatoire | Description                              | Exemple                    |
| ----------- | ----------- | ---------------------------------------- | -------------------------- |
| `LOG_LEVEL` | Non         | Niveau de log Winston                    | `info` / `debug` / `error` |
| `LOG_DIR`   | Non         | Dossier de stockage des fichiers de logs | `logs`                     |

---

## Différences développement vs production

| Paramètre        | Développement        | Production           |
| ---------------- | -------------------- | -------------------- |
| `NODE_ENV`       | `development`        | `production`         |
| `DB_SSL`         | `false`              | `true`               |
| `REDIS_ENABLED`  | `false` (optionnel)  | `true`               |
| `BYPASS_CAPTCHA` | `true`               | `false`              |
| `LOG_LEVEL`      | `debug`              | `info`               |
| `REDIS_TLS`      | `false`              | `true`               |
| Pool MongoDB     | 10 connexions max    | 50 connexions max    |
| Swagger UI       | Activé (`/api-docs`) | Désactivé            |
| Obfuscation code | Non                  | Oui (`build:prod`)   |
| `SESSION_TTL`    | 3600 (1h)            | 3600 (1h) recommandé |
| `JWT_EXPIRES_IN` | `15m`                | `15m`                |
