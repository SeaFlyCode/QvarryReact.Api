# Stack Technique

## Vue d'ensemble

| Catégorie                 | Technologie                        | Version          | Rôle                                              |
| ------------------------- | ---------------------------------- | ---------------- | ------------------------------------------------- |
| Runtime                   | Node.js                            | ≥ 18             | Environnement d'exécution JavaScript côté serveur |
| Langage                   | TypeScript                         | ^5.9.3           | Typage statique, meilleure maintenabilité         |
| Framework                 | Express                            | ^5.2.1           | Routage HTTP, middleware chain                    |
| Base de données           | MongoDB Atlas                      | —                | Stockage principal des données (NoSQL)            |
| ODM                       | Mongoose                           | ^8.15.0          | Modélisation des documents MongoDB                |
| Cache / Sessions          | Redis (ioredis)                    | ^5.9.2           | Sessions, rate limiting distribué, cache          |
| WebSocket                 | ws                                 | ^8.18.3          | Notifications et messagerie temps réel            |
| Push notifications        | Firebase Admin (FCM)               | ^13.7.0          | Push notifications iOS/Android                    |
| SMS                       | Vonage (via HTTP)                  | —                | Alertes SOS par SMS                               |
| Email                     | Nodemailer                         | ^7.0.12          | Emails transactionnels (SMTP)                     |
| Authentification          | jsonwebtoken                       | ^9.0.2           | Génération et vérification des JWT                |
| Chiffrement mots de passe | bcrypt                             | ^6.0.0           | Hashage des mots de passe                         |
| 2FA                       | otpauth                            | ^9.5.0           | Génération/vérification TOTP                      |
| QR Code                   | qrcode                             | ^1.5.4           | Génération QR codes pour 2FA                      |
| Sécurité headers          | helmet                             | ^8.1.0           | CSP, HSTS, X-Frame-Options, etc.                  |
| Rate limiting             | express-rate-limit                 | ^7.5.0           | Protection contre les abus                        |
| CORS                      | cors                               | ^2.8.5           | Contrôle des origines autorisées                  |
| Cookies                   | cookie-parser                      | ^1.4.7           | Parsing des cookies HTTP-only                     |
| Logging HTTP              | morgan                             | ^1.10.0          | Logs des requêtes HTTP                            |
| Logging applicatif        | winston + rotate                   | ^3.19.0 / ^5.0.0 | Logs structurés avec rotation quotidienne         |
| Compression               | compression                        | ^1.8.1           | Compression gzip des réponses                     |
| Tâches planifiées         | node-cron                          | ^4.2.1           | Jobs périodiques (nettoyage, archivage)           |
| Documentation API         | swagger-jsdoc + swagger-ui-express | ^6.2.8 / ^5.0.1  | Documentation OpenAPI interactive                 |
| Variables d'environnement | dotenv                             | ^16.4.7          | Chargement du fichier .env                        |

---

## Dépendances de production

```json
{
  "bcrypt": "^6.0.0",
  "compression": "^1.8.1",
  "cookie-parser": "^1.4.7",
  "cors": "^2.8.5",
  "dotenv": "^16.4.7",
  "express": "^5.2.1",
  "express-rate-limit": "^7.5.0",
  "firebase-admin": "^13.7.0",
  "helmet": "^8.1.0",
  "ioredis": "^5.9.2",
  "jsonwebtoken": "^9.0.2",
  "mongodb": "^6.15.0",
  "mongoose": "^8.15.0",
  "morgan": "^1.10.0",
  "node-cron": "^4.2.1",
  "nodemailer": "^7.0.12",
  "otpauth": "^9.5.0",
  "qrcode": "^1.5.4",
  "swagger-jsdoc": "^6.2.8",
  "swagger-ui-express": "^5.0.1",
  "winston": "^3.19.0",
  "winston-daily-rotate-file": "^5.0.0",
  "ws": "^8.18.3"
}
```

