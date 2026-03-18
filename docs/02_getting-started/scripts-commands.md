# Scripts et Commandes NPM

## Tableau complet des scripts

| Script                       | Commande                                                   | Description                                   |
| ---------------------------- | ---------------------------------------------------------- | --------------------------------------------- |
| `start`                      | `node dist/server.js`                                      | Démarre le serveur depuis le build compilé    |
| `start:prod`                 | `NODE_ENV=production node dist/server.js`                  | Démarre en mode production explicite          |
| `dev`                        | `nodemon src/server.ts`                                    | Démarre avec hot-reload pour le développement |
| `dev:debug`                  | `DEBUG=* nodemon --inspect src/server.ts`                  | Développement avec debugger Node.js activé    |
| `build`                      | `npm run clean && tsc -p tsconfig.prod.json`               | Compile TypeScript pour la production         |
| `build:prod`                 | `npm run build && npm run obfuscate`                       | Build + obfuscation du code compilé           |
| `build:watch`                | `tsc --watch`                                              | Compile en mode watch (sans nodemon)          |
| `clean`                      | `rm -rf dist`                                              | Supprime le dossier de build                  |
| `obfuscate`                  | `node --stack-size=8192 scripts/obfuscate.js`              | Obfuscation du JavaScript compilé             |
| `verify:obfuscation`         | `node scripts/verify-obfuscation.js`                       | Vérifie que l'obfuscation est correcte        |
| `verify:obfuscation:verbose` | `node scripts/verify-obfuscation.js -v`                    | Vérification avec détails                     |
| `verify:obfuscation:full`    | `node scripts/verify-obfuscation.js -v -s`                 | Vérification complète avec statistiques       |
| `type-check`                 | `tsc --noEmit`                                             | Vérifie les types sans compiler               |
| `type-check:watch`           | `tsc --noEmit --watch`                                     | Vérification des types en mode watch          |
| `verify`                     | `npm run type-check`                                       | Alias pour type-check                         |
| `lint`                       | `eslint src/**/*.ts --fix`                                 | Lint avec correction automatique              |
| `lint:check`                 | `eslint src/**/*.ts`                                       | Lint sans correction (CI)                     |
| `format`                     | `prettier --write "src/**/*.ts"`                           | Formatte le code avec Prettier                |
| `format:check`               | `prettier --check "src/**/*.ts"`                           | Vérifie le formatage sans modifier            |
| `test`                       | `jest`                                                     | Lance tous les tests                          |
| `test:watch`                 | `jest --watch`                                             | Tests en mode watch interactif                |
| `test:coverage`              | `jest --coverage`                                          | Tests avec rapport de couverture              |
| `test:ci`                    | `jest --ci --coverage --reporters=...`                     | Tests en mode CI (JUnit output)               |
| `audit`                      | `npx ts-node scripts/audit-infrastructure.ts`              | Audit de l'infrastructure                     |
| `audit:tokens`               | `npx ts-node scripts/audit-token-refresh.ts`               | Audit du mécanisme refresh token              |
| `audit:stress`               | `npx ts-node scripts/audit-stress-test.ts`                 | Test de charge                                |
| `audit:verbose`              | `VERBOSE=true npx ts-node scripts/audit-infrastructure.ts` | Audit avec logs détaillés                     |
| `audit:all`                  | `npm run audit && audit:tokens && audit:stress`            | Lance tous les audits                         |
| `audit:deps`                 | `npm audit --production`                                   | Audit des vulnérabilités des dépendances      |
| `audit:deps:fix`             | `npm audit fix --production`                               | Corrige les vulnérabilités automatiquement    |
| `docker:build`               | Voir section Docker                                        | Build de l'image Docker (linux/amd64)         |
| `docker:build:no-cache`      | Voir section Docker                                        | Build sans cache Docker                       |
| `docker:push`                | Voir section Docker                                        | Push vers le registre privé                   |
| `docker:release`             | `npm run docker:build && npm run docker:push`              | Build + push en une commande                  |
| `docker:run`                 | Voir section Docker                                        | Démarre un conteneur local                    |
| `docker:stop`                | `docker stop qvarry-api && docker rm qvarry-api`           | Arrête et supprime le conteneur               |
| `docker:logs`                | `docker logs -f qvarry-api`                                | Suit les logs du conteneur                    |
| `health`                     | `curl -s http://localhost:${PORT:-3000}/health`            | Vérifie que le serveur répond                 |
| `precommit`                  | `npm run type-check && npm run lint:check`                 | Vérifications avant commit (hook)             |

---

## Commandes de développement quotidien

### Démarrer le serveur de développement

```bash
npm run dev
```

### Vérifier les types TypeScript sans compiler

```bash
npm run type-check
```

### Linter et corriger automatiquement

```bash
npm run lint
```

### Formater le code

```bash
npm run format
```

### Vérifier la santé du serveur local

```bash
npm run health
# ou directement :
curl http://localhost:3000/health
```

---

## Commandes de build et production

### Build standard (TypeScript → JavaScript)

```bash
npm run build
```

Le build compile `src/` vers `dist/` en utilisant `tsconfig.prod.json`. Le script `prebuild` et `postbuild` affichent des messages de progression.

### Build production avec obfuscation

```bash
npm run build:prod
```

Effectue le build puis obfusque le JavaScript généré dans `dist/`. L'obfuscation protège la propriété intellectuelle et complexifie l'analyse du code en cas de compromission.

### Vérifier l'obfuscation après build

```bash
npm run verify:obfuscation
# Avec détails :
npm run verify:obfuscation:verbose
# Complet avec statistiques :
npm run verify:obfuscation:full
```

### Nettoyer le dossier de build

```bash
npm run clean
```

---

## Commandes de test

### Lancer tous les tests

```bash
npm test
```

### Tests en mode watch (relance automatique)

```bash
npm run test:watch
```

Utile pendant le développement : les tests se relancent à chaque modification de fichier.

### Tests avec rapport de couverture

```bash
npm run test:coverage
```

Génère un rapport HTML dans `coverage/`. Ouvrir `coverage/lcov-report/index.html` dans un navigateur.

### Tests en mode CI

```bash
npm run test:ci
```

Mode non-interactif, génère un rapport JUnit compatible avec les pipelines CI/CD.

---

## Commandes d'audit

### Audit de l'infrastructure

```bash
npm run audit
# Avec logs verbeux :
npm run audit:verbose
```

Vérifie l'état des connexions, des services tiers, des variables d'environnement critiques.

### Audit du mécanisme de refresh token

```bash
npm run audit:tokens
```

Valide que la rotation des refresh tokens fonctionne correctement.

### Test de charge

```bash
npm run audit:stress
```

Simule une charge importante pour vérifier les performances et le rate limiting.

### Lancer tous les audits

```bash
npm run audit:all
```

### Audit des vulnérabilités npm

```bash
npm run audit:deps
# Avec correction automatique :
npm run audit:deps:fix
```

> ⚠️ `audit:deps:fix` peut mettre à jour des dépendances. Vérifier les changements et relancer les tests après correction.

---

## Commandes Docker

Voir [docker.md](./docker.md) pour la documentation complète.

```bash
# Build de l'image
npm run docker:build

# Push vers le registre
npm run docker:push

# Build + push (release complète)
npm run docker:release

# Démarrer un conteneur local
npm run docker:run

# Arrêter le conteneur
npm run docker:stop

# Suivre les logs
npm run docker:logs
```
