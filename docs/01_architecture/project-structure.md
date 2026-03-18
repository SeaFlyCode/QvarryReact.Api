# Structure du Projet

## Arborescence complète

```
QvarryReact.Api/
├── src/                                # Code source TypeScript
│   ├── server.ts                       # Point d'entrée : Express, WebSocket, routes
│   ├── config/                         # Configuration centralisée
│   │   ├── cookieConfig.ts             # Options des cookies HTTP-only (JWT)
│   │   ├── database.ts                 # Connexion MongoDB avec retry/backoff
│   │   ├── rateLimitConfig.ts          # Définition des rate limiters par route
│   │   └── swagger.ts                  # Configuration OpenAPI / Swagger
│   ├── controllers/                    # Handlers de requêtes HTTP
│   │   ├── auth/                       # Controllers d'authentification
│   │   │   ├── authHelpers.ts          # Fonctions partagées auth (cookies, tokens)
│   │   │   ├── index.ts                # Barrel export des controllers auth
│   │   │   ├── loginController.ts      # Connexion, vérification password + 2FA
│   │   │   ├── logoutController.ts     # Déconnexion, invalidation tokens
│   │   │   ├── passwordController.ts   # Reset/changement de mot de passe
│   │   │   └── websocketController.ts  # Authentification WebSocket
│   │   ├── adminControllers.ts         # Gestion admin (users, validation comptes)
│   │   ├── adminSosControllers.ts      # Supervision SOS côté admin
│   │   ├── contactControllers.ts       # Gestion des contacts et demandes
│   │   ├── conversationsControllers.ts # CRUD conversations
│   │   ├── dataShareControllers.ts     # Partage de données entre utilisateurs
│   │   ├── fichesControllers.ts        # CRUD fiches personnelles
│   │   ├── listsControllers.ts         # CRUD listes
│   │   ├── maintenanceController.ts    # Mode maintenance
│   │   ├── messagesControllers.ts      # CRUD messages dans les conversations
│   │   ├── mobilePushTokenControllers.ts # Enregistrement tokens push mobile
│   │   ├── mobileSosControllers.ts     # Déclenchement SOS mobile
│   │   ├── mobileSyncControllers.ts    # Synchronisation données mobile
│   │   ├── mobileTwoFactorControllers.ts # 2FA sur mobile
│   │   ├── mobileAuthControllers.ts    # Auth mobile (login/refresh/logout)
│   │   ├── notificationsControllers.ts # Lecture/gestion notifications
│   │   ├── pointsControllers.ts        # Gestion des points
│   │   ├── securityControllers.ts      # Sessions actives, IPs bloquées
│   │   ├── sessionControllers.ts       # Gestion multi-sessions
│   │   ├── syncControllers.ts          # Synchronisation web
│   │   ├── twoFactorControllers.ts     # 2FA web (setup, verify, disable)
│   │   ├── userControllers.ts          # Profil, paramètres utilisateur
│   │   └── webhookControllers.ts       # Réception webhooks Vonage
│   ├── middlewares/                    # Middlewares Express
│   │   ├── adminMiddleware.ts          # Vérification rôle administrateur
│   │   ├── authMiddleware.ts           # Vérification JWT (web)
│   │   ├── correlationMiddleware.ts    # Génération X-Correlation-ID
│   │   ├── maintenanceMiddleware.ts    # Blocage si mode maintenance actif
│   │   ├── mobileAuthMiddleware.ts     # Vérification JWT mobile (Bearer)
│   │   ├── mobileSecurityMiddleware.ts # Vérifications sécurité mobile
│   │   ├── rateLimitMiddleware.ts      # Rate limiters globaux et par route
│   │   ├── turnstileMiddleware.ts      # Vérification CAPTCHA Cloudflare Turnstile
│   │   └── validateObjectIdMiddleware.ts # Validation format ObjectId MongoDB
│   ├── models/                         # Schémas Mongoose (MongoDB)
│   │   ├── auditLogs.ts                # Logs d'audit des actions sensibles
│   │   ├── blockedIps.ts               # IPs bloquées
│   │   ├── contacts.ts                 # Relations de contact entre utilisateurs
│   │   ├── conversations.ts            # Conversations de messagerie
│   │   ├── cronLock.ts                 # Verrous pour les jobs cron (anti-doublons)
│   │   ├── dataShare.ts                # Partages de données
│   │   ├── deletedData.ts              # Archive des données supprimées
│   │   ├── fiches.ts                   # Fiches personnelles
│   │   ├── keys.ts                     # Clés de chiffrement RSA par utilisateur
│   │   ├── lists.ts                    # Listes
│   │   ├── maintenance.ts              # État du mode maintenance
│   │   ├── messages.ts                 # Messages de conversation
│   │   ├── notifications.ts            # Notifications in-app
│   │   ├── pendingNotification.ts      # Notifications en attente (offline)
│   │   ├── points.ts                   # Points/récompenses utilisateur
│   │   ├── pushToken.ts                # Tokens push mobile (FCM)
│   │   ├── refreshTokens.ts            # Refresh tokens (rotation sécurisée)
│   │   ├── smsDeliveryReceipt.ts       # Accusés de réception SMS Vonage
│   │   ├── sosContact.ts               # Contacts d'urgence SOS
│   │   ├── sosEvent.ts                 # Événements SOS déclenchés
│   │   ├── sosSession.ts               # Sessions SOS actives
│   │   └── users.ts                    # Utilisateurs (profil, auth, paramètres)
│   ├── routes/                         # Définition des routes Express
│   │   ├── adminRoutes.ts              # /api/v1/admin
│   │   ├── authRoutes.ts               # /api/v1/auth
│   │   ├── contactRoutes.ts            # /api/v1/contacts
│   │   ├── conversationsRoutes.ts      # /api/v1/conversations
│   │   ├── dataShareRoutes.ts          # /api/v1/share
│   │   ├── fichesRoutes.ts             # /api/v1/fiches
│   │   ├── listsRoutes.ts              # /api/v1/lists
│   │   ├── maintenanceRoutes.ts        # /api/v1/maintenance
│   │   ├── messagesRoutes.ts           # /api/v1/messages
│   │   ├── mobileAuthRoutes.ts         # /api/v1/mobile/auth
│   │   ├── mobilePushTokenRoutes.ts    # /api/v1/mobile/push-tokens
│   │   ├── mobileSosRoutes.ts          # /api/v1/mobile/sos
│   │   ├── mobileSyncRoutes.ts         # /api/v1/mobile/sync
│   │   ├── mobileTwoFactorRoutes.ts    # /api/v1/mobile/2fa
│   │   ├── notificationsRoutes.ts      # /api/v1/notifications
│   │   ├── pointsRoutes.ts             # /api/v1/points
│   │   ├── publicRoutes.ts             # /public (ressources publiques)
│   │   ├── securityRoutes.ts           # /api/v1/security
│   │   ├── twoFactorRoutes.ts          # /api/v1/2fa
│   │   ├── userRoutes.ts               # /api/v1/users
│   │   └── webhookRoutes.ts            # /webhooks/vonage
│   ├── services/                       # Logique métier
│   │   ├── auditService.ts             # Écriture des logs d'audit
│   │   ├── cronJobs.ts                 # Tâches planifiées générales
│   │   ├── dataArchiveService.ts       # Archivage et purge des données
│   │   ├── dataShareService.ts         # Logique de partage de données
│   │   ├── deviceAttestationService.ts # Vérification d'attestation d'appareil mobile
│   │   ├── emailService.ts             # Envoi d'emails via Nodemailer/SMTP
│   │   ├── ficheService.ts             # Logique métier des fiches
│   │   ├── loggerService.ts            # Configuration Winston (fichiers + console)
│   │   ├── memoryStorageService.ts     # Stockage en mémoire (fallback Redis)
│   │   ├── messageOperationsService.ts # Opérations sur les messages (chiffrement)
│   │   ├── mobileSyncService.ts        # Synchronisation incrémentale mobile
│   │   ├── notificationService.ts      # Envoi notifications in-app et push FCM
│   │   ├── pointService.ts             # Logique des points
│   │   ├── pushTokenService.ts         # Gestion des tokens push FCM
│   │   ├── redisSessionService.ts      # Gestion des sessions dans Redis
│   │   ├── refreshTokenService.ts      # Rotation et validation des refresh tokens
│   │   ├── securityAlertService.ts     # Détection et notification d'alertes sécurité
│   │   ├── sosCronJobs.ts              # Jobs cron spécifiques SOS (timeout, nettoyage)
│   │   ├── sosService.ts               # Logique du système SOS (déclenchement, SMS)
│   │   ├── syncService.ts              # Synchronisation web
│   │   ├── userService.ts              # Logique métier utilisateurs
│   │   ├── validationService.ts        # Validation des données entrantes
│   │   ├── vonageService.ts            # Envoi SMS via Vonage API
│   │   └── webSocketService.ts         # Gestion des connexions WebSocket
│   ├── templates/
│   │   └── emails/                     # Templates HTML pour les emails
│   │       ├── base.html               # Layout de base (header, footer)
│   │       ├── account-approved.html   # Compte validé par l'admin
│   │       ├── account-rejected.html   # Compte refusé par l'admin
│   │       ├── admin-pending-validation.html # Notif admin : nouveau compte à valider
│   │       ├── contact-accepted.html   # Demande de contact acceptée
│   │       ├── contact-request.html    # Nouvelle demande de contact reçue
│   │       ├── email-verification.html # Vérification de l'adresse email
│   │       ├── password-changed.html   # Confirmation changement de mot de passe
│   │       ├── password-reset.html     # Lien de réinitialisation de mot de passe
│   │       ├── security-alert-admin.html # Alerte de sécurité pour l'admin
│   │       ├── security-alert-login.html # Alerte connexion suspecte pour l'utilisateur
│   │       ├── share-notification.html # Notification de partage reçu
│   │       └── welcome.html            # Email de bienvenue
│   ├── types/                          # Déclarations de types TypeScript
│   │   ├── express.d.ts                # Augmentation de Request (user, correlationId…)
│   │   └── jest.d.ts                   # Types custom pour les tests Jest
│   ├── utils/                          # Fonctions utilitaires
│   │   ├── communicationEncryptionUtils.ts # Chiffrement AES des messages
│   │   ├── deviceFingerprint.ts        # Génération empreinte d'appareil
│   │   ├── emailUtils.ts               # Utilitaires email (HMAC masquage)
│   │   ├── errorUtils.ts               # Helpers pour la gestion des erreurs
│   │   ├── jwtKeyManager.ts            # Gestion rotation des clés JWT
│   │   ├── logUtils.ts                 # Helpers de logging structuré
│   │   ├── masterEncryptionUtils.ts    # Chiffrement AES-256 (données au repos)
│   │   ├── passwordUtils.ts            # Validation complexité mot de passe
│   │   ├── rsaEncryptionUtils.ts       # Chiffrement RSA (clés de session)
│   │   ├── sanitizeUtils.ts            # Nettoyage et sanitisation des entrées
│   │   └── userEncryptionUtils.ts      # Chiffrement des données utilisateur
│   └── __tests__/                      # Tests (miroir de la structure src/)
│       ├── routes/                     # Tests d'intégration des routes
│       └── services/                   # Tests unitaires des services
├── dist/                               # Code JavaScript compilé (gitignored)
├── logs/                               # Fichiers de logs Winston (gitignored)
├── scripts/                            # Scripts utilitaires
│   ├── obfuscate.js                    # Obfuscation du code compilé
│   ├── verify-obfuscation.js           # Vérification de l'obfuscation
│   ├── audit-infrastructure.ts         # Audit de l'infrastructure
│   ├── audit-token-refresh.ts          # Audit du mécanisme de refresh token
│   └── audit-stress-test.ts            # Test de charge
├── docs/                               # Documentation technique (ce dossier)
├── Dockerfile                          # Image Docker multi-stage
├── package.json
├── tsconfig.json                       # Configuration TypeScript (développement)
├── tsconfig.prod.json                  # Configuration TypeScript (production)
├── tsconfig.test.json                  # Configuration TypeScript (tests)
├── jest.config.ts                      # Configuration Jest
├── eslint.config.js                    # Configuration ESLint
└── obfuscator.json                     # Options javascript-obfuscator
```

