# Vue d'ensemble des tests

## Framework et configuration

QvarryReact.Api utilise **Jest v29** avec **ts-jest v29** pour l'exécution des tests TypeScript natifs, et **supertest v7** pour les tests d'intégration HTTP.

La configuration Jest est définie dans `jest.config.ts` à la racine du projet.

### jest.config.ts — paramètres clés

| Paramètre            | Valeur                   |
| -------------------- | ------------------------ |
| `preset`             | `ts-jest`                |
| `testEnvironment`    | `node`                   |
| `roots`              | `<rootDir>/src`          |
| `setupFilesAfterEnv` | `src/__tests__/setup.ts` |
| `verbose`            | `true`                   |
| `clearMocks`         | `true`                   |
| `resetMocks`         | `true`                   |
| `restoreMocks`       | `true`                   |
| Timeout global       | `10 000 ms`              |

### Patterns de fichiers reconnus

```
**/__tests__/**/*.test.ts
**/__tests__/**/*.spec.ts
```

---

## Structure du répertoire de tests

Tous les tests sont regroupés sous `src/__tests__/` :

```
src/__tests__/
├── setup.ts                        # Configuration globale Jest
├── mocks/
│   └── index.ts                    # Factories de mocks réutilisables
├── controllers/
│   ├── auth/
│   │   ├── loginController.test.ts
│   │   ├── logoutController.test.ts
│   │   ├── passwordController.test.ts
│   │   ├── authHelpers.test.ts
│   │   └── websocketController.test.ts
│   └── ...                         # 30+ fichiers de tests controllers
├── routes/
│   └── ...                         # 20+ fichiers de tests routes
├── services/
│   └── ...                         # 20+ fichiers de tests services
├── middlewares/
│   └── ...                         # 9+ fichiers de tests middlewares
├── utils/
│   └── ...                         # 6+ fichiers de tests utils
├── models/
│   └── models.test.ts
└── config/
    ├── database.test.ts
    ├── cookieConfig.test.ts
    ├── rateLimitConfig.test.ts
    └── swagger.test.ts
```

### Répartition par catégorie

| Catégorie   | Fichiers | Notes                                    |
| ----------- | -------- | ---------------------------------------- |
| Controllers | 30+      | Dont le sous-dossier `auth/` complet     |
| Routes      | 20+      | Tests d'intégration HTTP via supertest   |
| Services    | 20+      | Services métier, email, WebSocket, Redis |
| Middlewares | 9+       | Auth, rate limit, maintenance, etc.      |
| Utils       | 6+       | Chiffrement, JWT, mots de passe, etc.    |
| Config      | 3+       | Base de données, cookies, rate limit     |
| Models      | 1        | `models.test.ts`                         |
| Mocks       | 1        | `mocks/index.ts`                         |
| Setup       | 1        | `setup.ts`                               |
| **Total**   | **90+**  |                                          |

---

## Fichier setup.ts — mocks globaux

Le fichier `src/__tests__/setup.ts` est chargé avant chaque suite de tests via `setupFilesAfterEnv`. Il initialise les mocks globaux suivants :

### Modules mockés automatiquement

| Module                         | Ce qui est mocké                                        |
| ------------------------------ | ------------------------------------------------------- |
| `mongoose`                     | `connect`, `disconnect`, `connection.close`             |
| `ioredis`                      | Client Redis complet                                    |
| `nodemailer`                   | `createTransport`                                       |
| `bcrypt`                       | `hash`, `compare`, `genSalt`, `hashSync`, `compareSync` |
| `../services/loggerService`    | Logger entier (tous les niveaux)                        |
| `../services/webSocketService` | Toutes les méthodes du service                          |

### Variables d'environnement de test

`setup.ts` initialise également les variables d'environnement nécessaires à l'exécution des tests :

```
JWT_SECRET
JWT_REFRESH_SECRET
ENCRYPTION_KEY_MASTER
ENCRYPTION_KEY_COMMUNICATION
EMAIL_HMAC_KEY
DB_CONN_STRING
DB_NAME
```

Ces valeurs sont des données de test et ne correspondent pas aux secrets de production.

---

## Scripts npm disponibles

| Commande                | Description                                         |
| ----------------------- | --------------------------------------------------- |
| `npm test`              | Lance tous les tests une fois                       |
| `npm run test:watch`    | Mode watch — relance à chaque modification          |
| `npm run test:coverage` | Tests + rapport de couverture dans `coverage/`      |
| `npm run test:ci`       | Tests CI : `--ci --coverage` + reporters jest-junit |

### Comportement des mocks entre les tests

Les trois options `clearMocks`, `resetMocks` et `restoreMocks` sont toutes activées, ce qui garantit qu'aucun état de mock ne persiste d'un test à l'autre :

- **clearMocks** : efface les appels, instances et résultats enregistrés
- **resetMocks** : réinitialise l'implémentation des mocks à leur état par défaut
- **restoreMocks** : restaure les espions (`jest.spyOn`) vers leur implémentation originale

---

## Diagramme de la chaîne d'exécution

```
npm test
    │
    ▼
jest.config.ts
    │
    ├─► setupFilesAfterEnv → src/__tests__/setup.ts
    │       ├── jest.mock('mongoose')
    │       ├── jest.mock('ioredis')
    │       ├── jest.mock('nodemailer')
    │       ├── jest.mock('bcrypt')
    │       ├── jest.mock('loggerService')
    │       └── jest.mock('webSocketService')
    │
    ├─► src/__tests__/controllers/**/*.test.ts
    ├─► src/__tests__/routes/**/*.test.ts
    ├─► src/__tests__/services/**/*.test.ts
    ├─► src/__tests__/middlewares/**/*.test.ts
    ├─► src/__tests__/utils/**/*.test.ts
    ├─► src/__tests__/models/**/*.test.ts
    └─► src/__tests__/config/**/*.test.ts
```
