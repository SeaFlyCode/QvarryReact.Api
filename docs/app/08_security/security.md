# Sécurité — Application Mobile Qvarry

## Vue d'ensemble

Ce document rassemble toutes les mesures de sécurité implémentées dans l'application mobile Qvarry, de la couche réseau jusqu'à l'interface utilisateur.

---

## 1. Authentification et gestion des tokens

### Double token (Access + Refresh)

- **Access Token** (JWT, durée courte ~15 min) → stocké en mémoire via `tokenStore.ts`
- **Refresh Token** (JWT, durée longue) → stocké dans le Keychain/Keystore

### Stockage sécurisé

| Système  | Mécanisme                    | Protection                             |
| -------- | ---------------------------- | -------------------------------------- |
| iOS      | iOS Keychain (Secure Enclave) | Chiffrement matériel, inaccessible hors app |
| Android  | Android Keystore              | TEE (Trusted Execution Environment)    |
| Fallback | AsyncStorage                  | Chiffrement logiciel si Keychain indispo |

### Refresh automatique

Le `refreshManager.ts` implémente un **mutex** : si plusieurs requêtes échouent avec 401 simultanément, un seul refresh est lancé. Les autres attendent sa résolution.

```
Requête A → 401 → refresh() lancé
Requête B → 401 → attend la fin du refresh de A
Requête C → 401 → attend la fin du refresh de A
                    │
                    ▼
              Nouveau token disponible
              → A, B, C rejouées avec le nouveau token
```

---

## 2. Verrouillage biométrique

Configurable dans `SecurityScreen`. Quand activé :

- Au démarrage, `BiometricLockScreen` est affiché
- L'utilisateur doit s'authentifier via Face ID / Touch ID / empreinte
- Si la biométrie échoue, un fallback PIN peut être proposé
- La préférence est stockée dans le Keychain (`qvarry_biometric_enabled`)

**Technologies** : `react-native-biometrics`, `react-native-keychain`, `@react-native-community/blur` (fond flou)

---

## 3. Intégrité de l'appareil

**Fichier** : `src/services/security/deviceIntegrity.ts`

Détection des appareils compromis (jailbreak iOS / root Android) au démarrage via `react-native-device-info`.

```typescript
const isSecure = await enforceDeviceIntegrity();
if (!isSecure) {
  showAlert(AlertHelper.warning('Sécurité', 'Cette application ne peut pas fonctionner sur un appareil modifié.'));
}
```

> L'app ne se ferme pas de force mais l'utilisateur est informé du risque. Les données sensibles restent accessibles.

---

## 4. Sécurité réseau

### HTTPS/WSS obligatoire

En production, `secureFetch.ts` refuse toute connexion non chiffrée :

```typescript
if (!isSecureProtocol(url)) {
  throw new Error('[SECURITY] Insecure protocol detected');
}
```

### Whitelist de domaines

Seuls les domaines autorisés sont acceptés :
- `qvarry.fr` (et sous-domaines)
- `challenges.cloudflare.com` (Cloudflare Turnstile)

### Header d'identification

Toutes les requêtes incluent `X-Requested-With: QvarryMobile` pour identifier les requêtes légitimes côté serveur.

---

## 5. Headers de sécurité mobile

À chaque requête vers `/api/v1/mobile/*` :

```http
X-Platform: ios | android
X-Device-ID: <UUID v4 persistant et unique par appareil>
X-App-Version: <version sémantique>
Authorization: Bearer <access_token>
X-Requested-With: QvarryMobile
```

Ces headers permettent au serveur de :
- Calculer le **Device Trust Score** (0-100)
- Rejeter les appareils avec une version obsolète (HTTP 426)
- Appliquer un rate limiting par combinaison IP + Device ID

---

## 6. Device ID

Un UUID v4 est généré à la première installation et stocké dans AsyncStorage. Il est transmis dans le header `X-Device-ID` à chaque requête mobile.

```typescript
// Génération cryptographiquement sécurisée
const bytes = new Uint8Array(16);
crypto.getRandomValues(bytes);
// → UUID v4 formaté
```

Si l'appareil fournit un ID unique valide via `DeviceInfo.getUniqueId()`, celui-ci est préféré.

---

## 7. Authentification à deux facteurs (2FA)

L'application supporte la 2FA TOTP (Time-based One-Time Password) :

1. L'utilisateur active la 2FA dans `SecurityScreen`
2. Un QR code est affiché (scannable par Google Authenticator, Authy, etc.)
3. À la connexion, si `requiresTwoFactor: true`, l'utilisateur saisit le code à 6 chiffres
4. `complete2FALogin(tempToken, code)` est appelé avec le token temporaire

---

## 8. Suppression des logs en production

Le plugin Babel `babel-plugin-transform-remove-console` supprime **tous** les `console.log`, `console.debug`, `console.warn` et `console.error` dans les builds de production, évitant ainsi toute fuite d'information dans les logs système de l'appareil.

---

## 9. Mode dégradé (vs déconnexion forcée)

Par design, l'application **ne déconnecte pas** l'utilisateur en cas d'expiration de token ou de perte de connexion. Elle passe en mode `limited` :

- Les données locales restent accessibles
- Un modal non-bloquant informe l'utilisateur (`SessionExpiredModal`)
- L'utilisateur choisit de se reconnecter ou de continuer en mode dégradé

Ce choix de design améliore l'UX tout en maintenant un niveau de sécurité acceptable : les données sensibles restent protégées par le Keychain et le verrouillage biométrique.

---

## Tableau récapitulatif

| Menace                        | Contre-mesure                                            |
| ----------------------------- | -------------------------------------------------------- |
| Vol du token                  | Keychain/Keystore (stockage matériel sécurisé)           |
| Accès physique à l'appareil   | Verrouillage biométrique (BiometricLockScreen)           |
| Appareil jailbreaké/rooté     | deviceIntegrity.ts (détection + avertissement)           |
| Interception réseau (MITM)    | HTTPS/WSS obligatoire en production                      |
| Requêtes vers domaines tiers  | Whitelist de domaines (secureFetch)                      |
| Version obsolète de l'app     | Vérification `X-App-Version` côté serveur (HTTP 426)     |
| Abus / scraping                | Rate limiting IP + Device ID côté serveur               |
| Fuite via logs système        | babel-plugin-transform-remove-console en production      |
| Tokens concurrents             | Mutex refresh (refreshManager)                          |
