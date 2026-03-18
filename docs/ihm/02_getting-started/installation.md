# Installation et Démarrage — IHM Qvarry

## Prérequis

| Outil | Version minimale | Vérification |
|-------|-----------------|--------------|
| Node.js | ≥ 20 | `node --version` |
| npm | ≥ 10 | `npm --version` |
| Git | Dernière stable | `git --version` |

---

## Installation

### 1. Cloner le dépôt

```bash
git clone <url-du-repo>
cd QvarryReact
```

### 2. Installer les dépendances

```bash
npm install
```

### 3. Configurer les variables d'environnement

```bash
cp .env.example .env
```

Éditer `.env` avec les valeurs appropriées. Voir [environment-variables.md](./environment-variables.md) pour la liste complète.

---

## Démarrage en développement

```bash
npm run dev
```

→ Démarre Next.js avec Turbopack sur le port **3001** : http://localhost:3001

> **Note** : Turbopack est le bundler expérimental de Next.js, plus rapide que Webpack en développement. Il est activé via `--turbopack`.

---

## Build de production

```bash
# Build standard
npm run build

# Build avec variable d'environnement development
npm run build:dev

# Build avec variable d'environnement production
npm run build:prod
```

Le build génère le dossier `.next/`.

---

## Démarrage en production

```bash
npm run start
```

→ Démarre Next.js en mode production sur le port **3001** (0.0.0.0 pour Docker).

---

## Vérification du build

```bash
# Type checking TypeScript
npm run type-check

# Linting ESLint
npm run lint:check

# Les deux ensemble
npm run verify
```

---

## Formatage du code

```bash
# Formater (écriture)
npm run format

# Vérifier le formatage
npm run format:check
```

---

## Commandes utiles

| Commande | Description |
|----------|-------------|
| `npm run dev` | Démarrage dev (port 3001, Turbopack) |
| `npm run build` | Build production |
| `npm run start` | Démarrage production |
| `npm run lint` | Linting Next.js |
| `npm run type-check` | Vérification TypeScript |
| `npm run verify` | Type-check + lint |
| `npm run format` | Formatage Prettier |
| `npm run test` | Exécution des tests Vitest |
| `npm run test:watch` | Tests en mode watch |
| `npm run test:coverage` | Tests avec couverture |
| `npm run test:ui` | Interface UI Vitest |
| `npm run clean` | Nettoyage `.next` et `out` |
| `npm run analyze` | Analyse du bundle |
| `npm run health` | Vérification de santé locale |
