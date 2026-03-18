# Middlewares de Sécurité Mobile

## Table des matières

- [Vue d'ensemble](#vue-densemble)
- [mobileSecurityHeaders](#mobilesecurityheaders)
- [checkAppVersion](#checkappversion)
- [verifyMobilePlatform](#verifymobileplatform)
- [mobileRateLimitMiddleware](#mobileratelimitmiddleware)
- [verifyDeviceAttestation](#verifydeviceattestation)
- [Codes d'erreur complets](#codes-derreur-complets)

---

## Vue d'ensemble

Les middlewares de sécurité mobile forment une **chaîne de protection** appliquée à toutes les routes sous `/api/v1/mobile/`. Ils remplacent le mécanisme Cloudflare Turnstile utilisé sur les routes web.

### Pipeline d'exécution

```
Requête → /api/v1/mobile/*
           │
           ▼
   ┌───────────────────┐
   │mobileSecurityHeaders│  Étape 1 : Headers HTTP sécurisés
   └─────────┬─────────┘
             │
             ▼
   ┌───────────────────┐
   │  checkAppVersion  │  Étape 2 : Vérification version minimale
   └─────────┬─────────┘
             │
             ▼
   ┌───────────────────┐
   │verifyMobilePlatform│  Étape 3 : Validation X-Platform + X-Device-ID
   └─────────┬─────────┘
             │
             ▼
   ┌──────────────────────────┐
   │mobileRateLimitMiddleware │  Étape 4 : Rate limit composite
   └─────────┬────────────────┘
             │
             ▼ (routes avec attestation obligatoire uniquement)
   ┌────────────────────────┐
   │verifyDeviceAttestation │  Étape 5 : iOS App Attest / Android Play Integrity
   └────────────────────────┘
             │
             ▼
      Route Handler
```

---

## mobileSecurityHeaders

Ajoute des en-têtes HTTP de sécurité sur toutes les réponses des routes mobiles.

### Headers ajoutés

| Header                   | Valeur                                                  | Description                     |
| ------------------------ | ------------------------------------------------------- | ------------------------------- |
| `Cache-Control`          | `no-store, no-cache, must-revalidate, proxy-revalidate` | Désactive tout cache navigateur |
| `Pragma`                 | `no-cache`                                              | Compatibilité HTTP/1.0          |
| `X-Frame-Options`        | `DENY`                                                  | Protège contre le clickjacking  |
| `X-Content-Type-Options` | `nosniff`                                               | Bloque le MIME type sniffing    |
| `Referrer-Policy`        | `no-referrer`                                           | Aucun referrer envoyé           |
| `Expires`                | `0`                                                     | Invalidation immédiate du cache |

### Implémentation

```typescript
export const mobileSecurityHeaders = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    Expires: "0",
  });
  next();
};
```

> ℹ️ Ce middleware ne retourne jamais d'erreur. Il s'exécute systématiquement et passe la main au middleware suivant.

---

## checkAppVersion

Vérifie que la version de l'application mobile est supérieure ou égale à la version minimale requise.

### Logique de comparaison sémantique

```
Header X-App-Version: 1.8.0

Variable env : MIN_IOS_VERSION=2.0.0
                MIN_ANDROID_VERSION=2.0.0

Comparaison sémantique (semver) :
  1.8.0 < 2.0.0 → ❌ Retourne 426 UPDATE_REQUIRED

Header X-App-Version: 2.1.0
  2.1.0 >= 2.0.0 → ✅ Passe au middleware suivant
```

### Algorithme de comparaison

```
parse(version) :
  split(".") → [major, minor, patch]

compare(v1, v2) :
  if major(v1) != major(v2) → compare major
  if minor(v1) != minor(v2) → compare minor
  compare patch
```

### Variables d'environnement

| Variable              | Description              | Exemple |
| --------------------- | ------------------------ | ------- |
| `MIN_IOS_VERSION`     | Version minimale iOS     | `2.0.0` |
| `MIN_ANDROID_VERSION` | Version minimale Android | `2.0.0` |

### Réponse d'erreur `426 Upgrade Required`

```json
{
  "error": "UPDATE_REQUIRED",
  "message": "Mise à jour de l'application requise",
  "minimumVersion": "2.0.0",
  "currentVersion": "1.8.0",
  "platform": "ios",
  "updateUrl": "https://apps.apple.com/app/qvarry/idXXXXXXXXXX"
}
```

> ⚠️ Si le header `X-App-Version` est absent, le middleware **rejette la requête** avec `400 MISSING_APP_VERSION`. Si `X-Platform` est absent (non validé encore), le middleware utilise la version iOS par défaut.

---

## verifyMobilePlatform

Valide les headers `X-Platform` et `X-Device-ID`. Ce middleware est le gardien de l'identité de l'appareil.

### Validation X-Platform

```
Valeurs acceptées : "ios", "android"
Sensible à la casse : oui (minuscules uniquement)

"iOS"     → ❌ INVALID_PLATFORM
"Android" → ❌ INVALID_PLATFORM
"ios"     → ✅
"android" → ✅
```

### Validation X-Device-ID

```
Format requis : UUID v4
Regex : /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

"not-a-uuid"                             → ❌ INVALID_DEVICE_ID
"550e8400-e29b-41d4-a716-446655440000"   → ✅
"550E8400-E29B-41D4-A716-446655440000"   → ✅ (insensible à la casse)
```

### Vérification device bloqué

Si le `X-Device-ID` est présent dans la liste noire (appareils bloqués en base), la requête est rejetée et un log d'audit `BLOCKED_DEVICE_ACCESS_ATTEMPT` est enregistré.

### Réponses d'erreur

```json
// X-Platform absent
{
  "error": "MISSING_PLATFORM",
  "message": "Header X-Platform requis",
  "statusCode": 400
}

// X-Platform invalide
{
  "error": "INVALID_PLATFORM",
  "message": "X-Platform doit être 'ios' ou 'android'",
  "statusCode": 400
}

// X-Device-ID absent
{
  "error": "MISSING_DEVICE_ID",
  "message": "Header X-Device-ID requis",
  "statusCode": 400
}

// X-Device-ID format invalide
{
  "error": "INVALID_DEVICE_ID",
  "message": "X-Device-ID doit être un UUID v4 valide",
  "statusCode": 400
}

// Appareil bloqué
{
  "error": "DEVICE_BLOCKED",
  "message": "Cet appareil a été bloqué",
  "statusCode": 403
}
```

---

## mobileRateLimitMiddleware

Rate limiting composite basé sur **IP + DeviceID**, persisté en Redis.

### Configuration par route

| Groupe  | Limite (prod) | Limite (dev) | Fenêtre | Blocage |
| ------- | ------------- | ------------ | ------- | ------- |
| Auth    | 5 req         | 50 req       | 15 min  | 30 min  |
| Sync    | 60 req        | 600 req      | 15 min  | 15 min  |
| SOS     | 30 req        | 300 req      | 15 min  | 30 min  |
| Général | 100 req       | 1000 req     | 15 min  | 15 min  |

### Identificateur composite

```
rateLimitKey = hash(IP + ":" + X-Device-ID)

Exemple :
  IP      : 192.168.1.42
  DeviceID: 550e8400-e29b-41d4-a716-446655440000
  Key     : qvarry:mobile_rl:sha256("192.168.1.42:550e8400...")
```

### Stockage Redis

```
Clé Redis : qvarry:mobile_rl:<hash>
Valeur    : { count: 3, firstRequestAt: 1710756000000 }
TTL       : durée de la fenêtre (ex: 900s pour 15 min)
```

### Fallback mémoire

Si Redis est indisponible :

- En **développement** : fallback `Map` en mémoire (non partagé entre instances)
- En **production** : ⚠️ `REDIS_ENABLED=true` est obligatoire. Le service refuse de démarrer sans Redis.

### Détection multi-device

Si plus de **3 appareils différents** effectuent des requêtes depuis la même IP dans une fenêtre de 15 minutes, un log d'audit `WARNING` est enregistré :

```
[AUDIT WARNING] Multi-device détecté depuis IP 192.168.1.42 :
  - devices: [uuid1, uuid2, uuid3, uuid4]
  - count: 4 (seuil: 3)
```

### Headers de réponse rate limit

Les headers standard sont inclus dans chaque réponse :

```http
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 2
X-RateLimit-Reset: 1710756900
Retry-After: 900
```

### Réponse d'erreur `429 Too Many Requests`

```json
{
  "error": "RATE_LIMIT_EXCEEDED",
  "message": "Trop de requêtes. Réessayez dans 30 minutes.",
  "retryAfter": 1800,
  "statusCode": 429
}
```

---

## verifyDeviceAttestation

Vérifie l'authenticité de l'appareil via les APIs natives du système d'exploitation.

> ⚠️ Ce middleware est **optionnel** sur la plupart des routes. Il est appliqué en mode **strict** uniquement sur les routes les plus sensibles.

### Modes d'application

| Mode       | Description             | Comportement si échec                 |
| ---------- | ----------------------- | ------------------------------------- |
| `strict`   | Attestation obligatoire | Rejette la requête (403)              |
| `optional` | Attestation recommandée | Log d'audit + continue (score réduit) |
| `bypass`   | Désactivé (dev/test)    | Passe directement                     |

### iOS — App Attest

```
Flow iOS App Attest :

1. App iOS génère une assertion via DCAppAttestService
2. L'assertion est envoyée dans le header X-Attestation-Assertion
3. Le serveur vérifie avec Apple Attestation Service
4. Si valide → Device Trust Score +25
5. Si invalide (mode strict) → 403 ATTESTATION_REQUIRED
```

**Bundle IDs iOS autorisés :**

```
Configurés via ALLOWED_IOS_BUNDLE_IDS (env)
Exemple : com.qvarry.app,com.qvarry.app.beta
```

### Android — Play Integrity

```
Flow Android Play Integrity :

1. App Android appelle IntegrityTokenProvider
2. Le token est envoyé dans X-Attestation-Token
3. Le serveur vérifie via Google Play Integrity API
4. Verdict vérifié : MEETS_DEVICE_INTEGRITY + MEETS_BASIC_INTEGRITY
5. Si valide → Device Trust Score +25
6. Si invalide → 403 ou continue selon le mode
```

**Package names Android autorisés :**

```
Configurés via ALLOWED_ANDROID_PACKAGE_NAMES (env)
Exemple : com.qvarry.app
```

### Variables d'environnement

| Variable                                 | Description                                     |
| ---------------------------------------- | ----------------------------------------------- |
| `ALLOWED_IOS_BUNDLE_IDS`                 | Bundle IDs iOS autorisés (séparés par virgules) |
| `ALLOWED_ANDROID_PACKAGE_NAMES`          | Package names Android autorisés                 |
| `ATTESTATION_STRICT_MODE`                | `true` pour mode strict global                  |
| `GOOGLE_PLAY_INTEGRITY_DECRYPTION_KEY`   | Clé de déchiffrement Play Integrity             |
| `GOOGLE_PLAY_INTEGRITY_VERIFICATION_KEY` | Clé de vérification Play Integrity              |

### Réponse d'erreur `403 Forbidden`

```json
{
  "error": "ATTESTATION_REQUIRED",
  "message": "Attestation d'appareil requise",
  "platform": "ios",
  "statusCode": 403
}
```

---

## Codes d'erreur complets

Tableau de référence de tous les codes d'erreur des middlewares mobiles :

| Code                   | HTTP | Middleware                  | Description                                  |
| ---------------------- | ---- | --------------------------- | -------------------------------------------- |
| `MISSING_APP_VERSION`  | 400  | `checkAppVersion`           | Header `X-App-Version` absent                |
| `INVALID_APP_VERSION`  | 400  | `checkAppVersion`           | Format de version invalide                   |
| `UPDATE_REQUIRED`      | 426  | `checkAppVersion`           | Version inférieure au minimum requis         |
| `MISSING_PLATFORM`     | 400  | `verifyMobilePlatform`      | Header `X-Platform` absent                   |
| `INVALID_PLATFORM`     | 400  | `verifyMobilePlatform`      | Valeur `X-Platform` invalide                 |
| `MISSING_DEVICE_ID`    | 400  | `verifyMobilePlatform`      | Header `X-Device-ID` absent                  |
| `INVALID_DEVICE_ID`    | 400  | `verifyMobilePlatform`      | `X-Device-ID` n'est pas un UUID v4 valide    |
| `DEVICE_BLOCKED`       | 403  | `verifyMobilePlatform`      | Appareil bloqué par un administrateur        |
| `RATE_LIMIT_EXCEEDED`  | 429  | `mobileRateLimitMiddleware` | Trop de requêtes                             |
| `ATTESTATION_REQUIRED` | 403  | `verifyDeviceAttestation`   | Attestation d'appareil manquante ou invalide |
| `ATTESTATION_EXPIRED`  | 403  | `verifyDeviceAttestation`   | Assertion d'attestation expirée              |
| `INVALID_BUNDLE_ID`    | 403  | `verifyDeviceAttestation`   | Bundle ID non autorisé                       |
| `ATTESTATION_BYPASS`   | —    | `verifyDeviceAttestation`   | Attestation non requise (mode bypass)        |

---

_Voir aussi : [overview.md](overview.md) — [redis-sessions.md](../06_services/redis-sessions.md)_
