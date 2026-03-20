# Routes conversations

**Préfixe** : `/api/v1/conversations`

Ces routes gèrent la création, la consultation et la gestion des conversations entre utilisateurs. Une conversation peut être privée (2 participants) ou de groupe (plusieurs participants).

Toutes les routes de ce groupe requièrent une authentification.

---

## Sommaire

### Gestion des conversations

- [GET /conversations](#get-conversations)
- [POST /conversations](#post-conversations)
- [GET /conversations/:conversationId](#get-conversationsconversationid)
- [DELETE /conversations/:conversationId](#delete-conversationsconversationid)
- [POST /conversations/:conversationId/participants](#post-conversationsconversationidparticipants)
- [DELETE /conversations/:conversationId/participants/:userId](#delete-conversationsconversationidparticipantsuserid)

### Options de conversation (Nouvelles fonctionnalités)

- [PATCH /conversations/:conversationId/mute](#patch-conversationsconversationidmute) - Couper les notifications
- [PATCH /conversations/:conversationId/unmute](#patch-conversationsconversationidunmute) - Réactiver les notifications
- [PATCH /conversations/:conversationId/archive](#patch-conversationsconversationidarchive) - Archiver une conversation
- [PATCH /conversations/:conversationId/unarchive](#patch-conversationsconversationidunarchive) - Désarchiver une conversation
- [GET /conversations/archived](#get-conversationsarchived) - Liste des conversations archivées
- [PATCH /conversations/:conversationId/pin](#patch-conversationsconversationidpin) - Épingler une conversation
- [PATCH /conversations/:conversationId/unpin](#patch-conversationsconversationidunpin) - Désépingler une conversation
- [PATCH /conversations/:conversationId/mark-unread](#patch-conversationsconversationidmark-unread) - Marquer comme non lu
- [PATCH /conversations/:conversationId/mark-read-flag](#patch-conversationsconversationidmark-read-flag) - Retirer le marquage non lu
- [PATCH /conversations/:conversationId/block](#patch-conversationsconversationidblock) - Bloquer une conversation
- [PATCH /conversations/:conversationId/unblock](#patch-conversationsconversationidunblock) - Débloquer une conversation

---

## Endpoints

### GET /api/v1/conversations

**Description** : Retourne la liste de toutes les conversations de l'utilisateur authentifié. Par défaut, les conversations archivées sont exclues. Les conversations épinglées apparaissent en premier, triées par ordre d'épinglage, suivies des conversations non épinglées triées par date du dernier message.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de query

| Paramètre         | Type    | Obligatoire | Description                                                      |
| ----------------- | ------- | ----------- | ---------------------------------------------------------------- |
| `includeArchived` | boolean | Non         | Inclure les conversations archivées (défaut: `false`)            |
| `limit`           | number  | Non         | Nombre de conversations à retourner (défaut: 20, max: 100)       |
| `skip`            | number  | Non         | Nombre de conversations à ignorer pour la pagination (défaut: 0) |

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
      "updatedAt": "2026-03-18T10:00:00.000Z",
      "userPreferences": {
        "isMuted": "boolean",
        "mutedUntil": "Date | null",
        "notifyOnMention": "boolean",
        "isArchived": "boolean",
        "isPinned": "boolean",
        "pinOrder": "number | null",
        "isMarkedUnread": "boolean",
        "isBlocked": "boolean"
      }
    }
  ],
  "total": "number"
}
```

**Nouveauté** : Le champ `userPreferences` contient toutes les préférences de l'utilisateur pour chaque conversation :

- `isMuted` : La conversation est en sourdine
- `mutedUntil` : Date de fin du mute (null = permanent)
- `notifyOnMention` : Recevoir des notifications si mentionné même si muted
- `isArchived` : La conversation est archivée
- `isPinned` : La conversation est épinglée
- `pinOrder` : Ordre d'épinglage (1 à 5, null si non épinglée)
- `isMarkedUnread` : Marquée manuellement comme non lue
- `isBlocked` : La conversation est bloquée

#### Tri des résultats

1. Conversations épinglées en premier (triées par `pinOrder` croissant)
2. Puis conversations non épinglées (triées par `updatedAt` décroissant)

- **400** : Paramètre invalide — `{ "error": "Paramètre invalide: limit doit être entre 1 et 100" }`
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

---

## Options de conversation

Les endpoints suivants permettent de gérer les préférences utilisateur pour chaque conversation : mute, archive, épinglage, marquage, et blocage.

### PATCH /api/v1/conversations/:conversationId/mute

**Description** : Met une conversation en sourdine pour ne plus recevoir de notifications. Possibilité de mute permanent ou temporaire. Les mentions (@username) peuvent être configurées pour continuer à notifier même si la conversation est mutée.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de chemin (path)

| Paramètre        | Type              | Obligatoire | Description                    |
| ---------------- | ----------------- | ----------- | ------------------------------ |
| `conversationId` | string (ObjectId) | Oui         | Identifiant de la conversation |

#### Corps de la requête

```json
{
  "mutedUntil": "Date | null (optionnel — null pour mute permanent, Date pour mute temporaire)",
  "notifyOnMention": "boolean (optionnel — défaut: true, notifier si mentionné même si muted)"
}
```

**Validations** :

- `mutedUntil` doit être dans le futur si fourni
- `mutedUntil` maximum : 1 an dans le futur
- Si `mutedUntil` est null → mute permanent
- Si `mutedUntil` est omis → mute permanent par défaut

#### Réponses

- **200 — Conversation mise en sourdine**

```json
{
  "message": "Conversation mise en sourdine jusqu'au 21/03/2026 18:00",
  "conversation": {
    "id": "string",
    "userPreferences": {
      "isMuted": true,
      "mutedUntil": "2026-03-21T18:00:00.000Z",
      "notifyOnMention": true
    }
  }
}
```

Pour un mute permanent :

```json
{
  "message": "Conversation mise en sourdine indéfiniment",
  "conversation": {
    "id": "string",
    "userPreferences": {
      "isMuted": true,
      "mutedUntil": null,
      "notifyOnMention": true
    }
  }
}
```

- **400** : Validation échouée — `{ "error": "La date de fin de sourdine doit être dans le futur" }`
- **400** : Date trop lointaine — `{ "error": "La date de fin de sourdine ne peut pas dépasser 1 an" }`
- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : Pas participant — `{ "error": "Vous devez être participant de cette conversation" }`
- **404** : Conversation introuvable — `{ "error": "Conversation introuvable" }`

---

### PATCH /api/v1/conversations/:conversationId/unmute

**Description** : Réactive les notifications pour une conversation précédemment mise en sourdine.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de chemin (path)

| Paramètre        | Type              | Obligatoire | Description                    |
| ---------------- | ----------------- | ----------- | ------------------------------ |
| `conversationId` | string (ObjectId) | Oui         | Identifiant de la conversation |

#### Réponses

- **200 — Notifications réactivées**

```json
{
  "message": "Notifications réactivées pour cette conversation",
  "conversation": {
    "id": "string",
    "userPreferences": {
      "isMuted": false,
      "mutedUntil": null,
      "notifyOnMention": false
    }
  }
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : Pas participant — `{ "error": "Vous devez être participant de cette conversation" }`
- **404** : Conversation introuvable — `{ "error": "Conversation introuvable" }`

---

### PATCH /api/v1/conversations/:conversationId/archive

**Description** : Archive une conversation. Elle disparaît de la liste principale mais reste accessible dans la section "Conversations archivées". Les nouveaux messages ne désarchivent pas automatiquement la conversation (contrairement au soft delete).

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de chemin (path)

| Paramètre        | Type              | Obligatoire | Description                    |
| ---------------- | ----------------- | ----------- | ------------------------------ |
| `conversationId` | string (ObjectId) | Oui         | Identifiant de la conversation |

#### Réponses

- **200 — Conversation archivée**

```json
{
  "message": "Conversation archivée",
  "conversation": {
    "id": "string",
    "userPreferences": {
      "isArchived": true
    }
  }
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : Pas participant — `{ "error": "Vous devez être participant de cette conversation" }`
- **404** : Conversation introuvable — `{ "error": "Conversation introuvable" }`

---

### PATCH /api/v1/conversations/:conversationId/unarchive

**Description** : Désarchive une conversation et la remet dans la liste principale.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de chemin (path)

| Paramètre        | Type              | Obligatoire | Description                    |
| ---------------- | ----------------- | ----------- | ------------------------------ |
| `conversationId` | string (ObjectId) | Oui         | Identifiant de la conversation |

#### Réponses

- **200 — Conversation désarchivée**

```json
{
  "message": "Conversation désarchivée",
  "conversation": {
    "id": "string",
    "userPreferences": {
      "isArchived": false
    }
  }
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : Pas participant — `{ "error": "Vous devez être participant de cette conversation" }`
- **404** : Conversation introuvable — `{ "error": "Conversation introuvable" }`

---

### GET /api/v1/conversations/archived

**Description** : Retourne la liste de toutes les conversations archivées par l'utilisateur authentifié, triées par date du dernier message (plus récentes en premier).

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de query

| Paramètre | Type   | Obligatoire | Description                                                      |
| --------- | ------ | ----------- | ---------------------------------------------------------------- |
| `limit`   | number | Non         | Nombre de conversations à retourner (défaut: 20, max: 100)       |
| `skip`    | number | Non         | Nombre de conversations à ignorer pour la pagination (défaut: 0) |

#### Réponses

- **200 — Liste des conversations archivées**

```json
{
  "conversations": [
    {
      "id": "string",
      "name": "string | null",
      "isGroup": "boolean",
      "participants": [...],
      "lastMessage": {...},
      "unreadCount": "number",
      "updatedAt": "2026-03-18T10:00:00.000Z",
      "userPreferences": {
        "isArchived": true,
        ...
      }
    }
  ],
  "total": "number",
  "limit": "number",
  "skip": "number"
}
```

- **400** : Paramètre invalide — `{ "error": "Paramètre invalide: limit doit être entre 1 et 100" }`
- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`

---

### PATCH /api/v1/conversations/:conversationId/pin

**Description** : Épingle une conversation pour qu'elle apparaisse en haut de la liste. Limite de 5 conversations épinglées maximum par utilisateur.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de chemin (path)

| Paramètre        | Type              | Obligatoire | Description                    |
| ---------------- | ----------------- | ----------- | ------------------------------ |
| `conversationId` | string (ObjectId) | Oui         | Identifiant de la conversation |

#### Corps de la requête (optionnel)

```json
{
  "order": "number (optionnel — position d'épinglage de 1 à 5, auto-calculé si omis)"
}
```

#### Réponses

- **200 — Conversation épinglée**

```json
{
  "message": "Conversation épinglée en position 2",
  "conversation": {
    "id": "string",
    "userPreferences": {
      "isPinned": true,
      "pinOrder": 2
    }
  }
}
```

- **400** : Limite atteinte — `{ "error": "Vous ne pouvez épingler que 5 conversations maximum" }`
- **400** : Ordre invalide — `{ "error": "L'ordre doit être un nombre entre 1 et 5" }`
- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : Pas participant — `{ "error": "Vous devez être participant de cette conversation" }`
- **404** : Conversation introuvable — `{ "error": "Conversation introuvable" }`

---

### PATCH /api/v1/conversations/:conversationId/unpin

**Description** : Désépingle une conversation.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de chemin (path)

| Paramètre        | Type              | Obligatoire | Description                    |
| ---------------- | ----------------- | ----------- | ------------------------------ |
| `conversationId` | string (ObjectId) | Oui         | Identifiant de la conversation |

#### Réponses

- **200 — Conversation désépinglée**

```json
{
  "message": "Conversation désépinglée",
  "conversation": {
    "id": "string",
    "userPreferences": {
      "isPinned": false,
      "pinOrder": null
    }
  }
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : Pas participant — `{ "error": "Vous devez être participant de cette conversation" }`
- **404** : Conversation introuvable — `{ "error": "Conversation introuvable" }`

---

### PATCH /api/v1/conversations/:conversationId/mark-unread

**Description** : Marque manuellement une conversation comme non lue pour se rappeler d'y répondre plus tard. Affiche un badge "non lu" même si tous les messages ont été lus.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de chemin (path)

| Paramètre        | Type              | Obligatoire | Description                    |
| ---------------- | ----------------- | ----------- | ------------------------------ |
| `conversationId` | string (ObjectId) | Oui         | Identifiant de la conversation |

#### Réponses

- **200 — Conversation marquée comme non lue**

```json
{
  "message": "Conversation marquée comme non lue",
  "conversation": {
    "id": "string",
    "userPreferences": {
      "isMarkedUnread": true
    }
  }
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : Pas participant — `{ "error": "Vous devez être participant de cette conversation" }`
- **404** : Conversation introuvable — `{ "error": "Conversation introuvable" }`

---

### PATCH /api/v1/conversations/:conversationId/mark-read-flag

**Description** : Retire le marquage manuel "non lu" d'une conversation.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de chemin (path)

| Paramètre        | Type              | Obligatoire | Description                    |
| ---------------- | ----------------- | ----------- | ------------------------------ |
| `conversationId` | string (ObjectId) | Oui         | Identifiant de la conversation |

#### Réponses

- **200 — Marquage retiré**

```json
{
  "message": "Marquage 'non lu' retiré",
  "conversation": {
    "id": "string",
    "userPreferences": {
      "isMarkedUnread": false
    }
  }
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : Pas participant — `{ "error": "Vous devez être participant de cette conversation" }`
- **404** : Conversation introuvable — `{ "error": "Conversation introuvable" }`

---

### PATCH /api/v1/conversations/:conversationId/block

**Description** : Bloque une conversation spécifique. Empêche l'envoi et la réception de messages dans cette conversation. Plus granulaire que bloquer un contact (n'affecte que cette conversation).

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de chemin (path)

| Paramètre        | Type              | Obligatoire | Description                    |
| ---------------- | ----------------- | ----------- | ------------------------------ |
| `conversationId` | string (ObjectId) | Oui         | Identifiant de la conversation |

#### Corps de la requête (optionnel)

```json
{
  "reason": "string (optionnel — raison du blocage, max 500 caractères)"
}
```

#### Réponses

- **200 — Conversation bloquée**

```json
{
  "message": "Conversation bloquée",
  "conversation": {
    "id": "string",
    "userPreferences": {
      "isBlocked": true
    }
  }
}
```

- **400** : Raison trop longue — `{ "error": "La raison ne peut pas dépasser 500 caractères" }`
- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : Pas participant — `{ "error": "Vous devez être participant de cette conversation" }`
- **404** : Conversation introuvable — `{ "error": "Conversation introuvable" }`

---

### PATCH /api/v1/conversations/:conversationId/unblock

**Description** : Débloque une conversation précédemment bloquée.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de chemin (path)

| Paramètre        | Type              | Obligatoire | Description                    |
| ---------------- | ----------------- | ----------- | ------------------------------ |
| `conversationId` | string (ObjectId) | Oui         | Identifiant de la conversation |

#### Réponses

- **200 — Conversation débloquée**

```json
{
  "message": "Conversation débloquée",
  "conversation": {
    "id": "string",
    "userPreferences": {
      "isBlocked": false
    }
  }
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : Pas participant — `{ "error": "Vous devez être participant de cette conversation" }`
- **404** : Conversation introuvable — `{ "error": "Conversation introuvable" }`

---

## Notes d'implémentation pour les développeurs front/mobile

### Nettoyage automatique des mutes expirés

Un cron job s'exécute toutes les heures pour nettoyer automatiquement les conversations dont le `mutedUntil` est expiré. Cependant, côté client, vous devriez également vérifier si `mutedUntil` est passé et considérer la conversation comme non mutée.

**Exemple de logique client :**

```javascript
const isMuted =
  conversation.userPreferences.isMuted &&
  (!conversation.userPreferences.mutedUntil ||
    new Date(conversation.userPreferences.mutedUntil) > new Date());
```

### Tri des conversations

Les conversations sont automatiquement triées par le serveur :

1. Conversations épinglées en premier (triées par `pinOrder` croissant : 1, 2, 3, 4, 5)
2. Conversations non épinglées ensuite (triées par `updatedAt` décroissant)

Vous n'avez pas besoin de re-trier côté client, mais gardez cet ordre lors de l'affichage.

### Gestion des badges de notification

- **Badge "non lu"** : Afficher si `unreadCount > 0` OU `isMarkedUnread === true`
- **Badge "muté"** : Afficher une icône 🔕 si `isMuted === true`
- **Badge "archivé"** : N'apparaît pas dans la liste principale (sauf si `includeArchived=true`)
- **Badge "épinglé"** : Afficher une icône 📌 si `isPinned === true`

### Limitations

- **Maximum 5 conversations épinglées** : Avant d'appeler `/pin`, vérifiez combien de conversations sont déjà épinglées
- **Mute maximum 1 an** : La date `mutedUntil` ne peut pas dépasser 1 an dans le futur
- **Blocage conversation** : Différent du blocage de contact. Bloque uniquement cette conversation spécifique

### Workflow recommandé pour le menu contextuel

```
Long press sur conversation → Menu contextuel :
├─ 📌 Épingler/Désépingler (si < 5 épinglées)
├─ 🔕 Mettre en sourdine
│   └─ Sous-menu : 1h / 8h / 1 semaine / Toujours / Personnalisé
├─ 📁 Archiver
├─ ● Marquer comme non lu
├─ 🚫 Bloquer conversation
└─ 🗑️ Supprimer
```
