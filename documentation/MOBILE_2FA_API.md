# 📱 Guide 2FA pour Application Mobile Qvarry

## Vue d'ensemble

Ce document décrit comment implémenter l'authentification à deux facteurs (2FA/TOTP) dans l'application mobile Qvarry (iOS/Android).

La 2FA utilise le standard TOTP (RFC 6238), compatible avec :
- Google Authenticator
- Authy
- Microsoft Authenticator
- 1Password
- Toute application TOTP standard

---

## 🔗 Endpoints 2FA Mobile

Tous les endpoints sont préfixés par `/api/mobile/2fa`

| Méthode | Endpoint | Auth | Description |
|---------|----------|------|-------------|
| GET | `/status` | ✅ JWT | Obtenir le statut 2FA |
| POST | `/setup` | ✅ JWT | Initier la configuration 2FA |
| POST | `/verify-setup` | ✅ JWT | Activer la 2FA |
| POST | `/disable` | ✅ JWT | Désactiver la 2FA |
| POST | `/regenerate-codes` | ✅ JWT | Régénérer les codes de récupération |
| POST | `/verify-login` | ❌ | Vérifier le code 2FA pendant le login |

---

## 📋 Headers Requis

Tous les appels vers `/api/mobile/*` nécessitent :

```http
X-Platform: ios | android
X-Device-ID: <UUID unique de l'appareil>
```

Pour les endpoints protégés (status, setup, disable, etc.) :

```http
Authorization: Bearer <accessToken>
```

---

## 1️⃣ Obtenir le Statut 2FA

### `GET /api/mobile/2fa/status`

Vérifie si la 2FA est activée pour l'utilisateur connecté.

#### Request

```http
GET /api/mobile/2fa/status
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
```

#### Response (200 OK)

```json
{
  "success": true,
  "enabled": false,
  "confirmedAt": null,
  "recoveryCodesRemaining": 0
}
```

Ou si activé :

```json
{
  "success": true,
  "enabled": true,
  "confirmedAt": "2026-02-10T15:30:00.000Z",
  "recoveryCodesRemaining": 8
}
```

---

## 2️⃣ Configurer la 2FA (Setup)

### `POST /api/mobile/2fa/setup`

Génère un secret TOTP et un QR code pour l'utilisateur.

#### Request

```http
POST /api/mobile/2fa/setup
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
Content-Type: application/json
```

Aucun body requis.

#### Response (200 OK)

```json
{
  "success": true,
  "qrCode": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...",
  "secret": "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
  "message": "Scannez le QR code avec votre application d'authentification (Google Authenticator, Authy, etc.)"
}
```

#### Utilisation côté Mobile

1. **Afficher le QR Code** : Le champ `qrCode` est une data URL PNG. Affichez-le pour que l'utilisateur le scanne avec son app d'authentification.

2. **Saisie manuelle** : Proposez aussi d'afficher le `secret` pour une saisie manuelle dans l'app d'authentification.

```tsx
// Exemple React Native
import { Image } from 'react-native';

<Image 
  source={{ uri: response.qrCode }} 
  style={{ width: 200, height: 200 }} 
/>
```

#### Erreurs possibles

| Code | Status | Description |
|------|--------|-------------|
| `2FA_ALREADY_ENABLED` | 400 | 2FA déjà activée |
| `UNAUTHORIZED` | 401 | Token invalide |

---

## 3️⃣ Activer la 2FA (Verify Setup)

### `POST /api/mobile/2fa/verify-setup`

Vérifie le code TOTP saisi par l'utilisateur et active la 2FA.

#### Request

```http
POST /api/mobile/2fa/verify-setup
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
Content-Type: application/json

{
  "code": "123456"
}
```

| Champ | Type | Description |
|-------|------|-------------|
| `code` | string | Code TOTP à 6 chiffres de l'app d'authentification |

#### Response (200 OK)

