# Modules API — Référence rapide

## `user.ts`

**Localisation** : `src/api/user.ts`

| Fonction | Endpoint | Description |
|----------|----------|-------------|
| `getCurrentUser()` | `GET /users/me` | Utilisateur courant |
| `updateProfile(data)` | `PUT /users/me` | Mise à jour du profil |
| `updatePassword(old, new)` | `PUT /users/me/password` | Changement de mot de passe |
| `deleteAccount(password)` | `DELETE /users/me` | Suppression du compte |
| `getActiveSessions()` | `GET /users/me/sessions` | Sessions actives |
| `revokeSession(sessionId)` | `DELETE /users/me/sessions/:id` | Révocation d'une session |

---

## `points.ts`

**Localisation** : `src/api/points.ts`

| Fonction | Endpoint | Description |
|----------|----------|-------------|
| `getPoints()` | `GET /points` | Tous les points de l'utilisateur |
| `getPoint(id)` | `GET /points/:id` | Un point |
| `createPoint(data)` | `POST /points` | Créer un point |
| `updatePoint(id, data)` | `PUT /points/:id` | Modifier un point |
| `deletePoint(id)` | `DELETE /points/:id` | Supprimer un point |
| `invalidatePointsCache()` | — | Invalide le cache local |

Cache mémoire sur `getPoints()` pour éviter les rechargements inutiles.

---

## `fiches.ts`

**Localisation** : `src/api/fiches.ts`

| Fonction | Endpoint | Description |
|----------|----------|-------------|
| `getFiches()` | `GET /fiches` | Toutes les fiches |
| `getFiche(id)` | `GET /fiches/:id` | Une fiche |
| `createFiche(data)` | `POST /fiches` | Créer une fiche |
| `updateFiche(id, data)` | `PUT /fiches/:id` | Modifier une fiche |
| `deleteFiche(id)` | `DELETE /fiches/:id` | Supprimer une fiche |

---

## `lists.ts`

**Localisation** : `src/api/lists.ts`

| Fonction | Endpoint | Description |
|----------|----------|-------------|
| `getLists()` | `GET /lists` | Toutes les listes |
| `getList(id)` | `GET /lists/:id` | Une liste avec ses points |
| `createList(data)` | `POST /lists` | Créer une liste |
| `updateList(id, data)` | `PUT /lists/:id` | Modifier une liste |
| `deleteList(id)` | `DELETE /lists/:id` | Supprimer une liste |
| `addPointToList(listId, ids)` | `POST /lists/:id/points` | Associer des points (batch) |
| `removePointFromList(listId, pointId)` | `DELETE /lists/:id/points/:pointId` | Dissocier un point |

---

## `contacts.ts`

**Localisation** : `src/api/contacts.ts`

| Fonction | Endpoint | Description |
|----------|----------|-------------|
| `getContacts()` | `GET /contacts` | Liste des contacts |
| `searchUsers(query)` | `GET /users/search?q=` | Recherche d'utilisateurs pour ajout |
| `addContact(userId)` | `POST /contacts` | Ajouter un contact |
| `removeContact(userId)` | `DELETE /contacts/:id` | Supprimer un contact |
| `blockContact(userId)` | `POST /contacts/:id/block` | Bloquer un contact |

---

## `conversations.ts`

**Localisation** : `src/api/conversations.ts`

| Fonction | Endpoint | Description |
|----------|----------|-------------|
| `getConversations()` | `GET /conversations` | Liste des conversations |
| `getConversation(id)` | `GET /conversations/:id` | Détail + messages |
| `createConversation(participantIds)` | `POST /conversations` | Nouvelle conversation |
| `sendMessage(convId, content)` | `POST /conversations/:id/messages` | Envoyer un message |
| `markAsRead(convId)` | `PUT /conversations/:id/read` | Marquer comme lu |

---

## `notifications.ts`

**Localisation** : `src/api/notifications.ts`

| Fonction | Endpoint | Description |
|----------|----------|-------------|
| `getNotifications()` | `GET /notifications` | Notifications de l'utilisateur |
| `markNotificationRead(id)` | `PUT /notifications/:id/read` | Marquer comme lue |
| `markAllRead()` | `PUT /notifications/read-all` | Tout marquer comme lu |
| `deleteNotification(id)` | `DELETE /notifications/:id` | Supprimer une notification |

---

## `maintenance.ts`

**Localisation** : `src/api/maintenance.ts`

| Fonction | Endpoint | Description |
|----------|----------|-------------|
| `getMaintenanceStatus()` | `GET /maintenance/status` | Statut de maintenance |

**Retourne** :
```ts
{
  maintenance:   boolean;
  message?:      string;
  estimatedEnd?: string; // ISO date
}
```

---

## `websocket.ts`

**Localisation** : `src/api/websocket.ts`

| Fonction | Description |
|----------|-------------|
| `connectWebSocket()` | Établit la connexion WebSocket avec le serveur |
| `disconnectWebSocket()` | Ferme la connexion |
| `on(event, handler)` | Abonnement à un type d'événement |
| `off(event, handler)` | Désabonnement |
| `emit(event, data)` | Envoi d'un message |

**Événements reçus** : `new_message`, `notification`, `data_update`, `sos_update`

---

## `useAuth.ts`

**Localisation** : `src/api/useAuth.ts`

Hook React encapsulant `checkAuth()` avec état et rechargement automatique.

```ts
function useAuth(): {
  user:          User | null;
  isLoading:     boolean;
  isAuthenticated: boolean;
  refetch:       () => Promise<void>;
}
```
