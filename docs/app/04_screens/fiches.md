# Écrans — Fiches

## Vue d'ensemble

Le module Fiches permet aux utilisateurs de créer et gérer des fiches personnelles. Les fiches sont synchronisées avec le serveur via le système offline-first.

---

## `FichesScreen`

**Chemin** : `src/screens/fiches/FichesScreen.tsx`

Écran principal listant toutes les fiches de l'utilisateur.

### Fonctionnalités

- Liste des fiches avec le composant `FicheCard`
- Swipe-to-delete via `SwipeableRow`
- Accès rapide à la création d'une nouvelle fiche
- Navigation vers le détail d'une fiche
- Synchronisation avec indicateur de sync en cours
- Support offline : les fiches du cache local sont affichées si hors ligne

### Hook utilisé

```typescript
const { fiches, isLoading, createFiche, deleteFiche, refresh } = useFiches();
```

---

## `FicheDetailScreen`

**Chemin** : `src/screens/fiches/FicheDetailScreen.tsx`

Affichage détaillé d'une fiche.

### Fonctionnalités

- Affichage de tous les champs de la fiche
- Accès à la modification (`FicheFormScreen`)
- Suppression de la fiche avec confirmation
- Partage de la fiche avec d'autres utilisateurs

---

## `FicheFormScreen`

**Chemin** : `src/screens/fiches/FicheFormScreen.tsx`

Formulaire de création ou modification d'une fiche.

### Fonctionnalités

- Mode création (nouvelle fiche) et mode édition (fiche existante)
- Champs texte, notes, tags, points associés
- Sauvegarde optimiste : la fiche est ajoutée au cache local immédiatement, puis synchronisée avec le serveur
- Gestion des erreurs de validation

### Comportement offline

Si l'appareil est hors ligne au moment de la sauvegarde, la fiche est créée localement avec un ID temporaire (`local-xxxx`) et placée dans la queue de synchronisation. À la reconnexion, elle est synchronisée et l'ID temporaire est remplacé par l'ID serveur.

```typescript
// Comportement transparent pour l'utilisateur
// En ligne → createFiche() appelle directement l'API
// Hors ligne → createFicheOffline() stocke en cache + queue
```
