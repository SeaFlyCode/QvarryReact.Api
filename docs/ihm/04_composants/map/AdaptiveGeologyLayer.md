# Composant : `AdaptiveGeologyLayer`

## Localisation
`src/components/map/AdaptiveGeologyLayer.tsx`

---

## Interface / Props

```typescript
{
  attribution?: string;  // défaut : '&copy; BRGM - Géologie France'
  zIndex?: number;       // défaut : 0
  opacity?: number;      // défaut : 1
}
```

Composant React (pas de `forwardRef`), retourne `null` — agit uniquement via effets Leaflet.

---

## Refs

| Ref | Type | Rôle |
|-----|------|------|
| `currentLayerRef` | `L.TileLayer.WMS \| null` | Instance WMS courante |
| `currentLayerNameRef` | `string \| null` | Nom de la couche BRGM active (pour le cache hit) |

---

## Effets (`useEffect`)

Dépendances : `[map, attribution, zIndex, opacity]`

Logique de `updateLayer()` (appelée au mount et à chaque `zoomend`) :

1. Détermine la couche selon le zoom :
   - zoom ≤ 8 → `SCAN_F_GEOL1M` (national 1:1M)
   - zoom 9–11 → `SCAN_F_GEOL250` (régional 1:250k)
   - zoom ≥ 12 → `SCAN_D_GEOL50` (détail 1:50k)

2. **Cache hit** : si `currentLayerNameRef.current === layerName`, ne fait rien

3. **setParams optimisé** : si layer existant, appelle `setParams({ layers: layerName }, false)` puis `setTimeout(() => layer.redraw(), 0)` — conserve le cache des tuiles déjà chargées

4. **Création** si setParams échoue ou premier montage : `L.tileLayer.wms(...)` avec options de cache :
   - `keepBuffer: 3` (3 écrans)
   - `updateWhenIdle: true`
   - `updateWhenZooming: false`
   - `maxZoom: 22`, `maxNativeZoom: 16`

Cleanup : `map.off('zoomend', updateLayer)` + suppression du layer WMS.

---

## Appels API (WMS)

| Service | URL |
|---------|-----|
| BRGM géologie | `https://geoservices.brgm.fr/geologie` |

Paramètres WMS : `format=image/png`, `transparent=true`, `uppercase=true`, `crs=L.CRS.EPSG3857`

---

## Comportements spéciaux

### Optimisation cache via `setParams()`
Au lieu de supprimer et recréer le layer WMS (ce qui viderait le cache des tuiles), `setParams()` change le paramètre `layers` en conservant l'instance et son cache interne. Cela évite un rechargement complet lors d'un changement de zoom.

### Couverture BRGM
Les tuiles BRGM sont disponibles jusqu'au zoom natif 16. Au-delà, Leaflet les met à l'échelle via `maxNativeZoom: 16`.

---

## Extrait de code clé

```typescript
// Changement de couche optimisé via setParams (conserve le cache)
if (currentLayerRef.current) {
    currentLayerRef.current.setParams({ layers: layerName }, false);
    currentLayerNameRef.current = layerName;
    setTimeout(() => currentLayerRef.current?.redraw(), 0);
    return;
}
```

---

## Utilisation typique

```tsx
// Dans Map.tsx — rendu conditionnel selon selectedLayer
{selectedLayer === 'geologiebrgm' && (
    <AdaptiveGeologyLayer
        attribution="&copy; BRGM - Géologie France"
        zIndex={0}
        opacity={1}
    />
)}

// Mode superposition avec opacité
<AdaptiveGeologyLayer
    zIndex={1}
    opacity={topLayerOpacity}
/>
```
