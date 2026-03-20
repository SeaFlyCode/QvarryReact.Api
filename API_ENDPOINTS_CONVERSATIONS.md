# 🔗 RÉFÉRENCE RAPIDE DES ENDPOINTS - GESTION DES CONVERSATIONS

## BASE URL

```
http://localhost:8080/api/v1/conversations
```

---

## 🔇 MUTE/UNMUTE

### Muter une conversation

```http
PATCH /conversations/:id/mute
Authorization: Bearer {token}
Content-Type: application/json

{
  "mutedUntil": "2026-12-31T23:59:59Z",  // null pour permanent
  "notifyOnMention": true                 // default: true
}
```

**Réponse 200:**

```json
{
  "message": "Conversation mise en sourdine jusqu'au 31/12/2026 23:59:59",
  "conversation": { ... },
  "mutedUntil": "2026-12-31T23:59:59Z"
}
```

### Réactiver le son

```http
PATCH /conversations/:id/unmute
Authorization: Bearer {token}
```

---

## 📦 ARCHIVE/UNARCHIVE

### Archiver

```http
PATCH /conversations/:id/archive
Authorization: Bearer {token}
```

### Désarchiver

```http
PATCH /conversations/:id/unarchive
Authorization: Bearer {token}
```

### Lister les archivées

```http
GET /conversations/archived?limit=20&skip=0
Authorization: Bearer {token}
```

**Réponse 200:**

```json
{
  "conversations": [...],
  "total": 42,
  "limit": 20,
  "skip": 0
}
```

---

## 📌 PIN/UNPIN

### Épingler

```http
PATCH /conversations/:id/pin
Authorization: Bearer {token}
Content-Type: application/json

{
  "order": 1  // optionnel, auto-calculé si absent
}
```

**Erreur 400 si 5 déjà épinglées:**

```json
{
  "error": "Vous ne pouvez épingler que 5 conversations maximum"
}
```

### Désépingler

```http
PATCH /conversations/:id/unpin
Authorization: Bearer {token}
```

---

## 📧 MARK AS UNREAD/READ

### Marquer comme non lu

```http
PATCH /conversations/:id/mark-unread
Authorization: Bearer {token}
```

### Retirer le marquage non lu

```http
PATCH /conversations/:id/mark-read-flag
Authorization: Bearer {token}
```

---

## 🚫 BLOCK/UNBLOCK

### Bloquer

```http
PATCH /conversations/:id/block
Authorization: Bearer {token}
Content-Type: application/json

{
  "reason": "Spam ou comportement inapproprié"  // optionnel, max 500 chars
}
```

### Débloquer

```http
PATCH /conversations/:id/unblock
Authorization: Bearer {token}
```

---

## 📋 LISTER LES CONVERSATIONS (MODIFIÉ)

```http
GET /conversations?page=1&limit=20&includeArchived=false
Authorization: Bearer {token}
```

**Query params:**

- `page` : Numéro de page (default: 1)
- `limit` : Limite par page (default: 20, max: 100)
- `includeArchived` : Inclure les archivées (default: false)

**Réponse 200:**

```json
{
  "data": [
    {
      "_id": "...",
      "name": "...",
      "isGroup": true,
      "participants": [...],
      "lastMessage": "...",
      "unreadCount": 5,
      "userPreferences": {
        "isMuted": false,
        "mutedUntil": null,
        "notifyOnMention": true,
        "isArchived": false,
        "isPinned": true,
        "pinOrder": 1,
        "isMarkedUnread": false,
        "isBlocked": false
      },
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 42,
    "totalPages": 3
  }
}
```

**Tri:**

1. Épinglées d'abord (par `pinOrder` ASC)
2. Puis non-épinglées (par `updatedAt` DESC)

---

## 🔴 ERREURS COMMUNES

### 400 - Bad Request

```json
{
  "error": "mutedUntil doit être une date valide"
}
```

### 401 - Unauthorized

```json
{
  "error": "Utilisateur non authentifié"
}
```

### 403 - Forbidden

```json
{
  "error": "Vous n'êtes pas participant de cette conversation"
}
```

### 404 - Not Found

```json
{
  "error": "Conversation non trouvée"
}
```

---

## 🔌 WEBSOCKET - BLOCAGE

**Erreur si conversation bloquée:**

```json
{
  "type": "error",
  "code": "CONVERSATION_BLOCKED",
  "message": "Cette conversation est bloquée"
}
```

---

## 📊 EXEMPLES CURL

### Muter pour 24h

```bash
curl -X PATCH http://localhost:8080/api/v1/conversations/123/mute \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"mutedUntil":"2026-03-21T18:00:00Z","notifyOnMention":true}'
```

### Épingler

```bash
curl -X PATCH http://localhost:8080/api/v1/conversations/123/pin \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"order":1}'
```

### Bloquer avec raison

```bash
curl -X PATCH http://localhost:8080/api/v1/conversations/123/block \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Spam"}'
```

### Lister avec archivées

```bash
curl -X GET "http://localhost:8080/api/v1/conversations?includeArchived=true" \
  -H "Authorization: Bearer TOKEN"
```

---

## 📝 NOTES

- Tous les endpoints nécessitent authentification
- L'utilisateur doit être participant actif (leftAt === null)
- Les conversations archivées sont exclues par défaut de GET /conversations
- Les conversations épinglées apparaissent toujours en premier
- Le cron job nettoie les mutes expirés toutes les heures

---

**📚 Documentation complète : `CONVERSATION_FEATURES.md`**
