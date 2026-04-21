# API Listes — Documentation Mobile

**Base URL :** `/api/v1/lists`  
**Auth :** JWT requis sur toutes les routes (cookie ou header `Authorization: Bearer <token>`)

---

## Modèle de données

```typescript
{
  _id: string               // ObjectId MongoDB
  userId: string            // ObjectId de l'utilisateur propriétaire
  name: string              // Nom (requis, max 200 chars)
  description: string       // Description (optionnel, max 2000 chars, défaut "")
  points: string[]          // Tableau d'ObjectId de points (défaut [])
  color: string             // Couleur hex (défaut "#000000", max 20 chars)
  icon: string              // Identifiant icône (défaut "default-icon", max 100 chars)
  createdAt: string         // ISO 8601
  updatedAt: string         // ISO 8601
  version: number           // Défaut 1
}
```

---

## Endpoints

### Créer une liste

```
POST /api/v1/lists
```

**Body :**
```json
{
  "name": "Ma liste",
  "description": "Description optionnelle",
  "color": "#FF5733",
  "icon": "heart",
  "points": ["pointId1", "pointId2"]
}
```

| Champ | Type | Requis | Contraintes |
|-------|------|--------|-------------|
| name | string | Oui | max 200 chars |
| description | string | Non | max 2000 chars |
| color | string | Non | max 20 chars |
| icon | string | Non | max 100 chars |
| points | string[] | Non | array d'ObjectIds |

**Réponse 201 :**
```json
{
  "message": "Liste créée avec succès"
}
```

**Erreurs :**
| Code | Message |
|------|---------|
| 400 | `"L'identifiant utilisateur et le nom sont requis"` |
| 500 | `{ "success": false, "error": "Une erreur interne est survenue" }` |

---

### Récupérer toutes ses listes

```
GET /api/v1/lists?page=1&limit=50
```

**Query params :**
| Param | Type | Défaut | Contraintes |
|-------|------|--------|-------------|
| page | number | 1 | >= 1 |
| limit | number | 50 | entre 1 et 200 |

**Réponse 200 :**
```json
{
  "data": [
    {
      "_id": "...",
      "userId": "...",
      "name": "Ma liste",
      "description": "",
      "points": ["pointId1"],
      "color": "#000000",
      "icon": "default-icon",
      "createdAt": "2026-04-05T10:00:00.000Z",
      "updatedAt": "2026-04-05T10:00:00.000Z",
      "version": 1
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 3,
    "totalPages": 1
  }
}
```

---

### Récupérer une liste par ID

```
GET /api/v1/lists/:id
```

**Réponse 200 :** objet liste complet (voir modèle)

**Erreurs :**
| Code | Message |
|------|---------|
| 400 | `"Identifiant invalide"` |
| 404 | `"Liste non trouvée"` |

---

### Récupérer les listes d'un utilisateur

```
GET /api/v1/lists/user/:userId?page=1&limit=50
```

**Autorisation :** un utilisateur ne peut voir que ses propres listes (sauf admin).

**Réponse 200 :**
```json
{
  "success": true,
  "message": "5 listes récupérées sur 10",
  "data": [ /* objets liste */ ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 10,
    "totalPages": 2
  }
}
```

**Erreurs :**
| Code | Message |
|------|---------|
| 403 | `"Accès refusé. Vous ne pouvez consulter que vos propres listes."` |

---

### Modifier une liste

```
PUT /api/v1/lists/:id
```

**Body (tous les champs sont optionnels) :**
```json
{
  "name": "Nouveau nom",
  "description": "Nouvelle description",
  "color": "#00FF00",
  "icon": "star"
}
```

> **Attention :** si `points` est fourni, il **remplace** l'intégralité du tableau (pas d'append). Pour gérer les points individuellement, utiliser les endpoints dédiés ci-dessous.

**Réponse 200 :**
```json
{
  "message": "Liste mise à jour avec succès",
  "updatedList": { /* objet liste mis à jour */ }
}
```

**Erreurs :**
| Code | Message |
|------|---------|
| 404 | `"Liste non trouvée"` |

---

### Supprimer une liste

```
DELETE /api/v1/lists/:id
```

**Réponse 200 :**
```json
{
  "message": "Liste supprimée avec succès"
}
```

**Erreurs :**
| Code | Message |
|------|---------|
| 404 | `"Liste non trouvée"` |

---

