# Nouvelles Fonctionnalités de Gestion des Conversations

## 📋 Vue d'ensemble

Ce document décrit les nouvelles fonctionnalités de gestion des conversations implémentées dans l'API Qvarry.

## 🆕 Fonctionnalités Implémentées

### 1. Mute/Unmute (Mise en sourdine)

**Endpoints:**

- `PATCH /api/v1/conversations/:id/mute` - Mettre en sourdine
- `PATCH /api/v1/conversations/:id/unmute` - Réactiver le son

**Body (mute):**

```json
{
  "mutedUntil": "2026-12-31T23:59:59Z", // Optionnel, null = permanent
  "notifyOnMention": true // Optionnel, default: true
}
```

**Réponse:**

```json
{
  "message": "Conversation mise en sourdine jusqu'au 31/12/2026 23:59:59",
  "conversation": {
    "_id": "...",
    "userPreferences": {
      "isMuted": true,
      "mutedUntil": "2026-12-31T23:59:59Z",
      "notifyOnMention": true,
      ...
    }
  },
  "mutedUntil": "2026-12-31T23:59:59Z"
}
```

**Règles:**

- `mutedUntil` doit être dans le futur (max 1 an)
- Si `mutedUntil` est `null`, la conversation est mutée indéfiniment
- Si `notifyOnMention` est `true`, l'utilisateur reçoit quand même les notifications de mention
- Les mutes expirés sont automatiquement nettoyés toutes les heures par un cron job

---

### 2. Archive/Unarchive

**Endpoints:**

- `PATCH /api/v1/conversations/:id/archive` - Archiver
- `PATCH /api/v1/conversations/:id/unarchive` - Désarchiver
- `GET /api/v1/conversations/archived` - Lister les conversations archivées

**Query params (archived):**

```
?limit=20&skip=0
```

**Réponse (archive):**

```json
{
  "message": "Conversation archivée",
  "conversation": {
    "_id": "...",
    "userPreferences": {
      "isArchived": true,
      ...
    }
  }
}
```

**Règles:**

- Par défaut, `GET /api/v1/conversations` **exclut** les conversations archivées
- Pour inclure les archivées : `GET /api/v1/conversations?includeArchived=true`
- Les conversations archivées sont triées par `updatedAt` DESC

---

### 3. Pin/Unpin (Épingler)

**Endpoints:**

- `PATCH /api/v1/conversations/:id/pin` - Épingler
- `PATCH /api/v1/conversations/:id/unpin` - Désépingler

**Body (pin):**

```json
{
  "order": 1 // Optionnel, auto-calculé si non fourni
}
```

**Réponse:**

```json
{
  "message": "Conversation épinglée",
  "conversation": {
    "_id": "...",
    "userPreferences": {
      "isPinned": true,
      "pinOrder": 1,
      ...
    }
  },
  "pinOrder": 1
}
```

**Règles:**

- Limite de **5 conversations épinglées** par utilisateur
- Si la limite est atteinte, retourne une erreur 400
- Les conversations épinglées apparaissent **en premier** dans `GET /conversations`
- Tri : épinglées par `order` ASC, puis par `updatedAt` DESC

---

### 4. Mark as Unread/Read

**Endpoints:**

- `PATCH /api/v1/conversations/:id/mark-unread` - Marquer comme non lu
- `PATCH /api/v1/conversations/:id/mark-read-flag` - Retirer le marquage non lu

**Note:** Ces endpoints gèrent le **flag visuel** de non-lu. Pour marquer les messages comme lus, utilisez `PATCH /api/v1/conversations/:id/read` (endpoint existant).

**Réponse:**

```json
{
  "message": "Conversation marquée comme non lue",
  "conversation": {
    "_id": "...",
    "userPreferences": {
      "isMarkedUnread": true,
      ...
    }
  }
}
```

**Règles:**

- Permet d'afficher une conversation comme "non lue" même si tous les messages sont lus
- Utile pour marquer une conversation à traiter plus tard

---

### 5. Block/Unblock

**Endpoints:**

- `PATCH /api/v1/conversations/:id/block` - Bloquer
- `PATCH /api/v1/conversations/:id/unblock` - Débloquer

**Body (block):**

```json
{
  "reason": "Raison du blocage" // Optionnel, max 500 caractères
}
```

**Réponse:**

```json
{
  "message": "Conversation bloquée",
  "conversation": {
    "_id": "...",
    "userPreferences": {
      "isBlocked": true,
      ...
    }
  }
}
```

**Règles:**

