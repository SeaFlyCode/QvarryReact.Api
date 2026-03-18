# Stack Technique — Application Mobile Qvarry

## Vue d'ensemble

| Catégorie              | Technologie                          | Version        | Rôle                                                       |
| ---------------------- | ------------------------------------ | -------------- | ---------------------------------------------------------- |
| Framework              | React Native                         | 0.81.5         | Application mobile cross-platform iOS / Android            |
| Langage                | TypeScript                           | ^5.9.3         | Typage statique, maintenabilité                            |
| UI                     | React                                | 19.1.0         | Rendu des composants                                       |
| Navigation             | React Navigation                     | ^7.x           | Stack, Bottom Tabs, navigation entre écrans                |
| Animations             | React Native Reanimated              | ~4.1.1         | Animations fluides (spring, interpolation)                 |
| Gestes                 | React Native Gesture Handler         | ~2.28.0        | Swipe, pinch, tap                                          |
| Stockage local         | AsyncStorage                         | ^2.2.0         | Persistance des données hors ligne                         |
| Stockage sécurisé      | React Native Keychain                | ^10.0.0        | Tokens JWT, données sensibles (Keychain iOS / Keystore Android) |
| Push Notifications     | @react-native-firebase/messaging     | ^23.8.6        | Notifications push Firebase FCM                            |
| Notifications locales  | @notifee/react-native                | ^9.1.8         | Canaux de notification Android, notifications locales      |
| Biométrie              | React Native Biometrics              | ^3.0.1         | Face ID, Touch ID, empreinte                               |
| Géolocalisation        | react-native-geolocation-service     | ^5.3.1         | GPS, position en temps réel                                |
| Capteurs               | react-native-sensors                 | ^7.3.6         | Accéléromètre, gyroscope                                   |
| Boussole               | react-native-compass-heading         | ^2.0.2         | Navigation directionnelle                                  |
| Carte                  | React Native WebView                 | ^13.15.0       | Leaflet.js embarqué dans une WebView                       |
| Fichiers               | react-native-fs                      | ^2.20.0        | Accès au système de fichiers                               |
| Caméra                 | react-native-vision-camera           | ^4.7.3         | Scan QR codes, photos                                      |
| QR Code (affichage)    | react-native-qrcode-svg              | ^6.3.21        | Affichage des QR codes de contact                          |
| Cryptographie          | react-native-quick-crypto            | ^1.0.16        | Chiffrement rapide natif                                   |
| Base64                 | react-native-quick-base64            | ^2.2.2         | Encodage/décodage base64 rapide                            |
| Son                    | react-native-sound                   | ^0.13.0        | Sons d'alerte SOS                                          |
| Retour haptique        | react-native-haptic-feedback         | ^2.3.3         | Vibrations tactiles                                        |
| Icônes                 | react-native-vector-icons            | ^10.3.0        | Icônes Material Design                                     |
| SVG                    | react-native-svg                     | ^15.15.3       | Graphiques et icônes SVG                                   |
| Permissions            | react-native-permissions             | ^5.5.1         | Gestion des permissions iOS / Android                      |
| Connectivité réseau    | @react-native-community/netinfo      | ^12.0.1        | Détection de l'état réseau (online/offline)                |
| Presse-papier          | @react-native-clipboard/clipboard   | ^1.16.3        | Copier/coller                                              |
| Blur                   | @react-native-community/blur         | ^4.4.1         | Effets de flou (lock screen biométrique)                   |
| Infos appareil         | react-native-device-info             | ^15.0.2        | Modèle, OS, ID unique de l'appareil                        |
| Tâches en arrière-plan | react-native-background-actions      | ^4.0.1         | Exécution en arrière-plan (SOS)                            |
| Reactive Extensions    | rxjs                                 | ^7.8.2         | Streams réactifs                                           |
| Date                   | date-fns                             | ^4.1.0         | Manipulation de dates                                      |
| Modules natifs         | react-native-nitro-modules           | ^0.35.0        | Bridge natif performant                                    |

---

## Dépendances de production (extrait `package.json`)

```json
{
  "react-native": "0.81.5",
  "react": "19.1.0",
  "@react-navigation/bottom-tabs": "^7.10.1",
  "@react-navigation/native": "^7.1.28",
  "@react-navigation/native-stack": "^7.11.0",
  "@react-native-firebase/app": "^23.8.6",
  "@react-native-firebase/messaging": "^23.8.6",
  "@notifee/react-native": "^9.1.8",
  "react-native-keychain": "^10.0.0",
  "react-native-biometrics": "^3.0.1",
  "react-native-reanimated": "~4.1.1",
  "react-native-gesture-handler": "~2.28.0",
  "@react-native-async-storage/async-storage": "^2.2.0",
  "react-native-webview": "^13.15.0",
  "react-native-quick-crypto": "^1.0.16",
  "react-native-vision-camera": "^4.7.3"
}
```

---

## Dépendances de développement

```json
{
  "typescript": "^5.9.3",
  "jest": "^30.2.0",
  "ts-jest": "^29.4.6",
  "@testing-library/react-native": "^13.3.3",
  "@types/react": "^19.2.10",
  "eslint": "^9.0.0",
  "@typescript-eslint/eslint-plugin": "^8.57.0",
  "babel-plugin-transform-remove-console": "^6.9.4"
}
```

---

## Justification des choix techniques

### React Native 0.81.5 + New Architecture

La **New Architecture** (Fabric + JSI + TurboModules) est activée pour des performances natives améliorées. `react-native-nitro-modules` est utilisé pour exploiter le bridge JSI le plus performant disponible.

### Keychain (iOS) / Keystore (Android)

Les tokens JWT sont stockés dans le **Keychain iOS** ou **Android Keystore** via `react-native-keychain`. Ces solutions matérielles garantissent que les tokens ne peuvent pas être extraits même en cas de compromission du système de fichiers.

### Carte via WebView (Leaflet)

La carte interactive est implémentée avec **Leaflet.js** embarqué dans une `react-native-webview`. Cette approche permet de bénéficier de l'écosystème Leaflet (tuiles offline, plugins) sans dépendre d'un SDK cartographique natif propriétaire.

### react-native-quick-crypto

Remplace le module `crypto` de Node.js pour le chiffrement côté client. Il utilise une implémentation native via JSI pour des performances proches du natif.

### Offline-first via AsyncStorage

Toutes les données critiques (points, fiches, listes, contacts SOS) sont mises en cache dans AsyncStorage. La synchronisation delta avec le serveur garantit la cohérence des données à chaque reconnexion.

### Reanimated v4 + Gesture Handler

L'animation du `BottomTabNavigator` (icônes avec spring effect Apple-like) et les interactions de swipe (`SwipeableRow`) utilisent Reanimated v4 et Gesture Handler pour s'exécuter sur le thread UI natif, sans passer par le bridge JS.

> ⚠️ `babel-plugin-transform-remove-console` supprime tous les `console.log` en production pour éviter les fuites d'informations dans les logs système.
