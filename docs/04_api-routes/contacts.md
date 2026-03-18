# Routes contacts

**Préfixe** : `/api/v1/contacts`

Ces routes permettent de gérer la liste de contacts d'un utilisateur : ajout via code de contact unique, suppression, et gestion des demandes d'ajout en attente.

Toutes les routes de ce groupe requièrent une authentification.

---

## Sommaire

- [GET /contacts](#get-contacts)
- [POST /contacts](#post-contacts)
- [DELETE /contacts/:contactId](#delete-contactscontactid)
- [GET /contacts/requests](#get-contactsrequests)
- [POST /contacts/requests/:requestId/accept](#post-contactsrequestsrequestidaccept)
- [POST /contacts/requests/:requestId/reject](#post-contactsrequestsrequestidreject)

---

## Endpoints

### GET /api/v1/contacts

**Description** : Retourne la liste complète des contacts de l'utilisateur authentifié, avec les informations publiques de chaque contact.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Réponses

- **200 — Liste des contacts**

```json
{
  "contacts": [
    {
      "id": "string",
      "userId": "string",
      "username": "string",
      "pseudo": "string | null",
      "addedAt": "2026-03-18T10:00:00.000Z"
    }
  ],
  "total": "number"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`

---

### POST /api/v1/contacts

**Description** : Envoie une demande d'ajout de contact à un utilisateur identifié par son code de contact unique (champ `contact_code` du profil). La demande doit être acceptée par le destinataire pour que le contact soit ajouté.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : `contactRequestLimiter`

#### Corps de la requête

```json
{
  "contact_code": "string (requis — code unique du profil cible)"
}
```

#### Réponses

- **201 — Demande envoyée**

```json
{
  "message": "Demande de contact envoyée",
  "requestId": "string"
}
```

- **400** : Code manquant — `{ "error": "contact_code requis", "code": "MISSING_FIELDS" }`
- **404** : Aucun utilisateur trouvé avec ce code — `{ "error": "Utilisateur introuvable", "code": "USER_NOT_FOUND" }`
- **409** : Contact déjà existant ou demande déjà envoyée — `{ "error": "...", "code": "ALREADY_CONTACT" | "REQUEST_ALREADY_SENT" }`
- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **429** : Rate limit — `{ "error": "Trop de demandes", "code": "RATE_LIMIT", "retryAfter": 60 }`

---

### DELETE /api/v1/contacts/:contactId

**Description** : Supprime un contact de la liste. L'opération est bilatérale : le contact est retiré de la liste des deux utilisateurs.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de chemin (path)

| Paramètre   | Type              | Obligatoire | Description                                 |
| ----------- | ----------------- | ----------- | ------------------------------------------- |
| `contactId` | string (ObjectId) | Oui         | Identifiant de l'entrée contact à supprimer |

#### Réponses

- **200 — Contact supprimé**

```json
{
  "message": "Contact supprimé"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : Tentative de suppression d'un contact appartenant à un autre utilisateur — `{ "error": "Accès interdit", "code": "FORBIDDEN" }`
- **404** : Contact introuvable — `{ "error": "Contact introuvable", "code": "CONTACT_NOT_FOUND" }`

---

### GET /api/v1/contacts/requests

**Description** : Retourne les demandes de contact en attente reçues par l'utilisateur authentifié.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Réponses

- **200 — Demandes en attente**

```json
{
  "requests": [
    {
      "id": "string",
      "from": {
        "userId": "string",
        "username": "string",
        "pseudo": "string | null"
      },
      "createdAt": "2026-03-18T10:00:00.000Z"
    }
  ],
  "total": "number"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`

---

### POST /api/v1/contacts/requests/:requestId/accept

**Description** : Accepte une demande de contact en attente. Les deux utilisateurs sont ajoutés mutuellement à leur liste de contacts.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de chemin (path)

| Paramètre   | Type              | Obligatoire | Description                          |
| ----------- | ----------------- | ----------- | ------------------------------------ |
| `requestId` | string (ObjectId) | Oui         | Identifiant de la demande de contact |

#### Réponses

- **200 — Demande acceptée**

```json
{
  "message": "Demande de contact acceptée",
  "contact": {
    "id": "string",
    "userId": "string",
    "username": "string"
  }
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : La demande ne vous est pas destinée — `{ "error": "Accès interdit", "code": "FORBIDDEN" }`
- **404** : Demande introuvable — `{ "error": "Demande introuvable", "code": "REQUEST_NOT_FOUND" }`

---

### POST /api/v1/contacts/requests/:requestId/reject

**Description** : Rejette une demande de contact en attente. L'émetteur n'est pas notifié du rejet.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de chemin (path)

| Paramètre   | Type              | Obligatoire | Description                          |
| ----------- | ----------------- | ----------- | ------------------------------------ |
| `requestId` | string (ObjectId) | Oui         | Identifiant de la demande de contact |

#### Réponses

- **200 — Demande rejetée**

```json
{
  "message": "Demande de contact rejetée"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : La demande ne vous est pas destinée — `{ "error": "Accès interdit", "code": "FORBIDDEN" }`
- **404** : Demande introuvable — `{ "error": "Demande introuvable", "code": "REQUEST_NOT_FOUND" }`
