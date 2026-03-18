# Pages de l'Application — IHM Qvarry

## Vue d'ensemble des routes

| Route | Composant | Auth | Admin | Description |
|-------|-----------|------|-------|-------------|
| `/` | `page.tsx` | ✗ | ✗ | Authentification (login, register, 2FA…) |
| `/dashboard` | `dashboard/page.tsx` | ✓ | ✗ | Carte interactive principale |
| `/fiches` | `fiches/page.tsx` | ✓ | ✗ | Liste des fiches terrain |
| `/fiches/create` | `fiches/create/page.tsx` | ✓ | ✗ | Création d'une fiche |
| `/fiches/[id]` | `fiches/[id]/page.tsx` | ✓ | ✗ | Détail / édition d'une fiche |
| `/conversations` | `(messaging)/conversations/page.tsx` | ✓ | ✗ | Messagerie chiffrée |
| `/contacts` | `(messaging)/contacts/page.tsx` | ✓ | ✗ | Gestion des contacts |
| `/profil` | `profil/page.tsx` | ✓ | ✗ | Profil utilisateur |
| `/profil/security` | `profil/security/page.tsx` | ✓ | ✗ | Sécurité (2FA, sessions) |
| `/partage` | `partage/page.tsx` | ✓ | ✗ | Partages de données |
| `/import` | `import/page.tsx` | ✓ | ✗ | Import de points GPS |
| `/admin` | `admin/page.tsx` | ✓ | ✓ | Dashboard administration |
| `/admin/users` | `admin/users/page.tsx` | ✓ | ✓ | Gestion des utilisateurs |
| `/admin/audit` | `admin/audit/page.tsx` | ✓ | ✓ | Logs d'audit |
| `/admin/security` | `admin/security/page.tsx` | ✓ | ✓ | IPs bloquées, alertes |
| `/admin/sos` | `admin/sos/page.tsx` | ✓ | ✓ | Supervision SOS |
| `/maintenance` | `maintenance/page.tsx` | ✗ | ✗ | Page de maintenance |
| `/privacy` | `privacy/page.tsx` | ✗ | ✗ | Politique de confidentialité |

---

## Page d'Authentification (`/`)

**Fichier** : `src/app/page.tsx`

Page principale d'entrée de l'application. Elle est multi-mode : un seul composant gère 5 formulaires différents via l'état `viewMode`.

### Modes d'affichage

| Mode | Description |
|------|-------------|
| `login` | Connexion (email + mot de passe + Turnstile CAPTCHA) |
| `register` | Inscription (nom, prénom, email, mot de passe) |
| `forgot` | Demande de réinitialisation du mot de passe |
| `reset` | Saisie du code + nouveau mot de passe |
| `verify` | Saisie du code de vérification email |

