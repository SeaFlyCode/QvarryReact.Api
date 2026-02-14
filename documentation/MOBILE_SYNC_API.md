# 📱 API de Synchronisation Mobile Qvarry

## Vue d'ensemble

L'API de synchronisation mobile permet aux applications iOS/Android de :
- Télécharger toutes les données lors de la première connexion
- Synchroniser les changements de manière incrémentale
- Travailler en mode offline et pousser les modifications au retour du réseau

---

## Architecture Offline-First

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FLUX DE SYNCHRONISATION                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. PREMIÈRE CONNEXION                                                       │
│     App → POST /api/mobile/auth/login → { accessToken, refreshToken }       │
│     App → GET /api/mobile/sync (sans param) → Toutes les données            │
│     App → Stocke en SQLite/Realm local                                       │
│                                                                              │
│  2. UTILISATION NORMALE (avec réseau)                                        │
│     App → GET /api/mobile/sync?since=<lastSync> → Changements               │
│     App → Met à jour SQLite local                                            │
│                                                                              │
│  3. MODE OFFLINE (sous terre)                                                │
│     App → Lit/écrit dans SQLite local                                        │
│     App → Queue les modifications avec flag "pendingSync"                    │
│                                                                              │
│  4. RETOUR EN LIGNE                                                          │
│     App → POST /api/mobile/sync → Push des modifications locales            │
│     App → GET /api/mobile/sync?since=<lastSync> → Récupère changements     │
│     App → Résout les conflits si nécessaire                                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Endpoints

### 🔐 Authentification (prérequis)

Tous les endpoints de sync nécessitent :
- Header `Authorization: Bearer <accessToken>`
- Header `X-Platform: ios` ou `X-Platform: android`
- Header `X-Device-ID: <uuid-appareil>`

---

### GET /api/mobile/sync

**Synchronisation incrémentale ou complète**

#### Paramètres Query

| Param | Type | Obligatoire | Description |
|-------|------|-------------|-------------|
| `since` | ISO 8601 string | Non | Date de dernière sync. Si absent = sync complète |

#### Exemple requête (sync incrémentale)
```http
GET /api/mobile/sync?since=2026-02-10T15:30:00.000Z
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
```

#### Exemple requête (sync complète)
```http
GET /api/mobile/sync
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
```

#### Réponse 200
```json
{
  "success": true,
  "points": {
    "created": [
      {
        "_id": "65abc123...",
        "name": "Point d'entrée carrière",
        "description": "Accès principal",
        "location": {
          "type": "Point",
          "coordinates": [2.3522, 48.8566]
        },
        "ficheId": "65xyz789...",
        "accessType": "vertical",
        "createdAt": "2026-02-10T10:00:00.000Z",
        "updatedAt": "2026-02-10T10:00:00.000Z"
      }
    ],
    "updated": [],
    "deleted": ["65old456..."]
  },
  "fiches": {
    "created": [],
    "updated": [
      {
        "_id": "65xyz789...",
        "name": "Carrière de Montmartre",
        "ville": "Paris",
        "type": "Carrière",
        "etat": "Exploré",
        "difficulte_acces": "Moyen",
        "risque_oxygene": "Faible",
        "acces_souterrain": "Puits",
        "praticite_souterrain": "Bonne",
        "etat_general": "Stable",
        "commentaire": "Galeries bien conservées",
        "points_ids": ["65abc123..."],
        "date_creation": "2026-01-15T08:00:00.000Z",
        "date_modification": "2026-02-11T09:30:00.000Z"
      }
    ],
    "deleted": []
  },
  "lists": {
    "created": [],
    "updated": [],
    "deleted": []
  },
  "lastSyncDate": "2026-02-11T10:00:00.000Z",
  "totalChanges": 3,
  "syncDuration": 156
}
```

#### Codes d'erreur

| Code | Message | Description |
|------|---------|-------------|
| 400 | `INVALID_DATE_FORMAT` | Format de date invalide |
| 401 | `UNAUTHORIZED` | Token manquant ou invalide |
| 401 | `SESSION_EXPIRED` | Token expiré, refresh nécessaire |
| 500 | `SYNC_ERROR` | Erreur serveur |

---

### POST /api/mobile/sync

**Push des modifications effectuées en mode offline**

#### Body

```json
{
  "changes": [
    {
      "type": "point",
      "action": "create",
      "localId": "local-uuid-1",
      "data": {
        "name": "Nouveau point",
        "description": "Description",
        "location": {
          "type": "Point",
          "coordinates": [2.3522, 48.8566]
        },
        "accessType": "horizontal"
      },
      "timestamp": "2026-02-11T09:30:00.000Z"
    },
    {
      "type": "fiche",
      "action": "update",
      "id": "65xyz789...",
      "data": {
        "commentaire": "Mise à jour du commentaire"
      },
      "timestamp": "2026-02-11T09:35:00.000Z"
    },
    {
      "type": "point",
      "action": "delete",
      "id": "65old456...",
      "timestamp": "2026-02-11T09:40:00.000Z"
    }
  ]
}
```

#### Champs LocalChange

| Champ | Type | Obligatoire | Description |
|-------|------|-------------|-------------|
| `type` | `'point' \| 'fiche' \| 'list'` | Oui | Type d'élément |
| `action` | `'create' \| 'update' \| 'delete'` | Oui | Action à effectuer |
| `id` | string | Pour update/delete | ID serveur de l'élément |
| `localId` | string | Pour create | ID local temporaire |
| `data` | object | Pour create/update | Données déchiffrées |
| `timestamp` | ISO 8601 | Oui | Date de modification locale |

#### Réponse 200

