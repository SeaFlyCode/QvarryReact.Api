# Composants — IHM Qvarry

## Vue d'ensemble

Les composants React sont organisés dans `src/components/` par domaine fonctionnel. Chaque dossier expose un `index.ts` (barrel export) pour faciliter les imports.

---

## Hiérarchie des Providers

L'ordre d'imbrication dans `ClientProviders.tsx` est important :

```
NonceProvider
└── MobileProvider
    └── MobileBlocker
        └── NotificationProvider
            └── ConfirmModalProvider
                └── AuthGuard
                    └── SyncProvider
                        ├── Navbar
                        └── <children> (pages)
```

---

## Composants de Layout

### `Navbar.tsx`
**Fichier** : `src/components/layout/Navbar.tsx`

Barre de navigation principale affichée sur toutes les pages (sauf `/`, `/privacy`, `/maintenance`).

**Contenu** :
- Logo Qvarry (lien vers `/dashboard`)
- Items de navigation principaux : Tableau de bord, Fiches, Messages
- Cloche de notifications (`NotificationBell`)
- Menu déroulant utilisateur : Profil, Partages, Import, Déconnexion

**Visibilité** : Cachée sur la page d'authentification, maintenance et privacy.

---

### `MobileBlocker.tsx`
**Fichier** : `src/components/layout/MobileBlocker.tsx`

Composant qui bloque l'affichage sur mobile, avec un message invitant à utiliser l'application mobile.

