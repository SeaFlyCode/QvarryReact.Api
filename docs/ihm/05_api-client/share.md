# Module API `share.ts`

## Localisation

```
src/api/share.ts
```

---

## Vue d'ensemble

Module de gestion des partages de données entre utilisateurs. Supporte le partage de fiches, points et listes. Intègre une détection de falsification (tamper detection) côté client.

---

## Types

```ts
type DataType = 'fiche' | 'point' | 'liste';

interface Share {
  id:            string;
  dataType:      DataType;
  dataId:        string;
  senderId:      string;
  recipientId:   string;
  status:        'pending' | 'accepted' | 'rejected' | 'expired' | 'revoked';
  expiresAt:     string | null;
  createdAt:     string;
  signatureValid: boolean;
}
```

---

## Exports

---

### `getReceivedShares(params?)`

```ts
async function getReceivedShares(params?: {
  status?:         string;
  includeExpired?: boolean;
}): Promise<Share[]>
```

**Endpoint** : `GET /share/received`

---

### `getSentShares(params?)`

```ts
async function getSentShares(params?: {
  status?:         string;
  includeExpired?: boolean;
}): Promise<Share[]>
```

**Endpoint** : `GET /share/sent`

---

### `createShare(dataType, dataId, recipientId, options?)`

```ts
async function createShare(
  dataType:    DataType,
  dataId:      string,
  recipientId: string,
  options?: {
    expiresIn?: number;  // Durée en heures, null = permanent
  }
): Promise<Share>
```

**Endpoint** : `POST /share`

---

### `acceptShare(id)`

```ts
async function acceptShare(id: string): Promise<void>
```

**Endpoint** : `POST /share/:id/accept`

---

### `rejectShare(id)`

```ts
async function rejectShare(id: string): Promise<void>
```

**Endpoint** : `POST /share/:id/reject`

---

### `revokeShare(id)`

```ts
async function revokeShare(id: string): Promise<void>
```

**Endpoint** : `DELETE /share/:id`

---

### `getSharedData(shareId)` ⭐ Tamper detection

```ts
async function getSharedData(shareId: string): Promise<SharedData>
```

**Endpoint** : `GET /share/:id/data`

**Détection de falsification** :
```ts
const response = await apiFetch<SharedDataResponse>(`/share/${shareId}/data`);

if (response.data?.tampered === true) {
  throw new Error('TAMPER_DETECTED: Les données partagées ont été modifiées');
}

return response.data;
```

Si `tampered: true` est présent dans la réponse, une erreur est levée avant de retourner les données. La page `partage.tsx` affiche une alerte de sécurité dans ce cas.

Le champ `signatureValid` dans `Share` indique si la signature cryptographique des données est valide.

---

## Note sur `invalidatePointsCache()`

Importée depuis `src/api/points.ts`, appelée après `acceptShare()` pour forcer le rechargement des points sur le dashboard :

```ts
import { invalidatePointsCache } from './points';

// Après acceptShare()
invalidatePointsCache();
window.dispatchEvent(new Event('dataSharedAccepted'));
```
