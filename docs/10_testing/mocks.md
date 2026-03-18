# Mocks et factories de test

## Vue d'ensemble

Le fichier `src/__tests__/mocks/index.ts` centralise toutes les factories de mocks réutilisables à travers la suite de tests. Il est importé dans les fichiers de test individuels selon les besoins.

Le fichier `src/__tests__/setup.ts` configure les mocks globaux appliqués automatiquement à chaque suite de tests.

---

## Mocks Express

### `mockRequest(options?)`

Crée un objet `Request` Express factice avec les propriétés configurables suivantes :

```typescript
const req = mockRequest({
  body: { email: "user@example.com", password: "pass" },
  params: { id: "507f1f77bcf86cd799439011" },
  query: { page: "1", limit: "20" },
  headers: { "x-forwarded-for": "192.168.1.1" },
  cookies: { qvarry_jwt: "test-token" },
  user: mockUser(),
  ip: "127.0.0.1",
  method: "POST",
  url: "/auth/login",
  path: "/auth/login",
});
```

### `mockResponse()`

Crée un objet `Response` Express factice. Toutes les méthodes sont des `jest.fn().mockReturnThis()` pour permettre le chaînage :

| Méthode mockée                 | Type de retour     |
| ------------------------------ | ------------------ |
| `status(code)`                 | `this` (chaînable) |
| `json(data)`                   | `this`             |
| `send(data)`                   | `this`             |
| `setHeader(name, value)`       | `this`             |
| `cookie(name, value, options)` | `this`             |
| `clearCookie(name)`            | `this`             |
| `redirect(url)`                | `this`             |
| `render(view, data)`           | `this`             |
| `end()`                        | `this`             |
| `sendStatus(code)`             | `this`             |

```typescript
const res = mockResponse();
// Utilisation dans les assertions
expect(res.status).toHaveBeenCalledWith(200);
expect(res.json).toHaveBeenCalledWith({ success: true });
```

### `mockNext()`

```typescript
const next = mockNext(); // jest.fn() typé comme NextFunction
expect(next).toHaveBeenCalledWith(expect.any(Error));
```

---

## Mocks utilisateurs

Toutes les factories acceptent un paramètre `overrides` pour personnaliser les valeurs par défaut.

### `mockUser(overrides?)`

Utilisateur standard vérifié :

```typescript
{
  _id: 'test-user-id',
  email: 'user@example.com',
  is_verified: true,
  is_admin: false,
  is_blocked: false,
  gdpr_consent: true,
  two_factor_enabled: false
}
```

### `mockAdminUser(overrides?)`

Identique à `mockUser` avec `is_admin: true`.

### `mockBlockedUser(overrides?)`

```typescript
{
  ...mockUser(),
  is_blocked: true,
  blocked_reason: 'Violation des conditions d\'utilisation'
}
```

### `mockUnverifiedUser(overrides?)`

```typescript
{
  ...mockUser(),
  is_verified: false,
  email_verification_token: 'verification-token-123'
}
```

### `mockUser2FA(overrides?)`

```typescript
{
  ...mockUser(),
  two_factor_enabled: true,
  two_factor_secret: 'JBSWY3DPEHPK3PXP',
  two_factor_recovery_codes: ['code1', 'code2', ...]
}
```

---

## Mocks JWT

### `mockJwtPayload(overrides?)`

```typescript
{
  userId: 'test-user-id',
  email: 'user@example.com',
  is_admin: false,
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 900  // +15 minutes
}
```

### `mockJwtToken()`

Retourne une chaîne JWT de test (format valide pour les assertions de format).

### `mockRefreshToken()`

Retourne un refresh token aléatoire (chaîne hexadécimale).

---

## Mocks MongoDB

### `mockMongooseDocument<T>(data)`

Simule un document Mongoose avec les méthodes d'instance :

```typescript
const doc = mockMongooseDocument<IUser>({
  email: "test@example.com",
  is_verified: true,
});

// Méthodes disponibles (toutes jest.fn())
doc.save();
doc.remove();
doc.deleteOne();
doc.toObject();
doc.toJSON();
```

Le champ `_id` est automatiquement généré si non fourni dans `data`.

### `mockMongooseModel<T>()`

Simule un modèle Mongoose complet avec les méthodes statiques :

| Méthode                      | Description          |
| ---------------------------- | -------------------- |
| `find(filter)`               | Recherche multiple   |
| `findOne(filter)`            | Recherche unique     |
| `findById(id)`               | Recherche par ID     |
| `create(data)`               | Création de document |
| `updateOne(filter, update)`  | Mise à jour unique   |
| `updateMany(filter, update)` | Mise à jour multiple |
| `deleteOne(filter)`          | Suppression unique   |
| `deleteMany(filter)`         | Suppression multiple |
| `countDocuments(filter)`     | Comptage             |
| `exists(filter)`             | Existence            |
| `save()`                     | Sauvegarde           |

