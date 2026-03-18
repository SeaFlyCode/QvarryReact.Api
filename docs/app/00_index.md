# Documentation technique — Qvarry Mobile

Qvarry est une application mobile **React Native / Expo** destinée aux explorateurs de milieux souterrains (carrières, mines, grottes, tunnels). Elle embarque une carte interactive Leaflet, une navigation souterraine par PDR, un mode SOS d'urgence multi-stades, une messagerie temps réel et un fonctionnement offline-first avec synchronisation différée.

> **Point d'entrée** : ce fichier recense l'ensemble de la documentation technique. Commencez ici, puis suivez les liens selon votre besoin.

---

## Sommaire

### 01 — Vue d'ensemble

| Fichier | Contenu |
|---|---|
| [overview.md](01_overview/overview.md) | Présentation générale de l'application, fonctionnalités clés et public cible |
| [tech-stack.md](01_overview/tech-stack.md) | Stack technique complète (Expo, React Native, Reanimated, Leaflet, etc.) |

---

### 02 — Prise en main

| Fichier | Contenu |
|---|---|
| [getting-started.md](02_getting-started/getting-started.md) | Prérequis, installation, configuration de l'environnement et premier lancement |

---

### 03 — Architecture

| Fichier | Contenu |
|---|---|
| [project-structure.md](03_architecture/project-structure.md) | Organisation des dossiers `src/`, conventions de nommage et responsabilités de chaque couche |
| [navigation.md](03_architecture/navigation.md) | Système de navigation React Navigation (stacks, tabs, guards d'authentification) |
| [contexts.md](03_architecture/contexts.md) | Contextes React globaux : Auth, Theme, SOS, et autres providers applicatifs |

---

### 04 — Écrans

| Fichier | Contenu |
|---|---|
| [auth.md](04_screens/auth.md) | Écrans d'authentification : Welcome, Login, Register |
| [fiches.md](04_screens/fiches.md) | Module fiches de cavités : catalogue géolocalisé, détail, création collaborative |
| [lists.md](04_screens/lists.md) | Module listes de points : création, gestion et partage de listes personnalisées |
| [map.md](04_screens/map.md) | Carte interactive (WebView Leaflet), 13 fonds de carte IGN/OSM, navigation souterraine PDR |
| [messages.md](04_screens/messages.md) | Messagerie temps réel : conversations privées, groupes, statuts de lecture |
| [profile.md](04_screens/profile.md) | Profil utilisateur, paramètres personnels et préférences de l'application |
| [sos.md](04_screens/sos.md) | Mode SOS d'urgence : escalade en 3 stades, heartbeat, géolocalisation, panel admin |

---

### 05 — Composants

| Fichier | Contenu |
|---|---|
| [components.md](05_components/components.md) | Catalogue de tous les composants réutilisables avec props, usage et exemples |

---

### 06 — Services

| Fichier | Contenu |
|---|---|
| [api.md](06_services/api.md) | Client API REST : configuration, intercepteurs, gestion des erreurs et endpoints |
| [websocket.md](06_services/websocket.md) | Services WebSocket temps réel : connexion, événements, reconnexion automatique |
| [sync.md](06_services/sync.md) | Synchronisation offline-first : file d'attente, résolution de conflits, stratégies de sync |
| [security.md](06_services/security.md) | Sécurité applicative : authentification biométrique, chiffrement local, gestion des tokens |
| [push.md](06_services/push.md) | Notifications push : intégration FCM et Notifee, gestion des permissions et payloads |

---

### 07 — Hooks

| Fichier | Contenu |
|---|---|
| [hooks.md](07_hooks/hooks.md) | Hooks personnalisés par domaine : données, système, carte, messagerie, administration |

---

### 08 — Sécurité

| Fichier | Contenu |
|---|---|
| [security.md](08_security/security.md) | Modèle de sécurité global : menaces identifiées, mesures de protection, flux d'authentification |

---

### 09 — Tests

| Fichier | Contenu |
|---|---|
| [testing.md](09_testing/testing.md) | Stratégie de tests : Jest, React Testing Library, couverture et bonnes pratiques |

---

### 10 — Constantes, Types & Utilitaires

| Fichier | Contenu |
|---|---|
| [constants.md](10_constants-types-utils/constants.md) | Constantes de l'application : couleurs, thème, configuration des fiches et de la carte |
| [types.md](10_constants-types-utils/types.md) | Interfaces TypeScript globales : messagerie, SOS, navigation, synchronisation |
| [utils.md](10_constants-types-utils/utils.md) | Fonctions utilitaires : validation, logger, système d'événements, helpers SOS |

---

## Convention de nommage

Les dossiers sont préfixés par un numéro à deux chiffres (`01_`, `02_`, …) pour imposer un ordre de lecture logique — du général vers le spécifique. Les fichiers `.md` à l'intérieur portent un nom explicite en minuscules avec des tirets.

---

## Statut

> ✅ **Documentation complète** — toutes les sections listées ci-dessus sont rédigées et à jour.
