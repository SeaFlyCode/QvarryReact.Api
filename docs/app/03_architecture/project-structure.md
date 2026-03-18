# Structure du projet — Application Mobile Qvarry

## Arborescence racine

```
Qvarry-phone/
├── App.tsx                    ← Point d'entrée React (providers + navigation)
├── index.js                   ← Point d'entrée React Native
├── app.json                   ← Configuration de l'application
├── package.json               ← Dépendances npm
├── tsconfig.json              ← Configuration TypeScript
├── babel.config.js            ← Configuration Babel (alias @/)
├── metro.config.js            ← Configuration Metro bundler
├── jest.config.js             ← Configuration Jest
├── jest.setup.js              ← Setup des tests
├── eslint.config.js           ← Configuration ESLint
├── react-native.config.js     ← Configuration React Native CLI
├── shim.js                    ← Polyfills globaux
├── .env.example               ← Template des variables d'environnement
├── .env.local                 ← Variables locales (non commité)
├── .nvmrc                     ← Version Node.js recommandée
│
├── src/                       ← Code source principal
│   ├── components/            ← Composants réutilisables
│   ├── config/                ← Configuration de l'app (ENV, etc.)
│   ├── constants/             ← Constantes (thème, layout, couleurs)
│   ├── contexts/              ← Context Providers React
│   ├── hooks/                 ← Hooks personnalisés
│   ├── navigation/            ← Navigateurs React Navigation
│   ├── screens/               ← Écrans de l'application
│   ├── services/              ← Services (API, WebSocket, sécurité, push)
│   ├── types/                 ← Types TypeScript partagés
│   └── utils/                 ← Utilitaires (logger, etc.)
│
├── android/                   ← Code natif Android
├── ios/                       ← Code natif iOS
├── assets/                    ← Images, polices, ressources statiques
├── docs/                      ← Documentation
└── scripts/                   ← Scripts de build et lancement
```

---

## Détail de `src/`

### `src/screens/` — Écrans

```
screens/
├── auth/
│   ├── LoginScreen.tsx
│   ├── ForgotPasswordScreen.tsx
│   └── index.ts
├── fiches/
│   ├── FichesScreen.tsx
│   ├── FicheDetailScreen.tsx
│   ├── FicheFormScreen.tsx
│   └── index.ts
├── lists/
│   ├── ListsScreen.tsx
│   ├── ListDetailScreen.tsx
│   ├── ListFormScreen.tsx
│   ├── SharedListsScreen.tsx
│   └── index.ts
├── map/
│   ├── LeafletMapScreen.tsx
│   ├── PointDetailScreen.tsx
│   ├── PointFormScreen.tsx
│   ├── SearchScreen.tsx
│   ├── UndergroundNavScreen.tsx
│   └── index.ts
├── messages/
│   ├── MessagesScreen.tsx
│   ├── ConversationsScreen.tsx
│   ├── ChatScreen.tsx
│   ├── ContactsScreen.tsx
│   ├── ContactRequestsScreen.tsx
│   ├── ConfirmContactScreen.tsx
│   ├── NewConversationScreen.tsx
│   ├── MyCodeScreen.tsx
│   └── index.ts
├── profile/
│   ├── ProfileScreen.tsx
│   ├── EditProfileScreen.tsx
│   ├── SettingsScreen.tsx
│   ├── SecurityScreen.tsx
│   ├── NotificationsScreen.tsx
│   ├── UserPointsScreen.tsx
│   ├── CacheManagementScreen.tsx
│   ├── OfflineMapScreen.tsx
│   ├── HelpScreen.tsx
│   ├── AboutScreen.tsx
│   └── index.ts
├── sos/
│   ├── SosDashboardScreen.tsx
│   ├── SosActivationScreen.tsx
│   ├── SosActiveScreen.tsx
│   ├── SosAlarmScreen.tsx
│   ├── SosContactsScreen.tsx
│   ├── SosQuickActivationScreen.tsx
│   ├── SosHistoryScreen.tsx
│   ├── SosHistoryDetailScreen.tsx
│   ├── SosStatsScreen.tsx
│   ├── SosWidgetConfigScreen.tsx
│   └── index.ts
└── admin/
    └── sos/
```

