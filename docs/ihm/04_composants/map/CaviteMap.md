# Composant : `CaviteMap`

## Localisation
`src/components/map/CaviteMap.tsx`

---

## Interface / Props

```typescript
interface CaviteMapProps {
    center: [number, number];   // [lat, lng]
    points?: Point[];
    onMapClick?: (lat: number, lng: number) => void;
    isSelecting?: boolean;
}

interface Point {
    _id?: string;
    id?: string;
    name?: string;
    location?: {
        type: "Point";
        coordinates: [number, number]; // [lng, lat]
    };
}
```

---

## États internes

| État | Type | Valeur initiale | Rôle |
|------|------|----------------|------|
| `mapLayerType` | `'standard' \| 'satellite'` | `'standard'` | Fond de carte actif (OSM ou Esri ArcGIS) |
| `currentZoom` | `number` | `isSelecting ? 6 : 13` | Niveau de zoom contrôlé manuellement |

---

## Sous-composants internes

### `MapController`
Props : `{ zoomLevel: number }`  
Appelle `map.setZoom(zoomLevel)` à chaque changement de `zoomLevel`. Permet de contrôler le zoom depuis le state React sans utiliser les contrôles Leaflet natifs.

### `MapClickHandler`
Props : `{ onMapClick?, isSelecting? }`  
Via `useMapEvents`, écoute les clics carte et appelle `onMapClick(lat, lng)` uniquement si `isSelecting === true`.

---

## Sources de tuiles

| Mode | URL | Attribution |
|------|-----|-------------|
| `standard` | `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png` | © OpenStreetMap contributors |
| `satellite` | `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` | © Esri (World Imagery) |

---

## Comportements spéciaux

### Guard coordonnées invalides
Si `center` est `null`, pas un tableau, ou contient des `NaN`, affiche un `<div>` rouge avec "Erreur: Coordonnées invalides" à la place de la carte.

### Mode sélection (`isSelecting`)
- Zoom initial réduit à 6 (vue nationale)
- `dragging` activé (pour naviguer)
- Curseur `crosshair` sur la carte
- Clic appelle `onMapClick(lat, lng)`

### Mode lecture seule (sans `isSelecting`)
- `dragging={false}`, `scrollWheelZoom={false}`, `touchZoom={false}`, `doubleClickZoom={false}`, `boxZoom={false}`, `keyboard={false}`
- Zoom uniquement via boutons `+`/`-` manuels

### Masquage du marqueur central en mode sélection
Si `isSelecting === true` et que `center` est `[46.603354, 1.888334]` (centre France par défaut), le marqueur central n'est pas affiché pour éviter une confusion visuelle.

### Dimensions fixes
`h-[300px]`, `w-full`, `rounded-lg overflow-hidden border border-gray-200`.

---

## Extrait de code clé

```typescript
// Masquage marqueur si centre par défaut en mode sélection
{!(isSelecting && center[0] === 46.603354 && center[1] === 1.888334) && (
    <Marker key="center-marker" position={center}>
        <Popup>Centre de la cavité</Popup>
    </Marker>
)}
```

---

## Utilisation typique

```tsx
// Dans un formulaire d'édition de fiche
<CaviteMap
  center={[ficheData.lat, ficheData.lng]}
  points={ficheData.linkedPoints}
  isSelecting={editMode}
  onMapClick={(lat, lng) => setFicheCoords({ lat, lng })}
/>
```