**Exceptions** : Le chemin `/` (page d'authentification) est autorisé sur mobile pour l'inscription.

**Props** :
```typescript
interface MobileBlockerProps {
  children: ReactNode;
  allowedPaths?: string[]; // Chemins autorisés sur mobile
}
```

---

## Composants d'Authentification

### `AuthGuard.tsx`
**Fichier** : `src/components/auth/AuthGuard.tsx`

Vérifie l'authentification côté client (en complément du middleware Edge). Si la session expire pendant la navigation, redirige vers `/`.

### `LoginForm.tsx`
Formulaire de connexion avec email, mot de passe et widget Turnstile CAPTCHA.

### `RegisterForm.tsx`
Formulaire d'inscription multi-champs avec validation côté client.

### `ForgotPasswordForm.tsx`
Formulaire de demande de reset : saisie d'email, envoi du code par l'API.

### `ResetPasswordForm.tsx`
Formulaire avec le code reçu par email + nouveau mot de passe (avec confirmation).

### `VerifyEmailForm.tsx`
Saisie du code de vérification email (envoyé après inscription).

### `TwoFactorVerifyModal.tsx`
Modal de saisie du code TOTP (6 chiffres) lors d'une connexion avec 2FA activée.

### `TwoFactorSection.tsx`
Section dans `/profil/security` pour activer/désactiver la 2FA, avec affichage du QR code.

### `Turnstile.tsx`
Widget Cloudflare Turnstile (CAPTCHA). Chargé dynamiquement côté client.

---

## Composants Cartographiques

Tous les composants de carte sont **Client Components** et chargés dynamiquement (`next/dynamic`) pour éviter les erreurs SSR avec Leaflet.

### `Map.tsx`
Composant carte principal basé sur `react-leaflet`. Gère :
- Initialisation de la carte (centre, zoom)
- Calques de fond
- Marqueurs des points
- Événements (clic, déplacement)

### `CaviteMap.tsx`
Carte spécialisée pour les cavités souterraines. Inclut des calques géologiques spécifiques.

### `MapComparison.tsx`
Vue comparaison côte-à-côte de deux calques cartographiques.

### `FicheViewMap.tsx`
Mini-carte non interactive affichée dans les fiches (localisation d'une fiche).

### `MiniMapRayon.tsx`
Mini-carte avec cercle de rayon pour les recherches géographiques.

### `MapPopup.tsx`
Popup Leaflet affiché au clic sur un marqueur (nom, description, actions).

### `MarkerCluster.tsx`
Wrapper `leaflet.markercluster` pour le regroupement automatique de marqueurs proches.

### `LayerPreview.tsx`
Aperçu miniature d'un calque cartographique dans le panneau de sélection.

### `AdaptiveGeologyLayer.tsx`
Calque géologique (BRGM WMS) qui s'adapte selon le niveau de zoom.

### `WMSTileLayer.tsx`
Composant pour les calques WMS (Web Map Service) personnalisés.

### `PointCreatePopover.tsx`
Popover (Radix UI) affiché lors d'un clic sur la carte pour créer un nouveau point.

---

## Composants Dashboard

### `LayersPanel.tsx`
Panneau latéral de sélection des calques. Toggle actif/inactif pour chaque calque disponible (OSM, IGN Topo, IGN Photo, OpenTopoMap, BRGM, etc.).

### `LegendPanel.tsx`
Légende des symboles/couleurs utilisés sur la carte.

### `MapToolbar.tsx`
Barre d'outils flottante : zoom, géolocalisation, plein écran, partage de position.

### `PointsPanel.tsx`
Panneau latéral avec la liste des points filtrés. Permet de cliquer sur un point pour le centrer sur la carte.

---

## Composants de Fiches

Composants d'inputs spécialisés pour les formulaires de fiches géologiques. Chaque type a une version éditable et une version lecture seule.

### `StarRating.tsx` / `ReadOnlyStarRating.tsx`
Sélecteur de note 1 à 5 étoiles (ex: difficulté d'accès). Cliquable en mode édition.

### `LevelSlider.tsx` / `ReadOnlyLevelSlider.tsx`
Curseur de niveau (ex: profondeur estimée, difficulté technique).

### `ChipCheckbox.tsx` / `ReadOnlyChipCheckbox.tsx`
Sélection multiple sous forme de chips (ex: types de roches, équipements nécessaires).

### `ColorRadio.tsx` / `ReadOnlyColorRadio.tsx`
Sélecteur de couleur pour catégoriser visuellement les fiches.

### `EmojiRadio.tsx` / `ReadOnlyEmojiRadio.tsx`
Sélecteur d'emoji pour représenter rapidement le type de cavité.

---

## Composants de Messagerie

### `ConversationsList.tsx`
Liste des conversations avec aperçu du dernier message et indicateur de messages non lus.

### `MessagesPanel.tsx`
Affichage des messages d'une conversation. Scroll automatique vers le bas.

### `MessageInput.tsx`
Zone de saisie de message avec envoi via `Entrée` ou bouton.

### `NewConversationModal.tsx`
Modal pour créer une nouvelle conversation : recherche d'utilisateurs, sélection.

### `GroupSettingsModal.tsx`
Paramètres d'une conversation de groupe : nom, membres, quitter/supprimer.

---

## Composants Modales

### `ConfirmModal.tsx` + `ConfirmModalProvider.tsx`
Système de modal de confirmation générique accessible via un hook :

```typescript
const { confirm } = useConfirm();

const result = await confirm({
  title: "Supprimer ce point ?",
  message: "Cette action est irréversible.",
  confirmLabel: "Supprimer",
  cancelLabel: "Annuler",
});

if (result) {
  // ... effectuer la suppression
}
```

### `NotificationProvider.tsx` + `NotificationModal.tsx`
Système de notifications toast accessible via un hook :

```typescript
const { showNotification } = useNotification();

showNotification({
  title: "Succès",
  message: "Le point a été créé.",
  type: "success",        // "success" | "error" | "warning" | "info"
  autoClose: true,
  duration: 3000,
});
```

### `CreatePointModal.tsx`
Modal de création d'un point géologique (nom, coordonnées GPS, description, type).

### `PointEditModal.tsx`
Modal d'édition des propriétés d'un point existant.

### `PointDetailsContent.tsx`
Contenu de détail d'un point (affiché dans la popup carte ou une modale dédiée).

### `FicheViewModal.tsx`
Visualisation complète d'une fiche en mode lecture seule.

### `AddPointsToFicheModal.tsx`
Sélection de points existants à ajouter à une fiche.

### `AddPointsToListModal.tsx`
Sélection de points à ajouter à une liste.

### `ListEditModal.tsx`
Création et édition d'une liste de points.

### `PointListsEditor.tsx`
Éditeur inline des listes auxquelles appartient un point.

### `ShareModal.tsx`
Modal pour partager une fiche ou des données avec un autre utilisateur.

### `ExportPDFModal.tsx`
Options et prévisualisation avant export PDF d'une fiche (via jsPDF).

### `ImportPreviewModal.tsx`
Prévisualisation des données importées (depuis un fichier GPS) avant confirmation.

---

## Composants UI de Base

Situés dans `src/components/ui/`, ces composants sont génériques et réutilisables dans toute l'application.

### `Button.tsx`
Bouton avec variants (primary, secondary, danger, ghost) et états (loading, disabled).

### `Modal.tsx`
Composant modal de base : overlay, fermeture au clic en dehors, accessibilité (focus trap).

### `LoadingScreen.tsx`
Écran de chargement initial affiché lors du premier chargement de l'application.

### `LoginLoadingScreen.tsx`
Animation de connexion affichée après une authentification réussie.

### `PageLoader.tsx`
Indicateur de chargement lors de la navigation entre pages.

### `InlineSpinner.tsx`
Petit spinner animé pour les états de chargement inline (dans les boutons, listes…).

### `PasswordInput.tsx`
Input de type password avec bouton toggle pour afficher/masquer le mot de passe.

### `Tooltip.tsx`
Infobulle (tooltip) affichée au survol d'un élément.

### `GdprConsentBanner.tsx`
Bannière de consentement RGPD affichée à la première visite.

---

## Providers

### `SyncProvider.tsx`
**Fichier** : `src/components/providers/SyncProvider.tsx`

Gère la synchronisation périodique des données (points, notifications, conversations). Maintient la connexion WebSocket active et rafraîchit les données en arrière-plan.

---

## Cloche de Notifications

### `NotificationBell.tsx`
**Fichier** : `src/components/notifications/NotificationBell.tsx`

Icône de cloche dans la Navbar avec badge de compteur. Au clic, affiche un dropdown listant les notifications récentes non lues.