### `src/components/` — Composants

```
components/
├── __tests__/
├── admin/
├── animations/
├── fiches/
├── messaging/
├── sos/
├── AnimatedHeader.tsx
├── BiometricLockScreen.tsx
├── CustomAlert.tsx
├── DegradedModeBanner.tsx
├── FicheCard.tsx
├── InAppMessageToast.tsx
├── InputModal.tsx
├── MaintenanceModal.tsx
├── OfflineDownloadWebView.tsx
├── SessionExpiredModal.tsx
├── SosActiveBanner.tsx
├── SplashLoader.tsx
├── SwipeableRow.tsx
└── index.ts
```

### `src/services/` — Services

```
services/
├── api/
│   ├── config.ts          ← Base URL, headers, ApiError, fetchWithAuth
│   ├── secureFetch.ts     ← Fetch sécurisé (whitelist domaines, HTTPS only)
│   ├── auth.ts            ← Authentification (login, logout, refresh)
│   ├── fiches.ts          ← CRUD fiches
│   ├── lists.ts           ← CRUD listes
│   ├── points.ts          ← Points de fidélité
│   ├── contacts.ts        ← Gestion des contacts
│   ├── conversations.ts   ← Conversations
│   ├── notifications.ts   ← Notifications
│   ├── sos.ts             ← Système SOS
│   ├── adminSos.ts        ← Admin SOS
│   ├── sync.ts            ← Synchronisation offline-first
│   ├── users.ts           ← Profil utilisateur
│   ├── pushToken.ts       ← Enregistrement token FCM
│   ├── share.ts           ← Partage de données
│   ├── tokenStore.ts      ← Gestion du token en mémoire
│   ├── secureTokenStore.ts ← Stockage sécurisé des tokens
│   ├── refreshManager.ts  ← Refresh automatique du token
│   ├── websocket.ts       ← Client WebSocket
│   └── index.ts
├── push/
│   └── PushNotificationService.ts
├── security/
│   └── deviceIntegrity.ts ← Détection jailbreak / root
├── sos/
│   └── SosNotificationService.ts
└── websocket/
```

### `src/contexts/` — Contextes

```
contexts/
├── AuthContext.tsx          ← Authentification + mode de connexion
├── SosContext.tsx           ← Gestion du mode SOS
├── AdminSosContext.tsx      ← Admin SOS
├── WebSocketContext.tsx     ← Connexion WebSocket
├── SyncContext.tsx          ← Synchronisation
├── SyncSettingsContext.tsx  ← Paramètres de synchronisation
├── ThemeContext.tsx         ← Thème clair / sombre
├── HapticsContext.tsx       ← Retour haptique
└── index.ts
```

### `src/hooks/` — Hooks

```
hooks/
├── admin/
├── map/
├── messaging/
├── sos/
├── useAppPermissions.ts
├── useFiches.ts
├── useHaptics.ts
├── useLists.ts
├── useNotifications.ts
├── usePoints.ts
├── usePushNotifications.ts
├── useSync.ts
├── useThemedStyles.ts
├── useWebSocket.ts
└── index.ts
```

### `src/constants/` — Constantes

Contient les définitions de thème (couleurs claires/sombres), les constantes de layout adaptatif (`sh()`, `sw()` pour les dimensions scalées), les espacements et les styles partagés.

### `src/types/` — Types TypeScript

Types partagés entre les services, hooks et composants. Inclut notamment les types de synchronisation (`SyncPoint`, `SyncFiche`, `SyncList`, `SyncSosContact`, `PendingChange`, etc.).

### `src/utils/` — Utilitaires

- `logger.ts` : logger structuré (wrapping de `console.*`) avec niveaux `debug`, `info`, `warn`, `error` et un préfixe de module.

### `src/config/` — Configuration

Chargement et validation des variables d'environnement (`ENV.API_BASE_URL`, `ENV.WS_BASE_URL`, etc.).
