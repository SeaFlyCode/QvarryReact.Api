# Composant : `Map`

## Localisation
`src/components/map/Map.tsx`

---

## Interface / Props

```typescript
export type MapHandle = {
    zoomIn: () => void;
    zoomOut: () => void;
    goToUserLocation: (position: { lat: number; lng: number }) => void;
    getCenter: () => [number, number];
    getZoom: () => number;
    goTo: (coords: [number, number], zoom?: number) => void;
    setSelectedPoint: (p: Point | null) => void;
    closePopup: () => void;
    setAddPointMode: (enabled: boolean) => void;
};

type MapProps = {
    selectedLayer: string;
    onMapMove?: () => void;
    points?: Array<Point>;
    lists?: Array<{
        _id: string;
        name: string;
        points?: string[] | Array<{_id: string}>;
        pointIds?: string[];
        color?: string;
        icon?: string;
    }>;
    addPointMode?: boolean;
    manualCreatePoint?: boolean;
    onAddPointModeChange?: (enabled: boolean) => void;
    onMapRefresh?: () => void;
    clustersEnabled?: boolean;
    satelliteOverlayOpacity?: number;
    overlayMode?: 'none' | 'superposition' | 'comparison';
    topLayer?: string;
    topLayerOpacity?: number;
};
```

---

## États internes

| État | Type | Valeur initiale | Rôle |
|------|------|----------------|------|
| `userPosition` | `{ lat, lng } \| null` | `null` | Position GPS de l'utilisateur |
| `selectedPoint` | `Point \| null` | `null` | Point sélectionné (déclenche `MapPopup`) |
| `isMapReady` | `boolean` | `false` | Vrai 200ms après que la carte est montée |
| `isCreatingPoint` | `boolean` | `false` | Contrôle l'ouverture de `CreatePointModal` |
| `createPointCoords` | `{ lat, lng } \| null` | `null` | Coordonnées du clic pour la création |
| `fiches` | `FicheApi[]` | `[]` | Fiches de l'utilisateur chargées au montage |
| `mapCenter` | `[number, number]` | localStorage ou `[46.603354, 1.888334]` | Centre initial (France par défaut) |
| `mapZoom` | `number` | localStorage ou `6` | Zoom initial |
| `zoomSettings` | `{ minZoom, maxZoom }` | `{ 4, 18 }` | Limites de zoom globales |

---

## Refs

| Ref | Type | Rôle |
|-----|------|------|
| `mapRef` | `L.Map \| null` | Instance Leaflet principale |
| `skipAutoZoomRef` | `boolean` | Flag pour inhiber le flyTo automatique lors d'un setSelectedPoint programmatique |
| `clusterGroupRef` | `L.LayerGroup \| null` | Groupe de clusters courant |
| `markersRef` | `Map<string, L.Marker>` | Référence indexée par `_id` des marqueurs créés |

---

## Effets (`useEffect`)

| Dépendances | Description |
|-------------|-------------|
| `[]` | Charge les fiches utilisateur via `fetchUserFiches()` |
| `[manualCreatePoint, addPointMode]` | En mode manuel actif, ouvre `CreatePointModal` sans coordonnées |
| `[isMapReady, onMapMove]` | Attache `move` (callback `onMapMove`) et `moveend` (sauvegarde localStorage) |
| `[selectedLayer, zoomLevels]` | Ajuste `minZoom`/`maxZoom` de la carte selon la couche active |
| `[selectedPoint]` | `flyTo` zoom 17 sur le point (sauf si `skipAutoZoomRef.current === true`) |
| `[isMapReady, addPointMode]` | Attache `click` sur la carte ; change curseur en `crosshair` si `addPointMode` |
| `[isMapReady, leafletMarkers, clustersEnabled]` | Recrée le groupe de clusters ou pose les marqueurs directs |

---

## useMemo

| Variable | Dépendances | Rôle |
|----------|-------------|------|
| `markerIcons` | `points, lists` | Mappe `_id → L.Icon` en cherchant la liste primaire via `findPrimaryListForPoint` |
| `leafletMarkers` | `points, markerIcons` | Crée les `L.Marker` et les indexe dans `markersRef` |

---

## Fonctions internes

