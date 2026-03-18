# Routes listes

**Préfixe** : `/api/v1/lists`

Ces routes permettent de gérer des listes avec leurs items. Une liste appartient à l'utilisateur qui la crée et lui est privée par défaut.

Toutes les routes de ce groupe requièrent une authentification.

---

## Sommaire

- [GET /lists](#get-lists)
- [POST /lists](#post-lists)
- [GET /lists/:listId](#get-listslistid)
- [PUT /lists/:listId](#put-listslistid)
- [DELETE /lists/:listId](#delete-listslistid)
- [POST /lists/:listId/items](#post-listslistiditems)
- [DELETE /lists/:listId/items/:itemId](#delete-listslistiditemsitemid)

---

## Endpoints

### GET /api/v1/lists

**Description** : Retourne toutes les listes de l'utilisateur authentifié, sans le détail des items (pour les performances). Utilisez `GET /lists/:listId` pour obtenir le contenu complet d'une liste.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Réponses

- **200 — Liste des listes**

```json
{
  "lists": [
    {
      "id": "string",
      "name": "string",
      "itemCount": "number",
      "createdAt": "2026-03-18T10:00:00.000Z",
      "updatedAt": "2026-03-18T10:00:00.000Z"
    }
  ],
  "total": "number"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`

---

### POST /api/v1/lists

**Description** : Crée une nouvelle liste pour l'utilisateur authentifié. Des items peuvent être ajoutés directement à la création.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Corps de la requête

```json
{
  "name": "string (requis)",
  "items": [
    {
      "label": "string (requis)",
      "checked": "boolean (optionnel — défaut : false)"
    }
  ]
}
```

#### Réponses

- **201 — Liste créée**

```json
{
  "message": "Liste créée",
  "list": {
    "id": "string",
    "name": "string",
    "items": [
      {
        "id": "string",
        "label": "string",
        "checked": false
      }
    ],
    "createdAt": "2026-03-18T10:00:00.000Z"
  }
}
```

- **400** : Nom manquant — `{ "error": "Le nom de la liste est requis", "code": "MISSING_FIELDS" }`
- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`

---

### GET /api/v1/lists/:listId

**Description** : Retourne le contenu complet d'une liste, incluant tous ses items avec leur état (coché / non coché).

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de chemin (path)

| Paramètre | Type              | Obligatoire | Description             |
| --------- | ----------------- | ----------- | ----------------------- |
| `listId`  | string (ObjectId) | Oui         | Identifiant de la liste |

#### Réponses

- **200 — Détails de la liste**

```json
{
  "id": "string",
  "name": "string",
  "ownerId": "string",
  "items": [
    {
      "id": "string",
      "label": "string",
      "checked": "boolean",
      "createdAt": "2026-03-18T10:00:00.000Z"
    }
  ],
  "createdAt": "2026-03-18T10:00:00.000Z",
  "updatedAt": "2026-03-18T10:00:00.000Z"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : L'utilisateur n'est pas propriétaire de la liste — `{ "error": "Accès interdit", "code": "FORBIDDEN" }`
- **404** : Liste introuvable — `{ "error": "Liste introuvable", "code": "LIST_NOT_FOUND" }`

---

### PUT /api/v1/lists/:listId

**Description** : Met à jour les propriétés d'une liste (actuellement : son nom). Seuls les champs fournis sont mis à jour.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de chemin (path)

| Paramètre | Type              | Obligatoire | Description             |
| --------- | ----------------- | ----------- | ----------------------- |
| `listId`  | string (ObjectId) | Oui         | Identifiant de la liste |

#### Corps de la requête

```json
{
  "name": "string (optionnel)"
}
```

#### Réponses

- **200 — Liste mise à jour**

```json
{
  "message": "Liste mise à jour",
  "list": {
    "id": "string",
    "name": "string",
    "updatedAt": "2026-03-18T10:00:00.000Z"
  }
}
```

- **400** : Données invalides — `{ "error": "Données invalides", "code": "INVALID_DATA" }`
- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : L'utilisateur n'est pas propriétaire de la liste — `{ "error": "Accès interdit", "code": "FORBIDDEN" }`
- **404** : Liste introuvable — `{ "error": "Liste introuvable", "code": "LIST_NOT_FOUND" }`

---

### DELETE /api/v1/lists/:listId

**Description** : Supprime définitivement une liste et tous ses items.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de chemin (path)

| Paramètre | Type              | Obligatoire | Description             |
| --------- | ----------------- | ----------- | ----------------------- |
| `listId`  | string (ObjectId) | Oui         | Identifiant de la liste |

#### Réponses

- **200 — Liste supprimée**

```json
{
  "message": "Liste supprimée"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : L'utilisateur n'est pas propriétaire de la liste — `{ "error": "Accès interdit", "code": "FORBIDDEN" }`
- **404** : Liste introuvable — `{ "error": "Liste introuvable", "code": "LIST_NOT_FOUND" }`

---

### POST /api/v1/lists/:listId/items

**Description** : Ajoute un nouvel item à une liste existante.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de chemin (path)

| Paramètre | Type              | Obligatoire | Description             |
| --------- | ----------------- | ----------- | ----------------------- |
| `listId`  | string (ObjectId) | Oui         | Identifiant de la liste |

#### Corps de la requête

```json
{
  "label": "string (requis)",
  "checked": "boolean (optionnel — défaut : false)"
}
```

#### Réponses

- **201 — Item ajouté**

```json
{
  "message": "Item ajouté",
  "item": {
    "id": "string",
    "label": "string",
    "checked": false,
    "createdAt": "2026-03-18T10:00:00.000Z"
  }
}
```

- **400** : Label manquant — `{ "error": "Le libellé de l'item est requis", "code": "MISSING_FIELDS" }`
- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : L'utilisateur n'est pas propriétaire de la liste — `{ "error": "Accès interdit", "code": "FORBIDDEN" }`
- **404** : Liste introuvable — `{ "error": "Liste introuvable", "code": "LIST_NOT_FOUND" }`

---

### DELETE /api/v1/lists/:listId/items/:itemId

**Description** : Supprime un item spécifique d'une liste.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de chemin (path)

| Paramètre | Type              | Obligatoire | Description             |
| --------- | ----------------- | ----------- | ----------------------- |
| `listId`  | string (ObjectId) | Oui         | Identifiant de la liste |
| `itemId`  | string (ObjectId) | Oui         | Identifiant de l'item   |

#### Réponses

- **200 — Item supprimé**

```json
{
  "message": "Item supprimé"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : L'utilisateur n'est pas propriétaire de la liste — `{ "error": "Accès interdit", "code": "FORBIDDEN" }`
- **404** : Liste ou item introuvable — `{ "error": "...", "code": "LIST_NOT_FOUND" | "ITEM_NOT_FOUND" }`