---

## Description des dossiers

### `src/config/`

Centralise toute la configuration de l'application. Chaque fichier exporte une configuration ou une fonction d'initialisation. Cela évite de disperser les paramètres dans les controllers ou services.

### `src/controllers/`

Handlers Express : reçoivent `req`/`res`, appellent les services, retournent la réponse. Ils ne contiennent pas de logique métier. Le sous-dossier `auth/` regroupe les controllers liés à l'authentification pour une meilleure cohésion.

### `src/middlewares/`

Fonctions intermédiaires appliquées avant les controllers. Chaque middleware a une responsabilité unique (authentification, rate limiting, validation, etc.).

### `src/models/`

Schémas Mongoose définissant la structure des collections MongoDB. Chaque fichier correspond à une collection. Les modèles incluent la validation, les index et les hooks si nécessaires.

### `src/routes/`

Définit le mapping URL → middleware(s) → controller. Les routes appliquent les middlewares d'authentification, de validation et de rate limiting appropriés avant de déléguer au controller.

### `src/services/`

Contient toute la logique métier. Les services sont indépendants d'Express (pas de `req`/`res`) et peuvent être testés unitairement. Ils interagissent avec les models, les services tiers (Redis, FCM, Vonage, SMTP) et les utils.

### `src/templates/emails/`

