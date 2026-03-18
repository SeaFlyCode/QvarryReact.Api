# Page Dashboard

## Vue d'ensemble

Page principale de l'application après authentification. Affiche une carte interactive (Leaflet) avec les points de l'utilisateur. Intègre la barre de recherche, les outils cartographiques, et gère l'état de la carte via `safeStorage`.

---

## Route & fichier source

| Élément | Valeur |
|---------|--------|
| Route Next.js | `/dashboard` |
| Fichier | `src/app/dashboard/page.tsx` |
| Layout | `src/app/dashboard/layout.tsx` |
| Rendu | Client (`'use client'`) |
| Protection | `<AuthGuard>` (redirection si non authentifié) |

---

## Layout (`dashboard/layout.tsx`)

Le layout enveloppe la page dans :
- `<AuthGuard>` — vérifie la session, redirige vers `/` si non authentifié
- `<Navbar>` — barre de navigation supérieure
- `<NotificationProvider>` — système de notifications toast

---

## États internes (page)

| État | Type | Rôle |
|------|------|------|
| `points` | `Point[]` | Liste des points chargés depuis l'API |
| `selectedPoint` | `Point \| null` | Point sélectionné sur la carte |
| `isLoading` | `boolean` | État de chargement initial |
| `mapCenter` | `[number, number]` | Centre de la carte (lat/lng) |
| `mapZoom` | `number` | Niveau de zoom |
| `searchQuery` | `string` | Valeur de la barre de recherche |
| `filteredPoints` | `Point[]` | Points filtrés selon `searchQuery` |

---

## Persistance de l'état carte

L'état de la carte (centre, zoom) est persisté via `safeStorage` pour survivre aux rechargements :

```ts
// Lecture au montage
const savedState = safeStorage.getItem('mapState');

// Sauvegarde à chaque changement
safeStorage.setItem('mapState', JSON.stringify({ center, zoom }));
```

---

## Composants enfants

| Composant | Rôle |
|-----------|------|
| `<MapContainer>` | Carte Leaflet principale |
| `<MapToolbar>` | Outils cartographiques (zoom, localisation, etc.) |
| `<SearchBar>` | Recherche de points par nom/description |
| `<PointMarker>` | Marqueur individuel sur la carte |
| `<PointDetailPanel>` | Panneau latéral de détail d'un point sélectionné |

---

## Appels API

| Fonction | Module | Moment | Description |
|----------|--------|--------|-------------|
| `getPoints()` | `src/api/points.ts` | Au montage | Charge tous les points de l'utilisateur |
| `checkAuth()` | `src/api/auth.ts` | Via `<AuthGuard>` | Vérifie la session |

---

## Événements écoutés

| Événement | Source | Action |
|-----------|--------|--------|
| `dataSharedAccepted` | `window` | Recharge les points (un partage a été accepté) |
| `auth-state-change` | `window` | Vérifie si session expirée |

---

## Comportements spéciaux

### Recherche
- La recherche filtre les points en temps réel sur `name` et `description`
- Utilise le hook `useDashboardSearch` pour le debounce et la logique de filtrage

### Géolocalisation
- Le `MapToolbar` expose un bouton de centrage sur la position GPS de l'utilisateur
- Utilise l'API navigateur `navigator.geolocation`

### WebSocket
- En production, une connexion WebSocket (`src/api/websocket.ts`) maintient les points synchronisés en temps réel avec les autres sessions

---

## Extrait de code clé

```tsx
useEffect(() => {
  const loadPoints = async () => {
    setIsLoading(true);
    try {
      const data = await getPoints();
      setPoints(data);
    } finally {
      setIsLoading(false);
    }
  };
  loadPoints();
}, []);

// Écoute des partages acceptés
useEffect(() => {
  const handler = () => loadPoints();
  window.addEventListener('dataSharedAccepted', handler);
  return () => window.removeEventListener('dataSharedAccepted', handler);
}, []);
```