```json
{
  "success": true,
  "synced": [
    {
      "type": "point",
      "action": "create",
      "localId": "local-uuid-1",
      "id": "65new123...",
      "timestamp": "2026-02-11T09:30:00.000Z"
    },
    {
      "type": "fiche",
      "action": "update",
      "id": "65xyz789...",
      "timestamp": "2026-02-11T09:35:00.000Z"
    }
  ],
  "conflicts": [],
  "errors": [
    {
      "change": { "type": "point", "action": "delete", "id": "65old456..." },
      "error": "Point 65old456... non trouvé"
    }
  ],
  "idMapping": {
    "local-uuid-1": "65new123..."
  },
  "syncDuration": 234
}
```

#### Codes d'erreur

| Code | Message | Description |
|------|---------|-------------|
| 400 | `INVALID_CHANGES_FORMAT` | Le champ changes n'est pas un tableau |
| 400 | `INVALID_CHANGE_TYPE` | Type invalide |
| 400 | `INVALID_CHANGE_ACTION` | Action invalide |
| 400 | `MISSING_ID` | ID manquant pour update/delete |
| 400 | `MISSING_DATA` | Data manquant pour create/update |
| 401 | `UNAUTHORIZED` | Token invalide |
| 500 | `SYNC_PUSH_ERROR` | Erreur serveur |

---

### GET /api/mobile/sync/status

**Vérifie rapidement s'il y a des changements disponibles**

Utile pour afficher un badge "X mises à jour disponibles" sans télécharger les données.

#### Paramètres Query

| Param | Type | Obligatoire | Description |
|-------|------|-------------|-------------|
| `since` | ISO 8601 string | **Oui** | Date de dernière sync |

#### Exemple requête
```http
GET /api/mobile/sync/status?since=2026-02-10T15:30:00.000Z
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
```

#### Réponse 200
```json
{
  "success": true,
  "hasChanges": true,
  "changeCount": 5,
  "lastSyncDate": "2026-02-11T10:00:00.000Z",
  "breakdown": {
    "points": 2,
    "fiches": 3,
    "lists": 0
  }
}
```

---

### GET /api/mobile/data/full

**Téléchargement complet forcé**

Identique à `GET /api/mobile/sync` sans paramètre `since`. À utiliser pour :
- Réinitialisation des données locales
- Récupération après corruption
- Debug

---

## Implémentation côté mobile

### Exemple React Native (TypeScript)

```typescript
// types.ts
interface SyncResult {
  points: { created: Point[]; updated: Point[]; deleted: string[] };
  fiches: { created: Fiche[]; updated: Fiche[]; deleted: string[] };
  lists: { created: List[]; updated: List[]; deleted: string[] };
  lastSyncDate: string;
  totalChanges: number;
}

interface LocalChange {
  type: 'point' | 'fiche' | 'list';
  action: 'create' | 'update' | 'delete';
  id?: string;
  localId?: string;
  data?: any;
  timestamp: string;
}

// syncService.ts
class SyncService {
  private baseUrl = 'https://api.qvarry.fr/api/mobile';
  private lastSyncDate: string | null = null;

  async sync(): Promise<void> {
    // 1. Push des modifications locales
    const pendingChanges = await this.getPendingChanges();
    if (pendingChanges.length > 0) {
      await this.pushChanges(pendingChanges);
    }

    // 2. Pull des changements serveur
    const url = this.lastSyncDate 
      ? `${this.baseUrl}/sync?since=${this.lastSyncDate}`
      : `${this.baseUrl}/sync`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${await this.getAccessToken()}`,
        'X-Platform': Platform.OS,
        'X-Device-ID': await this.getDeviceId()
      }
    });

    const data: SyncResult = await response.json();
    
    // 3. Appliquer les changements localement
    await this.applyChanges(data);
    
    // 4. Sauvegarder la date de sync
    this.lastSyncDate = data.lastSyncDate;
    await AsyncStorage.setItem('lastSyncDate', this.lastSyncDate);
  }

  private async pushChanges(changes: LocalChange[]): Promise<void> {
    const response = await fetch(`${this.baseUrl}/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${await this.getAccessToken()}`,
        'X-Platform': Platform.OS,
        'X-Device-ID': await this.getDeviceId()
      },
      body: JSON.stringify({ changes })
    });

    const result = await response.json();
    
    // Mettre à jour les IDs locaux avec les IDs serveur
    for (const [localId, serverId] of Object.entries(result.idMapping)) {
      await this.updateLocalId(localId, serverId as string);
    }

    // Marquer les changements comme synchronisés
    await this.markAsSynced(result.synced);
  }
}
```

### Stockage local recommandé

| Solution | Avantages | Inconvénients |
|----------|-----------|---------------|
| **SQLite** | Standard, performant | Config manuelle |
| **Realm** | Simple, réactif | Taille bundle |
| **WatermelonDB** | Sync intégrée | Complexité |
| **MMKV** | Ultra rapide | Pas de requêtes |

---

## Gestion des conflits

Actuellement : **Last-Write-Wins** (le serveur accepte la dernière modification)

Futur : Retour des conflits pour résolution manuelle :
```json
{
  "conflicts": [
    {
      "type": "fiche",
      "id": "65xyz789...",
      "localVersion": { "commentaire": "Version locale" },
      "serverVersion": { "commentaire": "Version serveur" },
      "resolution": "manual"
    }
  ]
}
```

---

## Bonnes pratiques

1. **Toujours synchroniser au lancement** de l'app si réseau disponible
2. **Queue les modifications offline** avec timestamp précis
3. **Gérer les erreurs réseau** gracieusement (retry avec backoff)
4. **Afficher l'état de sync** à l'utilisateur (dernière sync, en cours...)
5. **Permettre la sync manuelle** (pull-to-refresh)
6. **Nettoyer les données locales** périodiquement (éléments supprimés)

