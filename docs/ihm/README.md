# Documentation IHM — Qvarry

Documentation technique de l'IHM (Interface Homme-Machine) de l'application **Qvarry**, développée en Next.js 15 / React 19 / TypeScript.

**Version** : 1.0.7  
**URL de production** : https://qvarry.fr  
**Port** : 3001

---

## Structure de la documentation

```
docs/ihm/
├── 01_architecture/
│   ├── overview.md              ← Vue d'ensemble, architecture, flux de navigation
│   ├── tech-stack.md            ← Stack technique (Next.js, React, Leaflet, Tailwind…)
│   └── project-structure.md    ← Arborescence complète du projet
│
├── 02_getting-started/
│   ├── installation.md          ← Prérequis, installation, démarrage
│   ├── environment-variables.md ← Variables d'environnement
│   └── docker.md                ← Build et déploiement Docker
│
├── 03_pages/
│   └── overview.md              ← Toutes les pages (routes, comportement, layout)
│
├── 04_composants/
│   └── overview.md              ← Composants React (layout, auth, carte, fiches, modales, UI)
│
├── 05_api-client/
│   └── overview.md              ← Client HTTP, modules API, WebSocket
│
├── 06_securite/
│   └── overview.md              ← Middleware CSP, cookies JWT, Turnstile, 2FA, RGPD
│
├── 07_tests/
│   └── overview.md              ← Vitest, Testing Library, MSW, couverture
│
└── 08_deploiement/
    └── overview.md              ← Docker, variables production, monitoring, Sentry
```

---

## Démarrage rapide

```bash
# Installer les dépendances
npm install

# Copier la configuration
cp .env.example .env

# Démarrer en développement (port 3001)
npm run dev
```

---

## Liens rapides

| Sujet | Documentation |
|-------|---------------|
| Architecture générale | [01_architecture/overview.md](./01_architecture/overview.md) |
| Stack technique | [01_architecture/tech-stack.md](./01_architecture/tech-stack.md) |
| Structure du projet | [01_architecture/project-structure.md](./01_architecture/project-structure.md) |
| Installation | [02_getting-started/installation.md](./02_getting-started/installation.md) |
| Variables d'environnement | [02_getting-started/environment-variables.md](./02_getting-started/environment-variables.md) |
| Docker | [02_getting-started/docker.md](./02_getting-started/docker.md) |
| Pages et routes | [03_pages/overview.md](./03_pages/overview.md) |
| Composants React | [04_composants/overview.md](./04_composants/overview.md) |
| Client API | [05_api-client/overview.md](./05_api-client/overview.md) |
| Sécurité | [06_securite/overview.md](./06_securite/overview.md) |
| Tests | [07_tests/overview.md](./07_tests/overview.md) |
| Déploiement | [08_deploiement/overview.md](./08_deploiement/overview.md) |

---

## Documentation API back-end

La documentation de l'API back-end (Node.js/Express) est disponible dans :
→ [`docs/api/`](../api/)
