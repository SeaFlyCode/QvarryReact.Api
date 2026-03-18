# Service de Sécurité — Application Mobile Qvarry

## Vue d'ensemble

La sécurité de l'application repose sur plusieurs couches complémentaires : intégrité de l'appareil, stockage sécurisé des tokens, communication réseau sécurisée et verrouillage biométrique.

---

## Intégrité de l'appareil — `deviceIntegrity.ts`

**Fichier** : `src/services/security/deviceIntegrity.ts`

Détection des appareils modifiés (jailbreak iOS / root Android).

```typescript
export const enforceDeviceIntegrity(): Promise<boolean>
// → true si l'appareil est sain
// → false si jailbreak / root détecté
```

Appelé au démarrage dans `App.tsx`. Si un appareil modifié est détecté, une alerte `CustomAlert` est affichée (l'app ne se ferme pas, mais l'utilisateur est informé).

---

## Stockage sécurisé — `secureTokenStore.ts`

**Fichier** : `src/services/api/secureTokenStore.ts`

Abstraction sur `react-native-keychain` pour un stockage des tokens résistant :

| Donnée          | Clé Keychain                       |
| --------------- | ---------------------------------- |
| Access Token    | `qvarry_secure_token`              |
| Refresh Token   | `qvarry_secure_refresh_token`      |
| Données user    | `qvarry_secure_user`               |
| Biométrie ON/OFF | `qvarry_biometric_enabled`        |

**Mécanisme de fallback** : si le Keychain est indisponible (erreur système), `AsyncStorage` est utilisé en remplacement.

---

## Verrouillage biométrique

**Composant** : `src/components/BiometricLockScreen.tsx`

L'application peut être verrouillée avec la biométrie (Face ID / Touch ID / empreinte digitale) via `react-native-biometrics`.

### Flux de verrouillage

```
Démarrage de l'app
        │
        ▼
Lecture Keychain: qvarry_biometric_enabled
        │
        ├── "true" → setIsLocked(true)
        │       │
        │       ▼
        │   BiometricLockScreen affiché
        │       │
        │       ├── Biométrie réussie → setIsLocked(false) → app accessible
        │       └── Biométrie échouée → réessayer ou utiliser PIN
        │
        └── absent / "false" → app accessible directement
```

### Activation dans `SecurityScreen`

```typescript
// Activer
await Keychain.setGenericPassword('qvarry', 'true', { service: 'qvarry_biometric_enabled' });

// Désactiver
await Keychain.resetGenericPassword({ service: 'qvarry_biometric_enabled' });
```

---

## Communication réseau sécurisée — `secureFetch.ts`

**Fichier** : `src/services/api/secureFetch.ts`

Toutes les requêtes réseau passent par `secureFetch` qui garantit :

| Vérification            | Environnement | Comportement                        |
| ----------------------- | ------------- | ----------------------------------- |
| Protocole HTTPS/WSS     | Production    | Lève une erreur si HTTP              |
| Whitelist de domaines   | Production    | Lève une erreur si domaine inconnu   |
| Header identification   | Toujours      | Ajoute `X-Requested-With: QvarryMobile` |

**Domaines autorisés en production** :
- `qvarry.fr`
- `challenges.cloudflare.com`

> En développement (`__DEV__`), les vérifications sont désactivées pour permettre les appels vers `localhost` ou des API de staging.

---

## Refresh automatique des tokens

**Fichier** : `src/services/api/refreshManager.ts`

Gère le renouvellement des tokens d'accès de manière sécurisée :

- **Mutex** : un seul refresh à la fois, même si plusieurs requêtes échouent avec 401 simultanément
- Si le refresh échoue → le `onAuthExpiredCallback` est déclenché → l'utilisateur passe en mode dégradé
- Le refresh token est stocké dans Keychain sous `@qvarry_refresh_token`

---

## Headers de sécurité mobile

À chaque requête vers `/api/v1/mobile/*`, les headers suivants sont envoyés :

```http
X-Platform: ios | android
X-Device-ID: <UUID v4 persistant>
X-App-Version: <version depuis app.json>
Authorization: Bearer <access_token>
X-Requested-With: QvarryMobile
```

Ces headers sont validés côté serveur par `verifyMobilePlatform` et `checkAppVersion`.

---

## Résumé des mesures de sécurité

| Mesure                        | Technologie                              | Scope           |
| ----------------------------- | ---------------------------------------- | --------------- |
| Stockage tokens               | react-native-keychain (iOS Keychain / Android Keystore) | Tokens JWT |
| Verrouillage biométrique      | react-native-biometrics                  | Accès à l'app   |
| Intégrité appareil            | deviceIntegrity.ts                       | Jailbreak/Root  |
| Whitelist domaines            | secureFetch.ts                           | Réseau          |
| HTTPS/WSS enforced            | secureFetch.ts                           | Réseau          |
| Refresh token mutex           | refreshManager.ts                        | Auth            |
| Mode dégradé (pas déconnexion)| AuthContext.tsx                          | UX sécurisée    |
| Suppression console.log prod  | babel-plugin-transform-remove-console    | Build           |
