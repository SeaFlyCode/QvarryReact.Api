# AUDIT DE SECURITE - API MOBILE QVARRY

**Version**: 1.0
**Date**: 12 fevrier 2026
**Auditeur**: Claude Code (Audit automatise)
**Perimetre**: Routes `/api/mobile/*` (authentification, 2FA, synchronisation)
**Standards de reference**: OWASP Mobile Top 10 2024, NIST SP 800-63B, RFC 6238 (TOTP), RFC 7519 (JWT)

---

## TABLE DES MATIERES

1. [Resume executif](#1-resume-executif)
2. [Methodologie](#2-methodologie)
3. [Architecture analysee](#3-architecture-analysee)
4. [Vulnerabilites critiques](#4-vulnerabilites-critiques)
5. [Vulnerabilites hautes](#5-vulnerabilites-hautes)
6. [Vulnerabilites moyennes](#6-vulnerabilites-moyennes)
7. [Vulnerabilites basses](#7-vulnerabilites-basses)
8. [Points positifs](#8-points-positifs)
9. [Conformite aux standards](#9-conformite-aux-standards)
10. [Recommandations pour l'application mobile](#10-recommandations-pour-lapplication-mobile)
11. [Plan de remediation](#11-plan-de-remediation)
12. [Annexes](#12-annexes)

---

## 1. RESUME EXECUTIF

### 1.1 Synthese des resultats

| Severite | Nombre | Statut |
|----------|--------|--------|
| CRITIQUE | 2 | A corriger immediatement |
| HAUTE | 4 | A corriger sous 7 jours |
| MOYENNE | 4 | A corriger sous 30 jours |
| BASSE | 3 | A planifier |

### 1.2 Score global de securite

```
Score: 65/100 - AMELIORATION REQUISE
```

| Categorie | Score | Commentaire |
|-----------|-------|-------------|
| Authentification | 70/100 | Bonne base, corrections necessaires |
| Autorisation | 75/100 | Correct |
| Chiffrement | 85/100 | Bien implemente |
| Protection brute-force | 55/100 | Contournable |
| Gestion des sessions | 80/100 | Redis en production, bien |
| Audit/Logging | 90/100 | Excellent |

### 1.3 Risques principaux identifies

1. **Brute-force 2FA** : L'endpoint de verification 2FA est vulnerable a des attaques ciblees
2. **Rate limiting contournable** : Le Device ID auto-declare permet de contourner les protections
3. **Attestation non implementee** : Les apps peuvent etre usurpees

---

## 2. METHODOLOGIE

### 2.1 Approche d'audit

- **Type** : Revue de code statique (White-box)
- **Outils** : Analyse manuelle du code source TypeScript
- **Couverture** : 100% des fichiers mobile

### 2.2 Fichiers analyses

| Fichier | Lignes | Role |
|---------|--------|------|
| `mobileAuthControllers.ts` | 589 | Controleurs d'authentification |
| `mobileTwoFactorControllers.ts` | 720 | Controleurs 2FA |
| `mobileSyncControllers.ts` | 300 | Controleurs de synchronisation |
| `mobileAuthMiddleware.ts` | 199 | Middleware d'authentification |
| `mobileSecurityMiddleware.ts` | 476 | Middleware de securite |
| `mobileAuthRoutes.ts` | 84 | Definition des routes auth |
| `mobileTwoFactorRoutes.ts` | 154 | Definition des routes 2FA |
| `mobileSyncRoutes.ts` | 155 | Definition des routes sync |
| `mobileSyncService.ts` | 637 | Service de synchronisation |
| `refreshTokenService.ts` | 276 | Gestion des refresh tokens |
| `redisSessionService.ts` | 564 | Gestion des sessions Redis |
| `jwtKeyManager.ts` | 145 | Gestion des cles JWT |
| `deviceFingerprint.ts` | 61 | Empreinte d'appareil |

### 2.3 Standards de reference

- **OWASP Mobile Top 10 2024**
  - M1: Improper Platform Usage
  - M2: Insecure Data Storage
  - M3: Insecure Communication
  - M4: Insecure Authentication
  - M5: Insufficient Cryptography
  - M6: Insecure Authorization
  - M7: Client Code Quality
  - M8: Code Tampering
  - M9: Reverse Engineering
  - M10: Extraneous Functionality

- **NIST SP 800-63B** : Digital Identity Guidelines - Authentication

- **RFC 6238** : TOTP: Time-Based One-Time Password Algorithm

- **RFC 7519** : JSON Web Token (JWT)

---

## 3. ARCHITECTURE ANALYSEE

### 3.1 Vue d'ensemble

```
+-------------------+       +-------------------+       +-------------------+
|   App Mobile      |       |   API Backend     |       |   Base de donnees |
|   (iOS/Android)   | <---> |   (Express.js)    | <---> |   (MongoDB)       |
+-------------------+       +-------------------+       +-------------------+
        |                           |
        |                           v
        |                   +-------------------+
        |                   |   Redis           |
        |                   |   (Sessions)      |
        |                   +-------------------+
        v
+-------------------+
|   TOTP App        |
|   (Authenticator) |
+-------------------+
```

### 3.2 Flux d'authentification mobile

```
1. LOGIN INITIAL
   App --> POST /api/mobile/auth/login
       Headers: X-Platform, X-Device-ID
       Body: { email, password }

   Si 2FA activee:
       <-- { requiresTwoFactor: true, userId }

   App --> POST /api/mobile/2fa/verify-login
       Body: { userId, code }

   <-- { accessToken, refreshToken, ... }

2. REQUETES AUTHENTIFIEES
   App --> GET /api/mobile/sync
       Headers: Authorization: Bearer <accessToken>

3. REFRESH TOKEN
   App --> POST /api/mobile/auth/refresh
       Body: { refreshToken }
   <-- { accessToken, refreshToken }
```

### 3.3 Composants de securite

| Composant | Fichier | Role |
|-----------|---------|------|
| JWT Key Manager | `jwtKeyManager.ts` | Rotation de cles JWT |
| Redis Session | `redisSessionService.ts` | Persistence des sessions |
| Refresh Token | `refreshTokenService.ts` | Gestion refresh tokens |
| Device Fingerprint | `deviceFingerprint.ts` | Empreinte serveur |
| Mobile Security | `mobileSecurityMiddleware.ts` | Rate limit, attestation |
| Audit Service | `auditService.ts` | Journalisation |

---

## 4. VULNERABILITES CRITIQUES

### 4.1 CRIT-001: Endpoint 2FA vulnerable au brute-force cible

**Severite**: CRITIQUE
**CVSS 3.1**: 8.1 (High)
**CWE**: CWE-307 (Improper Restriction of Excessive Authentication Attempts)
**OWASP Mobile**: M4 (Insecure Authentication)

#### Description

L'endpoint `POST /api/mobile/2fa/verify-login` accepte un `userId` fourni directement par le client sans verification prealable de l'identite du demandeur. Cela permet a un attaquant de cibler un compte specifique pour une attaque brute-force sur le code TOTP.

#### Localisation

**Fichier**: `server/src/controllers/mobileTwoFactorControllers.ts`
**Lignes**: 425-595

#### Code vulnerable

```typescript
export async function mobileVerifyTwoFactorLogin(req: Request, res: Response): Promise<Response> {
    try {
        // PROBLEME: userId vient directement du body sans verification
        const { userId, code, isRecoveryCode } = req.body;

        if (!userId || !code) {
            return res.status(400).json({
                error: "userId et code requis",
                code: 'MISSING_PARAMS'
            });
        }

        // L'attaquant peut fournir n'importe quel userId valide
        const user = await UserModel.findById(userId);
        // ...
    }
}
```

#### Scenario d'attaque

1. L'attaquant obtient un `userId` valide (via enumeration, fuite de donnees, ou autre vulnerabilite)
2. L'attaquant envoie des requetes `POST /api/mobile/2fa/verify-login` avec ce `userId` et des codes TOTP aleatoires
3. Le rate limiting est base sur IP + Device ID, mais l'attaquant peut changer de Device ID a volonte
4. Avec `window: 1`, il y a 3 codes valides simultanement (code precedent, actuel, suivant)
5. L'attaquant peut tester jusqu'a 1000 codes par minute en changeant de Device ID

#### Impact

- **Confidentialite**: HAUTE - Acces complet au compte utilisateur
- **Integrite**: HAUTE - Modification des donnees utilisateur
- **Disponibilite**: MOYENNE - Blocage potentiel du compte legitime

#### Preuve de concept

```bash
# Attaque brute-force avec rotation de Device ID
for i in {1..1000}; do
    DEVICE_ID=$(uuidgen)
    CODE=$(printf "%06d" $i)
    curl -X POST https://api.qvarry.fr/api/mobile/2fa/verify-login \
        -H "Content-Type: application/json" \
        -H "X-Platform: android" \
        -H "X-Device-ID: $DEVICE_ID" \
        -d "{\"userId\": \"TARGET_USER_ID\", \"code\": \"$CODE\"}"
done
```

#### Remediation recommandee

**Solution 1 : Token temporaire signe (RECOMMANDE)**

```typescript
// Dans handleMobileLogin - Generer un token temporaire
if (user.two_factor_enabled) {
    const tempToken = jwt.sign(
        {
            userId: userId,
            purpose: '2fa_verification',
            iat: Math.floor(Date.now() / 1000)
        },
        process.env.JWT_SECRET,
        {
            expiresIn: '2m', // Expire apres 2 minutes
            algorithm: 'HS256'
        }
    );

    return res.status(200).json({
        requiresTwoFactor: true,
        tempToken: tempToken, // Token signe au lieu du userId
        message: "Code 2FA requis",
        code: 'TWO_FACTOR_REQUIRED'
    });
}

// Dans mobileVerifyTwoFactorLogin - Verifier le token
export async function mobileVerifyTwoFactorLogin(req: Request, res: Response) {
    const { tempToken, code, isRecoveryCode } = req.body;

    if (!tempToken || !code) {
        return res.status(400).json({
            error: "Token et code requis",
            code: 'MISSING_PARAMS'
        });
    }

    // Verifier le token temporaire
    let payload;
    try {
        payload = jwt.verify(tempToken, process.env.JWT_SECRET);
        if (payload.purpose !== '2fa_verification') {
            throw new Error('Invalid token purpose');
        }
    } catch (error) {
        return res.status(401).json({
            error: "Token invalide ou expire",
            code: 'INVALID_TEMP_TOKEN'
        });
    }

    const userId = payload.userId;
    // ... reste de la verification
}
```

**Solution 2 : Rate limiting par userId**

```typescript
// Ajouter un rate limiting specifique par userId
const twoFactorAttempts = new Map<string, { count: number; blockedUntil?: Date }>();

async function checkTwoFactorAttempts(userId: string): Promise<boolean> {
    const attempt = twoFactorAttempts.get(userId);
    if (!attempt) return true;

    if (attempt.blockedUntil && attempt.blockedUntil > new Date()) {
        return false;
    }

    if (attempt.count >= 5) {
        attempt.blockedUntil = new Date(Date.now() + 30 * 60 * 1000);
        return false;
    }

    return true;
}
```

#### References

- OWASP Testing Guide: Testing for Weak Lock Out Mechanism
- NIST SP 800-63B Section 5.2.2

---

### 4.2 CRIT-002: Device ID auto-declare sans validation cryptographique

**Severite**: CRITIQUE
**CVSS 3.1**: 7.5 (High)
**CWE**: CWE-290 (Authentication Bypass by Spoofing)
**OWASP Mobile**: M1 (Improper Platform Usage)

#### Description

Le header `X-Device-ID` est auto-declare par le client et valide uniquement par une expression reguliere permissive. Un attaquant peut generer des Device IDs arbitraires pour contourner le rate limiting et les mecanismes de detection d'anomalies.

#### Localisation

**Fichier**: `server/src/middlewares/mobileSecurityMiddleware.ts`
**Lignes**: 72-77

#### Code vulnerable

```typescript
function isValidDeviceId(deviceId: string | undefined): boolean {
    if (!deviceId) return false;
    // PROBLEME: Accepte n'importe quel string de 32-64 caracteres
    const uuidRegex = /^[a-zA-Z0-9-]{32,64}$/;
    return uuidRegex.test(deviceId);
}
```

#### Impact

- Le rate limiting par IP + Device devient inefficace
- Detection des appareils multiples contournee
- Trust score facilement manipulable
- Blocage d'appareils inutile (l'attaquant change de Device ID)

#### Scenario d'attaque

```javascript
// L'attaquant genere un nouveau Device ID pour chaque requete
function generateFakeDeviceId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

// Contournement du rate limiting
for (let i = 0; i < 1000; i++) {
    fetch('/api/mobile/auth/login', {
        headers: {
            'X-Platform': 'android',
            'X-Device-ID': generateFakeDeviceId() // Nouveau Device ID a chaque fois
        },
        body: JSON.stringify({ email, password })
    });
}
```

#### Remediation recommandee

**Solution 1 : Attestation d'appareil obligatoire**

Implementer l'integration avec les APIs natives de verification:

- **iOS**: App Attest API
- **Android**: Play Integrity API

**Solution 2 : Enregistrement de Device ID cote serveur**

```typescript
// A l'inscription ou premiere connexion, generer un Device ID serveur
async function registerDevice(userId: string, req: Request): Promise<string> {
    const deviceSecret = crypto.randomBytes(32).toString('hex');
    const deviceId = crypto.randomBytes(16).toString('hex');

    // Stocker le lien Device-User-Secret en base
    await DeviceModel.create({
        deviceId,
        userId,
        deviceSecretHash: await bcrypt.hash(deviceSecret, 10),
        platform: req.headers['x-platform'],
        createdAt: new Date()
    });

    // Retourner le Device ID et le secret au client
    // Le client devra signer ses requetes avec le secret
    return { deviceId, deviceSecret };
}

// Verification a chaque requete
async function verifyDeviceSignature(req: Request): Promise<boolean> {
    const deviceId = req.headers['x-device-id'];
    const signature = req.headers['x-device-signature'];
    const timestamp = req.headers['x-request-timestamp'];

    const device = await DeviceModel.findOne({ deviceId });
    if (!device) return false;

    // Verifier la signature HMAC
    const expectedSignature = crypto
        .createHmac('sha256', device.deviceSecret)
        .update(`${timestamp}:${req.method}:${req.path}`)
        .digest('hex');

    return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
    );
}
```

#### References

- Apple App Attest Documentation
- Google Play Integrity API Documentation
- OWASP Mobile Security Testing Guide

---

## 5. VULNERABILITES HAUTES

### 5.1 HIGH-001: Attestation d'appareil non implementee

**Severite**: HAUTE
**CVSS 3.1**: 6.5 (Medium)
**CWE**: CWE-345 (Insufficient Verification of Data Authenticity)
**OWASP Mobile**: M8 (Code Tampering)

#### Description

Le code contient des placeholders `TODO` pour l'integration avec les APIs d'attestation Apple et Google. L'attestation actuelle est un simple JSON encode en base64, facilement falsifiable.

#### Localisation

**Fichier**: `server/src/middlewares/mobileSecurityMiddleware.ts`
**Lignes**: 343-346

#### Code concerne

```typescript
// TODO: Validation reelle avec Apple/Google APIs
// - iOS: Appeler Apple's App Attest API
// - Android: Appeler Google Play Integrity API
// Pour l'instant, on fait une validation basique
```

#### Impact

- Un attaquant peut creer une fausse application ou utiliser des outils de reverse engineering
- Les scripts automatises peuvent se faire passer pour l'application officielle
- Pas de garantie que le code client n'a pas ete modifie

#### Remediation recommandee

**Implementation iOS (App Attest)**

```typescript
import { verifyAttestation } from 'node-app-attest';

async function verifyIOSAttestation(
    attestation: string,
    keyId: string,
    clientData: string
): Promise<boolean> {
    try {
        const result = await verifyAttestation({
            attestation: Buffer.from(attestation, 'base64'),
            keyId,
            clientData,
            bundleId: process.env.IOS_BUNDLE_ID,
            teamId: process.env.APPLE_TEAM_ID,
            allowDevelopment: process.env.NODE_ENV !== 'production'
        });

        return result.isValid;
    } catch (error) {
        console.error('iOS attestation verification failed:', error);
        return false;
    }
}
```

**Implementation Android (Play Integrity)**

```typescript
import { google } from 'googleapis';

async function verifyAndroidIntegrity(integrityToken: string): Promise<boolean> {
    const playIntegrity = google.playintegrity('v1');

    try {
        const response = await playIntegrity.decodeIntegrityToken({
            packageName: process.env.ANDROID_PACKAGE_NAME,
            requestBody: { integrityToken }
        });

        const verdict = response.data.tokenPayloadExternal;

        // Verifier les verdicts
        return (
            verdict.appIntegrity?.appRecognitionVerdict === 'PLAY_RECOGNIZED' &&
            verdict.deviceIntegrity?.deviceRecognitionVerdict?.includes('MEETS_DEVICE_INTEGRITY') &&
            verdict.accountDetails?.appLicensingVerdict === 'LICENSED'
        );
    } catch (error) {
        console.error('Android integrity verification failed:', error);
        return false;
    }
}
```

---

### 5.2 HIGH-002: Enumeration des comptes avec 2FA

**Severite**: HAUTE
**CVSS 3.1**: 5.3 (Medium)
**CWE**: CWE-204 (Observable Response Discrepancy)
**OWASP Mobile**: M4 (Insecure Authentication)

#### Description

Les messages d'erreur de l'endpoint `/verify-login` revelent si un compte utilisateur a active la 2FA ou non.

#### Localisation

**Fichier**: `server/src/controllers/mobileTwoFactorControllers.ts`
**Lignes**: 444-449

#### Code vulnerable

```typescript
if (!user.two_factor_enabled || !user.two_factor_secret) {
    return res.status(400).json({
        error: "2FA non activee pour cet utilisateur", // FUITE D'INFORMATION
        code: '2FA_NOT_ENABLED'
    });
}
```

#### Impact

- Un attaquant peut determiner quels comptes ont la 2FA activee
- Permet de cibler les comptes sans 2FA (plus faciles a compromettre)
- Aide a la reconnaissance pour des attaques ciblees

#### Remediation recommandee

```typescript
// Reponse generique pour toutes les erreurs de verification 2FA
const genericError = {
    error: "Code invalide ou verification impossible",
    code: 'VERIFICATION_FAILED'
};

if (!user) {
    // Simuler un delai pour eviter les timing attacks
    await new Promise(resolve => setTimeout(resolve, 500));
    return res.status(400).json(genericError);
}

if (!user.two_factor_enabled || !user.two_factor_secret) {
    await new Promise(resolve => setTimeout(resolve, 500));
    return res.status(400).json(genericError);
}

// ... verification du code
if (!codeValid) {
    return res.status(400).json(genericError);
}
```

---

### 5.3 HIGH-003: Rate limiting mobile en memoire volatile

**Severite**: HAUTE
**CVSS 3.1**: 5.9 (Medium)
**CWE**: CWE-799 (Improper Control of Interaction Frequency)
**OWASP Mobile**: M4 (Insecure Authentication)

#### Description

Les donnees de rate limiting pour les routes mobiles sont stockees en memoire (`Map`) au lieu de Redis, contrairement aux sessions qui utilisent Redis.

#### Localisation

**Fichier**: `server/src/middlewares/mobileSecurityMiddleware.ts`
**Lignes**: 43-45

#### Code concerne

```typescript
// Store en memoire (peut etre migre vers Redis pour production distribuee)
const mobileRateLimitStore = new Map<string, MobileRateLimitEntry>();
const knownDevices = new Map<string, { userId?: string; firstSeen: Date; lastSeen: Date; trustScore: number }>();
const blockedDevices = new Set<string>();
```

#### Impact

- Les donnees de rate limiting sont perdues au redemarrage du serveur
- Incompatible avec le clustering/load balancing (chaque instance a sa propre memoire)
- Un attaquant peut attendre un redemarrage pour reinitialiser ses compteurs
- Les appareils bloques sont debloques au redemarrage

#### Remediation recommandee

```typescript
import { redisSessionService } from '../services/redisSessionService';

// Prefixes Redis pour le rate limiting mobile
const MOBILE_RATE_LIMIT_PREFIX = 'qvarry:mobile_rate:';
const KNOWN_DEVICES_PREFIX = 'qvarry:known_device:';
const BLOCKED_DEVICES_PREFIX = 'qvarry:blocked_device:';

async function getMobileRateLimit(identifier: string): Promise<MobileRateLimitEntry | null> {
    const key = `${MOBILE_RATE_LIMIT_PREFIX}${identifier}`;
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
}

async function setMobileRateLimit(identifier: string, entry: MobileRateLimitEntry): Promise<void> {
    const key = `${MOBILE_RATE_LIMIT_PREFIX}${identifier}`;
    const ttl = Math.ceil(MOBILE_WINDOW_MS / 1000) + 60; // TTL = window + marge
    await redis.setex(key, ttl, JSON.stringify(entry));
}

async function isDeviceBlocked(deviceId: string): Promise<boolean> {
    const key = `${BLOCKED_DEVICES_PREFIX}${deviceId}`;
    return await redis.exists(key) === 1;
}

async function blockDevice(deviceId: string, durationSeconds: number = 86400): Promise<void> {
    const key = `${BLOCKED_DEVICES_PREFIX}${deviceId}`;
    await redis.setex(key, durationSeconds, 'blocked');
}
```

---

### 5.4 HIGH-004: Secret TOTP expose dans la reponse API

**Severite**: HAUTE
**CVSS 3.1**: 5.3 (Medium)
**CWE**: CWE-200 (Exposure of Sensitive Information)
**OWASP Mobile**: M2 (Insecure Data Storage)

#### Description

L'endpoint `/setup` retourne le secret TOTP en clair dans la reponse JSON, en plus du QR code.

#### Localisation

**Fichier**: `server/src/controllers/mobileTwoFactorControllers.ts`
**Lignes**: 166-171

#### Code vulnerable

```typescript
return res.status(200).json({
    success: true,
    qrCode: qrCodeDataUrl,
    secret: secret.base32, // SECRET EN CLAIR DANS LA REPONSE
    message: "Scannez le QR code avec votre application d'authentification"
});
```

#### Impact

- Si la reponse est interceptee (MITM, proxy mal configure), le secret est compromis
- Si la reponse est loguee (debug, monitoring), le secret est expose
- Un attaquant avec le secret peut generer des codes TOTP valides

#### Remediation recommandee

**Option 1 : Supprimer le secret de la reponse**

```typescript
return res.status(200).json({
    success: true,
    qrCode: qrCodeDataUrl,
    // Le secret n'est plus envoye, l'utilisateur doit scanner le QR
    message: "Scannez le QR code avec votre application d'authentification"
});
```

**Option 2 : Chiffrer le secret avec une cle ephemere**

```typescript
// Le client envoie une cle publique ephemere
const { publicKey } = req.body;

// Chiffrer le secret avec la cle publique du client
const encryptedSecret = crypto.publicEncrypt(
    {
        key: publicKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256'
    },
    Buffer.from(secret.base32)
);

return res.status(200).json({
    success: true,
    qrCode: qrCodeDataUrl,
    encryptedSecret: encryptedSecret.toString('base64'),
    message: "Scannez le QR code ou utilisez le secret chiffre"
});
```

---

## 6. VULNERABILITES MOYENNES

### 6.1 MED-001: Pas de binding Device-Token

**Severite**: MOYENNE
**CVSS 3.1**: 4.3 (Medium)
**CWE**: CWE-384 (Session Fixation)

#### Description

Un token JWT vole peut etre utilise depuis n'importe quel appareil. Le middleware d'authentification ne verifie pas que le `X-Device-ID` de la requete correspond a celui utilise lors de la creation du token.

#### Localisation

**Fichier**: `server/src/middlewares/mobileAuthMiddleware.ts`

#### Remediation recommandee

```typescript
// Dans generateMobileToken - Ajouter deviceId au payload
const token = jwt.sign(
    {
        id: userId,
        isAdmin,
        iat: Math.floor(Date.now() / 1000),
        jti,
        kv: version,
        platform: 'mobile',
        deviceId: deviceId // AJOUTER LE DEVICE ID
    },
    secret,
    { expiresIn, algorithm: 'HS256', issuer: 'qvarry-api', audience: 'qvarry-mobile' }
);

// Dans mobileAuthMiddleware - Verifier le deviceId
const headerDeviceId = req.headers['x-device-id'] as string;
if (decoded.deviceId && decoded.deviceId !== headerDeviceId) {
    console.warn(`Device ID mismatch: token=${decoded.deviceId}, header=${headerDeviceId}`);
    return res.status(401).json({
        error: "Token invalide pour cet appareil",
        code: 'DEVICE_MISMATCH'
    });
}
```

---

### 6.2 MED-002: Fenetre TOTP trop permissive

**Severite**: MOYENNE
**CVSS 3.1**: 3.7 (Low)
**CWE**: CWE-307 (Improper Restriction of Excessive Authentication Attempts)

#### Description

Le parametre `window: 1` dans la verification TOTP accepte le code precedent et le code suivant, soit 3 codes valides simultanement au lieu de 1.

#### Localisation

**Fichier**: `server/src/controllers/mobileTwoFactorControllers.ts`
**Lignes**: 230-235

#### Code concerne

```typescript
const isValid = speakeasy.totp.verify({
    secret: decryptedSecret,
    encoding: 'base32',
    token: code,
    window: 1 // ACCEPTE -30s / actuel / +30s
});
```

#### Impact

- Augmente la surface d'attaque brute-force de 3x
- Avec 3 codes valides, l'attaquant a plus de chances de trouver un code correct

#### Remediation recommandee

```typescript
const isValid = speakeasy.totp.verify({
    secret: decryptedSecret,
    encoding: 'base32',
    token: code,
    window: 0, // Un seul code valide
    time: Math.floor(Date.now() / 1000) // Tolerence au niveau du serveur
});
```

---

### 6.3 MED-003: Pas de limite d'appareils par utilisateur

**Severite**: MOYENNE
**CVSS 3.1**: 3.1 (Low)
**CWE**: CWE-613 (Insufficient Session Expiration)

#### Description

Un compte peut etre utilise sur un nombre illimite d'appareils simultanement, sans notification ni controle de l'utilisateur.

#### Impact

- Partage de compte non detectable
- Tokens multiples en circulation
- Difficulte a revoquer l'acces en cas de compromission

#### Remediation recommandee

```typescript
// Modele Device
interface UserDevice {
    deviceId: string;
    platform: 'ios' | 'android';
    name: string;
    lastActive: Date;
    createdAt: Date;
}

// Constantes
const MAX_DEVICES_PER_USER = 5;

// Lors du login, verifier le nombre d'appareils
async function checkDeviceLimit(userId: string, deviceId: string): Promise<boolean> {
    const devices = await DeviceModel.find({ userId }).sort({ lastActive: -1 });

    // Si l'appareil est deja enregistre, OK
    if (devices.some(d => d.deviceId === deviceId)) {
        return true;
    }

    // Si limite atteinte, refuser ou supprimer le plus ancien
    if (devices.length >= MAX_DEVICES_PER_USER) {
        // Option 1: Refuser
        return false;

        // Option 2: Supprimer le plus ancien
        // await DeviceModel.deleteOne({ _id: devices[devices.length - 1]._id });
    }

    return true;
}
```

---

### 6.4 MED-004: Codes de recuperation sans limite specifique

**Severite**: MOYENNE
**CVSS 3.1**: 4.3 (Medium)
**CWE**: CWE-307 (Improper Restriction of Excessive Authentication Attempts)

#### Description

Les codes de recuperation utilisent le meme rate limiting que les codes TOTP. Un attaquant pourrait tenter de brute-forcer les codes de recuperation qui ont une entropie plus elevee (72 bits) mais sont verifies de la meme maniere.

#### Remediation recommandee

```typescript
// Compteur specifique pour les tentatives de codes de recuperation
async function checkRecoveryCodeAttempts(userId: string): Promise<boolean> {
    const key = `recovery_attempts:${userId}`;
    const attempts = await redis.get(key);

    if (attempts && parseInt(attempts) >= 3) {
        return false; // Bloque apres 3 echecs
    }

    return true;
}

async function recordRecoveryCodeFailure(userId: string): Promise<void> {
    const key = `recovery_attempts:${userId}`;
    await redis.incr(key);
    await redis.expire(key, 3600); // Expire apres 1 heure
}

async function resetRecoveryCodeAttempts(userId: string): Promise<void> {
    const key = `recovery_attempts:${userId}`;
    await redis.del(key);
}
```

---

## 7. VULNERABILITES BASSES

### 7.1 LOW-001: Logs contenant des informations sensibles

**Severite**: BASSE
**CWE**: CWE-532 (Insertion of Sensitive Information into Log File)

#### Description

Certains logs contiennent des Device IDs et des User-Agents complets qui pourraient etre consideres comme des donnees personnelles.

#### Localisation

Multiples fichiers, notamment `mobileAuthControllers.ts`, `mobileSecurityMiddleware.ts`

#### Remediation recommandee

```typescript
// Fonction de sanitisation des logs
function sanitizeForLog(data: any): any {
    return {
        ...data,
        deviceId: data.deviceId ? `${data.deviceId.substring(0, 8)}...` : undefined,
        userAgent: data.userAgent ? data.userAgent.substring(0, 50) : undefined,
        ipAddress: data.ipAddress ? maskIP(data.ipAddress) : undefined
    };
}

function maskIP(ip: string): string {
    if (ip.includes(':')) {
        // IPv6
        return ip.split(':').slice(0, 4).join(':') + ':****:****:****:****';
    } else {
        // IPv4
        return ip.split('.').slice(0, 2).join('.') + '.***.**';
    }
}
```

---

### 7.2 LOW-002: Absence de headers de securite specifiques mobile

**Severite**: BASSE
**CWE**: CWE-693 (Protection Mechanism Failure)

#### Description

Les reponses API ne contiennent pas certains headers de securite recommandes pour les APIs mobiles.

#### Remediation recommandee

```typescript
// Middleware pour ajouter des headers de securite API
app.use('/api/mobile', (req, res, next) => {
    // Empecher le caching des reponses sensibles
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // Indiquer que c'est une API JSON
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    // Protection contre le clickjacking (meme pour API)
    res.setHeader('X-Frame-Options', 'DENY');

    // Desactiver le MIME sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');

    next();
});
```

---

### 7.3 LOW-003: Pas de verification de version de l'application

**Severite**: BASSE
**CWE**: CWE-1188 (Insecure Default Initialization of Resource)

#### Description

L'API accepte les requetes de toutes les versions de l'application mobile, meme les versions obsoletes potentiellement vulnerables.

#### Remediation recommandee

```typescript
// Middleware de verification de version
const MIN_APP_VERSION = {
    ios: '1.2.0',
    android: '1.2.0'
};

function checkAppVersion(req: Request, res: Response, next: NextFunction) {
    const platform = req.headers['x-platform'] as string;
    const appVersion = req.headers['x-app-version'] as string;

    if (!appVersion) {
        return res.status(400).json({
            error: 'Version de l\'application requise',
            code: 'MISSING_APP_VERSION'
        });
    }

    const minVersion = MIN_APP_VERSION[platform as keyof typeof MIN_APP_VERSION];
    if (minVersion && compareVersions(appVersion, minVersion) < 0) {
        return res.status(426).json({
            error: 'Veuillez mettre a jour l\'application',
            code: 'UPDATE_REQUIRED',
            minVersion,
            currentVersion: appVersion
        });
    }

    next();
}
```

---

## 8. POINTS POSITIFS

### 8.1 Excellentes pratiques identifiees

| Categorie | Implementation | Evaluation |
|-----------|---------------|------------|
| **Rotation de cles JWT** | `jwtKeyManager.ts` avec versioning | Excellent |
| **Detection vol de token** | Token family dans `refreshTokenService.ts` | Excellent |
| **Chiffrement des donnees** | AES-256-GCM via `masterEncryptionUtils.ts` | Excellent |
| **Hachage des mots de passe** | bcrypt avec salt factor 10 | Correct |
| **Audit logging** | `auditService.ts` complet | Excellent |
| **Redis obligatoire en prod** | Verification au demarrage | Excellent |
| **Protection timing attack** | Dummy hash pour comparaison | Tres bien |
| **Codes de recuperation hashes** | bcrypt pour stockage | Correct |
| **CORS configure** | Origines restreintes | Correct |
| **Helmet integre** | Headers securise | Excellent |
| **Validation des entrees** | Regex et type checking | Correct |

### 8.2 Details des implementations positives

#### JWT Key Versioning

```typescript
// Support de multiples versions de cles pour rotation sans interruption
// Les anciens tokens restent valides jusqu'a expiration
const { secret, version } = jwtKeyManager.getCurrentKey();
// Stockage de la version dans le token: kv: version
```

#### Detection de vol de Refresh Token

```typescript
// Si un token revoque de la meme famille est reutilise = vol detecte
async detectTokenTheft(tokenFamily: string, userId: string): Promise<boolean> {
    const revokedTokenInFamily = await RefreshTokenModel.findOne({
        tokenFamily,
        revoked: true
    });

    if (revokedTokenInFamily) {
        // Revoquer TOUS les tokens de l'utilisateur
        await this.revokeAllUserTokens(userId, 'token_theft_detected');
        return true;
    }
    return false;
}
```

#### Protection Timing Attack sur mot de passe

```typescript
// Toujours comparer avec un hash, meme si l'utilisateur n'existe pas
const DUMMY_HASH = "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.KPYWxv0Y2dwzOe";
const passwordToCompare = user?.password || DUMMY_HASH;
const isPasswordValid = await bcrypt.compare(password, passwordToCompare);
```

---

## 9. CONFORMITE AUX STANDARDS

### 9.1 OWASP Mobile Top 10 2024

| ID | Risque | Statut | Commentaire |
|----|--------|--------|-------------|
| M1 | Improper Platform Usage | PARTIEL | Attestation non implementee |
| M2 | Insecure Data Storage | OK | Chiffrement correct |
| M3 | Insecure Communication | OK | HTTPS + TLS |
| M4 | Insecure Authentication | A CORRIGER | Vulnerabilites 2FA |
| M5 | Insufficient Cryptography | OK | AES-256, RSA-4096 |
| M6 | Insecure Authorization | OK | Verification userId |
| M7 | Client Code Quality | N/A | Cote serveur |
| M8 | Code Tampering | A CORRIGER | Attestation manquante |
| M9 | Reverse Engineering | N/A | Cote client |
| M10 | Extraneous Functionality | OK | Pas de debug en prod |

### 9.2 NIST SP 800-63B (Authentication)

| Section | Exigence | Statut | Commentaire |
|---------|----------|--------|-------------|
| 5.1.1 | Memorized Secrets | OK | Politique mot de passe forte |
| 5.1.3 | Out-of-Band | N/A | Non implemente |
| 5.1.4 | Single-Factor OTP | OK | TOTP conforme RFC 6238 |
| 5.1.5 | Multi-Factor OTP | OK | TOTP + mot de passe |
| 5.2.2 | Rate Limiting | PARTIEL | Contournable |
| 5.2.3 | Account Lockout | OK | 5 echecs = blocage 30min |
| 5.2.5 | Session Management | OK | JWT + Refresh Token |

### 9.3 RFC 6238 (TOTP)

| Exigence | Statut | Commentaire |
|----------|--------|-------------|
| Algorithme SHA-1/SHA-256 | OK | SHA-1 par defaut (speakeasy) |
| Periode 30 secondes | OK | Standard |
| 6 chiffres | OK | Conforme |
| Secret 128+ bits | OK | 256 bits (32 caracteres base32) |
| Synchronisation temporelle | ATTENTION | window: 1 est permissif |

---

## 10. RECOMMANDATIONS POUR L'APPLICATION MOBILE

### 10.1 Stockage securise des tokens

#### iOS (Swift)

```swift
import Security

class SecureStorage {

    static func storeToken(_ token: String, forKey key: String) throws {
        let data = token.data(using: .utf8)!

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            // Protection biometrique optionnelle
            // kSecAttrAccessControl as String: createAccessControl()
        ]

        // Supprimer l'existant
        SecItemDelete(query as CFDictionary)

        // Ajouter le nouveau
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw KeychainError.unableToStore
        }
    }

    static func retrieveToken(forKey key: String) throws -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess,
              let data = result as? Data,
              let token = String(data: data, encoding: .utf8) else {
            return nil
        }

        return token
    }

    static func deleteToken(forKey key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key
        ]
        SecItemDelete(query as CFDictionary)
    }
}
```

#### Android (Kotlin)

```kotlin
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class SecureStorage(private val context: Context) {

    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val securePrefs = EncryptedSharedPreferences.create(
        context,
        "secure_prefs",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    fun storeToken(key: String, token: String) {
        securePrefs.edit().putString(key, token).apply()
    }

    fun retrieveToken(key: String): String? {
        return securePrefs.getString(key, null)
    }

    fun deleteToken(key: String) {
        securePrefs.edit().remove(key).apply()
    }

    fun clearAll() {
        securePrefs.edit().clear().apply()
    }
}
```

### 10.2 Certificate Pinning

#### iOS (Swift avec URLSession)

```swift
class PinnedURLSessionDelegate: NSObject, URLSessionDelegate {

    // Hash SHA-256 du certificat serveur
    private let pinnedCertificateHash = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="

    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let serverTrust = challenge.protectionSpace.serverTrust else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }

        // Extraire le certificat
        guard let certificate = SecTrustGetCertificateAtIndex(serverTrust, 0) else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }

        // Calculer le hash
        let certData = SecCertificateCopyData(certificate) as Data
        let certHash = SHA256.hash(data: certData)
        let certHashBase64 = Data(certHash).base64EncodedString()

        // Verifier le pin
        if certHashBase64 == pinnedCertificateHash {
            completionHandler(.useCredential, URLCredential(trust: serverTrust))
        } else {
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }
}
```

#### Android (Kotlin avec OkHttp)

```kotlin
import okhttp3.CertificatePinner
import okhttp3.OkHttpClient

val certificatePinner = CertificatePinner.Builder()
    .add(
        "api.qvarry.fr",
        "sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
    )
    .build()

val client = OkHttpClient.Builder()
    .certificatePinner(certificatePinner)
    .build()
```

### 10.3 Device ID Generation

#### iOS

```swift
import UIKit

func getSecureDeviceId() -> String {
    // Utiliser identifierForVendor
    if let uuid = UIDevice.current.identifierForVendor?.uuidString {
        return uuid
    }

    // Fallback: UUID stocke dans le Keychain (persiste apres reinstallation)
    let key = "device_uuid"
    if let stored = SecureStorage.retrieveToken(forKey: key) {
        return stored
    }

    let newUUID = UUID().uuidString
    try? SecureStorage.storeToken(newUUID, forKey: key)
    return newUUID
}
```

#### Android

```kotlin
import android.provider.Settings

fun getSecureDeviceId(context: Context): String {
    // Android ID (unique par appareil/utilisateur)
    val androidId = Settings.Secure.getString(
        context.contentResolver,
        Settings.Secure.ANDROID_ID
    )

    if (!androidId.isNullOrEmpty() && androidId != "9774d56d682e549c") {
        return androidId
    }

    // Fallback: UUID genere et stocke
    val prefs = SecureStorage(context)
    prefs.retrieveToken("device_uuid")?.let { return it }

    val newUUID = UUID.randomUUID().toString()
    prefs.storeToken("device_uuid", newUUID)
    return newUUID
}
```

### 10.4 Gestion du cycle de vie des tokens

```typescript
// Configuration recommandee
const TOKEN_CONFIG = {
    accessToken: {
        expiresIn: '15m',           // 15 minutes
        refreshThreshold: 120       // Rafraichir 2 min avant expiration
    },
    refreshToken: {
        expiresIn: '24h',           // 24 heures (reduit pour mobile)
        rotateOnUse: true           // Rotation a chaque utilisation
    }
};

// Client mobile - Gestion automatique du refresh
class TokenManager {
    private accessToken: string | null = null;
    private refreshToken: string | null = null;
    private expiresAt: number = 0;

    async getValidAccessToken(): Promise<string> {
        // Verifier si le token est encore valide (avec marge)
        const now = Date.now() / 1000;
        if (this.accessToken && this.expiresAt - now > TOKEN_CONFIG.accessToken.refreshThreshold) {
            return this.accessToken;
        }

        // Rafraichir le token
        await this.refreshAccessToken();
        return this.accessToken!;
    }

    private async refreshAccessToken(): Promise<void> {
        const response = await fetch('/api/mobile/auth/refresh', {
            method: 'POST',
            body: JSON.stringify({ refreshToken: this.refreshToken })
        });

        if (!response.ok) {
            // Refresh token invalide - forcer re-authentification
            this.clearTokens();
            throw new AuthenticationError('Session expiree');
        }

        const data = await response.json();
        this.setTokens(data.accessToken, data.refreshToken, data.tokenExpiresIn);
    }
}
```

---

## 11. PLAN DE REMEDIATION

### 11.1 Phase 1 : Corrections critiques (J+1 a J+3)

| ID | Action | Effort | Responsable |
|----|--------|--------|-------------|
| CRIT-001 | Implementer token temporaire pour verify-login | 2-3h | Backend |
| CRIT-002 | Migrer rate limiting mobile vers Redis | 3-4h | Backend |

### 11.2 Phase 2 : Corrections hautes (J+4 a J+14)

| ID | Action | Effort | Responsable |
|----|--------|--------|-------------|
| HIGH-001 | Integrer App Attest (iOS) | 1-2j | Backend + iOS |
| HIGH-001 | Integrer Play Integrity (Android) | 1-2j | Backend + Android |
| HIGH-002 | Anonymiser les erreurs 2FA | 1h | Backend |
| HIGH-003 | (Inclus dans CRIT-002) | - | - |
| HIGH-004 | Supprimer secret de la reponse setup | 30min | Backend |

### 11.3 Phase 3 : Corrections moyennes (J+15 a J+30)

| ID | Action | Effort | Responsable |
|----|--------|--------|-------------|
| MED-001 | Ajouter binding Device-Token | 2-3h | Backend |
| MED-002 | Reduire window TOTP a 0 | 30min | Backend |
| MED-003 | Implementer limite d'appareils | 4-6h | Backend |
| MED-004 | Rate limit specifique recovery codes | 1-2h | Backend |

### 11.4 Phase 4 : Optimisations (J+30+)

| ID | Action | Effort | Responsable |
|----|--------|--------|-------------|
| LOW-001 | Sanitiser les logs | 2h | Backend |
| LOW-002 | Ajouter headers securite API | 1h | Backend |
| LOW-003 | Verification version app | 2h | Backend + Mobile |

### 11.5 Checklist de verification post-correction

```markdown
- [ ] CRIT-001: Tester que verify-login refuse les userId directs
- [ ] CRIT-002: Verifier que le rate limit persiste apres redemarrage
- [ ] HIGH-001: Valider l'attestation avec une app modifiee (doit echouer)
- [ ] HIGH-002: Verifier que les erreurs sont generiques
- [ ] HIGH-004: Confirmer que le secret n'apparait plus dans la reponse
- [ ] MED-001: Tester un token vole sur un autre appareil (doit echouer)
- [ ] MED-002: Verifier que seul le code actuel est accepte
- [ ] MED-003: Tester la limite de 5 appareils
- [ ] MED-004: Verifier le blocage apres 3 echecs recovery
```

---

## 12. ANNEXES

### 12.1 Glossaire

| Terme | Definition |
|-------|------------|
| JWT | JSON Web Token - Standard de token d'authentification |
| TOTP | Time-based One-Time Password - Mot de passe a usage unique base sur le temps |
| 2FA | Two-Factor Authentication - Authentification a deux facteurs |
| Rate Limiting | Limitation du nombre de requetes par periode de temps |
| Brute-force | Attaque par essais successifs de toutes les combinaisons |
| MITM | Man-in-the-Middle - Attaque par interception des communications |
| Certificate Pinning | Verification que le certificat serveur correspond a un hash connu |

### 12.2 References

1. OWASP Mobile Security Testing Guide
   https://owasp.org/www-project-mobile-security-testing-guide/

2. NIST Special Publication 800-63B
   https://pages.nist.gov/800-63-3/sp800-63b.html

3. RFC 6238 - TOTP
   https://datatracker.ietf.org/doc/html/rfc6238

4. RFC 7519 - JWT
   https://datatracker.ietf.org/doc/html/rfc7519

5. Apple App Attest Documentation
   https://developer.apple.com/documentation/devicecheck/establishing_your_app_s_integrity

6. Google Play Integrity API
   https://developer.android.com/google/play/integrity

### 12.3 Historique du document

| Version | Date | Auteur | Modifications |
|---------|------|--------|---------------|
| 1.0 | 12/02/2026 | Claude Code | Creation initiale |

---

**Fin du rapport d'audit**

*Ce document est confidentiel et destine uniquement aux equipes de developpement et de securite de Qvarry.*
