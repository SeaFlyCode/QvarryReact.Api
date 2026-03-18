# Tests d'intégration

## Périmètre

Les tests d'intégration sont situés dans `src/__tests__/routes/`. Ils testent les routes HTTP complètes en simulant des requêtes réelles grâce à **supertest v7**, depuis la réception de la requête jusqu'à la réponse JSON, en passant par tous les middlewares.

Les mocks globaux définis dans `setup.ts` (mongoose, Redis, nodemailer, etc.) restent actifs pendant ces tests, garantissant qu'aucune connexion réelle n'est établie vers les services externes.

---

## Principe de fonctionnement

```
supertest(app)
    │
    ▼
Express Router
    │
    ├─► Middlewares mockés (auth, rate limit, etc.)
    │
    ├─► Controller
    │       ├── Modèle Mongoose (mocké)
    │       ├── Service Redis (mocké)
    │       └── Service email (mocké)
    │
    └─► Réponse HTTP vérifiée par Jest
```

### Pattern de base

```typescript
import request from "supertest";
import express from "express";
import authRouter from "../../../routes/authRoutes";

// Mock des middlewares d'authentification
jest.mock("../../../middlewares/authMiddleware", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    req.user = mockUser();
    next();
  },
  requireAdmin: (req: any, res: any, next: any) => {
    req.user = mockAdminUser();
    next();
  },
}));

const app = express();
app.use(express.json());
app.use("/auth", authRouter);

describe("Auth Routes", () => {
  it("POST /auth/login → 200 avec credentials valides", async () => {
    const response = await request(app)
      .post("/auth/login")
      .send({ email: "user@example.com", password: "Password123!" });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("success", true);
  });

  it("POST /auth/login → 400 sans email", async () => {
    const response = await request(app)
      .post("/auth/login")
      .send({ password: "Password123!" });

    expect(response.status).toBe(400);
  });
});
```

---

## Routes testées

### API principale

| Fichier de test               | Route testée       | Méthodes couvertes                                         |
| ----------------------------- | ------------------ | ---------------------------------------------------------- |
| `authRoutes.test.ts`          | `/auth/*`          | Login, logout, refresh, vérification email, reset password |
| `userRoutes.test.ts`          | `/users/*`         | Profil, mise à jour, suppression de compte                 |
| `contactRoutes.test.ts`       | `/contacts/*`      | Ajout, suppression, liste des contacts                     |
| `conversationsRoutes.test.ts` | `/conversations/*` | Création, liste, archivage                                 |
| `messagesRoutes.test.ts`      | `/messages/*`      | Envoi, réception, suppression                              |
| `fichesRoutes.test.ts`        | `/fiches/*`        | CRUD fiches d'urgence                                      |
| `listsRoutes.test.ts`         | `/lists/*`         | CRUD listes                                                |
| `pointsRoutes.test.ts`        | `/points/*`        | Gestion des points géographiques                           |
| `dataShareRoutes.test.ts`     | `/data-share/*`    | Partage de données entre utilisateurs                      |
| `notificationsRoutes.test.ts` | `/notifications/*` | Liste, marquage lu, préférences                            |
| `securityRoutes.test.ts`      | `/security/*`      | Sessions actives, déconnexion distante                     |
| `adminRoutes.test.ts`         | `/admin/*`         | Gestion utilisateurs, statistiques                         |
| `maintenanceRoutes.test.ts`   | `/maintenance/*`   | Mode maintenance                                           |
| `twoFactorRoutes.test.ts`     | `/2fa/*`           | Activation, vérification, codes de récupération            |

### API mobile

| Fichier de test                 | Route testée     | Méthodes couvertes                 |
| ------------------------------- | ---------------- | ---------------------------------- |
| `mobileAuthRoutes.test.ts`      | `/mobile/auth/*` | Authentification depuis app mobile |
| `mobileTwoFactorRoutes.test.ts` | `/mobile/2fa/*`  | 2FA mobile                         |
| `mobileSyncRoutes.test.ts`      | `/mobile/sync/*` | Synchronisation données            |
| `mobilePushTokenRoutes.test.ts` | `/mobile/push/*` | Enregistrement token FCM           |
| `mobileSosRoutes.test.ts`       | `/mobile/sos/*`  | Déclenchement et gestion SOS       |

---

## Cas de test couverts

Pour chaque route, les tests d'intégration vérifient typiquement :

### Cas nominaux (happy path)

```typescript
it("devrait retourner 200 avec les données correctes", async () => {
  const response = await request(app)
    .get("/users/profile")
    .set("Cookie", "qvarry_jwt=valid-token");

  expect(response.status).toBe(200);
  expect(response.body.data).toBeDefined();
});
```

### Authentification manquante ou invalide

```typescript
it("devrait retourner 401 sans token", async () => {
  const response = await request(app).get("/users/profile");

  expect(response.status).toBe(401);
});
```

### Validation des entrées

```typescript
it("devrait retourner 400 avec un corps invalide", async () => {
  const response = await request(app)
    .post("/contacts")
    .send({ invalid_field: "value" });

  expect(response.status).toBe(400);
  expect(response.body.errors).toBeDefined();
});
```

### Contrôle d'accès (admin uniquement)

```typescript
it("devrait retourner 403 pour un utilisateur non-admin", async () => {
  // Le mock de requireAdmin est contourné pour simuler un utilisateur normal
  const response = await request(app).get("/admin/users");

  expect(response.status).toBe(403);
});
```

---

## Mock des middlewares d'authentification

Les middlewares d'authentification sont mockés pour permettre de tester les routes sans générer de vrais JWT :

```typescript
// Mock standard — utilisateur authentifié
jest.mock("../../../middlewares/authMiddleware", () => ({
  requireAuth: jest.fn((req: any, res: any, next: any) => {
    req.user = {
      _id: "test-user-id",
      email: "user@example.com",
      is_admin: false,
    };
    next();
  }),
}));

// Pour tester les routes protégées par admin
jest.mock("../../../middlewares/authMiddleware", () => ({
  requireAdmin: jest.fn((req: any, res: any, next: any) => {
    req.user = { _id: "admin-id", is_admin: true };
    next();
  }),
}));
```

---

## Commandes d'exécution

| Commande                | Usage                                          |
| ----------------------- | ---------------------------------------------- |
| `npm test`              | Lance tous les tests (unitaires + intégration) |
| `npm run test:watch`    | Mode watch, relance à chaque modification      |
| `npm run test:coverage` | Tests + couverture dans `coverage/`            |
| `npm run test:ci`       | Mode CI strict avec rapport JUnit XML          |

### Filtrer les tests d'intégration uniquement

```bash
# Via Jest CLI directement
npx jest src/__tests__/routes/

# Un seul fichier
npx jest src/__tests__/routes/authRoutes.test.ts
```
