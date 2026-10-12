# E2E API (Playwright, sans navigateur)

Teste de bout en bout un serveur Qvarry **déjà démarré** (aucun serveur/DB lancé par la suite).

## Commandes

```bash
npm run test:e2e-api                 # tout
npm run test:e2e-api:list            # lister les tests
npx playwright test e2e/specs/06-plans.spec.ts
npx playwright show-report           # rapport HTML
```

## Variables d'environnement

| Variable | Rôle |
| --- | --- |
| `E2E_API_URL` | URL du serveur (défaut `http://localhost:3000`) |
| `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD` | compte standard, **sans 2FA** (requis pour auth/points/fiches/plans/speleo) |
| `E2E_TEST_EMAIL_2` / `E2E_TEST_PASSWORD_2` | 2e compte (isolation inter-utilisateurs sur les plans) |
| `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` | compte admin (lecture seule) |
| `E2E_APPCHECK_TOKEN` | optionnel : token Firebase App Check si actif côté serveur |

Serveur injoignable (`/api/health` puis `/health`) ou identifiants absents/refusés : les tests concernés sont **skipped** avec la raison, jamais en échec.

## Principes

- Login mobile (`POST /api/v1/mobile/auth/login`) effectué **une seule fois par compte** dans `global-setup.ts` (budget rate limit mobile très bas : 3/h/IP, 5/15 min en prod). Session stockée dans `e2e/.auth/` (gitignoré).
- Aucun contournement de sécurité : 2FA, App Check ou rate limit bloquant => skip.
- Pas de test de lockout ni de bruteforce ; le test de login invalide utilise un email inexistant. Rate limiting : 3 requêtes sur `/health`, vérification des en-têtes `RateLimit-*` uniquement.
- Les ressources créées (points, plans) sont supprimées dans `afterEach`/`afterAll`.
- `98-refresh.spec.ts` s'exécute en dernier (la rotation consomme le refresh token).
- Jest (`roots: src`) et ESLint (`src/**`) ignorent `e2e/`. Typecheck : `npx tsc -p e2e/tsconfig.json`.
