# Routes fiches

**Préfixe** : `/api/v1/fiches`

Ces routes permettent de créer, consulter, modifier et supprimer des fiches de contenu personnelles. Les fiches sont privées par défaut et appartiennent à l'utilisateur qui les crée.

Toutes les routes de ce groupe requièrent une authentification.

---

## Sommaire

- [GET /fiches](#get-fiches)
- [POST /fiches](#post-fiches)
- [GET /fiches/:ficheId](#get-fichesficheid)
- [PUT /fiches/:ficheId](#put-fichesficheid)
- [DELETE /fiches/:ficheId](#delete-fichesficheid)

---

## Endpoints

### GET /api/v1/fiches

**Description** : Retourne la liste des fiches de l'utilisateur authentifié, avec support de la pagination et de la recherche plein texte sur le titre et le contenu.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de requête (query)

| Paramètre | Type   | Obligatoire | Description                                           |
| --------- | ------ | ----------- | ----------------------------------------------------- |
| `limit`   | number | Non         | Nombre de fiches à retourner (défaut : 20, max : 100) |
| `offset`  | number | Non         | Décalage pour la pagination (défaut : 0)              |
| `search`  | string | Non         | Recherche plein texte dans le titre et le contenu     |

#### Réponses

- **200 — Liste des fiches**

```json
{
  "fiches": [
    {
      "id": "string",
      "title": "string",
      "content": "string",
      "tags": ["string"],
      "createdAt": "2026-03-18T10:00:00.000Z",
      "updatedAt": "2026-03-18T10:00:00.000Z"
    }
  ],
  "total": "number",
  "hasMore": "boolean"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`

---

### POST /api/v1/fiches

**Description** : Crée une nouvelle fiche pour l'utilisateur authentifié. Les tags permettent de catégoriser les fiches.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : `ficheLimiter`

#### Corps de la requête

```json
{
  "title": "string (requis)",
  "content": "string (requis)",
  "tags": ["string (optionnel)"]
}
```

#### Réponses

- **201 — Fiche créée**

```json
{
  "message": "Fiche créée",
  "fiche": {
    "id": "string",
    "title": "string",
    "content": "string",
    "tags": ["string"],
    "createdAt": "2026-03-18T10:00:00.000Z"
  }
}
```

- **400** : Champs obligatoires manquants — `{ "error": "Titre et contenu requis", "code": "MISSING_FIELDS" }`
- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **429** : Rate limit — `{ "error": "Trop de fiches créées", "code": "RATE_LIMIT", "retryAfter": 60 }`

---

### GET /api/v1/fiches/:ficheId

**Description** : Retourne le contenu complet d'une fiche spécifique. L'utilisateur doit être le propriétaire de la fiche.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de chemin (path)

| Paramètre | Type              | Obligatoire | Description             |
| --------- | ----------------- | ----------- | ----------------------- |
| `ficheId` | string (ObjectId) | Oui         | Identifiant de la fiche |

#### Réponses

- **200 — Fiche retournée**

```json
{
  "id": "string",
  "title": "string",
  "content": "string",
  "tags": ["string"],
  "ownerId": "string",
  "createdAt": "2026-03-18T10:00:00.000Z",
  "updatedAt": "2026-03-18T10:00:00.000Z"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : L'utilisateur n'est pas propriétaire de la fiche — `{ "error": "Accès interdit", "code": "FORBIDDEN" }`
- **404** : Fiche introuvable — `{ "error": "Fiche introuvable", "code": "FICHE_NOT_FOUND" }`

---

### PUT /api/v1/fiches/:ficheId

**Description** : Met à jour une fiche existante. Seuls les champs fournis sont mis à jour (PATCH sémantique).

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de chemin (path)

| Paramètre | Type              | Obligatoire | Description             |
| --------- | ----------------- | ----------- | ----------------------- |
| `ficheId` | string (ObjectId) | Oui         | Identifiant de la fiche |

#### Corps de la requête

```json
{
  "title": "string (optionnel)",
  "content": "string (optionnel)",
  "tags": ["string (optionnel)"]
}
```

#### Réponses

- **200 — Fiche mise à jour**

```json
{
  "message": "Fiche mise à jour",
  "fiche": {
    "id": "string",
    "title": "string",
    "content": "string",
    "tags": ["string"],
    "updatedAt": "2026-03-18T10:00:00.000Z"
  }
}
```

- **400** : Données invalides — `{ "error": "Données invalides", "code": "INVALID_DATA" }`
- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : L'utilisateur n'est pas propriétaire de la fiche — `{ "error": "Accès interdit", "code": "FORBIDDEN" }`
- **404** : Fiche introuvable — `{ "error": "Fiche introuvable", "code": "FICHE_NOT_FOUND" }`

---

### DELETE /api/v1/fiches/:ficheId

**Description** : Supprime définitivement une fiche. Seul le propriétaire peut effectuer cette opération.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de chemin (path)

| Paramètre | Type              | Obligatoire | Description             |
| --------- | ----------------- | ----------- | ----------------------- |
| `ficheId` | string (ObjectId) | Oui         | Identifiant de la fiche |

#### Réponses

- **200 — Fiche supprimée**

```json
{
  "message": "Fiche supprimée"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : L'utilisateur n'est pas propriétaire de la fiche — `{ "error": "Accès interdit", "code": "FORBIDDEN" }`
- **404** : Fiche introuvable — `{ "error": "Fiche introuvable", "code": "FICHE_NOT_FOUND" }`
