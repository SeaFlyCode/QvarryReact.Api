# Configuration des Tests Jest

Ce document explique la configuration des tests pour le projet QvarryReact.Api.

## 📁 Structure des fichiers de test

```
/
├── jest.config.ts                 # Configuration Jest
├── tsconfig.test.json             # Configuration TypeScript pour les tests
└── src/
    ├── types/
    │   └── jest.d.ts              # Déclarations de types Jest
    └── __tests__/
        ├── setup.ts               # Configuration globale des tests
        └── mocks/
            └── index.ts           # Mocks partagés
```

## 🔧 Configuration

### jest.config.ts

Configuration principale de Jest :

- **Preset**: `ts-jest` pour compiler TypeScript
- **Test Environment**: Node.js
- **Test Match**: Fichiers `*.test.ts` et `*.spec.ts`
- **Coverage**: Configuration de couverture de code avec seuils à 50%
- **Setup**: Fichier `src/__tests__/setup.ts` exécuté avant tous les tests

### src/**tests**/setup.ts

Configuration globale exécutée avant tous les tests :

- Définition de `NODE_ENV=test`
- Configuration des variables d'environnement de test
- Mocks globaux :
  - Service de logging (winston)
  - Mongoose (connexion MongoDB)
  - Redis (ioredis)
  - Nodemailer
  - bcrypt (pour accélérer les tests)

### src/**tests**/mocks/index.ts

Factories pour créer des mocks d'objets :

#### Mocks Express

- `mockRequest()` - Mock Request Express
- `mockResponse()` - Mock Response Express
- `mockNext()` - Mock NextFunction

#### Mocks Utilisateurs

- `mockUser()` - Utilisateur standard
- `mockAdminUser()` - Utilisateur admin
- `mockBlockedUser()` - Utilisateur bloqué
- `mockUnverifiedUser()` - Utilisateur non vérifié
- `mockUser2FA()` - Utilisateur avec 2FA

#### Mocks JWT

- `mockJwtPayload()` - Payload JWT
- `mockJwtToken()` - Token JWT
- `mockRefreshToken()` - Refresh token

#### Autres Mocks

- `mockMongooseDocument()` - Document Mongoose
- `mockMongooseModel()` - Modèle Mongoose
- `mockRedisClient()` - Client Redis
- `mockEmailTransporter()` - Transporter Nodemailer
- `mockWebSocket()` - Client WebSocket
- `mockWebSocketServer()` - Serveur WebSocket

#### Utilitaires

- `wait(ms)` - Attendre un délai
- `mockDateNow(timestamp)` - Mock Date.now()
- `resetAllMocks()` - Réinitialiser tous les mocks

## 🚀 Utilisation

### Lancer les tests

```bash
# Tous les tests
npm test

# Mode watch
npm run test:watch

# Avec couverture
npm run test:coverage

# Mode CI
npm run test:ci
```

### Exemple de test

```typescript
import {
  mockRequest,
  mockResponse,
  mockNext,
  mockUser,
} from "../__tests__/mocks";
import { authMiddleware } from "../middlewares/authMiddleware";

describe("authMiddleware", () => {
  it("should authenticate valid user", async () => {
    const req = mockRequest({
      headers: {
        authorization: "Bearer valid-token",
      },
    });
    const res = mockResponse();
    const next = mockNext();

    await authMiddleware(req as any, res as any, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should reject invalid token", async () => {
    const req = mockRequest({
      headers: {
        authorization: "Bearer invalid-token",
      },
    });
    const res = mockResponse();
    const next = mockNext();

    await authMiddleware(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
```

### Utilisation des mocks utilisateur

```typescript
import { mockUser, mockAdminUser, mockUser2FA } from "../__tests__/mocks";

describe("User Service", () => {
  it("should create a standard user", () => {
    const user = mockUser({
      email: "custom@test.com",
      name: "Custom",
    });

    expect(user.email).toBe("custom@test.com");
    expect(user.is_admin).toBe(false);
  });

  it("should create an admin user", () => {
    const admin = mockAdminUser();
    expect(admin.is_admin).toBe(true);
  });

  it("should create a 2FA user", () => {
    const user2fa = mockUser2FA();
    expect(user2fa.two_factor_enabled).toBe(true);
  });
});
```

## 🧪 Variables d'environnement de test

Les variables suivantes sont automatiquement définies dans `setup.ts` :

```
NODE_ENV=test
JWT_SECRET=test-jwt-secret-key-for-unit-tests-only-do-not-use-in-production
JWT_REFRESH_SECRET=test-jwt-refresh-secret-key-for-unit-tests-only
ENCRYPTION_KEY_MASTER=0123456789abcdef... (64 hex chars)
EMAIL_HMAC_KEY=fedcba9876543210... (64 hex chars)
DB_CONN_STRING=mongodb://localhost:27017/qvarry-test
REDIS_HOST=localhost
REDIS_PORT=6379
```

## 📊 Couverture de code

Configuration des seuils de couverture :

- Branches: 50%
- Fonctions: 50%
- Lignes: 50%
- Statements: 50%

Les fichiers suivants sont exclus de la couverture :

- `*.d.ts` - Fichiers de déclaration TypeScript
- `*.test.ts` et `*.spec.ts` - Fichiers de test
- `src/__tests__/**` - Dossier de tests
- `src/server.ts` - Point d'entrée de l'application
- `src/test-logger.ts` - Fichier de test du logger

## 🔍 Debugging

Pour déboguer les tests :

```bash
# Lancer les tests en mode verbose
npm test -- --verbose

# Lancer un test spécifique
npm test -- path/to/test.test.ts

# Lancer les tests avec un pattern
npm test -- --testNamePattern="should authenticate"

# Déboguer avec Node Inspector
node --inspect-brk node_modules/.bin/jest --runInBand
```

## 📝 Conventions

1. **Nommage des fichiers** : `*.test.ts` ou `*.spec.ts`
2. **Organisation** : Placer les tests à côté des fichiers testés ou dans `__tests__/`
3. **Structure** : Utiliser `describe` pour grouper et `it`/`test` pour les cas de test
4. **Mocks** : Utiliser les mocks partagés de `src/__tests__/mocks/`
5. **Cleanup** : Les mocks sont automatiquement réinitialisés entre les tests

## ⚠️ Notes importantes

- Les logs sont silencieux par défaut pendant les tests (sauf si `DEBUG=true`)
- Mongoose et Redis sont mockés globalement
- bcrypt est mocké pour accélérer les tests
- Les types Jest sont disponibles via `src/types/jest.d.ts`
- Le `tsconfig.json` principal reste inchangé
