# Synchronisation Mobile — /api/v1/mobile/sync

## Table des matières

- [Architecture offline-first](#architecture-offline-first)
- [GET /mobile/sync](#get-mobilesync)
- [POST /mobile/sync](#post-mobilesync)
- [GET /mobile/sync/status](#get-mobilesyncstatus)
- [Gestion des conflits](#gestion-des-conflits)
- [Données synchronisées](#données-synchronisées)

---

## Architecture offline-first

Le système de synchronisation Qvarry suit une architecture **delta sync** : seules les données modifiées depuis la dernière synchronisation sont transmises, minimisant ainsi la bande passante consommée.

```
┌──────────────────────────────────────────────────────────────┐
│                     Application Mobile                        │
│                                                              │
│  ┌─────────────┐     ┌──────────────────────────────────┐   │
│  │  SQLite DB  │     │         Sync Engine               │   │
│  │  (locale)   │◀───▶│                                  │   │
│  │             │     │  1. Collecte les changements      │   │
│  │  - fiches   │     │     locaux (trackChanges)         │   │
│  │  - listes   │     │  2. Envoie au serveur             │   │
│  │  - points   │     │  3. Applique les changements      │   │
│  │  - contacts │     │     distants (applyChanges)       │   │
│  │  - messages │     │  4. Met à jour lastSyncAt         │   │
│  └─────────────┘     └──────────────┬───────────────────┘   │
│                                     │                        │
└─────────────────────────────────────┼────────────────────────┘
                                      │  HTTPS Bearer Token
                        ┌─────────────▼────────────┐
                        │     POST /mobile/sync      │
                        │  { changes: [], lastSyncAt }│
                        │                           │
                        │  Réponse :                │
                        │  { serverChanges: [],     │
                        │    newLastSyncAt: "..." }  │
                        └───────────────────────────┘
```

### Principe de delta sync

| Concept                  | Description                                            |
| ------------------------ | ------------------------------------------------------ |
| `lastSyncAt`             | Timestamp ISO 8601 de la dernière sync réussie         |
| `changes`                | Tableau des modifications locales à envoyer au serveur |
| `serverChanges`          | Modifications du serveur à appliquer localement        |
| **Stratégie de conflit** | Last-write-wins (timestamp le plus récent gagne)       |

### Rate limiting Sync

| Environnement | Limite       | Fenêtre    | Blocage    |
| ------------- | ------------ | ---------- | ---------- |
| Production    | 60 requêtes  | 15 minutes | 15 minutes |
| Développement | 600 requêtes | 15 minutes | —          |

---

## GET /mobile/sync

Retourne **l'intégralité des données** de l'utilisateur. À utiliser lors de la première synchronisation ou d'une réinstallation.

> ⚠️ Cette route retourne beaucoup de données. Préférer `POST /mobile/sync` (delta sync) pour les synchronisations régulières.

### Requête

```http
GET /api/v1/mobile/sync
Authorization: Bearer eyJhbGci...
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
X-App-Version: 2.1.0
```

### Réponse succès `200 OK`

```json
{
  "syncedAt": "2026-03-18T10:30:00.000Z",
  "data": {
    "fiches": [...],
    "listes": [...],
    "points": [...],
    "contacts": [...],
    "conversations": [...],
    "messages": [...],
    "notifications": [...]
  },
  "meta": {
    "totalItems": 1247,
    "userId": "64a1b2c3d4e5f6789012345"
  }
}
```

### Réponses d'erreur

| HTTP  | Code erreur           | Description              |
| ----- | --------------------- | ------------------------ |
| `401` | `UNAUTHORIZED`        | Token invalide ou expiré |
| `429` | `RATE_LIMIT_EXCEEDED` | Rate limit sync atteint  |

---

## POST /mobile/sync

**Synchronisation delta** : envoie les changements locaux et reçoit les changements serveur depuis `lastSyncAt`.

### Requête

```http
POST /api/v1/mobile/sync
Authorization: Bearer eyJhbGci...
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
X-App-Version: 2.1.0
Content-Type: application/json
```

```json
{
  "lastSyncAt": "2026-03-18T09:00:00.000Z",
  "changes": [
    {
      "entity": "fiches",
      "operation": "create",
      "data": {
        "localId": "local-uuid-1234",
        "title": "Nouvelle fiche",
        "content": "...",
        "updatedAt": "2026-03-18T10:15:00.000Z"
      }
    },
    {
      "entity": "points",
      "operation": "update",
      "data": {
        "id": "64a1b2c3d4e5f6789012345",
        "lat": 43.2965,
        "lng": 5.3698,
        "updatedAt": "2026-03-18T10:20:00.000Z"
      }
    },
    {
      "entity": "messages",
      "operation": "delete",
      "data": {
        "id": "64a1b2c3d4e5f6789054321",
        "deletedAt": "2026-03-18T10:25:00.000Z"
      }
    }
  ]
}
```

| Champ                 | Type              | Requis | Description                                        |
| --------------------- | ----------------- | ------ | -------------------------------------------------- |
| `lastSyncAt`          | string (ISO 8601) | ✅     | Timestamp de la dernière sync réussie              |
| `changes`             | array             | ✅     | Liste des changements locaux (peut être vide `[]`) |
| `changes[].entity`    | string            | ✅     | Type d'entité (`fiches`, `listes`, `points`, etc.) |
| `changes[].operation` | string            | ✅     | `create`, `update`, ou `delete`                    |
| `changes[].data`      | object            | ✅     | Données de l'entité modifiée                       |

### Réponse succès `200 OK`

```json
{
  "newLastSyncAt": "2026-03-18T10:30:00.000Z",
  "serverChanges": [
    {
      "entity": "contacts",
      "operation": "update",
      "data": {
        "id": "64a1b2c3d4e5f6789099999",
        "status": "accepted",
        "updatedAt": "2026-03-18T10:10:00.000Z"
      }
    }
  ],
  "conflicts": [
    {
      "entity": "fiches",
      "localData": {
        "id": "...",
        "title": "Version locale",
        "updatedAt": "2026-03-18T10:00:00.000Z"
      },
      "serverData": {
        "id": "...",
        "title": "Version serveur",
        "updatedAt": "2026-03-18T10:05:00.000Z"
      },
      "resolution": "server_wins",
      "reason": "Server timestamp is more recent"
    }
  ],
  "errors": [],
  "stats": {
    "applied": 3,
    "conflicts": 1,
    "errors": 0
  }
}
```

| Champ           | Description                                                     |
| --------------- | --------------------------------------------------------------- |
| `newLastSyncAt` | Nouveau timestamp à persister localement pour la prochaine sync |
| `serverChanges` | Modifications du serveur à appliquer localement                 |
| `conflicts`     | Conflits détectés et leur résolution                            |
| `errors`        | Erreurs sur certains items (ne bloque pas la sync globale)      |
| `stats`         | Statistiques de la synchronisation                              |

### Réponses d'erreur

| HTTP  | Code erreur           | Description                                  |
| ----- | --------------------- | -------------------------------------------- |
| `400` | `VALIDATION_ERROR`    | Format `lastSyncAt` invalide                 |
| `400` | `INVALID_ENTITY_TYPE` | Type d'entité inconnu dans `changes`         |
| `401` | `UNAUTHORIZED`        | Token invalide                               |
| `409` | `SYNC_IN_PROGRESS`    | Une sync est déjà en cours pour cet appareil |
| `429` | `RATE_LIMIT_EXCEEDED` | Rate limit sync atteint                      |

---

## GET /mobile/sync/status

Retourne l'état de synchronisation de l'appareil courant.

### Requête

```http
GET /api/v1/mobile/sync/status
Authorization: Bearer eyJhbGci...
X-Platform: android
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
X-App-Version: 2.1.0
```

### Réponse succès `200 OK`

```json
{
  "deviceId": "550e8400-e29b-41d4-a716-446655440000",
  "lastSyncAt": "2026-03-18T10:30:00.000Z",
  "isUpToDate": true,
  "pendingServerChanges": 0,
  "syncEnabled": true,
  "serverTime": "2026-03-18T10:31:05.000Z"
}
```

| Champ                  | Description                                                               |
| ---------------------- | ------------------------------------------------------------------------- |
| `lastSyncAt`           | Dernière synchronisation connue du serveur pour cet appareil              |
| `isUpToDate`           | `true` si aucune modification serveur en attente                          |
| `pendingServerChanges` | Nombre de changements serveur non encore synchronisés                     |
| `syncEnabled`          | `true` si la sync est activée pour ce compte                              |
| `serverTime`           | Heure serveur actuelle (utile pour corriger les dérives d'horloge locale) |

---

## Gestion des conflits

### Stratégie last-write-wins

Lorsqu'une même entité est modifiée à la fois localement et sur le serveur entre deux syncs :

```
Conflit détecté :
  - Version locale  : updatedAt = 10:00:00
  - Version serveur : updatedAt = 10:05:00

Résolution → server_wins (timestamp serveur plus récent)
```

### Cas de résolution possibles

| Résolution        | Condition                             | Description                                    |
| ----------------- | ------------------------------------- | ---------------------------------------------- |
| `server_wins`     | Timestamp serveur > local             | La version serveur remplace la version locale  |
| `client_wins`     | Timestamp local > serveur             | La version locale est appliquée sur le serveur |
| `merge`           | Champs différents non-conflictuels    | Fusion des deux versions                       |
| `manual_required` | Impossible à résoudre automatiquement | Renvoyé au client pour résolution manuelle     |

---

## Données synchronisées

| Entité          | Opérations             | Description                                              |
| --------------- | ---------------------- | -------------------------------------------------------- |
| `fiches`        | create, update, delete | Fiches de plongée                                        |
| `listes`        | create, update, delete | Listes personnalisées                                    |
| `points`        | create, update, delete | Points d'intérêt géolocalisés                            |
| `contacts`      | update                 | Statut des contacts (lecture seule pour les invitations) |
| `conversations` | create, update         | Conversations de messagerie                              |
| `messages`      | create, delete         | Messages dans les conversations                          |
| `notifications` | update                 | Marquage lu/non-lu                                       |

> ⚠️ Certaines entités (contacts, notifications) sont en **lecture seule** côté sync : les modifications doivent passer par leurs routes dédiées pour des raisons de sécurité et de validation métier.

---

_Voir aussi : [overview.md](overview.md) — [sync-service.md](../06_services/sync-service.md)_
