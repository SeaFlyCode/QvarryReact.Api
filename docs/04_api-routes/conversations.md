# Routes conversations

**Préfixe** : `/api/v1/conversations`

Ces routes gèrent la création, la consultation et la gestion des conversations entre utilisateurs. Une conversation peut être privée (2 participants) ou de groupe (plusieurs participants).

Toutes les routes de ce groupe requièrent une authentification.

---

## Sommaire

- [GET /conversations](#get-conversations)
- [POST /conversations](#post-conversations)
- [GET /conversations/:conversationId](#get-conversationsconversationid)
- [DELETE /conversations/:conversationId](#delete-conversationsconversationid)
- [POST /conversations/:conversationId/participants](#post-conversationsconversationidparticipants)
- [DELETE /conversations/:conversationId/participants/:userId](#delete-conversationsconversationidparticipantsuserid)

---

## Endpoints

### GET /api/v1/conversations

**Description** : Retourne la liste de toutes les conversations de l'utilisateur authentifié, triées par date du dernier message (plus récentes en premier). Inclut un aperçu du dernier message et le nombre de messages non lus.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Réponses

- **200 — Liste des conversations**

```json
{
  "conversations": [
    {
      "id": "string",
      "name": "string | null",
      "isGroup": "boolean",
      "participants": [
        {
          "userId": "string",
          "username": "string"
        }
      ],
      "lastMessage": {
        "content": "string",
        "sentAt": "2026-03-18T10:00:00.000Z",
        "senderId": "string"
      },
      "unreadCount": "number",
      "updatedAt": "2026-03-18T10:00:00.000Z"
    }
  ],
  "total": "number"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`

---

### POST /api/v1/conversations

**Description** : Crée une nouvelle conversation avec un ou plusieurs participants. Si une conversation privée (1 contre 1) existe déjà entre les deux utilisateurs, retourne la conversation existante plutôt que d'en créer une nouvelle.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Corps de la requête

```json
{
  "participantIds": ["string (ObjectId)", "..."],
  "name": "string (optionnel — nom du groupe si plusieurs participants)"
}
```

#### Réponses

- **201 — Conversation créée**

```json
{
  "message": "Conversation créée",
  "conversation": {
    "id": "string",
    "name": "string | null",
    "isGroup": "boolean",
    "participants": [
      {
        "userId": "string",
        "username": "string"
      }
    ],
    "createdAt": "2026-03-18T10:00:00.000Z"
  }
}
```

- **200 — Conversation existante retournée** (cas d'une conversation privée déjà existante)

```json
{
  "conversation": { "id": "string", "..." }
}
```

- **400** : `participantIds` manquant ou vide — `{ "error": "Au moins un participant requis", "code": "MISSING_PARTICIPANTS" }`
- **400** : Participant inconnu ou non contact — `{ "error": "...", "code": "INVALID_PARTICIPANT" }`
- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`

---

### GET /api/v1/conversations/:conversationId

**Description** : Retourne les détails complets d'une conversation spécifique, incluant la liste des participants et les métadonnées. L'utilisateur doit être membre de la conversation.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de chemin (path)

| Paramètre        | Type              | Obligatoire | Description                    |
| ---------------- | ----------------- | ----------- | ------------------------------ |
| `conversationId` | string (ObjectId) | Oui         | Identifiant de la conversation |

#### Réponses

- **200 — Détails de la conversation**

```json
{
  "id": "string",
  "name": "string | null",
  "isGroup": "boolean",
  "participants": [
    {
      "userId": "string",
      "username": "string",
      "pseudo": "string | null",
      "joinedAt": "2026-03-18T10:00:00.000Z"
    }
  ],
  "createdAt": "2026-03-18T10:00:00.000Z",
  "updatedAt": "2026-03-18T10:00:00.000Z"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : L'utilisateur n'est pas membre de cette conversation — `{ "error": "Accès interdit", "code": "FORBIDDEN" }`
- **404** : Conversation introuvable — `{ "error": "Conversation introuvable", "code": "CONVERSATION_NOT_FOUND" }`

---

### DELETE /api/v1/conversations/:conversationId

**Description** : Supprime une conversation et tous ses messages. Pour les conversations de groupe, seul le créateur peut supprimer. Pour les conversations privées, chaque participant peut supprimer sa propre vue.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

⚠️ **Cette opération supprime définitivement tous les messages de la conversation.**

#### Paramètres de chemin (path)

| Paramètre        | Type              | Obligatoire | Description                    |
| ---------------- | ----------------- | ----------- | ------------------------------ |
| `conversationId` | string (ObjectId) | Oui         | Identifiant de la conversation |

#### Réponses

- **200 — Conversation supprimée**

```json
{
  "message": "Conversation supprimée"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : Droits insuffisants pour supprimer — `{ "error": "Accès interdit", "code": "FORBIDDEN" }`
- **404** : Conversation introuvable — `{ "error": "Conversation introuvable", "code": "CONVERSATION_NOT_FOUND" }`

---

### POST /api/v1/conversations/:conversationId/participants

**Description** : Ajoute un ou plusieurs participants à une conversation de groupe existante. L'utilisateur ajouté doit être dans les contacts du demandeur.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de chemin (path)

| Paramètre        | Type              | Obligatoire | Description                    |
| ---------------- | ----------------- | ----------- | ------------------------------ |
| `conversationId` | string (ObjectId) | Oui         | Identifiant de la conversation |

#### Corps de la requête

```json
{
  "userId": "string (requis — ObjectId de l'utilisateur à ajouter)"
}
```

#### Réponses

- **200 — Participant ajouté**

```json
{
  "message": "Participant ajouté",
  "participant": {
    "userId": "string",
    "username": "string",
    "joinedAt": "2026-03-18T10:00:00.000Z"
  }
}
```

- **400** : `userId` manquant — `{ "error": "userId requis", "code": "MISSING_FIELDS" }`
- **400** : Impossible d'ajouter un participant à une conversation privée — `{ "error": "...", "code": "NOT_A_GROUP" }`
- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : Droits insuffisants — `{ "error": "Accès interdit", "code": "FORBIDDEN" }`
- **404** : Conversation ou utilisateur introuvable — `{ "error": "...", "code": "CONVERSATION_NOT_FOUND" | "USER_NOT_FOUND" }`
- **409** : Utilisateur déjà membre — `{ "error": "Déjà membre", "code": "ALREADY_PARTICIPANT" }`

---

### DELETE /api/v1/conversations/:conversationId/participants/:userId

**Description** : Retire un participant d'une conversation de groupe. Un participant peut se retirer lui-même ou le créateur du groupe peut retirer n'importe quel membre.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de chemin (path)

| Paramètre        | Type              | Obligatoire | Description                            |
| ---------------- | ----------------- | ----------- | -------------------------------------- |
| `conversationId` | string (ObjectId) | Oui         | Identifiant de la conversation         |
| `userId`         | string (ObjectId) | Oui         | Identifiant de l'utilisateur à retirer |

#### Réponses

- **200 — Participant retiré**

```json
{
  "message": "Participant retiré de la conversation"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : Droits insuffisants — `{ "error": "Accès interdit", "code": "FORBIDDEN" }`
- **404** : Conversation introuvable ou utilisateur non membre — `{ "error": "...", "code": "CONVERSATION_NOT_FOUND" | "PARTICIPANT_NOT_FOUND" }`