```json
{
  "success": true,
  "message": "Authentification à deux facteurs activée avec succès",
  "recoveryCodes": [
    "ABCD-EFGH-IJKL",
    "MNOP-QRST-UVWX",
    "1234-5678-90AB",
    "CDEF-GHIJ-KLMN",
    "OPQR-STUV-WXYZ",
    "2345-6789-0ABC",
    "DEFG-HIJK-LMNO",
    "PQRS-TUVW-XYZ1",
    "3456-7890-ABCD",
    "EFGH-IJKL-MNOP"
  ],
  "warning": "Conservez ces codes de récupération en lieu sûr. Ils ne seront plus affichés."
}
```

⚠️ **IMPORTANT** : Les `recoveryCodes` ne sont affichés qu'une seule fois ! Demandez à l'utilisateur de les sauvegarder.

#### Erreurs possibles

| Code | Status | Description |
|------|--------|-------------|
| `INVALID_CODE_FORMAT` | 400 | Code pas 6 chiffres |
| `INVALID_CODE` | 400 | Code TOTP invalide |
| `2FA_NOT_INITIATED` | 400 | Appeler /setup d'abord |
| `2FA_ALREADY_ENABLED` | 400 | 2FA déjà activée |

---

## 4️⃣ Login avec 2FA

### Étape 1 : Login standard

```http
POST /api/mobile/auth/login
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "motdepasse123"
}
```

### Réponse si 2FA activée

```json
{
  "requiresTwoFactor": true,
  "userId": "6975f37343cedcf0e817d842",
  "code": "TWO_FACTOR_REQUIRED"
}
```

### Étape 2 : Vérifier le code 2FA

### `POST /api/mobile/2fa/verify-login`

```http
POST /api/mobile/2fa/verify-login
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
Content-Type: application/json

{
  "userId": "6975f37343cedcf0e817d842",
  "code": "123456",
  "isRecoveryCode": false
}
```

| Champ | Type | Description |
|-------|------|-------------|
| `userId` | string | ID retourné par /login |
| `code` | string | Code TOTP ou code de récupération |
| `isRecoveryCode` | boolean | `true` si c'est un code de récupération |

#### Response (200 OK)

```json
{
  "success": true,
  "verified": true,
  "userId": "6975f37343cedcf0e817d842",
  "email": "user@example.com",
  "isAdmin": false,
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "tokenExpiresIn": 900,
  "refreshTokenExpiresIn": 172800
}
```

#### Erreurs possibles

| Code | Status | Description |
|------|--------|-------------|
| `MISSING_PARAMS` | 400 | userId et code requis |
| `INVALID_CODE` | 400 | Code TOTP invalide |
| `INVALID_RECOVERY_CODE` | 400 | Code de récupération invalide |
| `2FA_NOT_ENABLED` | 400 | 2FA pas activée pour cet user |

---

## 5️⃣ Désactiver la 2FA

### `POST /api/mobile/2fa/disable`

```http
POST /api/mobile/2fa/disable
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
Content-Type: application/json

{
  "password": "motdepasse123",
  "code": "123456"
}
```

| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| `password` | string | ✅ | Mot de passe du compte |
| `code` | string | ❌ | Code TOTP ou récupération (recommandé) |

#### Response (200 OK)

```json
{
  "success": true,
  "message": "Authentification à deux facteurs désactivée"
}
```

---

## 6️⃣ Régénérer les Codes de Récupération

### `POST /api/mobile/2fa/regenerate-codes`

⚠️ Invalide tous les anciens codes !

```http
POST /api/mobile/2fa/regenerate-codes
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
Content-Type: application/json

{
  "password": "motdepasse123"
}
```

#### Response (200 OK)

```json
{
  "success": true,
  "recoveryCodes": [
    "XXXX-XXXX-XXXX",
    ...
  ],
  "message": "Nouveaux codes de récupération générés. Conservez-les en lieu sûr.",
  "warning": "Les anciens codes ont été invalidés."
}
```

---

