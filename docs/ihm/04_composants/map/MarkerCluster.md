# Composant : `MarkerCluster`

## Localisation
`src/components/map/MarkerCluster.tsx`

---

## Interface

Ce fichier exporte une fonction utilitaire, pas un composant React classique :

```typescript
export function createMarkerClusters(
  map: L.Map,
  markers: L.Marker[],
  onMarkerClick?: (marker: L.Marker) => void
): L.LayerGroup
```

---

## Architecture

Clustering **100% custom** — aucune dépendance à `leaflet.markercluster`. Implémentation directe avec `L.layerGroup()`, injection CSS via singleton DOM, et algorithme de résolution de collisions de labels.

---

## Injection CSS (singleton)

```typescript
if (typeof document !== 'undefined' && !document.getElementById('marker-cluster-styles')) {
  const styleEl = document.createElement('style');
  styleEl.id = 'marker-cluster-styles';
  styleEl.textContent = clusterStyles;
  document.head.appendChild(styleEl);
}
```

Injecté une seule fois grâce au guard sur `document.getElementById`. Définit les classes CSS `.marker-cluster-small/medium/large`.

---

## Couleurs des clusters

| Classe | Couleur fond | Condition | Couleur bord (hover rectangle) |
|--------|-------------|-----------|-------------------------------|
| `marker-cluster-small` | `rgba(137, 124, 255, 0.6)` → violet `#897CFF` | count < 10 | `#897CFF` |
| `marker-cluster-medium` | `rgba(241, 128, 23, 0.6)` → orange `#F18017` | count < 50 | `#F18017` |
| `marker-cluster-large` | `rgba(253, 156, 115, 0.6)` → saumon `#FD9C73` | count ≥ 50 | `#FD9C73` |

---

## Algorithme de clustering (`updateClusters`)

Appelé à chaque `zoomend` et `moveend`.

1. Calcule `clusterDistance` selon le zoom : `zoom > 15 → 40px`, `> 12 → 60px`, `> 10 → 80px`, sinon `120px`
2. Pour chaque marqueur non encore regroupé, cherche tous les marqueurs dont la distance pixel < `clusterDistance`
3. Crée :
   - Un marqueur individuel si le cluster a 1 seul élément
   - Un `L.divIcon` cluster sinon (avec le count)

---

## Interactions clusters

### Clic sur un cluster
- Si `zoom < 18` : `map.fitBounds(group.getBounds().pad(0.1))` — zoom sur l'étendue du cluster
- Si `zoom >= 18` : `spiderfyCluster()` — affiche les marqueurs en cercle

### Survol d'un cluster
Affiche un `L.rectangle` pointillé (`dashArray: '5, 5'`) autour de tous les points du cluster, coloré selon la taille.

---

## Visibilité des labels (`updatePointLabelsVisibility`)

Seuil `LABEL_ZOOM_THRESHOLD = 12`.
- zoom ≥ 12 : ajoute classe `show-labels` sur le conteneur de la carte → affiche les `.point-marker-label`, puis appelle `resolveLabelsCollisions` après 50ms
- zoom < 12 : retire la classe

---

## Algorithme de résolution des collisions (`resolveLabelsCollisions`)

1. Lit tous les `.point-marker-label` et leur `getBoundingClientRect()`
2. Trie par position `top` puis `left` (priorité haut-gauche)
3. Pour chaque label, jusqu'à 8 tentatives de déplacement en 4 directions cycliques : Haut → Droite → Gauche → Haut-droite
4. Décalage de `20px * Math.ceil(attempt / 4)` à chaque cycle
5. Applique via `transform: translateX(calc(-50% + Xpx))` et `marginBottom`

---

## `spiderfyCluster` (function)

Crée un `L.layerGroup` temporaire avec :
- `L.polyline` du centre vers chaque marqueur déployé
- `L.marker` à position circulaire (rayon 50px en pixels carte)

Fermeture par clic sur la carte (`map.on('click', closeSpiderfy)` avec délai 100ms pour éviter le déclenchement immédiat).

---

## Extrait de code clé

```typescript
// Distance de clustering adaptative au zoom
const clusterDistance = zoom > 15 ? 40 : zoom > 12 ? 60 : zoom > 10 ? 80 : 120;

// Spiderfy au zoom maximum
if (zoom < 18) {
    map.fitBounds(group.getBounds().pad(0.1));
} else {
    spiderfyCluster(map, cluster.markers, cluster.center, onMarkerClick);
}
```

---

## Utilisation typique

```typescript
// Dans Map.tsx
clusterGroupRef.current = createMarkerClusters(
    mapRef.current,
    leafletMarkers,
    (marker) => {
        const pointData = (marker as L.Marker & {_pointData?: Point})._pointData;
        if (pointData) handleMarkerClick(pointData);
    }
);
clusterGroupRef.current.addTo(mapRef.current);
```
