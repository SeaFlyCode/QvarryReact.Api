# Module API `geo.ts`

## Localisation

```
src/api/geo.ts
```

---

## Vue d'ensemble

Module de géocodage utilisant l'API publique française `geo.api.gouv.fr`. **N'utilise pas `apiFetch`** — appelle directement l'API externe. Gère les `AbortError` pour les requêtes annulées.

---

## Particularité critique

Ce module appelle `https://geo.api.gouv.fr` directement avec `fetch()` natif, **pas via `apiFetch`** :

```ts
// Pas de apiFetch — API externe
const response = await fetch(
  `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(query)}&fields=nom,code,centre&format=json&geometry=centre`,
  { signal: controller.signal }
);
```

---

## Exports

---

### `searchCommunes(query, signal?)`

```ts
async function searchCommunes(
  query:   string,
  signal?: AbortSignal
): Promise<Commune[]>
```

**URL externe** : `https://geo.api.gouv.fr/communes?nom=...&fields=nom,code,centre&format=json&geometry=centre`

**Retourne** :
```ts
interface Commune {
  nom:    string;
  code:   string;       // Code INSEE
  centre: {
    type:        'Point';
    coordinates: [number, number]; // [longitude, latitude]
  };
}
```

**Gestion AbortError** :
```ts
try {
  const response = await fetch(url, { signal });
  return await response.json();
} catch (error) {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return []; // Requête annulée — pas d'erreur
  }
  throw error;
}
```

---

### `reverseGeocode(lat, lng)`

```ts
async function reverseGeocode(
  lat: number,
  lng: number
): Promise<string | null>
```

**URL externe** : `https://geo.api.gouv.fr/communes?lat=...&lon=...&fields=nom&format=json`

**Retourne** : Le nom de la commune la plus proche, ou `null` si aucune trouvée.

---

## Pattern AbortController dans les composants

Les composants qui utilisent `searchCommunes` passent un `AbortSignal` pour annuler la requête précédente lors d'une nouvelle saisie :

```ts
// Dans un composant de recherche
useEffect(() => {
  const controller = new AbortController();

  searchCommunes(query, controller.signal)
    .then(setResults)
    .catch(() => {}); // AbortError ignorée

  return () => controller.abort();
}, [query]);
```