### `saveMapState()`
Sérialise `{ center, zoom, timestamp }` dans `localStorage['mapViewState']` via `safeSetItem`.  
TTL de 7 jours vérifié à la lecture (initialisation des états `mapCenter`/`mapZoom`).

### `handleCreatePoint(pointData)`
1. Appelle `saveMapState()`
2. Appelle `createPoint()`
3. En succès : invalide les caches `invalidatePointsCache()` + `invalidateListsCache()`, puis appelle `onMapRefresh?.()` ou `window.location.reload()`
4. En erreur : `showNotification` avec le message API

### `handleMarkerClick(pt: Point)`
Réinitialise `skipAutoZoomRef.current = false` puis appelle `setSelectedPoint(pt)`.

---

## `useImperativeHandle` — méthodes exposées via `MapHandle`

| Méthode | Comportement |
|---------|-------------|
| `zoomIn()` | `mapRef.current?.zoomIn()` |
| `zoomOut()` | `mapRef.current?.zoomOut()` |
| `goToUserLocation(position)` | `setView([lat, lng], 14)` + `setUserPosition` |
| `getCenter()` | Retourne `[lat, lng]` ou `[46.603354, 1.888334]` |
| `getZoom()` | Retourne zoom courant ou `6` |
| `goTo(coords, zoom?)` | `setView(coords, zoom)` |
| `setSelectedPoint(p)` | Pose `skipAutoZoomRef.current = true` puis `setSelectedPoint(p)` |
| `closePopup()` | `setSelectedPoint(null)` |
| `setAddPointMode(enabled)` | Appelle `onAddPointModeChange?.(enabled)` |

---

## Appels API

| API | Moment | Description |
|-----|--------|-------------|
| `fetchUserFiches()` | Mount | Récupère les fiches pour les passer à `CreatePointModal` |
| `createPoint()` | `handleCreatePoint` | Crée un nouveau point |
| `invalidatePointsCache()` | Post-création/suppression/édition | Import dynamique pour invalider le cache |
| `invalidateListsCache()` | Post-création/suppression/édition | Import dynamique |

---

## Comportements spéciaux

### Sauvegarde position carte (localStorage)
La position et le zoom sont sauvegardés dans `localStorage['mapViewState']` à chaque `moveend`. Lors de l'initialisation, si la valeur est présente et a moins de 7 jours (`timestamp + 7 * 24 * 60 * 60 * 1000`), la carte s'ouvre à la dernière position connue.

### Rendu des couches
Le rendu `JSX` conditionne les `<TileLayer>` selon `overlayMode` et `selectedLayer` :
- `overlayMode === 'superposition'` : deux `TileLayer` empilés
- `selectedLayer === 'geologiebrgm'` : `<AdaptiveGeologyLayer>`
- `selectedLayer === 'pci'` : satellite en dessous + PCI en dessus
- `selectedLayer === 'satellite'` : ortho + annotations IGN avec opacité
- `selectedLayer === 'photohist1950'` : cas spécial
- Tous les autres : `TileLayer` générique depuis `MAP_LAYER_URLS`

### Mode `forwardRef`
`Map` utilise `forwardRef<MapHandle, MapProps>` et expose 8 méthodes impératives via `useImperativeHandle`. Cela permet au parent (`MapDashboard`) de contrôler la carte sans prop drilling d'événements.

---

## Extrait de code clé

```typescript
// Initialisation position depuis localStorage avec TTL 7 jours
const [mapCenter] = useState<[number, number]>(() => {
    if (typeof window !== 'undefined') {
        const mapState = safeGetItem<{...}>('mapViewState');
        if (mapState) {
            const sevenDays = 7 * 24 * 60 * 60 * 1000;
            if (Date.now() - mapState.timestamp < sevenDays) {
                return [mapState.center.lat, mapState.center.lng];
            }
        }
    }
    return [46.603354, 1.888334]; // Centre France
});
```

---

## Utilisation typique

```tsx
const mapRef = useRef<MapHandle>(null);

<Map
  ref={mapRef}
  selectedLayer="standard"
  points={points}
  lists={lists}
  clustersEnabled={true}
  overlayMode="none"
  onMapRefresh={loadData}
  onAddPointModeChange={setAddPointMode}
/>

// Contrôle impératif
mapRef.current?.goTo([48.8566, 2.3522], 14);
mapRef.current?.setSelectedPoint(point);
```
