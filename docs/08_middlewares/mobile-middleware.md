# mobileSecurityMiddleware

Middleware de sécurité dédié aux applications mobiles iOS et Android. Remplace Cloudflare Turnstile (incompatible mobile) par un ensemble de contrôles spécifiques : validation de plateforme, rate limiting composite IP+Device, attestation d'appareil et headers de sécurité.

## Exports principaux

| Nom                               | Type                     | Description                                         |
| --------------------------------- | ------------------------ | --------------------------------------------------- |
| `mobileSecurityMiddleware`        | `RequestHandler[]`       | Middleware combiné (stack complète)                 |
| `verifyMobilePlatform`            | `RequestHandler`         | Validation plateforme + Device ID                   |
| `mobileRateLimitMiddleware`       | `RequestHandler`         | Rate limiting strict (routes d'auth)                |
| `mobileSyncRateLimitMiddleware`   | `RequestHandler`         | Rate limiting permissif (routes sync)               |
| `verifyDeviceAttestation(strict)` | `RequestHandler` factory | Attestation iOS App Attest / Android Play Integrity |
| `mobileSecurityHeaders`           | `RequestHandler`         | Headers de sécurité HTTP                            |
| `checkAppVersion`                 | `RequestHandler`         | Vérification de version minimale                    |

## `verifyMobilePlatform`

Vérifie que la requête provient d'une app mobile légitime.

**Headers requis** :

| Header        | Valeurs acceptées                           | Description                      |
| ------------- | ------------------------------------------- | -------------------------------- |
| `X-Platform`  | `ios` / `android` / `mobile`                | Plateforme de l'appareil         |
| `X-Device-ID` | UUID (32–64 chars alphanumériques + tirets) | Identifiant unique de l'appareil |

**Comportements** :

- Si plateforme manquante / invalide → `400 INVALID_PLATFORM`
- Si Device ID manquant / format invalide → `400 INVALID_DEVICE_ID`
- Si appareil dans `blockedDevices` → `403 DEVICE_BLOCKED` (audit loggé)
- Injecte `req.mobileContext = { platform, deviceId, trustScore }`

**Trust Score** (0–100) calculé à chaque requête :

| Condition                         | Points |
| --------------------------------- | ------ |
| Score de base                     | +50    |
| Appareil déjà connu               | +20    |
| Appareil vu depuis > 7 jours      | +15    |
| Appareil associé à un utilisateur | +10    |
| Header `X-Platform` présent       | +5     |
| Header `X-App-Version` présent    | +5     |

> ⚠️ La liste `knownDevices` est limitée à 10 000 entrées (cap anti-DoS). Au-delà, l'entrée la plus ancienne est évincée (politique FIFO).

## `mobileRateLimitMiddleware`

Rate limiting strict pour les routes d'authentification mobile (login, register, mot de passe oublié).

| Paramètre | Production | Développement |
| --------- | ---------- | ------------- |
| Limite    | 5 req      | 50 req        |
| Fenêtre   | 15 minutes | 15 minutes    |
| Blocage   | 30 minutes | 30 minutes    |

- Clé composite : `mobile_<IP>_<Device-ID>`
- Stockage : Redis (`qvarry:mobile_rl:<key>`) avec fallback Map en mémoire
- Si > 3 appareils distincts depuis la même IP → audit `MOBILE_SUSPICIOUS_MULTI_DEVICE`
- Si limite dépassée → `429 RATE_LIMIT_EXCEEDED` + header `retryAfter` (secondes)

## `mobileSyncRateLimitMiddleware`

Rate limiting permissif pour les routes de synchronisation authentifiées.

| Paramètre | Production | Développement |
| --------- | ---------- | ------------- |
| Limite    | 60 req     | 600 req       |
| Fenêtre   | 15 minutes | 15 minutes    |
| Blocage   | 15 minutes | 15 minutes    |

- Clé Redis : `qvarry:mobile_sync_rl:<key>`
- Même logique multi-device que `mobileRateLimitMiddleware`

## `verifyDeviceAttestation(strict: boolean = false)`

Vérifie l'attestation d'appareil via iOS App Attest ou Android Play Integrity. Ce middleware est une factory qui retourne un `RequestHandler`.

**Header** : `X-Device-Attestation` (base64 JSON)

```typescript
interface DeviceAttestationPayload {
  bundleId: string;
  deviceId: string;
  timestamp: number; // ms Unix, doit être < 5 minutes
  platform: "ios" | "android";
  signature?: string;
}
```

**Bundle IDs autorisés** : `fr.qvarry.app`, `fr.qvarry.mobile`, `com.qvarry.app`, plus `MOBILE_BUNDLE_ID_IOS` et `MOBILE_BUNDLE_ID_ANDROID` (variables d'env).

**Résultats** :

| Résultat           | Trust boost | `req.attestationVerified` | Mode strict                           |
| ------------------ | ----------- | ------------------------- | ------------------------------------- |
| Vérification OK    | +25         | `true`                    | Passe                                 |
| Mode bypass        | +12         | `false`                   | Passe                                 |
| Échec vérification | 0           | `false`                   | `403 ATTESTATION_VERIFICATION_FAILED` |

Si le header est absent : en mode non strict → passe ; en mode strict → `403 ATTESTATION_REQUIRED`.

## `mobileSecurityHeaders`

Ajoute des headers HTTP de sécurité sur toutes les réponses API mobile :

```
Cache-Control: no-store, no-cache, must-revalidate, private
Pragma: no-cache
Expires: 0
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

## `checkAppVersion`

Vérifie que la version de l'app mobile respecte la version minimale requise.

**Header** : `X-App-Version` (format semver : `"1.2.3"`)

Si la version est absente, la requête passe (rétrocompatibilité) avec un warning en production.

Si la version est inférieure à la minimale → `426 UPDATE_REQUIRED` :

```json
{
  "error": "Veuillez mettre à jour l'application pour continuer.",
  "code": "UPDATE_REQUIRED",
  "minVersion": "1.2.0",
  "currentVersion": "1.0.0",
  "platform": "ios"
}
```

## `mobileSecurityMiddleware` (stack combiné)

```typescript
export const mobileSecurityMiddleware = [
  verifyMobilePlatform,
  mobileRateLimitMiddleware,
  verifyDeviceAttestation(false), // mode non strict par défaut
];
```

À utiliser sur les routes sensibles non authentifiées : `/auth/login`, `/auth/register`, `/auth/forgot-password`.

## Utilitaires d'administration

```typescript
blockDevice(deviceId: string, reason: string): void
unblockDevice(deviceId: string): void
resetMobileRateLimit(identifier: string): void
associateDeviceWithUser(deviceId: string, userId: string): void
getMobileSecurityStats(): { knownDevicesCount, blockedDevicesCount, activeRateLimits, blockedDevices }
```

## Nettoyage automatique

Un `setInterval` s'exécute toutes les heures et :

- Supprime les entrées de rate limit dont la fenêtre est expirée
- Supprime les appareils non vus depuis 30 jours

## Variables d'environnement

| Variable                   | Description                                  |
| -------------------------- | -------------------------------------------- |
| `NODE_ENV`                 | `production` active les limites strictes     |
| `MIN_IOS_VERSION`          | Version minimale iOS (défaut: `"1.0.0"`)     |
| `MIN_ANDROID_VERSION`      | Version minimale Android (défaut: `"1.0.0"`) |
| `MOBILE_BUNDLE_ID_IOS`     | Bundle ID iOS autorisé supplémentaire        |
| `MOBILE_BUNDLE_ID_ANDROID` | Bundle ID Android autorisé supplémentaire    |