## 🔐 Codes d'Erreur Communs

| Code | Status | Description |
|------|--------|-------------|
| `UNAUTHORIZED` | 401 | Token manquant ou invalide |
| `TOKEN_EXPIRED` | 401 | Token expiré, rafraîchir |
| `TOKEN_REVOKED` | 401 | Token révoqué |
| `USER_NOT_FOUND` | 404 | Utilisateur n'existe plus |
| `INVALID_PLATFORM` | 400 | Header X-Platform invalide |
| `INVALID_DEVICE_ID` | 400 | Header X-Device-ID invalide |
| `RATE_LIMIT_EXCEEDED` | 429 | Trop de tentatives |
| `INTERNAL_ERROR` | 500 | Erreur serveur |

---

## 📱 Exemple de Flow Complet (React Native)

```typescript
// services/twoFactorService.ts

const API_BASE = 'https://api.qvarry.fr/api/mobile/2fa';

const headers = (token?: string) => ({
  'Content-Type': 'application/json',
  'X-Platform': Platform.OS, // 'ios' ou 'android'
  'X-Device-ID': getDeviceId(), // UUID unique
  ...(token && { 'Authorization': `Bearer ${token}` })
});

// 1. Vérifier le statut
export async function get2FAStatus(token: string) {
  const res = await fetch(`${API_BASE}/status`, {
    headers: headers(token)
  });
  return res.json();
}

// 2. Initier le setup
export async function setup2FA(token: string) {
  const res = await fetch(`${API_BASE}/setup`, {
    method: 'POST',
    headers: headers(token)
  });
  return res.json();
}

// 3. Activer avec le code TOTP
export async function enable2FA(token: string, code: string) {
  const res = await fetch(`${API_BASE}/verify-setup`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ code })
  });
  return res.json();
}

// 4. Vérifier le code au login
export async function verify2FALogin(userId: string, code: string, isRecoveryCode = false) {
  const res = await fetch(`${API_BASE}/verify-login`, {
    method: 'POST',
    headers: headers(), // Pas de token ici
    body: JSON.stringify({ userId, code, isRecoveryCode })
  });
  return res.json();
}

// 5. Désactiver
export async function disable2FA(token: string, password: string, code?: string) {
  const res = await fetch(`${API_BASE}/disable`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ password, code })
  });
  return res.json();
}
```

---

## 🎯 Bonnes Pratiques

1. **Stockage des codes de récupération** : Proposez à l'utilisateur de les copier dans son gestionnaire de mots de passe ou de les noter.

2. **Affichage du QR Code** : Utilisez un composant Image natif avec la data URL.

3. **Gestion du login 2FA** : Stockez temporairement le `userId` retourné par `/login` pour l'envoyer à `/verify-login`.

4. **Timeout** : Les codes TOTP sont valides 30 secondes avec une fenêtre de ±30 secondes.

5. **Codes de récupération** : Format `XXXX-XXXX-XXXX`, acceptés avec ou sans tirets.

---

## 📊 Diagramme de Séquence - Login avec 2FA

```
┌─────────┐          ┌─────────┐          ┌─────────┐
│  Mobile │          │  Server │          │  TOTP   │
│   App   │          │   API   │          │   App   │
└────┬────┘          └────┬────┘          └────┬────┘
     │                    │                    │
     │  POST /login       │                    │
     │  {email, password} │                    │
     │───────────────────>│                    │
     │                    │                    │
     │  {requiresTwoFactor: true, userId}     │
     │<───────────────────│                    │
     │                    │                    │
     │  Demande code TOTP │                    │
     │<───────────────────────────────────────>│
     │                    │                    │
     │  POST /2fa/verify-login                │
     │  {userId, code}    │                    │
     │───────────────────>│                    │
     │                    │                    │
     │  {accessToken, refreshToken, ...}      │
     │<───────────────────│                    │
     │                    │                    │
```

---

*Dernière mise à jour : 12 février 2026*

