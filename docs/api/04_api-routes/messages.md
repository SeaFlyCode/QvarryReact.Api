# Routes messages

**Préfixe** : `/api/v1/messages`

Ces routes gèrent l'envoi, la consultation, la modification et la suppression de messages au sein d'une conversation. Une connexion WebSocket est également disponible pour la messagerie temps réel.

Toutes les routes HTTP de ce groupe requièrent une authentification. L'utilisateur doit être membre de la conversation concernée.

---

## Sommaire

- [GET /messages/:conversationId](#get-messagesconversationid)
- [POST /messages/:conversationId](#post-messagesconversationid)
- [PUT /messages/:messageId](#put-messagesmessageid)
- [DELETE /messages/:messageId](#delete-messagesmessageid)
- [PUT /messages/:messageId/read](#put-messagesmessageidread)
- [WebSocket — Messagerie temps réel](#websocket--messagerie-temps-réel)

---

## Endpoints

### GET /api/v1/messages/:conversationId

**Description** : Retourne les messages d'une conversation avec pagination. Les messages sont triés du plus récent au plus ancien. Supporte la pagination par curseur via le paramètre `before`.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de chemin (path)

| Paramètre        | Type              | Obligatoire | Description                    |
| ---------------- | ----------------- | ----------- | ------------------------------ |
| `conversationId` | string (ObjectId) | Oui         | Identifiant de la conversation |

#### Paramètres de requête (query)

| Paramètre | Type              | Obligatoire | Description                                                                       |
| --------- | ----------------- | ----------- | --------------------------------------------------------------------------------- |
| `limit`   | number            | Non         | Nombre de messages à retourner (défaut : 50, max : 100)                           |
| `offset`  | number            | Non         | Décalage pour la pagination (défaut : 0)                                          |
| `before`  | string (ISO 8601) | Non         | Retourne uniquement les messages antérieurs à cette date (pagination par curseur) |

#### Réponses

- **200 — Messages retournés**

```json
{
  "messages": [
    {
      "id": "string",
      "conversationId": "string",
      "senderId": "string",
      "senderUsername": "string",
      "content": "string",
      "type": "text | image",
      "edited": "boolean",
      "readBy": ["string (userId)"],
      "createdAt": "2026-03-18T10:00:00.000Z",
      "updatedAt": "2026-03-18T10:00:00.000Z"
    }
  ],
  "total": "number",
  "hasMore": "boolean"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : L'utilisateur n'est pas membre de cette conversation — `{ "error": "Accès interdit", "code": "FORBIDDEN" }`
- **404** : Conversation introuvable — `{ "error": "Conversation introuvable", "code": "CONVERSATION_NOT_FOUND" }`

---

### POST /api/v1/messages/:conversationId

**Description** : Envoie un nouveau message dans une conversation. L'événement est diffusé en temps réel via WebSocket aux autres membres actifs.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : `messageLimiter`

#### Paramètres de chemin (path)

| Paramètre        | Type              | Obligatoire | Description                    |
| ---------------- | ----------------- | ----------- | ------------------------------ |
| `conversationId` | string (ObjectId) | Oui         | Identifiant de la conversation |

#### Corps de la requête

```json
{
  "content": "string (requis — contenu du message)",
  "type": "\"text\" | \"image\" (optionnel — défaut : \"text\")"
}
```

#### Réponses

- **201 — Message envoyé**

```json
{
  "message": {
    "id": "string",
    "conversationId": "string",
    "senderId": "string",
    "content": "string",
    "type": "text | image",
    "edited": false,
    "readBy": [],
    "createdAt": "2026-03-18T10:00:00.000Z"
  }
}
```

- **400** : Contenu manquant ou vide — `{ "error": "Le contenu du message est requis", "code": "MISSING_CONTENT" }`
- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : L'utilisateur n'est pas membre de cette conversation — `{ "error": "Accès interdit", "code": "FORBIDDEN" }`
- **404** : Conversation introuvable — `{ "error": "Conversation introuvable", "code": "CONVERSATION_NOT_FOUND" }`
- **429** : Rate limit — `{ "error": "Trop de messages", "code": "RATE_LIMIT", "retryAfter": 10 }`

---

### PUT /api/v1/messages/:messageId

**Description** : Modifie le contenu d'un message existant. Seul l'auteur du message peut le modifier. Le message est marqué comme `edited: true`.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de chemin (path)

| Paramètre   | Type              | Obligatoire | Description            |
| ----------- | ----------------- | ----------- | ---------------------- |
| `messageId` | string (ObjectId) | Oui         | Identifiant du message |

#### Corps de la requête

```json
{
  "content": "string (requis — nouveau contenu)"
}
```

#### Réponses

- **200 — Message modifié**

```json
{
  "message": {
    "id": "string",
    "content": "string",
    "edited": true,
    "updatedAt": "2026-03-18T10:00:00.000Z"
  }
}
```

- **400** : Contenu manquant — `{ "error": "Le contenu est requis", "code": "MISSING_CONTENT" }`
- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : L'utilisateur n'est pas l'auteur du message — `{ "error": "Accès interdit", "code": "FORBIDDEN" }`
- **404** : Message introuvable — `{ "error": "Message introuvable", "code": "MESSAGE_NOT_FOUND" }`

---

### DELETE /api/v1/messages/:messageId

**Description** : Supprime un message. Seul l'auteur du message ou un administrateur peut le supprimer. La suppression est propagée en temps réel via WebSocket.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de chemin (path)

| Paramètre   | Type              | Obligatoire | Description            |
| ----------- | ----------------- | ----------- | ---------------------- |
| `messageId` | string (ObjectId) | Oui         | Identifiant du message |

#### Réponses

- **200 — Message supprimé**

```json
{
  "message": "Message supprimé"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : Droits insuffisants — `{ "error": "Accès interdit", "code": "FORBIDDEN" }`
- **404** : Message introuvable — `{ "error": "Message introuvable", "code": "MESSAGE_NOT_FOUND" }`

---

### PUT /api/v1/messages/:messageId/read

**Description** : Marque un message comme lu par l'utilisateur authentifié. Ajoute l'ID de l'utilisateur au tableau `readBy` du message.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de chemin (path)

| Paramètre   | Type              | Obligatoire | Description            |
| ----------- | ----------------- | ----------- | ---------------------- |
| `messageId` | string (ObjectId) | Oui         | Identifiant du message |

#### Réponses

- **200 — Marqué comme lu**

```json
{
  "message": "Message marqué comme lu"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : L'utilisateur n'est pas membre de la conversation — `{ "error": "Accès interdit", "code": "FORBIDDEN" }`
- **404** : Message introuvable — `{ "error": "Message introuvable", "code": "MESSAGE_NOT_FOUND" }`

---

## WebSocket — Messagerie temps réel

### Connexion

```
ws://host/ws/messages?conversationId={conversationId}&token={wsToken}
```

| Paramètre        | Type   | Obligatoire | Description                                                |
| ---------------- | ------ | ----------- | ---------------------------------------------------------- |
| `conversationId` | string | Oui         | Identifiant de la conversation à rejoindre                 |
| `token`          | string | Oui         | Token WebSocket temporaire obtenu via `GET /auth/ws-token` |

### Événements émis par le serveur

| Événement            | Description                          | Payload                             |
| -------------------- | ------------------------------------ | ----------------------------------- |
| `message:new`        | Nouveau message reçu                 | Objet message complet               |
| `message:edited`     | Message modifié                      | `{ messageId, content, updatedAt }` |
| `message:deleted`    | Message supprimé                     | `{ messageId }`                     |
| `message:read`       | Message lu par un participant        | `{ messageId, userId }`             |
| `participant:typing` | Un participant est en train d'écrire | `{ userId, username }`              |

### Événements envoyés par le client

| Événement      | Description                                     | Payload              |
| -------------- | ----------------------------------------------- | -------------------- |
| `typing:start` | Indique que l'utilisateur est en train d'écrire | `{ conversationId }` |
| `typing:stop`  | Indique que l'utilisateur a arrêté d'écrire     | `{ conversationId }` |

⚠️ **Le token WebSocket a une durée de vie courte (~30 secondes). Il doit être obtenu juste avant d'ouvrir la connexion.**