- Si une conversation est bloquée, l'utilisateur **ne peut plus envoyer de messages** via WebSocket
- Le blocage est unilatéral (ne bloque pas l'autre utilisateur)
- La raison du blocage est sanitizée (suppression de `<>` pour éviter XSS)

---

## 🔄 Modification de `GET /conversations`

L'endpoint existant a été modifié pour :

1. **Exclure les conversations archivées par défaut**
   - Utilisez `?includeArchived=true` pour les inclure

2. **Ajouter le champ `userPreferences`** dans chaque conversation :

```json
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
```

3. **Tri automatique :**
   - Épinglées d'abord (par `pinOrder` ASC)
   - Puis non-épinglées par `updatedAt` DESC

---

## 🔔 Modification du Service de Notifications

Le service `notificationService.ts` a été modifié pour :

1. **Vérifier si la conversation est mutée** avant d'envoyer une notification
2. **Respecter `notifyOnMention`** : si `true`, envoie quand même la notification si l'utilisateur est mentionné
3. **Auto-unmute** les conversations dont `mutedUntil` est expiré

**Exemple de logique :**

```typescript
const mutedInfo = conversation.mutedBy.find((m) => m.userId === recipientId);
const isMuted =
  mutedInfo && (!mutedInfo.mutedUntil || mutedInfo.mutedUntil > new Date());
const isMentioned = message.metadata?.mentions?.includes(recipientId);

if (isMuted && !(isMentioned && mutedInfo.notifyOnMention)) {
  return null; // Skip notification
}
```

---

## 🔌 Modification du Service WebSocket

Le service `webSocketService.ts` a été modifié pour :

1. **Vérifier si la conversation est bloquée** avant d'envoyer un message
2. **Retourner une erreur** si bloquée :

```json
{
  "type": "error",
  "code": "CONVERSATION_BLOCKED",
  "message": "Cette conversation est bloquée"
}
```

---

## ⏰ Cron Job : Nettoyage des Mutes Expirés

**Fichier:** `/src/jobs/cleanExpiredMutes.ts`

**Fréquence:** Toutes les heures (`0 * * * *`)

**Fonctionnement:**

1. Récupère toutes les conversations avec `mutedBy.mutedUntil < now`
2. Nettoie les entrées expirées
3. Sauvegarde les conversations modifiées
4. Log les statistiques

**Fonction manuelle:**

```typescript
import { cleanExpiredMutesManually } from "./jobs/cleanExpiredMutes";

const result = await cleanExpiredMutesManually();
// { conversationsProcessed: 10, totalMutesCleaned: 15, uniqueUsers: 8 }
```

---

## 🗂️ Nouveaux Index MongoDB

Pour optimiser les performances, les index suivants ont été ajoutés :

```typescript
ConversationSchema.index({ "mutedBy.userId": 1 });
ConversationSchema.index({ "archivedBy.userId": 1 });
ConversationSchema.index({ "pinnedBy.userId": 1, "pinnedBy.order": 1 });
ConversationSchema.index({ markedUnreadBy: 1 });
ConversationSchema.index({ "blockedBy.userId": 1 });
```

---

## 🔒 Sécurité

Tous les endpoints :

- ✅ Nécessitent l'authentification (`authMiddleware`)
- ✅ Valident les `ObjectId` MongoDB
- ✅ Vérifient que l'utilisateur est participant actif
- ✅ Sanitizent les inputs (raison de blocage, etc.)
- ✅ Appliquent des limites (5 pins max, 1 an max pour mute, 500 chars max pour reason)

---

## 📝 Fichiers Modifiés/Créés

### Modifiés :

1. `/src/models/conversations.ts` - Nouveaux champs + index
2. `/src/controllers/conversationsControllers.ts` - 14 nouveaux controllers
3. `/src/routes/conversationsRoutes.ts` - 10 nouvelles routes
4. `/src/services/notificationService.ts` - Logique de mute/mention
5. `/src/services/webSocketService.ts` - Vérification blocage
6. `/src/server.ts` - Démarrage du cron job

### Créés :

1. `/src/utils/conversationHelpers.ts` - Helpers pour userPreferences
2. `/src/jobs/cleanExpiredMutes.ts` - Cron job de nettoyage
3. `/src/middlewares/conversationValidationMiddleware.ts` - Validation des nouveaux endpoints

---

## 🧪 Tests à Effectuer

Après déploiement, vérifier :

1. ✅ Un utilisateur non-participant ne peut pas modifier les options
2. ✅ La limite de 5 pins est respectée
3. ✅ Les mutes expirés sont nettoyés automatiquement
4. ✅ Les notifications respectent le mute (sauf mentions)
5. ✅ Le blocage empêche l'envoi de messages via WebSocket
6. ✅ `GET /conversations` exclut bien les archivées par défaut
7. ✅ Le tri (pinned first, puis updatedAt) fonctionne
8. ✅ `userPreferences` est correctement calculé pour chaque conversation

---

## 📊 Exemples de Requêtes

### Muter une conversation pour 24h

```bash
curl -X PATCH http://localhost:8080/api/v1/conversations/123/mute \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mutedUntil": "2026-03-21T18:00:00Z",
    "notifyOnMention": true
  }'
```

### Épingler une conversation

```bash
curl -X PATCH http://localhost:8080/api/v1/conversations/123/pin \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"order": 1}'
```

### Bloquer une conversation

```bash
curl -X PATCH http://localhost:8080/api/v1/conversations/123/block \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Spam"}'
```

### Lister les conversations (incluant archivées)

```bash
curl -X GET "http://localhost:8080/api/v1/conversations?includeArchived=true" \
  -H "Authorization: Bearer TOKEN"
```

---

## 🚀 Améliorations Futures Possibles

1. **Notification de réactivation** : Envoyer une notification quand un mute expire
2. **Historique des blocages** : Garder un historique des raisons de blocage
3. **Mute par catégorie** : Muter seulement certains types de notifications
4. **Pin groupé** : Permettre de réorganiser l'ordre des pins par drag & drop
5. **Auto-archive** : Archiver automatiquement les conversations inactives après X jours

---

## 📞 Support

Pour toute question ou problème, consulter :

- Documentation API : `/api/v1/docs`
- Logs serveur : `pm2 logs` ou fichiers dans `/logs`
- Code source : `/src/controllers/conversationsControllers.ts`