---

## Dépendances de développement

```json
{
  "@types/bcrypt": "^5.0.2",
  "@types/compression": "^1.8.1",
  "@types/cookie-parser": "^1.4.9",
  "@types/cors": "^2.8.18",
  "@types/express": "^4.17.21",
  "@types/jest": "^29.5.14",
  "@types/jsonwebtoken": "^9.0.9",
  "@types/morgan": "^1.9.9",
  "@types/node": "^22.13.14",
  "@types/node-cron": "^3.0.11",
  "@types/nodemailer": "^7.0.5",
  "@types/qrcode": "^1.5.6",
  "@types/supertest": "^6.0.2",
  "@types/swagger-jsdoc": "^6.0.4",
  "@types/swagger-ui-express": "^4.1.8",
  "@types/ws": "^8.18.1",
  "@typescript-eslint/eslint-plugin": "^8.0.0",
  "@typescript-eslint/parser": "^8.0.0",
  "axios": "^1.7.0",
  "eslint": "^10.0.1",
  "eslint-config-prettier": "^9.1.0",
  "javascript-obfuscator": "^4.1.1",
  "jest": "^29.0.0",
  "jest-junit": "^16.0.0",
  "nodemon": "^3.1.9",
  "prettier": "^3.3.0",
  "supertest": "^7.0.0",
  "ts-jest": "^29.0.0",
  "ts-node": "^10.9.2",
  "typescript": "^5.9.3"
}
```

---

## Justification des choix techniques

### Express v5

Express v5 apporte la gestion native des erreurs asynchrones (les rejections de promesses non gérées dans les route handlers sont automatiquement transmises au middleware d'erreur), sans nécessiter de wrapper `try/catch` ou de librairie tierce comme `express-async-errors`. Cela simplifie significativement le code des controllers.

### `ws` plutôt que Socket.io

`ws` est une implémentation WebSocket pure et légère (protocole RFC 6455). Socket.io ajoute une couche d'abstraction avec polling long comme fallback et un protocole propriétaire. Pour une API mobile-first où les clients supportent nativement WebSocket, `ws` suffit et réduit la surface d'attaque ainsi que le poids du bundle serveur.

### MongoDB Atlas + Mongoose

MongoDB convient au stockage de données hétérogènes (fiches, contacts, messages) dont le schéma peut évoluer. Mongoose apporte la validation de schéma, les hooks (pre/post save) et une API ODM fluide. Atlas gère la haute disponibilité, les backups et le SSL/TLS sans infrastructure propre.

### Redis (ioredis)

Redis est utilisé pour la gestion des sessions (TTL natif), le rate limiting distribué (compteurs partagés entre instances), et la mise en cache. `ioredis` est la librairie cliente la plus robuste pour Node.js, avec support TLS, reconnexion automatique et interface Promises.

### JWT en cookie HTTP-only (web) / Bearer token (mobile)

Les cookies HTTP-only empêchent l'accès aux tokens via JavaScript (protection XSS) pour les clients web. Les applications mobiles ne disposant pas d'un contexte de cookies géré par le navigateur, elles utilisent le header `Authorization: Bearer` standard.

### TypeScript

Le typage statique détecte les erreurs à la compilation, améliore l'autocomplétion et rend le code plus maintenable sur un projet multi-développeurs. Les types sont définis pour Express (augmentation de `Request`), les modèles Mongoose et les réponses API.

### Obfuscation du code en production

Le script `npm run obfuscate` (via `javascript-obfuscator`) transforme le JavaScript compilé avant le push Docker. Cela protège la propriété intellectuelle et rend plus difficile l'analyse du code en cas de compromission du conteneur.

> ⚠️ Les secrets (clés JWT, clés de chiffrement, credentials services tiers) ne doivent jamais être embarqués dans le code source ni dans l'image Docker. Ils sont injectés exclusivement via les variables d'environnement au démarrage du conteneur.
