# Module API `sync.ts`

## Localisation

```
src/api/sync.ts
```

---

## Vue d'ensemble

Module de synchronisation des données. Permet de vérifier si des changements sont disponibles côté serveur depuis la dernière synchronisation.

---

## Exports

---

### `refreshSync()`

```ts
async function refreshSync(): Promise<SyncResult>
```

**Endpoint** : `GET /auth/sync/refresh`

**Retourne** :
```ts
interface SyncResult {
  hasChanges: boolean;
  counts: {
    points?:        number;
    fiches?:        number;
    lists?:         number;
    conversations?: number;
    notifications?: number;
  };
}
```

**Description** : Interroge le serveur pour savoir si des données ont changé depuis la dernière synchronisation connue. Si `hasChanges === true`, les composants concernés rechargent leurs données.

---

## Pattern d'utilisation

```ts
// Vérification périodique ou au retour de focus
const result = await refreshSync();

if (result.hasChanges) {
  if (result.counts.points)        invalidatePointsCache();
  if (result.counts.notifications) reloadNotifications();
  // etc.
}
```
