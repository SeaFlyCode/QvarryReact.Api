# Vue d'ensemble — API Mobile Qvarry

## Table des matières

- [Architecture offline-first](#architecture-offline-first)
- [Headers requis](#headers-requis)
- [Différences avec les routes web](#différences-avec-les-routes-web)
- [Device Trust Score](#device-trust-score)
- [Middlewares mobiles](#middlewares-mobiles)

---

## Architecture offline-first

L'API mobile Qvarry suit une architecture **offline-first** : l'application mobile est conçue pour fonctionner sans connexion réseau permanente et synchronise ses données dès que la connectivité est disponible.

```
┌─────────────────────────────────────────────────────────┐
│                    Application Mobile                    │
│                                                         │
│  ┌─────────────┐     ┌─────────────┐                   │
│  │  Local DB   │────▶│ Sync Engine │                   │
│  │  (SQLite)   │◀────│  (delta)    │                   │
│  └─────────────┘     └──────┬──────┘                   │
│                             │                           │
└─────────────────────────────┼───────────────────────────┘
                              │  HTTPS / Bearer Token
                              ▼
┌─────────────────────────────────────────────────────────┐
│                    API Qvarry                           │
│                                                         │
│  /api/v1/mobile/                                        │
│  ├── auth/          ← Authentification Bearer           │
│  ├── sync/          ← Synchronisation delta             │
│  ├── sos/           ← Mode SOS (safety-critical)        │
│  ├── push-tokens/   ← Tokens FCM                        │
│  └── 2fa/           ← Double authentification           │
│                                                         │
│  Middlewares spéciaux :                                 │
│  mobileSecurityHeaders → checkAppVersion → routes       │
└─────────────────────────────────────────────────────────┘
```

### Principe de synchronisation delta

Le client envoie uniquement les changements survenus depuis la dernière synchronisation (`lastSyncAt`). Le serveur retourne les changements de son côté. En cas de conflit, la stratégie **last-write-wins** est appliquée (timestamp le plus récent gagne).

---

## Headers requis

Ces headers sont **obligatoires** pour toutes les requêtes vers `/api/v1/mobile/` :

| Header          | Description                      | Exemple                                | Validation                  |
| --------------- | -------------------------------- | -------------------------------------- | --------------------------- |
| `X-Platform`    | Plateforme de l'appareil         | `ios` ou `android`                     | Valeurs exactes uniquement  |
| `X-Device-ID`   | Identifiant unique de l'appareil | `550e8400-e29b-41d4-a716-446655440000` | Format UUID v4              |
| `X-App-Version` | Version de l'application         | `2.1.0`                                | Versionnage sémantique      |
| `Authorization` | Bearer token JWT                 | `Bearer eyJhbGci...`                   | Requis sur routes protégées |

### Erreurs retournées si headers manquants

```json
// X-Platform absent ou invalide
{
  "error": "INVALID_PLATFORM",
  "message": "Header X-Platform requis (ios ou android)",
  "statusCode": 400
}

// X-Device-ID absent ou format invalide
{
  "error": "INVALID_DEVICE_ID",
  "message": "Header X-Device-ID requis (format UUID v4)",
  "statusCode": 400
}

// Version de l'app obsolète
{
  "error": "UPDATE_REQUIRED",
  "message": "Mise à jour de l'application requise",
  "minimumVersion": "2.0.0",
  "currentVersion": "1.8.0",
  "statusCode": 426
}
```

---

## Différences avec les routes web

| Aspect                     | Routes Web `/api/v1/`      | Routes Mobile `/api/v1/mobile/`                       |
| -------------------------- | -------------------------- | ----------------------------------------------------- |
| **Authentification**       | Cookie HTTP-only (session) | Bearer token JWT dans `Authorization`                 |
| **Protection anti-bot**    | Cloudflare Turnstile       | `mobileSecurityMiddleware`                            |
| **Rate limiting**          | Standard                   | Strict (5 req/15min en prod)                          |
| **Headers spéciaux**       | Non                        | `X-Platform`, `X-Device-ID`, `X-App-Version`          |
| **Device tracking**        | Non                        | Oui (Device Trust Score)                              |
| **Attestation d'appareil** | Non                        | Optionnelle (iOS App Attest / Android Play Integrity) |
| **Sync offline**           | Non                        | Oui (endpoint `/sync`)                                |
| **Push tokens**            | Non                        | Oui (FCM)                                             |

### Authentification Bearer token

```http
POST /api/v1/mobile/auth/login
Content-Type: application/json
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
X-App-Version: 2.1.0

{
  "email": "user@example.com",
  "password": "motdepasse"
}
```

Réponse :

```json
{
  "accessToken": "eyJhbGci...",
  "refreshToken": "eyJhbGci...",
  "expiresIn": 900
}
```

Le `accessToken` doit ensuite être envoyé dans chaque requête :

```http
Authorization: Bearer eyJhbGci...
```

---

## Device Trust Score

Le **Device Trust Score** est un score de confiance calculé dynamiquement pour chaque appareil, utilisé pour adapter le niveau de sécurité appliqué.

### Calcul du score (0-100)

| Critère                             | Points |
| ----------------------------------- | ------ |
| Base                                | +50    |
| Appareil déjà vu (connu en base)    | +20    |
| Appareil utilisé depuis > 7 jours   | +15    |
| Appareil associé à un utilisateur   | +10    |
| Header `X-Platform` présent         | +5     |
| Header `X-App-Version` présent      | +5     |
| Attestation d'appareil vérifiée     | +25    |
| Attestation bypassed (mode dégradé) | +12    |

### Interprétation des niveaux de confiance

```
Score  0-30  : ⛔ Confiance faible  — Accès restreint, logs audit
Score 31-60  : ⚠️  Confiance moyenne — Accès standard
Score 61-80  : ✅ Confiance élevée  — Accès complet
Score 81-100 : 🔒 Confiance maximale — Attestation vérifiée
```

### Exemple de calcul

Un nouvel iPhone avec App Attest :

```
Base               : +50
Attestation iOS    : +25
X-Platform présent : +5
X-App-Version      : +5
─────────────────────────
Score total        : 85 → Confiance maximale
```

---

## Middlewares mobiles

### Pipeline d'exécution

```
Requête entrante
       │
       ▼
┌─────────────────────┐
│ mobileSecurityHeaders│  ← Headers de sécurité HTTP
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   checkAppVersion   │  ← Vérification version min (426 si obsolète)
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  verifyMobilePlatform│  ← Validation X-Platform + X-Device-ID
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│mobileRateLimitMiddlw│  ← Rate limit composite IP + DeviceID
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   Route Handler     │  ← Logique métier
└─────────────────────┘
```

### Tableau récapitulatif

| Middleware                  | Rôle                                                                                                                        | Code erreur                             | HTTP |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ---- |
| `mobileSecurityHeaders`     | Ajoute headers HTTP sécurisés (no-cache, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy no-referrer) | —                                       | —    |
| `checkAppVersion`           | Compare `X-App-Version` vs `MIN_IOS_VERSION` / `MIN_ANDROID_VERSION`                                                        | `UPDATE_REQUIRED`                       | 426  |
| `verifyMobilePlatform`      | Valide `X-Platform` (ios/android) et `X-Device-ID` (UUID v4)                                                                | `INVALID_PLATFORM`, `INVALID_DEVICE_ID` | 400  |
| `mobileRateLimitMiddleware` | Rate limiting Redis sur IP + DeviceID composite                                                                             | `RATE_LIMIT_EXCEEDED`                   | 429  |
| `verifyDeviceAttestation`   | iOS App Attest / Android Play Integrity (optionnel selon route)                                                             | `ATTESTATION_REQUIRED`                  | 403  |

### Variables d'environnement associées

| Variable              | Description                        | Exemple      |
| --------------------- | ---------------------------------- | ------------ |
| `MIN_IOS_VERSION`     | Version minimale requise iOS       | `2.0.0`      |
| `MIN_ANDROID_VERSION` | Version minimale requise Android   | `2.0.0`      |
| `REDIS_ENABLED`       | Active Redis pour rate limiting    | `true`       |
| `NODE_ENV`            | Environnement (affecte les seuils) | `production` |

> ⚠️ **En production**, `REDIS_ENABLED=true` est obligatoire pour le rate limiting mobile. Sans Redis, le service démarre mais utilise un fallback mémoire non partagé entre instances — inefficace en environnement distribué.

---

_Voir aussi : [security-middleware.md](security-middleware.md) pour le détail complet de chaque middleware._
