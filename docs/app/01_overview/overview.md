# Vue d'ensemble — Application Mobile Qvarry

## Description générale

L'application mobile Qvarry est développée en **React Native 0.81.5** avec TypeScript. Elle est disponible sur **iOS** et **Android** et communique exclusivement avec l'API Qvarry via des routes dédiées au mobile (`/api/v1/mobile/*`).

**Version** : 1.0.0  
**Plateformes** : iOS / Android  
**Authentification** : Bearer Token JWT (stocké de manière sécurisée via Keychain)

---

## Architecture générale

```
┌──────────────────────────────────────────────────────────────────┐
│                     Application Qvarry Mobile                    │
│                   React Native 0.81.5 / TypeScript               │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                    Context Providers                      │    │
│  │  ThemeProvider → HapticsProvider → AuthProvider           │    │
│  │  → SyncSettingsProvider → SyncProvider                   │    │
│  │  → WebSocketProvider → SosProvider                       │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                     Navigation                            │    │
│  │  BiometricLockScreen (si activé)                         │    │
│  │  ├── AuthStackNavigator (non authentifié)                │    │
│  │  └── BottomTabNavigator (authentifié)                    │    │
│  │      ├── ExplorerStackNavigator (Carte)                  │    │
│  │      ├── FichesScreen                                    │    │
│  │      ├── MessagesStackNavigator                          │    │
│  │      ├── ProfileScreen                                   │    │
│  │      └── AdminSosNavigator (admin uniquement)            │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                Services / Hooks / Utils                   │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────┬───────────────────┘
                                               │  HTTPS / Bearer Token
                                               │  X-Platform, X-Device-ID
                                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                          API Qvarry                              │
│                    /api/v1/mobile/*                              │
└──────────────────────────────────────────────────────────────────┘
```

---

## Domaines fonctionnels couverts

- **Authentification** : connexion, inscription, 2FA TOTP, sessions persistantes offline-first
- **Biométrie** : verrouillage/déverrouillage de l'app via Face ID / Touch ID
- **Fiches** : création, lecture, mise à jour, suppression de fiches personnelles
- **Listes** : organisation de contenu en listes, partage de listes
- **Carte / Points** : carte interactive (Leaflet via WebView), géolocalisation, navigation souterraine
- **Messagerie** : conversations chiffrées, temps réel via WebSocket, contacts QR code
- **SOS** : activation d'alertes d'urgence, historique, contacts SOS, dashboard admin
- **Profil** : gestion du profil, paramètres, sécurité, notifications, points de fidélité
- **Synchronisation offline-first** : les données sont disponibles sans connexion et synchronisées au retour en ligne
- **Mode dégradé** : l'app reste utilisable même en cas de perte de connexion ou de session expirée
- **Push notifications** : intégration Firebase FCM pour les notifications en arrière-plan

---

## Modes de connexion

L'application distingue trois modes de connexion :

| Mode           | Description                                                    |
| -------------- | -------------------------------------------------------------- |
| `full`         | En ligne + Token valide → accès complet                        |
| `limited`      | Hors ligne ou token expiré → mode dégradé, données en cache   |
| `disconnected` | Aucune session locale → écran de connexion                     |

---

## Flux de démarrage

```
1. App.tsx démarre
         │
         ▼
2. Initialisation Device ID + Token Cache
         │
         ▼
3. Vérification intégrité appareil (jailbreak / root)
         │
         ▼
4. Configuration canaux notifications (Android)
         │
         ▼
5. Vérification biométrie → BiometricLockScreen si activé
         │
         ▼
6. AuthProvider → chargement token depuis Keychain
         │
         ├── Token présent → SplashLoader "Connexion"
         │   → vérification arrière-plan → mode full ou limited
         │
         └── Pas de token → AuthStackNavigator (Login)
                  │
                  └── Login réussi → BottomTabNavigator
```

---

## Composants globaux toujours présents

Ces composants sont montés au niveau racine de l'app et persistent pendant toute la session :

| Composant             | Rôle                                                      |
| --------------------- | --------------------------------------------------------- |
| `BiometricLockScreen` | Verrouillage biométrique au premier plan                  |
| `SosActiveBanner`     | Bannière rouge en haut quand le mode SOS est actif        |
| `DegradedModeBanner`  | Bannière avertissant du mode hors-ligne / dégradé         |
| `InAppMessageToast`   | Toast de notification pour les messages reçus en temps réel |
| `SessionExpiredModal` | Modal invitant à se reconnecter si la session a expiré    |
| `MaintenanceModal`    | Modal bloquant si le serveur est en maintenance           |
| `OfflineDownloadWebView` | WebView cachée pour télécharger les tuiles de carte    |

---

_Voir aussi : [tech-stack.md](tech-stack.md) pour le détail des technologies utilisées._
