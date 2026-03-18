# Tests unitaires

## Périmètre

Les tests unitaires couvrent les couches **controllers**, **services**, **utils**, **models** et **config**. Chaque unité est testée en isolation grâce au système de mocks Jest.

---

## Pattern général

### Factories mockRequest / mockResponse / mockNext

Toutes les factories sont importées depuis `src/__tests__/mocks/index.ts` :

```typescript
import { mockRequest, mockResponse, mockNext } from "../../mocks";
```

Ces factories créent des objets Express factices avec des `jest.fn()` pour chaque méthode, permettant de vérifier les appels sans déclencher de vraie logique HTTP.

### Structure type d'un test de controller

```typescript
import { mockRequest, mockResponse, mockNext } from "../../mocks";
import { loginController } from "../../../controllers/auth/loginController";

jest.mock("../../../models/users");

describe("LoginController", () => {
  it("should return 200 on valid credentials", async () => {
    const req = mockRequest({
      body: { email: "user@example.com", password: "SecurePass123!" },
    });
    const res = mockResponse();

    await loginController(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });
});
```

Le modèle Mongoose est mocké via `jest.mock()` avant l'exécution, ce qui empêche toute connexion réelle à la base de données.

---

## Tests de controllers

### Sous-dossier `controllers/auth/`

| Fichier de test               | Controller testé           | Points clés                                         |
| ----------------------------- | -------------------------- | --------------------------------------------------- |
| `loginController.test.ts`     | Connexion utilisateur      | Validation credentials, génération JWT, gestion 2FA |
| `logoutController.test.ts`    | Déconnexion                | Révocation token, nettoyage session Redis           |
| `passwordController.test.ts`  | Gestion mot de passe       | Reset, changement, validation complexité            |
| `authHelpers.test.ts`         | Fonctions utilitaires auth | Helpers partagés entre controllers                  |
| `websocketController.test.ts` | Authentification WebSocket | Handshake, validation token WS                      |

### Pattern de mock des dépendances

```typescript
// Mock du modèle Mongoose
jest.mock("../../../models/users");
import User from "../../../models/users";
const MockUser = User as jest.Mocked<typeof User>;

// Configuration du mock pour un test
MockUser.findOne.mockResolvedValue(mockUser({ email: "test@example.com" }));

// Mock d'un service
jest.mock("../../../services/redisSessionService");
```

---

## Tests de services

| Fichier de test                   | Service testé                                        |
| --------------------------------- | ---------------------------------------------------- |
| `sosService.test.ts`              | Logique SOS : déclenchement, escalade, notifications |
| `emailService.test.ts`            | Envoi d'emails via nodemailer                        |
| `webSocketService.test.ts`        | Gestion des connexions WebSocket                     |
| `redisSessionService.test.ts`     | Sessions Redis : création, expiration, rotation      |
| `pushNotificationService.test.ts` | Notifications Firebase FCM                           |
| `syncService.test.ts`             | Synchronisation mobile                               |
| `auditService.test.ts`            | Journalisation des événements de sécurité            |
| `loggerService.test.ts`           | Configuration Winston et formatage                   |

### Exemple — test de service avec mock Redis

```typescript
import { mockRedisClient } from "../../mocks";
import { getSession } from "../../../services/redisSessionService";

const mockRedis = mockRedisClient();
jest.mock("ioredis", () => jest.fn(() => mockRedis));

describe("RedisSessionService", () => {
  it("should return null for expired session", async () => {
    mockRedis.get.mockResolvedValue(null);

    const session = await getSession("expired-token");

    expect(session).toBeNull();
    expect(mockRedis.get).toHaveBeenCalledWith("session:expired-token");
  });
});
```

---

## Tests d'utils

| Fichier de test                        | Utilitaire testé                            |
| -------------------------------------- | ------------------------------------------- |
| `masterEncryptionUtils.test.ts`        | Chiffrement/déchiffrement maître (AES-256)  |
| `jwtKeyManager.test.ts`                | Gestion des clés RSA pour JWT               |
| `rsaEncryptionUtils.test.ts`           | Chiffrement RSA asymétrique                 |
| `communicationEncryptionUtils.test.ts` | Chiffrement des messages                    |
| `userEncryptionUtils.test.ts`          | Chiffrement des données utilisateur         |
| `passwordUtils.test.ts`                | Validation, hash, vérification mot de passe |
| `deviceFingerprint.test.ts`            | Génération d'empreinte appareil             |
| `emailUtils.test.ts`                   | Validation, normalisation email             |
| `logUtils.test.ts`                     | Sanitisation des logs, redaction            |
| `errorUtils.test.ts`                   | Formatage des erreurs HTTP                  |
| `sanitizeUtils.test.ts`                | Nettoyage des entrées utilisateur           |

### Exemple — test d'utilitaire de chiffrement

```typescript
import { encrypt, decrypt } from "../../../utils/masterEncryptionUtils";

describe("MasterEncryptionUtils", () => {
  const testData = "données sensibles";

  it("should encrypt and decrypt data correctly", () => {
    const encrypted = encrypt(testData);

    expect(encrypted).not.toBe(testData);
    expect(encrypted).toMatch(/^[a-f0-9]+:[a-f0-9]+$/); // iv:ciphertext

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(testData);
  });

  it("should produce different ciphertext for same input", () => {
    const enc1 = encrypt(testData);
    const enc2 = encrypt(testData);

    expect(enc1).not.toBe(enc2); // IV aléatoire à chaque appel
  });
});
```

---

## Tests de config

| Fichier de test           | Configuration testée                                 |
| ------------------------- | ---------------------------------------------------- |
| `database.test.ts`        | Connexion MongoDB, retry logic, options de connexion |
| `cookieConfig.test.ts`    | Options cookie JWT selon l'environnement             |
| `rateLimitConfig.test.ts` | Configuration des rate limiters par route            |
| `swagger.test.ts`         | Génération de la documentation OpenAPI               |

---

## Tests de modèles

Le fichier `models/models.test.ts` teste les schémas Mongoose :

- Validation des champs obligatoires
- Valeurs par défaut
- Méthodes de schéma (virtuals, hooks)
- Contraintes d'unicité et d'index
- Transformations `toJSON` / `toObject`

```typescript
import { mockMongooseDocument } from "../../mocks";

describe("User Model", () => {
  it("should require email field", async () => {
    const user = new User({});

    await expect(user.validate()).rejects.toThrow(/email.*required/i);
  });

  it("should set default values", () => {
    const doc = mockMongooseDocument({ email: "test@example.com" });

    expect(doc.is_verified).toBe(false);
    expect(doc.is_admin).toBe(false);
    expect(doc.is_blocked).toBe(false);
  });
});
```

---

## Bonnes pratiques appliquées

```
┌─────────────────────────────────────────────────────────┐
│  ISOLATION     │ Chaque test mocke ses propres dépendances│
│  LISIBILITÉ    │ Nommage describe/it en anglais clair     │
│  RÉPÉTABILITÉ  │ clearMocks + resetMocks entre chaque test│
│  RAPIDITÉ      │ Pas d'I/O réel (tout est mocké)          │
│  COUVERTURE    │ Happy path + cas d'erreur + edge cases   │
└─────────────────────────────────────────────────────────┘
```