### Comportement spécial mobile
Sur mobile (`isMobile === true`), la page force le mode `register` : un utilisateur mobile ne peut pas se connecter depuis le web (il doit utiliser l'application mobile).

### Gestion de la 2FA
Lors d'une connexion nécessitant une 2FA, le serveur retourne un `tempToken`. La page affiche alors `TwoFactorVerifyModal` pour saisir le code TOTP, puis finalise la connexion.

### URL params
- `?verify=<email>` → Force le mode `verify` avec l'email pré-rempli
- `?reset=<email>` → Force le mode `reset` avec l'email pré-rempli
- `?admin=true` → Désactive la vérification de maintenance (accès admin)

### Layout
- **Gauche (40%)** : Formulaire + logo
- **Droite (60%)** : Image de fond + description + `AuthTips` défilants
- Sur mobile : plein écran (uniquement formulaire)

---

## Dashboard / Carte (`/dashboard`)

**Fichier** : `src/app/dashboard/page.tsx`

Page centrale de l'application. Affiche une carte interactive Leaflet avec :
- Points d'intérêt géologiques
- Clustering de marqueurs
- Sélection de calques (OSM, IGN, BRGM, OpenTopoMap…)
- Outils : création de point, filtres, recherche
- Panneau de points (liste filtrée)
- Légende des calques

### Composants clés
- `Map.tsx` — Rendu Leaflet (chargé dynamiquement côté client uniquement)
- `MapToolbar.tsx` — Barre d'outils (zoom, géolocalisation…)
- `LayersPanel.tsx` — Sélection des calques cartographiques
- `LegendPanel.tsx` — Légende des symboles
- `PointsPanel.tsx` — Panneau latéral des points
- `PointCreatePopover.tsx` — Popover de création d'un point sur la carte

---

## Fiches Terrain (`/fiches`)

**Fichiers** : `src/app/fiches/`

Module de gestion des fiches géologiques. Une fiche peut contenir :
- Nom, description, localisation
- Points associés
- Données structurées (notes étoiles, niveaux, tags, couleurs, emojis)
- Listes de points

### Pages
- `/fiches` — Liste paginée des fiches avec filtres
- `/fiches/create` — Formulaire de création (multi-étapes)
- `/fiches/[id]` — Visualisation et édition d'une fiche existante

### Composants de formulaire spéciaux
Les fiches utilisent des composants d'input personnalisés (`src/components/fiches/`) :

| Composant | Usage |
|-----------|-------|
| `StarRating` / `ReadOnlyStarRating` | Notation 1-5 étoiles |
| `LevelSlider` / `ReadOnlyLevelSlider` | Niveau de difficulté (curseur) |
| `ChipCheckbox` / `ReadOnlyChipCheckbox` | Tags/labels multi-sélection |
| `ColorRadio` / `ReadOnlyColorRadio` | Sélecteur de couleur |
| `EmojiRadio` / `ReadOnlyEmojiRadio` | Sélecteur d'emoji |

Chaque composant dispose d'une variante lecture seule (préfixe `ReadOnly`) pour l'affichage dans les modales de visualisation.

---

## Messagerie (`/conversations`)

**Fichiers** : `src/app/(messaging)/conversations/`

Messagerie chiffrée en temps réel.

### Fonctionnalités
- Liste des conversations (1-to-1 et groupes)
- Envoi/réception de messages via WebSocket
- Chiffrement des messages côté client
- Création de nouvelles conversations
- Gestion des groupes (paramètres, membres)

### Architecture
Le groupe de routes `(messaging)` partage un layout commun (layout de messagerie deux-colonnes).

### WebSocket
La connexion WebSocket est gérée dans `src/api/websocket.ts` et maintenue par le `SyncProvider`.

---

## Contacts (`/contacts`)

**Fichier** : `src/app/(messaging)/contacts/`

- Liste des contacts existants
- Envoi de demandes de contact
- Acceptation/refus des demandes reçues
- Recherche d'utilisateurs

---

## Profil (`/profil`)

**Fichiers** : `src/app/profil/`

### `/profil`
- Modification du nom, prénom, avatar
- Changement de mot de passe
- Paramètres de notification

### `/profil/security`
- Configuration de l'authentification à deux facteurs (TOTP via QR Code)
- Liste des sessions actives (révocation possible)
- Historique des alertes de sécurité
- Suppression du compte

---

## Partages (`/partage`)

**Fichier** : `src/app/partage/`

- Liste des partages reçus (fiches/données partagées par d'autres utilisateurs)
- Liste des partages envoyés
- Acceptation/refus des partages entrants
- Accès aux données partagées

---

## Import (`/import`)

**Fichier** : `src/app/import/`

- Import de points GPS depuis des fichiers (formats supportés : GPX, CSV, KML…)
- Prévisualisation sur carte avant import (`ImportPreviewModal`)
- Mapping des colonnes/champs
- Validation et import en base

---

## Administration (`/admin`)

**Fichiers** : `src/app/admin/`

Accessible uniquement aux administrateurs (vérification du rôle `isAdmin` dans le JWT côté middleware Edge).

### `/admin`
Dashboard récapitulatif : utilisateurs, activité, métriques.

### `/admin/users`
- Liste de tous les utilisateurs
- Validation/refus des nouveaux comptes (le back-end requiert une validation admin)
- Modification des rôles
- Suspension/suppression de comptes

### `/admin/audit`
- Visualisation des logs d'audit
- Filtres par utilisateur, action, date

### `/admin/security`
- Liste des IPs bloquées
- Débloquage manuel d'IPs
- Alertes de sécurité récentes

### `/admin/sos`
- Supervision des événements SOS actifs
- Historique des alertes SOS déclenchées
- État des sessions SOS

---

## Maintenance (`/maintenance`)

**Fichier** : `src/app/maintenance/`

Page affichée quand le mode maintenance est actif. Elle informe l'utilisateur de la maintenance en cours. Accessible sans authentification. Les administrateurs peuvent contourner via `?admin=true` sur la page `/`.

---

## Politique de confidentialité (`/privacy`)

**Fichier** : `src/app/privacy/`

Page statique présentant la politique de confidentialité de Qvarry (RGPD).
