# Routes partage de données

**Préfixe** : `/api/v1/share`

Ces routes permettent à un utilisateur de partager sélectivement des données (fiches, listes, etc.) avec d'autres utilisateurs, avec une durée de validité optionnelle.

Toutes les routes de ce groupe requièrent une authentification.

---

## Sommaire

- [POST /share](#post-share)
- [GET /share](#get-share)
- [GET /share/received](#get-sharereceived)
- [DELETE /share/:shareId](#delete-shareshareid)

---

## Endpoints

### POST /api/v1/share

**Description** : Crée un nouveau partage de données vers un utilisateur cible. Le partage peut être limité dans le temps via `expiresAt`. L'utilisateur cible reçoit une notification.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Corps de la requête

```json
{
  "targetUserId": "string (requis — ObjectId de l'utilisateur destinataire)",
  "dataType": "string (requis — type de données : \"fiche\", \"list\", etc.)",
  "dataId": "string (requis — ObjectId de la ressource à partager)",
  "expiresAt": "string (optionnel — date ISO 8601 d'expiration)"
}
```

#### Réponses

- **201 — Partage créé**

```json
{
  "message": "Partage créé",
  "share": {
    "id": "string",
    "targetUserId": "string",
    "dataType": "string",
    "dataId": "string",
    "expiresAt": "2026-04-18T10:00:00.000Z | null",
    "createdAt": "2026-03-18T10:00:00.000Z"
  }
}
```

- **400** : Champs obligatoires manquants — `{ "error": "...", "code": "MISSING_FIELDS" }`
- **400** : Type de données non supporté — `{ "error": "Type de données invalide", "code": "INVALID_DATA_TYPE" }`
- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : L'utilisateur n'est pas propriétaire de la ressource — `{ "error": "Accès interdit", "code": "FORBIDDEN" }`
- **404** : Utilisateur cible ou ressource introuvable — `{ "error": "...", "code": "USER_NOT_FOUND" | "RESOURCE_NOT_FOUND" }`
- **409** : Ce partage existe déjà — `{ "error": "Partage déjà existant", "code": "SHARE_ALREADY_EXISTS" }`

---

### GET /api/v1/share

**Description** : Retourne la liste des partages créés par l'utilisateur authentifié (partages émis). Inclut le statut de chaque partage (actif, expiré).

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Réponses

- **200 — Partages émis**

```json
{
  "shares": [
    {
      "id": "string",
      "targetUser": {
        "userId": "string",
        "username": "string"
      },
      "dataType": "string",
      "dataId": "string",
      "expiresAt": "2026-04-18T10:00:00.000Z | null",
      "isExpired": "boolean",
      "createdAt": "2026-03-18T10:00:00.000Z"
    }
  ],
  "total": "number"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`

---

### GET /api/v1/share/received

**Description** : Retourne les données partagées avec l'utilisateur authentifié par d'autres utilisateurs. Les partages expirés sont filtrés par défaut.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de requête (query)

| Paramètre        | Type    | Obligatoire | Description                                   |
| ---------------- | ------- | ----------- | --------------------------------------------- |
| `includeExpired` | boolean | Non         | Inclure les partages expirés (défaut : false) |

#### Réponses

- **200 — Données reçues**

```json
{
  "received": [
    {
      "id": "string",
      "fromUser": {
        "userId": "string",
        "username": "string"
      },
      "dataType": "string",
      "dataId": "string",
      "data": {},
      "expiresAt": "2026-04-18T10:00:00.000Z | null",
      "sharedAt": "2026-03-18T10:00:00.000Z"
    }
  ],
  "total": "number"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`

---

### DELETE /api/v1/share/:shareId

**Description** : Révoque un partage existant. Seul l'émetteur du partage peut le révoquer. L'utilisateur cible n'aura plus accès aux données partagées.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de chemin (path)

| Paramètre | Type              | Obligatoire | Description                       |
| --------- | ----------------- | ----------- | --------------------------------- |
| `shareId` | string (ObjectId) | Oui         | Identifiant du partage à révoquer |

#### Réponses

- **200 — Partage révoqué**

```json
{
  "message": "Partage révoqué"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : L'utilisateur n'est pas l'émetteur du partage — `{ "error": "Accès interdit", "code": "FORBIDDEN" }`
- **404** : Partage introuvable — `{ "error": "Partage introuvable", "code": "SHARE_NOT_FOUND" }`
