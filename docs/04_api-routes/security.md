# Routes sécurité

**Préfixe** : `/api/v1/security`

Ces routes permettent à un utilisateur de gérer ses sessions actives, consulter les événements de sécurité liés à son compte et gérer ses appareils connus.

Toutes les routes de ce groupe requièrent une authentification.

---

## Sommaire

- [GET /security/sessions](#get-securitysessions)
- [DELETE /security/sessions/:sessionId](#delete-securitysessionssessionid)
- [DELETE /security/sessions](#delete-securitysessions)
- [GET /security/events](#get-securityevents)
- [GET /security/devices](#get-securitydevices)

---

## Endpoints

### GET /api/v1/security/sessions

**Description** : Retourne la liste de toutes les sessions actives de l'utilisateur authentifié, incluant l'appareil, le navigateur, l'adresse IP et la date de dernière activité. La session courante est identifiée par `isCurrent: true`.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Réponses

- **200 — Sessions actives**

```json
{
  "sessions": [
    {
      "id": "string",
      "isCurrent": "boolean",
      "deviceName": "string | null",
      "browser": "string | null",
      "os": "string | null",
      "ipAddress": "string",
      "location": "string | null",
      "lastActiveAt": "2026-03-18T10:00:00.000Z",
      "createdAt": "2026-03-18T10:00:00.000Z"
    }
  ],
  "total": "number"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`

---

### DELETE /api/v1/security/sessions/:sessionId

**Description** : Révoque une session spécifique, déconnectant l'appareil associé. Il n'est pas possible de révoquer la session courante via cette route (utiliser `/auth/logout`).

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de chemin (path)

| Paramètre   | Type              | Obligatoire | Description                          |
| ----------- | ----------------- | ----------- | ------------------------------------ |
| `sessionId` | string (ObjectId) | Oui         | Identifiant de la session à révoquer |

#### Réponses

- **200 — Session révoquée**

```json
{
  "message": "Session révoquée"
}
```

- **400** : Tentative de révoquer la session courante — `{ "error": "Utilisez /auth/logout pour la session courante", "code": "CANNOT_REVOKE_CURRENT_SESSION" }`
- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : La session n'appartient pas à l'utilisateur — `{ "error": "Accès interdit", "code": "FORBIDDEN" }`
- **404** : Session introuvable — `{ "error": "Session introuvable", "code": "SESSION_NOT_FOUND" }`

---

### DELETE /api/v1/security/sessions

**Description** : Révoque toutes les sessions actives de l'utilisateur, à l'exception de la session courante. Utile en cas de compromission du compte.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Réponses

- **200 — Toutes les autres sessions révoquées**

```json
{
  "message": "Toutes les autres sessions ont été révoquées",
  "revokedCount": "number"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`

---

### GET /api/v1/security/events

**Description** : Retourne l'historique des événements de sécurité liés au compte de l'utilisateur (connexions, changements de mot de passe, activations 2FA, etc.).

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de requête (query)

| Paramètre | Type   | Obligatoire | Description                                              |
| --------- | ------ | ----------- | -------------------------------------------------------- |
| `limit`   | number | Non         | Nombre d'événements à retourner (défaut : 20, max : 100) |
| `offset`  | number | Non         | Décalage pour la pagination (défaut : 0)                 |

#### Réponses

- **200 — Événements de sécurité**

```json
{
  "events": [
    {
      "id": "string",
      "type": "string (ex: LOGIN_SUCCESS, PASSWORD_CHANGED, 2FA_ENABLED)",
      "ipAddress": "string",
      "userAgent": "string | null",
      "location": "string | null",
      "createdAt": "2026-03-18T10:00:00.000Z"
    }
  ],
  "total": "number",
  "hasMore": "boolean"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`

---

### GET /api/v1/security/devices

**Description** : Retourne la liste des appareils reconnus associés au compte de l'utilisateur (appareils ayant effectué une connexion réussie).

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Réponses

- **200 — Appareils connus**

```json
{
  "devices": [
    {
      "id": "string",
      "deviceName": "string | null",
      "browser": "string | null",
      "os": "string | null",
      "lastSeenIp": "string",
      "lastSeenAt": "2026-03-18T10:00:00.000Z",
      "trusted": "boolean"
    }
  ],
  "total": "number"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
