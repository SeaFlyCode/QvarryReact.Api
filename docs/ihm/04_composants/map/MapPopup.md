# Composant : `MapPopup`

## Localisation
`src/components/map/MapPopup.tsx`

---

## Interface / Props

```typescript
interface MapPopupProps {
    point: Point | null;
    onClose: () => void;
    onMapRefresh?: () => void;
}
```

---

## États internes

| État | Type | Valeur initiale | Rôle |
|------|------|----------------|------|
| `city` | `string \| null` | `null` | Nom de la commune obtenu par reverse geocoding |
| `isModalOpen` | `boolean` | `false` | Contrôle `PointEditModal` |
| `isShareModalOpen` | `boolean` | `false` | Contrôle `ShareModal` |
| `isDeleting` | `boolean` | `false` | Désactive le bouton supprimer pendant la requête |

---

## Effets (`useEffect`)

| Dépendances | Description |
|-------------|-------------|
| `[point, isModalOpen]` | Log de debug |
| `[point]` | Reset `city` à `null`, puis appelle `fetchCityByCoords` avec `AbortController`. Annule la requête si `point` change avant réponse. |

---

## Appels API

| API | Moment | Description |
|-----|--------|-------------|
| `fetchCityByCoords(lat, lon, signal)` | À chaque changement de `point` | Reverse geocoding ; résultat stocké dans `city` |
| `deletePoint(point._id)` | `handleDelete` | Supprime le point après confirmation |
| `updatePoint(point._id, updateData)` | Callback `onSave` de `PointEditModal` | Met à jour le point |
| `invalidatePointsCache()` | Post-delete/update | Import dynamique |
| `invalidateListsCache()` | Post-delete/update | Import dynamique |

---

## Fonctions internes

### `handleDelete()`
1. Appelle `showConfirm` (confirmation danger)
2. Si confirmé : `setIsDeleting(true)`, `deletePoint(point._id)`
3. En succès : notification success, `onClose()`, invalidation caches, `onMapRefresh?.()` ou `setTimeout(() => window.location.reload(), 500)`
4. En erreur : notification error

### `formatFull(v?: string)`
Formate une date ISO en `"15 janvier 2024 à 14:30"` (locale `fr-FR`). Retourne `null` si invalide.

---

## Comportements spéciaux

### Positionnement
Overlay `absolute top-[75px] left-[16px]`, z-index `10000`, largeur `min(40rem, 90vw)`. Toujours dans le coin supérieur gauche de la carte, au-dessus de tous les éléments Leaflet.

### Copie des coordonnées
Un clic sur les coordonnées `lat, lng` (format `"48.858600, 2.347200"`) appelle `navigator.clipboard.writeText` et affiche une notification de succès.

### Rendu conditionnel
Si `point === null`, le composant retourne `null` (pas de rendu).

### CRUD complet
- **Édition** : ouvre `<PointEditModal key={point._id} ...>` avec un callback `onSave` qui appelle `updatePoint`
- **Suppression** : via `showConfirm` (modal de confirmation) puis `deletePoint`
- **Partage** : ouvre `<ShareModal dataType="point" dataId={point._id} ...>`

---

## Extrait de code clé

```typescript
// Reverse geocoding avec annulation AbortController
useEffect(() => {
    setCity(null);
    if (!point) return;
    const [lon, lat] = [coords[0], coords[1]];
    const controller = new AbortController();
    fetchCityByCoords(lat, lon, controller.signal).then((name) => {
        if (name) setCity(name);
    });
    return () => controller.abort();
}, [point]);
```

---

## Utilisation typique

```tsx
<MapPopup
  point={selectedPoint}
  onClose={() => setSelectedPoint(null)}
  onMapRefresh={loadData}
/>
```