---

## Mocks Redis

### `mockRedisClient()`

Retourne un client ioredis factice avec toutes les méthodes en `jest.fn()` :

```typescript
const redis = mockRedisClient();

// Configuration pour un test
redis.get.mockResolvedValue('{"userId":"123","email":"test@example.com"}');
redis.exists.mockResolvedValue(1);

// Méthodes disponibles
redis.get(key);
redis.set(key, value);
redis.setex(key, seconds, value);
redis.del(key);
redis.exists(key);
redis.expire(key, seconds);
redis.ttl(key);
redis.keys(pattern);
redis.flushdb();
redis.quit();
redis.disconnect();
redis.on(event, handler);
redis.ping();
```

---

## Mocks Email

### `mockEmailTransporter()`

```typescript
const transporter = mockEmailTransporter();

// sendMail retourne automatiquement { messageId: 'test-message-id' }
transporter.sendMail.mockResolvedValue({ messageId: "msg-123" });
transporter.verify.mockResolvedValue(true);
```

---

## Mocks WebSocket

### `mockWebSocket()`

Simule une connexion WebSocket cliente :

```typescript
{
  send: jest.fn(),
  close: jest.fn(),
  on: jest.fn(),
  once: jest.fn(),
  emit: jest.fn(),
  readyState: 1  // WebSocket.OPEN
}
```

### `mockWebSocketServer()`

Simule un serveur WebSocket :

```typescript
{
  clients: new Set(),  // Ensemble des clients connectés
  on: jest.fn(),
  emit: jest.fn(),
  close: jest.fn(),
  handleUpgrade: jest.fn()
}
```

---

## Utilitaires de test

### `wait(ms)`

Pause asynchrone pour tester des comportements temporels :

```typescript
await wait(100); // Attend 100ms
```

### `mockDateNow(timestamp)`

Mock `Date.now()` et retourne une fonction de restauration :

```typescript
const restore = mockDateNow(1700000000000);
// ... tests dépendants du temps
restore(); // Restaure Date.now() original
```

### `resetAllMocks()`

Appelle `jest.clearAllMocks()` puis `jest.resetAllMocks()` — utile dans `beforeEach` pour une réinitialisation complète.

---

## Mocks globaux — setup.ts

Ces mocks s'appliquent automatiquement à **tous** les fichiers de test sans import explicite.

### Modules mockés

```typescript
// Mongoose — aucune connexion DB réelle
jest.mock("mongoose", () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  connection: {
    close: jest.fn().mockResolvedValue(undefined),
  },
}));

// ioredis — aucune connexion Redis réelle
jest.mock("ioredis", () => jest.fn(() => mockRedisClient()));

// nodemailer — aucun email envoyé
jest.mock("nodemailer", () => ({
  createTransport: jest.fn(() => mockEmailTransporter()),
}));

// bcrypt — hashing instantané (pas de calcul coûteux)
jest.mock("bcrypt", () => ({
  hash: jest.fn().mockResolvedValue("hashed-password"),
  compare: jest.fn().mockResolvedValue(true),
  genSalt: jest.fn().mockResolvedValue("salt"),
  hashSync: jest.fn().mockReturnValue("hashed-sync"),
  compareSync: jest.fn().mockReturnValue(true),
}));

// Logger — aucun fichier de log créé
jest.mock("../services/loggerService", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    critical: jest.fn(),
    http: jest.fn(),
  },
}));

// WebSocket Service — aucun WebSocket réel
jest.mock("../services/webSocketService", () => ({
  // Toutes les méthodes du service mockées
  sendToUser: jest.fn(),
  broadcast: jest.fn(),
  getConnectedClients: jest.fn().mockReturnValue([]),
}));
```

### Variables d'environnement injectées

```
JWT_SECRET=test-jwt-secret-key-for-testing-only
JWT_REFRESH_SECRET=test-refresh-secret-key-for-testing-only
ENCRYPTION_KEY_MASTER=test-master-encryption-key-32chars
ENCRYPTION_KEY_COMMUNICATION=test-communication-key-32chars!
EMAIL_HMAC_KEY=test-email-hmac-key
DB_CONN_STRING=mongodb://localhost:27017
DB_NAME=qvarry_test
NODE_ENV=test
```

⚠️ Ces valeurs sont uniquement valides pour les tests. Ne jamais utiliser ces clés en production.
