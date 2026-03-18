# Composant : `FicheViewMap`

## Localisation
`src/components/map/FicheViewMap.tsx`

---

## Interface / Props

```typescript
interface FichePoint {
    _id: string;
    name: string;
    location?: {
        coordinates?: [number, number]; // [lng, lat] — format GeoJSON
        lat?: number;                   // format alternatif
        lng?: number;                   // format alternatif
    } | null;
}

interface FicheViewMapProps {
    center?: [number, number];           // [lng, lat], optionnel
    points: FichePoint[];
    bounds?: [[number, number], [number, number]];  // optionnel
    mapType?: string;                    // 'satellite' ou autre
}
```

---

## États internes

| État | Type | Valeur initiale | Rôle |
|------|------|----------------|------|
| `mounted` | `boolean` | `false` | Guard SSR — affiche un placeholder jusqu'au mount côté client |
| `mapType` | `'plan' \| 'satellite'` | depuis `mapTypeProp` | Fond de carte actif |
| `mapInstance` | `L.Map \| null` | `null` | Instance Leaflet pour contrôle impératif du zoom |

---

## Effets (`useEffect`)

| Dépendances | Description |
|-------------|-------------|
| `[]` | `setMounted(true)` — levée du guard SSR |
| `[mapTypeProp]` | Synchronise `mapType` si le prop change après le montage |

---

## Sous-composant : `MapBounds`

Props : `{ center?, points, bounds? }`  
Utilise `useMap()`. Dans un `setTimeout(100ms)` :
1. Si `bounds` fourni : `map.fitBounds([[lat0,lng0],[lat1,lng1]], { padding: [50,50] })`
2. Sinon si points présents : construit `L.latLngBounds` sur tous les points + `center`, puis `fitBounds`
3. Sinon si `center` seul : `map.setView([center[1], center[0]], 13)`

---

## Helper `getPointCoordinates(point)`

Supporte deux formats de `location` :
1. **GeoJSON** : `{ coordinates: [lng, lat] }` → retourne `[lng, lat]`
2. **Alternatif** : `{ lat: number, lng: number }` → retourne `[lng, lat]`

Retourne `null` si les deux formats échouent ou si `location` est absent.

---

## Sources de tuiles

| Mode | URL | Attribution |
|------|-----|-------------|
| `'plan'` | `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png` | © OpenStreetMap |
| `'satellite'` | `https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}` | © Google |

---

## Comportements spéciaux

### Guard SSR (`mounted`)
Avant le montage côté client, retourne un placeholder gris `h-[400px]` avec "Chargement de la carte...". Cela évite les erreurs Leaflet (qui nécessite `window`) lors du rendu serveur.

### Carte en lecture seule
Tous les contrôles d'interaction désactivés : `dragging={false}`, `scrollWheelZoom={false}`, `touchZoom={false}`, `doubleClickZoom={false}`, `boxZoom={false}`, `keyboard={false}`. Seuls les boutons `+`/`-` personnalisés contrôlent le zoom via l'instance `mapInstance`.

### Centre initial calculé
Ordre de priorité :
1. Prop `center` si valide
2. Premier point du tableau `points` si présent (zoom 15 si point unique)
3. Centre des `bounds` si fourni
4. Fallback `[48.858, 2.347]` (Paris)

### Dimensions fixes
`w-full h-[400px]`, `rounded-lg overflow-hidden border border-gray-200`.

---

## Extrait de code clé

```typescript
// Double format coordonnées
function getPointCoordinates(point: FichePoint): [number, number] | null {
    // Format GeoJSON: { coordinates: [lng, lat] }
    if (point.location?.coordinates) {
        const [lng, lat] = point.location.coordinates;
        if (!isNaN(Number(lng)) && !isNaN(Number(lat))) return [Number(lng), Number(lat)];
    }
    // Format alternatif: { lat, lng }
    if (point.location?.lat !== undefined && point.location?.lng !== undefined) {
        return [Number(point.location.lng), Number(point.location.lat)];
    }
    return null;
}
```

---

## Utilisation typique

```tsx
<FicheViewMap
  center={[ficheData.lng, ficheData.lat]}
  points={ficheData.linkedPoints}
  mapType="plan"
/>
```
