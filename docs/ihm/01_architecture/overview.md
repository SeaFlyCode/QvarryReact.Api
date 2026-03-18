# Vue d'ensemble — IHM Qvarry

## Description générale

L'IHM Qvarry est le frontend web de l'application Qvarry, développée en **Next.js 15 / React 19 / TypeScript**. C'est une application de cartographie géologique permettant d'explorer, documenter et partager des données géologiques (cavités souterraines, points d'intérêt, fiches terrain).

**Version** : 1.0.7  
**Port par défaut** : 3001  
**URL de production** : https://qvarry.fr  
**Framework** : Next.js 15 (App Router)  

---

## Architecture générale

```
┌──────────────────────────────────────────────────────────────────┐
│                        NAVIGATEUR WEB                            │
│                                                                  │
│   ┌────────────────────────────────────────────────────────────┐ │
│   │               Next.js App Router (SSR/CSR)                 │ │
│   │                                                            │ │
│   │  src/middleware.ts                                         │ │
│   │  └─ Auth Guard (JWT cookie) + CSP (nonce)                  │ │
│   │                                                            │ │
│   │  src/app/                                                  │ │
│   │  ├── layout.tsx          (Server Component)                │ │
│   │  │   └── ClientProviders (Client Component)                │ │
│   │  │       ├── NonceProvider                                 │ │
│   │  │       ├── MobileProvider                                │ │
│   │  │       ├── MobileBlocker                                 │ │
│   │  │       ├── NotificationProvider                          │ │
│   │  │       ├── ConfirmModalProvider                          │ │
│   │  │       ├── AuthGuard                                     │ │
│   │  │       ├── SyncProvider                                  │ │
│   │  │       └── Navbar                                        │ │
│   │  │                                                         │ │
│   │  ├── page.tsx            (Authentification)                │ │
│   │  ├── dashboard/          (Carte interactive)               │ │
│   │  ├── fiches/             (Fiches terrain)                  │ │
│   │  ├── (messaging)/        (Messagerie)                      │ │
│   │  │   ├── contacts/                                         │ │
│   │  │   └── conversations/                                    │ │
│   │  ├── profil/             (Profil utilisateur)              │ │
│   │  ├── partage/            (Partages de données)             │ │
│   │  ├── import/             (Import de points)                │ │
│   │  ├── admin/              (Administration)                  │ │
│   │  └── maintenance/        (Page de maintenance)             │ │
│   └────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
                              │  HTTPS + Cookie JWT HTTP-only
                              ▼
               ┌──────────────────────────┐
               │      QVARRY API          │
               │  Node.js / Express v5    │
               │  Port 3000 (back-end)    │
               └──────────────────────────┘
```

---

## Domaines fonctionnels couverts

| Domaine | Route | Description |
|---------|-------|-------------|
| **Authentification** | `/` | Connexion, inscription, reset mot de passe, 2FA, vérification email |
| **Dashboard / Carte** | `/dashboard` | Carte interactive Leaflet, calques géologiques, points d'intérêt |
| **Fiches terrain** | `/fiches` | Liste, création, édition, visualisation de fiches géologiques |
| **Messagerie** | `/conversations` | Conversations chiffrées, messages temps réel (WebSocket) |
| **Contacts** | `/contacts` | Gestion des contacts, demandes d'ajout |
| **Profil** | `/profil` | Édition du profil, sécurité (2FA, sessions, alertes) |
| **Partages** | `/partage` | Partages reçus/envoyés de fiches et données |
| **Import** | `/import` | Import de points GPS depuis fichiers |
| **Administration** | `/admin` | Gestion utilisateurs, logs d'audit, supervision SOS |
| **Maintenance** | `/maintenance` | Page d'information mode maintenance |

---

## Flux de navigation type

```
1. Requête HTTP entrante
         │
         ▼
2. src/middleware.ts
   ├─ Génère un nonce CSP unique
   ├─ Ajoute les headers CSP (Content-Security-Policy)
   ├─ Vérifie le cookie JWT pour les routes protégées
   └─ Redirige vers "/" si non authentifié
         │
         ▼
3. Server Component : layout.tsx
   └─ Lit le nonce via next/headers
   └─ Monte les polices Ubuntu + Outfit (next/font)
   └─ Définit les métadonnées SEO (Open Graph, Twitter Cards)
         │
         ▼
4. Client Component : ClientProviders.tsx
   └─ Initialise tous les providers React
   └─ Gère la détection mobile (MobileProvider)
   └─ Bloque l'accès desktop sur mobile (MobileBlocker)
   └─ Met à jour le titre de page dynamiquement
         │
         ▼
5. AuthGuard.tsx
   └─ Vérifie l'authentification côté client
   └─ Redirige si session expirée
         │
         ▼
6. Page / Composants métier
         │
         ▼
7. src/api/*.ts
   └─ Appels HTTPS vers QVARRY API (/api/v1/*)
   └─ Cookie JWT HTTP-only envoyé automatiquement
```

---

## Rendu : Server Components vs Client Components

| Composant | Type | Raison |
|-----------|------|--------|
| `layout.tsx` | Server Component | Lecture nonce CSP, export `metadata`, polices |
| `ClientProviders.tsx` | Client Component | Providers React, titre dynamique, pathname |
| Pages (`page.tsx`) | Client Component | Interactions utilisateur, appels API, état local |
| `Navbar.tsx` | Client Component | Navigation active, logout, interactions |
| Composants de carte | Client Component | Leaflet ne supporte pas le SSR |
| `AuthGuard.tsx` | Client Component | Vérification session, redirections |

---

## Particularités techniques

### Application géologique
L'application est dédiée à la **cartographie des cavités souterraines**. Elle utilise Leaflet avec `react-leaflet` pour afficher des cartes interactives avec plusieurs couches (OpenStreetMap, IGN, OpenTopoMap, BRGM).

### Mobile vs Web
L'IHM est **exclusivement desktop** pour la partie web. Sur mobile, `MobileBlocker` affiche un message invitant à utiliser l'application mobile native. Seule la page d'inscription (`/`) est accessible sur mobile (pour créer un compte).

### Sécurité CSP avec nonces
Implémentation QVARRY-SEC-005 : le middleware génère un nonce unique par requête, propagé au layout Server Component via les headers internes. Les scripts inline sont autorisés uniquement via ce nonce (protection XSS).

### Authentification par cookie
Les tokens JWT sont stockés dans des **cookies HTTP-only** (préfixe `__Host-` en production), impossibles à lire en JavaScript — protection contre le vol de token XSS.
