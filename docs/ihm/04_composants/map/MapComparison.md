# Composant : `MapComparison`

## Localisation
`src/components/map/MapComparison.tsx`

---

## Interface / Props

```typescript
export type MapComparisonHandle = {
    zoomIn: () => void;
    zoomOut: () => void;
    goToUserLocation: (position: { lat: number; lng: number }) => void;
    getCenter: () => [number, number];
    getZoom: () => number;
    goTo: (coords: [number, number], zoom?: number) => void;
    setSelectedPoint: (p: Point | null) => void;  // no-op
    closePopup: () => void;                        // no-op
    setAddPointMode: (enabled: boolean) => void;   // no-op
};

type MapComparisonProps = {
    leftLayer: string;
    rightLayer: string;
    points?: Array<Point>;
    lists?: Array<{
        _id: string; name: string;
        points?: string[] | Array<{_id: string}>;
        pointIds?: string[];
        color?: string; icon?: string;
    }>;
    addPointMode?: boolean;
    manualCreatePoint?: boolean;
    onAddPointModeChange?: (enabled: boolean) => void;
    onMapRefresh?: () => void;
    clustersEnabled?: boolean;
    satelliteOverlayOpacity?: number;
    dividerPosition: number;           // % 0-100
    onDividerPositionChange: (position: number) => void;
    minPosition?: number;              // défaut : 5
    maxPosition?: number;              // défaut : 95
};
```

---

## États internes

| État | Type | Valeur initiale | Rôle |
|------|------|----------------|------|
| `isDragging` | `boolean` | `false` | Vrai pendant le drag du diviseur |
| `isLeftMapReady` | `boolean` | `false` | La carte gauche est montée |
| `isRightMapReady` | `boolean` | `false` | La carte droite est montée |
| `sharedCenter` | `[number, number]` | localStorage ou `[46.603354, 1.888334]` | Centre partagé des deux cartes |
| `sharedZoom` | `number` | localStorage ou `6` | Zoom partagé |

---

## Refs

| Ref | Type | Rôle |
|-----|------|------|
| `leftMapRef` | `L.Map \| null` | Instance Leaflet gauche |
| `rightMapRef` | `L.Map \| null` | Instance Leaflet droite |
| `containerRef` | `HTMLDivElement \| null` | Conteneur pour le calcul de position du diviseur |
| `rafIdRef` | `number \| null` | `requestAnimationFrame` courant pour le drag |
| `initiatingMapRef` | `'left' \| 'right' \| null` | Quelle carte a initié le mouvement en cours |
| `beingSyncedMapRef` | `'left' \| 'right' \| null` | Quelle carte est en train d'être synchronisée (protège contre les boucles) |
| `lastZoomRef` | `{ left, right }` | Dernier zoom connu de chaque carte |
| `leftClusterGroupRef` | `any` | Groupe de clusters carte gauche |
| `rightClusterGroupRef` | `any` | Groupe de clusters carte droite |
| `leftMarkersRef` | `L.Marker[]` | Marqueurs individuels carte gauche |
| `rightMarkersRef` | `L.Marker[]` | Marqueurs individuels carte droite |

---

## Sous-composants internes

### `MapReadyHandler`
Props : `{ onReady: () => void; mapId: string }`  
Détecte quand la carte est prête via `useMap()`. Crée le pane `'markersPane'` (z-index 650) puis appelle `onReady` après 150ms.

### `MapSyncController`
Props : `{ mapId, onSync, initiatingMap, beingSyncedMap }`  
Écoute les événements Leaflet `move`, `moveend`, `zoomstart`, `zoomend`, `movestart` et l'événement `zoomanim` (non-standard react-leaflet, attaché via `map.on`).  
Protection race-condition : ignore tous les événements si `beingSyncedMap.current === mapId`.  
Pendant le zoom, lance une boucle `requestAnimationFrame` via `syncCenterLoop` pour synchroniser le centre en continu.

