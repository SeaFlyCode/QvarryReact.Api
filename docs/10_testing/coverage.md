# Couverture de code

## Configuration

La couverture de code est calculée par Jest lors de l'exécution avec le flag `--coverage`. La configuration est définie dans `jest.config.ts`.

---

## Seuils de couverture

Les seuils minimaux requis sont définis via `coverageThreshold` :

| Métrique     | Seuil minimum |
| ------------ | ------------- |
| `branches`   | 50%           |
| `functions`  | 50%           |
| `lines`      | 50%           |
| `statements` | 50%           |

Si l'un de ces seuils n'est pas atteint, la commande `npm run test:coverage` se termine avec un code d'erreur non nul, ce qui fait échouer le pipeline CI.

---

## Fichiers analysés

### Inclus

```
src/**/*.ts
```

### Exclus

```
src/**/*.d.ts          — Fichiers de déclaration TypeScript
src/**/*.test.ts       — Fichiers de test eux-mêmes
src/**/*.spec.ts       — Fichiers de spec
src/__tests__/**       — Répertoire de tests complet
src/server.ts          — Point d'entrée (bootstrap uniquement)
src/test-logger.ts     — Utilitaire de log de test
```

---

## Formats de rapport

| Format | Usage                                                       |
| ------ | ----------------------------------------------------------- |
| `text` | Affiché dans le terminal à la fin de l'exécution            |
| `lcov` | Génère `coverage/lcov.info` (compatible avec les outils CI) |
| `html` | Rapport HTML interactif dans `coverage/lcov-report/`        |
| `json` | Données brutes dans `coverage/coverage-final.json`          |

### Accéder au rapport HTML

```bash
npm run test:coverage
open coverage/lcov-report/index.html
```

Le rapport HTML permet d'explorer fichier par fichier les lignes couvertes (en vert) et non couvertes (en rouge), ainsi que les branches conditionnelles.

---

## Structure du répertoire coverage/

```
coverage/
├── lcov.info                   # Format LCOV pour outils externes
├── coverage-final.json         # Données JSON brutes
├── clover.xml                  # Format Clover (optionnel)
└── lcov-report/
    ├── index.html              # Page principale du rapport HTML
    ├── src/
    │   ├── controllers/
    │   │   └── *.html          # Couverture par controller
    │   ├── services/
    │   ├── utils/
    │   └── ...
    └── ...
```

---

## Commandes disponibles

| Commande                | Description                                        |
| ----------------------- | -------------------------------------------------- |
| `npm run test:coverage` | Lance les tests et génère le rapport de couverture |
| `npm run test:ci`       | Mode CI : génère couverture + rapport JUnit XML    |

### Différence entre `test:coverage` et `test:ci`

```
test:coverage
  └── jest --coverage
        └── Formats : text, lcov, html, json

test:ci
  └── jest --ci --coverage --reporters=default --reporters=jest-junit
        ├── Formats : text, lcov, html, json
        └── junit.xml (rapport XML pour systèmes CI/CD)
```

### Rapport JUnit XML

Le fichier `junit.xml` est généré à la racine du projet lors de `npm run test:ci`. Il est compatible avec les outils CI standards (Jenkins, GitLab CI, GitHub Actions) pour l'affichage des résultats de test.

---

## Lecture du rapport terminal

```
----------|---------|----------|---------|---------|-------------------
File      | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
----------|---------|----------|---------|---------|-------------------
All files |   72.45 |    58.32 |   68.91 |   71.88 |
 controllers/auth/   |         |          |         |         |
  loginController.ts |   88.23 |    75.00 |   90.00 |   87.50 | 45, 78
  ...                |   ...   |    ...   |   ...   |   ...   |
----------|---------|----------|---------|---------|-------------------
```

La colonne `Uncovered Line #s` indique les numéros de lignes non couvertes, permettant d'identifier rapidement où ajouter des tests.

---

## Intégration CI/CD

```
npm run test:ci
    │
    ├─► Exécution des 90+ tests
    │
    ├─► Si seuils non atteints → exit code 1 → pipeline échoue
    │
    ├─► coverage/
    │       ├── lcov.info         (pour outils de qualité de code)
    │       ├── coverage-final.json
    │       └── lcov-report/      (rapport HTML archivable)
    │
    └─► junit.xml                 (résultats de tests pour CI)
```

⚠️ Le répertoire `coverage/` ne doit pas être commité dans git. Il est régénéré à chaque exécution.
