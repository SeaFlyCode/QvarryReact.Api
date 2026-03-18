# Écrans — Listes

## Vue d'ensemble

Le module Listes permet d'organiser des points en collections structurées et de les partager avec d'autres utilisateurs.

---

## `ListsScreen`

**Chemin** : `src/screens/lists/ListsScreen.tsx`

Écran principal affichant toutes les listes de l'utilisateur.

### Fonctionnalités

- Liste des collections créées par l'utilisateur
- Swipe-to-delete
- Navigation vers le détail d'une liste
- Accès rapide à la création

---

## `ListDetailScreen`

**Chemin** : `src/screens/lists/ListDetailScreen.tsx`

Détail d'une liste et de ses points.

### Fonctionnalités

- Affichage de tous les points de la liste
- Réorganisation des points
- Ajout / suppression de points
- Navigation vers le détail d'un point

---

## `ListFormScreen`

**Chemin** : `src/screens/lists/ListFormScreen.tsx`

Formulaire de création ou modification d'une liste.

### Fonctionnalités

- Nom, description, icône de la liste
- Sélection des points à inclure
- Sauvegarde avec synchronisation offline-first

---

## `SharedListsScreen`

**Chemin** : `src/screens/lists/SharedListsScreen.tsx`

Listes partagées par d'autres utilisateurs avec l'utilisateur connecté.

### Fonctionnalités

- Affichage des listes reçues par partage
- Acceptation / refus d'une liste partagée
- Navigation vers le détail d'une liste partagée

---

## Hook utilisé

```typescript
const { lists, isLoading, createList, deleteList, refresh } = useLists();
```