---

## Effets (`useEffect`)

| Dépendances | Description |
|-------------|-------------|
| `[isLeftMapReady, isRightMapReady]` | Log de debug quand les états ready changent |
| `[isLeftMapReady, leafletMarkers, clustersEnabled]` | Nettoie puis re-crée clusters ou marqueurs sur la carte gauche |
| `[isRightMapReady, leafletMarkers, clustersEnabled]` | Idem pour la carte droite |
| `[isDragging, handleMouseMove, handleMouseUp]` | Attache/détache listeners `mousemove`/`mouseup` sur `document`, change curseur body en `ew-resize` |
| `[]` | Cleanup des `requestAnimationFrame` au démontage |

---

## Fonctions clés

### `handleSync(sourceMapId, center, zoom, withAnimation?)`
Calcule la carte cible (opposée à source), pose `beingSyncedMapRef.current = targetMapId`, puis appelle :
- `panTo` si `zoom === null` (sync mouvement sans zoom)
- `setView` avec `animate: true, duration: 0.25` si `withAnimation === true`
- `setView` avec `animate: false` sinon

### `syncBothMaps(center, zoom)`
Appelle `setView` sans animation sur les deux cartes simultanément (pour les contrôles impératifs).

### Drag du diviseur
`handleMouseDown` → `isDragging = true`  
`handleMouseMove` (via RAF) → calcule `newPosition = (clientX - containerLeft) / containerWidth * 100`, clampe entre `minPosition` et `maxPosition`, appelle `onDividerPositionChange`.

---

## Appels API
Aucun appel API direct. Les marqueurs sont fournis via props `points`/`lists`.

---

## Comportements spéciaux

### Synchronisation bidirectionnelle des cartes
Les deux `MapContainer` sont absolus et superposés (plein écran). La carte gauche est clipée avec `clipPath: polygon(0 0, ${dividerPosition}% 0, ...)` et z-index 2 ; la droite avec le polygone complémentaire et z-index 1. Cela donne l'illusion d'un split-view alors que les deux cartes occupent tout l'espace.

### Protection anti-boucle de synchronisation
`beingSyncedMapRef` empêche qu'une carte en train d'être synchronisée déclenche à son tour une synchronisation de sa voisine (boucle infinie).

### Sécurité XSS dans les popups
`escapeHtml()` et `createSafePopupContent()` échappent les noms/descriptions avant `marker.bindPopup()` (fix CLIENT-003).

### Duplication des marqueurs
Les marqueurs Leaflet ne peuvent appartenir qu'à une seule carte. `MapComparison` crée une copie distincte de chaque marqueur pour la carte gauche et pour la carte droite.

---

## Extrait de code clé

```typescript
// Synchronisation pendant l'animation de zoom (zoomanim + RAF loop)
const handleZoomAnim = (e: L.ZoomAnimEvent) => {
    if (isZoomingRef.current && initiatingMap.current === mapId && !hasStartedZoomAnimationRef.current) {
        hasStartedZoomAnimationRef.current = true;
        onSync(mapId, e.center, e.zoom, true); // withAnimation=true

        const syncCenterLoop = () => {
            if (isZoomingRef.current && initiatingMap.current === mapId) {
                onSync(mapId, map.getCenter(), null, false); // zoom=null = panTo
                syncRafRef.current = requestAnimationFrame(syncCenterLoop);
            }
        };
        requestAnimationFrame(syncCenterLoop);
    }
};
```

---

## Utilisation typique

```tsx
const mapRef = useRef<MapComparisonHandle>(null);
const [dividerPos, setDividerPos] = useState(50);

<MapComparison
  ref={mapRef}
  leftLayer="standard"
  rightLayer="satellite"
  points={points}
  lists={lists}
  dividerPosition={dividerPos}
  onDividerPositionChange={setDividerPos}
  clustersEnabled={true}
/>
```