## Gestion des points dans une liste

### Ajouter un point

```
POST /api/v1/lists/:listId/points/:pointId
```

**Réponse 200 :**
```json
{
  "success": true,
  "message": "Point ajouté à la liste avec succès",
  "listId": "...",
  "pointId": "..."
}
```

**Erreurs :**
| Code | Message |
|------|---------|
| 400 | `"Le point est déjà dans la liste ou l'ajout a échoué"` |
| 400 | `"Les identifiants de liste et de point sont requis"` |
| 404 | `"Le point spécifié n'existe pas"` |
| 404 | `"La liste spécifiée n'existe pas"` |

---

### Retirer un point

```
DELETE /api/v1/lists/:listId/points/:pointId
```

**Réponse 200 :**
```json
{
  "success": true,
  "message": "Point retiré de la liste avec succès",
  "listId": "...",
  "pointId": "..."
}
```

**Erreurs :**
| Code | Message |
|------|---------|
| 400 | `"Le point n'est pas dans la liste ou la suppression a échoué"` |
| 404 | `"La liste spécifiée n'existe pas"` |

---

### Récupérer les points d'une liste

```
GET /api/v1/lists/:listId/points?page=1&limit=50
```

**Réponse 200 :**
```json
{
  "success": true,
  "message": "5 points récupérés sur 10",
  "data": [ /* objets point */ ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 10,
    "totalPages": 2
  }
}
```

**Erreurs :**
| Code | Message |
|------|---------|
| 404 | `"La liste spécifiée n'existe pas"` |

---

### Récupérer les listes contenant un point

```
GET /api/v1/lists/points/:pointId/lists?page=1&limit=50
```

**Réponse 200 :**
```json
{
  "success": true,
  "message": "3 listes contiennent ce point sur 5",
  "data": [ /* objets liste */ ],
  "pagination": { ... }
}
```

**Erreurs :**
| Code | Message |
|------|---------|
| 404 | `"Le point spécifié n'existe pas"` |

---

### Ajouter plusieurs points en lot

```
POST /api/v1/lists/:listId/points/bulk/add
```

**Body :**
```json
{
  "pointIds": ["pointId1", "pointId2", "pointId3"]
}
```

**Réponse 200 :**
```json
{
  "success": true,
  "message": "3 points ajoutés, 0 déjà présents, 0 non trouvés",
  "results": {
    "added": ["pointId1", "pointId2", "pointId3"],
    "alreadyInList": [],
    "notFound": []
  }
}
```

**Erreurs :**
| Code | Message |
|------|---------|
| 400 | `"La liste des identifiants de points doit être un tableau non vide"` |
| 404 | `"La liste spécifiée n'existe pas"` |

---

### Retirer plusieurs points en lot

```
POST /api/v1/lists/:listId/points/bulk/remove
```

**Body :**
```json
{
  "pointIds": ["pointId1", "pointId2"]
}
```

**Réponse 200 :**
```json
{
  "success": true,
  "message": "2 points retirés, 0 n'étaient pas dans la liste",
  "results": {
    "removed": ["pointId1", "pointId2"],
    "notInList": []
  }
}
```

---

### Synchronisation manuelle

```
POST /api/v1/lists/sync
```

> Déclenche manuellement la persistance en base de données. À utiliser si nécessaire, par exemple avant un logout explicite.

**Réponse 200 :**
```json
{
  "success": true,
  "message": "Données synchronisées avec succès"
}
```

---

## Comportement de synchronisation

Les opérations **créer / modifier / supprimer une liste** sont synchronisées immédiatement en base.

Les opérations **ajouter / retirer des points** (unitaires et en lot) sont d'abord appliquées en mémoire et synchronisées en base lors du **logout** ou via l'endpoint `/sync`. Ce comportement est intentionnel pour des raisons de performance.

---

## Codes d'erreur communs

| Code | Signification |
|------|--------------|
| 400 | Paramètre manquant ou invalide |
| 401 | Non authentifié |
| 403 | Accès interdit (liste appartenant à un autre utilisateur) |
| 404 | Ressource inexistante |
| 500 | Erreur serveur interne |

**Format d'erreur 401 :**
```json
{
  "message": "Authentification requise. Aucun token fourni.",
  "code": "NO_TOKEN"
}
```

**Format d'erreur 500 :**
```json
{
  "success": false,
  "error": "Une erreur interne est survenue"
}
```
