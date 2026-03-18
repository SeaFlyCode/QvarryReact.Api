# Routes notifications

**Préfixe** : `/api/v1/notifications`

Ces routes permettent de gérer les notifications de l'utilisateur. Une connexion WebSocket est disponible pour recevoir les notifications en temps réel sans polling.

Toutes les routes HTTP de ce groupe requièrent une authentification.

---

## Sommaire

- [GET /notifications](#get-notifications)
- [PUT /notifications/:notifId/read](#put-notificationsnotifidread)
- [PUT /notifications/read-all](#put-notificationsread-all)
- [DELETE /notifications/:notifId](#delete-notificationsnotifid)
- [WebSocket — Notifications temps réel](#websocket--notifications-temps-réel)

---

## Endpoints

### GET /api/v1/notifications

**Description** : Retourne la liste des notifications de l'utilisateur authentifié, triées de la plus récente à la plus ancienne. Supporte le filtrage sur les non-lues uniquement.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de requête (query)

| Paramètre    | Type    | Obligatoire | Description                                                                |
| ------------ | ------- | ----------- | -------------------------------------------------------------------------- |
| `limit`      | number  | Non         | Nombre de notifications à retourner (défaut : 20, max : 100)               |
| `unreadOnly` | boolean | Non         | Si `true`, retourne uniquement les notifications non lues (défaut : false) |

#### Réponses

- **200 — Notifications retournées**

```json
{
  "notifications": [
    {
      "id": "string",
      "type": "string (ex: contact_request, message, system)",
      "title": "string",
      "body": "string",
      "data": {},
      "read": "boolean",
      "createdAt": "2026-03-18T10:00:00.000Z"
    }
  ],
  "total": "number",
  "unreadCount": "number",
  "hasMore": "boolean"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`

---

### PUT /api/v1/notifications/:notifId/read

**Description** : Marque une notification spécifique comme lue.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de chemin (path)

| Paramètre | Type              | Obligatoire | Description                    |
| --------- | ----------------- | ----------- | ------------------------------ |
| `notifId` | string (ObjectId) | Oui         | Identifiant de la notification |

#### Réponses

- **200 — Notification marquée comme lue**

```json
{
  "message": "Notification marquée comme lue"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : La notification n'appartient pas à l'utilisateur — `{ "error": "Accès interdit", "code": "FORBIDDEN" }`
- **404** : Notification introuvable — `{ "error": "Notification introuvable", "code": "NOTIFICATION_NOT_FOUND" }`

---

### PUT /api/v1/notifications/read-all

**Description** : Marque toutes les notifications non lues de l'utilisateur authentifié comme lues en une seule opération.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Réponses

- **200 — Toutes les notifications marquées comme lues**

```json
{
  "message": "Toutes les notifications marquées comme lues",
  "updatedCount": "number"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`

---

### DELETE /api/v1/notifications/:notifId

**Description** : Supprime définitivement une notification de l'historique de l'utilisateur.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de chemin (path)

| Paramètre | Type              | Obligatoire | Description                    |
| --------- | ----------------- | ----------- | ------------------------------ |
| `notifId` | string (ObjectId) | Oui         | Identifiant de la notification |

#### Réponses

- **200 — Notification supprimée**

```json
{
  "message": "Notification supprimée"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : La notification n'appartient pas à l'utilisateur — `{ "error": "Accès interdit", "code": "FORBIDDEN" }`
- **404** : Notification introuvable — `{ "error": "Notification introuvable", "code": "NOTIFICATION_NOT_FOUND" }`

---

## WebSocket — Notifications temps réel

### Connexion

```
ws://host/ws/notifications?token={wsToken}
```

| Paramètre | Type   | Obligatoire | Description                                                |
| --------- | ------ | ----------- | ---------------------------------------------------------- |
| `token`   | string | Oui         | Token WebSocket temporaire obtenu via `GET /auth/ws-token` |

### Événements émis par le serveur

| Événement                | Description                                     | Payload                    |
| ------------------------ | ----------------------------------------------- | -------------------------- |
| `notification:new`       | Nouvelle notification reçue                     | Objet notification complet |
| `notification:read`      | Notification marquée comme lue (autre session)  | `{ notifId }`              |
| `notification:deleted`   | Notification supprimée (autre session)          | `{ notifId }`              |
| `notifications:read-all` | Toutes les notifs marquées lues (autre session) | `{}`                       |

⚠️ **Le token WebSocket a une durée de vie courte (~30 secondes). Il doit être obtenu juste avant d'ouvrir la connexion.**