Templates HTML pour les emails transactionnels. Tous héritent du layout `base.html`. Les variables dynamiques sont injectées par `emailService.ts` avant l'envoi.

### `src/types/`

Augmentations et déclarations de types TypeScript. `express.d.ts` étend l'interface `Request` avec les propriétés ajoutées par les middlewares (ex: `req.user`, `req.correlationId`).

### `src/utils/`

Fonctions pures et réutilisables. Particulièrement les utilitaires de chiffrement (AES-256, RSA, HMAC) utilisés par plusieurs services.

### `src/__tests__/`

Tests organisés en miroir de la structure `src/`. Les tests de routes utilisent `supertest` pour les tests d'intégration HTTP. Les tests de services utilisent Jest avec mocking des dépendances externes.

---

## Conventions de nommage

| Type                    | Convention                     | Exemple                          |
| ----------------------- | ------------------------------ | -------------------------------- |
| Fichiers de controllers | `camelCase` + `Controllers.ts` | `fichesControllers.ts`           |
| Fichiers de routes      | `camelCase` + `Routes.ts`      | `fichesRoutes.ts`                |
| Fichiers de services    | `camelCase` + `Service.ts`     | `ficheService.ts`                |
| Fichiers de modèles     | `camelCase` (pluriel)          | `fiches.ts`, `users.ts`          |
| Fichiers de middlewares | `camelCase` + `Middleware.ts`  | `authMiddleware.ts`              |
| Fichiers d'utils        | `camelCase` + `Utils.ts`       | `sanitizeUtils.ts`               |
| Fichiers de config      | `camelCase` + `Config.ts`      | `cookieConfig.ts`                |
| Fichiers de tests       | `nomOriginal.test.ts`          | `ficheService.test.ts`           |
| Classes / Interfaces    | `PascalCase`                   | `UserDocument`, `AuthService`    |
| Variables / Fonctions   | `camelCase`                    | `getUserById`, `refreshToken`    |
| Constantes              | `UPPER_SNAKE_CASE`             | `JWT_EXPIRES_IN`, `MAX_SESSIONS` |
