# Service Synchronisation Mobile (Offline-First)

## Table des matières

- [Vue d'ensemble](#vue-densemble)
- [Architecture delta sync](#architecture-delta-sync)
- [trackChanges](#trackchanges)
- [applyChanges](#applychanges)
- [Données synchronisées](#données-synchronisées)
- [Gestion des conflits](#gestion-des-conflits)
- [État de synchronisation](#état-de-synchronisation)

---

## Vue d'ensemble

Le service de synchronisation mobile implémente une architecture **offline-first** permettant à l'application mobile de fonctionner sans connexion permanente. Les données sont synchronisées via un système de **delta sync** : seules les modifications depuis la dernière synchronisation sont transmises.

```
┌────────────────────────────────────────────────────────────┐
│                     syncService                            │
│                                                            │
│  getFullSync(userId)         → Sync complète initiale      │
│  trackChanges(userId, since) → Récupère changements serveur│
│  applyChanges(userId, changes) → Applique changements client│
│  getSyncStatus(userId, deviceId) → État de sync           │
└────────────────────────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────────────────┐
│  Collections MongoDB surveillées                           │
│  - Fiche           - Liste          - Point               │
│  - Contact         - Conversation   - Message             │
│  - Notification                                           │
│                                                            │
│  Chaque document possède un champ updatedAt (timestamp)   │
│  utilisé comme marqueur de changement.                     │
└────────────────────────────────────────────────────────────┘
```

---

## Architecture delta sync

### Flux de synchronisation

```
Application Mobile                    API Qvarry
     │                                     │
     │ 1. Collecte changements locaux      │
     │    depuis lastSyncAt                │
     │                                     │
     │── POST /mobile/sync ───────────────▶│
     │   { lastSyncAt, changes: [...] }    │
     │                                     │ 2. applyChanges(userId, changes)
     │                                     │    Applique les changements client
     │                                     │
     │                                     │ 3. trackChanges(userId, lastSyncAt)
     │                                     │    Récupère les changements serveur
     │                                     │    depuis lastSyncAt
     │◀── { serverChanges, conflicts } ────│
     │    { newLastSyncAt }                │
     │                                     │
     │ 4. Applique serverChanges en local  │
     │ 5. Stocke newLastSyncAt             │
     │                                     │
```

### Principe de last-write-wins

Pour la résolution de conflits, la stratégie **last-write-wins** est appliquée :

```
Conflit sur Fiche "64a1b2c3..." :

  Version client :
    updatedAt = 2026-03-18T10:00:00.000Z
    title = "Ma fiche locale"

  Version serveur :
    updatedAt = 2026-03-18T10:05:00.000Z
    title = "Ma fiche serveur"

  Résolution → server_wins (10:05 > 10:00)
  La version serveur est retournée dans serverChanges
  Le client DOIT remplacer sa version locale
```

---

## trackChanges

Récupère toutes les modifications côté serveur depuis un timestamp donné.

### Signature

```typescript
syncService.trackChanges(
  userId: string,
  since: Date
): Promise<SyncChange[]>
```

### Logique interne

```typescript
// Pour chaque entité synchronisable :
const changes: SyncChange[] = [];

// Fiches modifiées depuis 'since'
const ficheChanges = await Fiche.find({
  userId,
  updatedAt: { $gt: since },
}).select("+deletedAt");

ficheChanges.forEach((fiche) => {
  changes.push({
    entity: "fiches",
    operation: fiche.deletedAt ? "delete" : "update",
    data: fiche.toObject(),
  });
});

// Idem pour chaque entité...
return changes;
```

---

## applyChanges

Applique les changements envoyés par le client mobile.

### Signature

```typescript
syncService.applyChanges(
  userId: string,
  changes: SyncChange[]
): Promise<ApplyChangesResult>
```

### Résultat

```typescript
interface ApplyChangesResult {
  applied: number; // Nombre de changements appliqués avec succès
  conflicts: SyncConflict[]; // Conflits détectés
  errors: SyncError[]; // Erreurs sur certains items
}
```

### Logique par type d'opération

```
Pour chaque changement client :

OPERATION = 'create' :
  Si document n'existe pas → INSERT
  Si document existe → conflict (résoudre par timestamp)

OPERATION = 'update' :
  Comparer client.updatedAt vs server.updatedAt
  Si client.updatedAt > server.updatedAt → UPDATE (client_wins)
  Si client.updatedAt < server.updatedAt → conflict (server_wins)
  Si client.updatedAt = server.updatedAt → no-op (idempotent)

OPERATION = 'delete' :
  Si document existe → soft delete (deletedAt = now)
  Si document n'existe pas → no-op

Validation métier :
  Vérifier que userId correspond (sécurité)
  Vérifier les champs requis
  Rejeter les champs non autorisés (ex: role, isAdmin)
```

---

## Données synchronisées

### Entités et leur politique de sync

| Entité          | Direction        | Create           | Update           | Delete           | Notes                                  |
| --------------- | ---------------- | ---------------- | ---------------- | ---------------- | -------------------------------------- |
| `fiches`        | Bidirectionnel   | Client + Serveur | Client + Serveur | Client + Serveur | Données principales                    |
| `listes`        | Bidirectionnel   | Client + Serveur | Client + Serveur | Client + Serveur |                                        |
| `points`        | Bidirectionnel   | Client + Serveur | Client + Serveur | Client + Serveur | Géolocalisation                        |
| `contacts`      | Serveur → Client | Non              | Serveur only     | Non              | Les invitations passent par API dédiée |
| `conversations` | Bidirectionnel   | Client + Serveur | Client + Serveur | Non              | Pas de suppression via sync            |
| `messages`      | Bidirectionnel   | Client + Serveur | Non              | Client + Serveur | Pas de modification via sync           |
| `notifications` | Serveur → Client | Non              | Client (read)    | Non              | Seul le champ `read` est sync-able     |

### Champs exclus de la synchronisation

Pour des raisons de sécurité, certains champs ne sont **jamais** synchronisés depuis le client :

```
- userId (généré par le serveur)
- isAdmin, role (gestion des privilèges)
- createdAt (généré par le serveur)
- _id (généré par MongoDB, sauf pour create avec localId)
- __v (version Mongoose)
- passwordHash, salt (données sensibles)
```

---

## Gestion des conflits

### Structure d'un conflit

```typescript
interface SyncConflict {
  entity: string; // 'fiches', 'messages', etc.
  documentId: string; // ID MongoDB du document
  localData: object; // Données envoyées par le client
  serverData: object; // Données actuelles sur le serveur
  resolution: ConflictResolution;
  reason: string;
}

type ConflictResolution =
  | "server_wins" // Timestamp serveur plus récent
  | "client_wins" // Timestamp client plus récent
  | "merge" // Fusion automatique possible
  | "manual_required"; // Conflit non résolvable automatiquement
```

### Exemple de conflit

```json
{
  "entity": "fiches",
  "documentId": "64a1b2c3d4e5f6789012345",
  "localData": {
    "title": "Épave du Dalton",
    "updatedAt": "2026-03-18T10:00:00.000Z"
  },
  "serverData": {
    "title": "Épave du Dalton - Zone B",
    "updatedAt": "2026-03-18T10:05:00.000Z"
  },
  "resolution": "server_wins",
  "reason": "Server timestamp 10:05 is more recent than client 10:00"
}
```

### Cas particulier : suppression vs modification

Si le client veut modifier un document que le serveur a supprimé :

```
Client : update fiche "64a1..." (titre modifié localement)
Serveur : fiche "64a1..." a été supprimée depuis la dernière sync

→ Conflit : resolution = 'manual_required'
→ Inclus dans conflicts[] de la réponse
→ Le client affiche une notification à l'utilisateur
```

---

## État de synchronisation

### getSyncStatus

```typescript
syncService.getSyncStatus(
  userId: string,
  deviceId: string
): Promise<SyncStatus>
```

```typescript
interface SyncStatus {
  deviceId: string;
  lastSyncAt: Date | null;
  isUpToDate: boolean;
  pendingServerChanges: number; // Nombre de changements en attente
  syncEnabled: boolean;
  serverTime: Date; // Heure serveur actuelle
}
```

### Gestion de la dérive d'horloge

L'application mobile peut avoir une horloge légèrement désynchronisée. Le champ `serverTime` dans la réponse de `/sync/status` permet au client de corriger sa dérive :

```
Dérive = serverTime - clientTime

Si dérive > 30 secondes :
  → Le client doit ajuster ses timestamps avant la prochaine sync
  → Log warning côté client
```

---

_Voir aussi : [sync.md](../05_mobile/sync.md) — [redis-sessions.md](redis-sessions.md)_
