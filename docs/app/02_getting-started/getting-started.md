# Getting Started — Application Mobile Qvarry

## Prérequis

### Environnement de développement

| Outil         | Version minimale | Notes                                   |
| ------------- | ---------------- | --------------------------------------- |
| Node.js       | ≥ 18             | Vérifier avec `node --version`          |
| npm           | ≥ 9              | Inclus avec Node.js                     |
| React Native CLI | latest        | `npm install -g @react-native-community/cli` |
| Ruby          | ≥ 3.0 (iOS)      | Requis pour CocoaPods                   |
| CocoaPods     | ≥ 1.12 (iOS)     | `sudo gem install cocoapods`            |
| Xcode         | ≥ 15 (iOS)       | Depuis l'App Store macOS                |
| Android Studio | latest (Android) | SDK Android 34+                        |
| Java JDK      | 17 (Android)     | Recommandé pour Gradle                  |

### Variables d'environnement

Copier le fichier d'exemple et le configurer :

```bash
cp .env.example .env.local
```

Contenu de `.env.local` :

```env
# API Qvarry
API_BASE_URL=https://api.qvarry.fr/api/v1
WS_BASE_URL=wss://api.qvarry.fr

# Firebase (optionnel en dev local)
FIREBASE_PROJECT_ID=...
```

> ⚠️ Ne jamais committer `.env.local`. Le fichier `.gitignore` l'exclut déjà.

---

## Installation

### 1. Installer les dépendances Node

```bash
npm install
```

### 2. Installer les dépendances iOS

```bash
cd ios && pod install && cd ..
```

---

## Lancer l'application

### iOS (simulateur ou appareil physique)

```bash
# Démarrer le bundler Metro
npm start

# Dans un autre terminal, lancer sur iOS
npm run ios

# Ou avec le script de lancement personnalisé
npm run ios:launch
```

### Android (émulateur ou appareil physique)

```bash
# Démarrer le bundler Metro
npm start

# Dans un autre terminal, lancer sur Android
npm run android

# Ou avec le script de lancement personnalisé
npm run android:launch
```

---

## Build de production

### Android (APK release)

```bash
npm run android:release
# → android/app/build/outputs/apk/release/app-release.apk
```

### iOS (archive)

Utiliser Xcode → Product → Archive, ou via Fastlane si configuré.

---

## Scripts disponibles

| Script               | Description                                              |
| -------------------- | -------------------------------------------------------- |
| `npm start`          | Démarre le bundler Metro                                 |
| `npm run android`    | Lance l'app sur Android (debug)                          |
| `npm run ios`        | Lance l'app sur iOS (debug)                              |
| `npm run android:launch` | Script de lancement Android personnalisé             |
| `npm run ios:launch` | Script de lancement iOS personnalisé                     |
| `npm run android:release` | Build APK release Android                          |
| `npm test`           | Lance les tests Jest                                     |
| `npm run test:coverage` | Tests avec rapport de couverture                      |
| `npm run test:watch` | Tests en mode watch                                      |
| `npm run typecheck`  | Vérification TypeScript sans compilation                 |
| `npm run lint`       | ESLint sur le dossier `src/`                             |
| `npm run clean`      | Nettoie les caches (watchman, node_modules, pods, builds) |

---

## Structure du fichier `.nvmrc`

Le fichier `.nvmrc` à la racine du projet indique la version de Node.js recommandée. Pour l'utiliser automatiquement :

```bash
nvm use
```

---

## Vérification TypeScript

```bash
npm run typecheck
```

Cette commande exécute `tsc --noEmit` et vérifie tous les types sans produire de fichiers compilés. À lancer avant chaque commit pour s'assurer qu'il n'y a pas d'erreurs de type.

---

## Alias de chemins (`@/`)

Le projet utilise l'alias `@/` pointant vers `src/`. Par exemple :

```typescript
// ✓ Correct
import { AuthProvider } from '@/contexts';
import { FichesScreen } from '@/screens/fiches';
import { createLogger } from '@/utils/logger';

// ✗ À éviter (chemins relatifs profonds)
import { AuthProvider } from '../../../contexts';
```

L'alias est configuré dans `tsconfig.json` (paths) et `babel.config.js` (module-resolver).

---

## Résolution des problèmes courants

### Metro bundler bloqué

```bash
npm run clean
npm start -- --reset-cache
```

### Pods iOS non synchronisés

```bash
cd ios
pod deintegrate
pod install
cd ..
```

### Build Android échoue (Gradle)

```bash
cd android
./gradlew clean
cd ..
npm run android
```

### Problème de Device ID manquant

L'application génère un UUID unique à la première installation et le stocke dans AsyncStorage sous la clé `@qvarry_device_id`. Ce Device ID est envoyé dans le header `X-Device-ID` à chaque requête mobile. En cas de réinstallation, un nouveau Device ID est généré automatiquement.
