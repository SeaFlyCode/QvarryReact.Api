# Service de Synchronisation Offline-First — Application Mobile Qvarry

## Vue d'ensemble

Le service de synchronisation (`src/services/api/sync.ts`) implémente une architecture **offline-first** : toutes les données sont disponibles localement et synchronisées avec le serveur dès que la connexion est disponible.

---

## Principes

| Principe              | Description                                                                           |
| --------------------- | ------------------------------------------------------------------------------------- |
| **Offline-first**     | L'app fonctionne sans connexion. Les données sont lues depuis le cache local.        |
| **Delta sync**        | Seuls les changements depuis la dernière sync sont échangés (pas de rechargement complet) |
| **Last-write-wins**   | En cas de conflit, la modification avec le timestamp le plus récent gagne            |
| **Queue locale**      | Les modifications hors ligne sont stockées en queue et poussées à la reconnexion     |
| **ID temporaires**    | Les créations offline ont un ID temporaire (`local-xxxx`) remplacé par l'ID serveur  |

---

## Données synchronisées

| Type           | Clé AsyncStorage                | API Endpoint                    |
| -------------- | -------------------------------- | ------------------------------- |
| Points         | `@qvarry_cached_points`         | `GET/POST /mobile/sync`         |
| Fiches         | `@qvarry_cached_fiches`         | `GET/POST /mobile/sync`         |
| Listes         | `@qvarry_cached_lists`          | `GET/POST /mobile/sync`         |
| Contacts SOS   | `@qvarry_cached_sos_contacts`   | `GET/POST /mobile/sync`         |

---

## Flux de synchronisation

```
sync()
   │
   ├── 1. Récupérer les changements locaux en attente (getPendingChanges)
   │         │
   │         └── Si changements → pushChanges() → API POST /mobile/sync
   │                  │
   │                  ├── Résoudre les conflits (last-write-wins)
   │                  ├── Mettre à jour les IDs locaux → serveur (idMapping)
   │                  └── Marquer les changements comme synchronisés
   │
   ├── 2. Récupérer les changements serveur (pullChanges)
   │         │
   │         └── GET /mobile/sync?since=<lastSyncDate>
   │                  │
   │                  └── applyChangesToCache(syncData)
   │                        ├── Appliquer créations / mises à jour / suppressions
   │                        └── Mettre à jour le cache AsyncStorage
   │
   └── 3. Sauvegarder la nouvelle date de sync (setLastSyncDate)
```

---

## API du service

### Synchronisation principale

```typescript
// Synchronisation complète (push + pull)
sync(options?: { forceFull?: boolean }): Promise<SyncResponse>

// Pull uniquement
pullChanges(since?: string): Promise<SyncResponse>

// Push uniquement
pushChanges(changes: LocalChange[]): Promise<PushSyncResponse>

// Vérifier si des changements sont disponibles sans les télécharger
checkSyncStatus(since: string): Promise<SyncStatusResponse>

// Téléchargement complet (remplace tout le cache)
forceFullSync(): Promise<SyncResponse>
```

### Opérations offline

```typescript
// Points
createPointOffline(data): Promise<string>  // Retourne l'ID local
updatePointOffline(id, data): Promise<void>
deletePointOffline(id): Promise<void>

// Fiches
createFicheOffline(data): Promise<string>
updateFicheOffline(id, data): Promise<void>
deleteFicheOffline(id): Promise<void>

// Listes
createListOffline(data): Promise<string>
updateListOffline(id, data): Promise<void>
deleteListOffline(id): Promise<void>
```

### Gestion de la queue

```typescript
// Ajouter un changement à la queue
queueChange(change: Omit<LocalChange, 'timestamp'>): Promise<string>

// Récupérer les changements en attente
getPendingChanges(): Promise<PendingChange[]>

// Marquer des changements comme synchronisés
markAsSynced(pendingIds: string[]): Promise<void>
```

### Accès au cache

```typescript
getCachedPoints(): Promise<SyncPoint[]>
getCachedFiches(): Promise<SyncFiche[]>
getCachedLists(): Promise<SyncList[]>
getCachedSosContacts(): Promise<SyncSosContact[]>
```

### Utilitaires

```typescript
// État actuel de la sync
getSyncState(): Promise<LocalSyncState>
// → { lastSyncDate, pendingChanges, isOnline, isSyncing }

// Vérifier si une sync est nécessaire
needsSync(): Promise<boolean>

// Réinitialiser toutes les données de sync
resetSyncData(): Promise<void>

// Listeners d'événements
addSyncListener(callback: SyncEventCallback): () => void
removeSyncListener(callback: SyncEventCallback): void
```

---

## Types de synchronisation

```typescript
interface PendingChange {
  type: 'point' | 'fiche' | 'list' | 'sosContact';
  action: 'create' | 'update' | 'delete';
  id?: string;        // ID serveur (si update/delete)
  localId?: string;   // ID local (si create offline)
  data?: any;
  timestamp: string;
  pendingId: string;  // ID unique de ce changement en queue
  retryCount: number;
  createdAt: string;
}

interface SyncEvent {
  status: 'idle' | 'syncing' | 'success' | 'error';
  message: string;
  progress?: number;       // 0-100
  totalChanges?: number;
}
```

---

## Retry et gestion des erreurs

- Maximum **3 tentatives** par changement (`MAX_RETRY_COUNT = 3`)
- Si un changement échoue 3 fois, il est supprimé de la queue
- En cas d'erreur réseau lors du push, la sync continue avec le pull (les données locales ne sont pas perdues)
- En cas d'erreur 401, le refresh token est tenté automatiquement via `fetchWithRefresh`

---

## `SyncContext` — Intégration React

Le `SyncContext` orchestre les appels à ce service depuis React :

```typescript
<SyncProvider
  autoSyncOnMount={true}     // Sync au démarrage de l'app
  syncOnForeground={true}    // Sync quand l'app revient au premier plan
  syncOnReconnect={true}     // Sync au retour de la connectivité réseau
  syncInterval={240000}      // Sync toutes les 4 minutes (en ms)
>
```
