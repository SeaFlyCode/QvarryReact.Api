# Client API — IHM Qvarry

## Vue d'ensemble

Tous les appels HTTP vers le back-end Qvarry sont centralisés dans `src/api/`. Chaque module correspond à un domaine fonctionnel et utilise le client HTTP commun `src/api/client.ts`.

---

## Client HTTP (`client.ts`)

**Fichier** : `src/api/client.ts`

Client `fetch` centralisé qui :
- Préfixe automatiquement l'URL avec `NEXT_PUBLIC_API_URL`
- Inclut les credentials (cookies) dans toutes les requêtes (`credentials: 'include'`)
- Gère les erreurs HTTP et les transforme en exceptions JavaScript
- Déclenche un refresh de token automatique en cas de 401 (via `tokenRefresh.ts`)

---

## Refresh Token (`tokenRefresh.ts`)

**Fichier** : `src/api/tokenRefresh.ts`

Mécanisme de renouvellement automatique du JWT :
1. Si une requête retourne `401 Unauthorized`
2. Le client tente un `POST /api/v1/auth/refresh`
3. Si le refresh réussit, la requête originale est re-tentée
4. Si le refresh échoue, l'utilisateur est redirigé vers `/`

---

## Authentification (`auth.ts`)

**Fichier** : `src/api/auth.ts`

| Fonction | Méthode | Endpoint | Description |
|----------|---------|----------|-------------|
| `login(email, password, turnstileToken?)` | POST | `/api/v1/auth/login` | Connexion |
| `register(data)` | POST | `/api/v1/auth/register` | Inscription |
| `logout()` | POST | `/api/v1/auth/logout` | Déconnexion |
| `checkAuth()` | GET | `/api/v1/auth/check` | Vérification session active |
| `invalidateAuthCache()` | — | — | Invalide le cache local |
| `refreshToken()` | POST | `/api/v1/auth/refresh` | Renouvellement du JWT |
| `forgotPassword(email)` | POST | `/api/v1/auth/forgot-password` | Demande reset mot de passe |
| `resetPassword(email, code, password)` | POST | `/api/v1/auth/reset-password` | Reset avec code |
| `verifyEmail(email, code)` | POST | `/api/v1/auth/verify-email` | Vérification email |

---

## Hook d'authentification (`useAuth.ts`)

**Fichier** : `src/api/useAuth.ts`

Hook React qui expose l'état d'authentification dans les composants :

```typescript
const { user, isAuthenticated, isAdmin, loading } = useAuth();
```

---

## Authentification 2FA (`twoFactor.ts`)

**Fichier** : `src/api/twoFactor.ts`

| Fonction | Endpoint | Description |
|----------|----------|-------------|
| `setup2FA()` | GET `/api/v1/2fa/setup` | Génération QR code + secret |
| `verify2FA(code)` | POST `/api/v1/2fa/verify` | Vérification du code TOTP |
| `disable2FA(code)` | POST `/api/v1/2fa/disable` | Désactivation |
| `confirm2FALogin(tempToken, code)` | POST `/api/v1/2fa/confirm-login` | Finalisation login 2FA |

---

## Fiches (`fiches.ts`)

**Fichier** : `src/api/fiches.ts`

| Fonction | Méthode | Endpoint | Description |
|----------|---------|----------|-------------|
| `getFiches()` | GET | `/api/v1/fiches` | Liste des fiches |
| `getFicheById(id)` | GET | `/api/v1/fiches/:id` | Détail d'une fiche |
| `createFiche(data)` | POST | `/api/v1/fiches` | Création |
| `updateFiche(id, data)` | PUT | `/api/v1/fiches/:id` | Mise à jour |
| `deleteFiche(id)` | DELETE | `/api/v1/fiches/:id` | Suppression |

---

## Listes (`lists.ts`)

**Fichier** : `src/api/lists.ts`

| Fonction | Méthode | Endpoint | Description |
|----------|---------|----------|-------------|
| `getLists()` | GET | `/api/v1/lists` | Liste des listes |
| `createList(data)` | POST | `/api/v1/lists` | Création d'une liste |
| `updateList(id, data)` | PUT | `/api/v1/lists/:id` | Mise à jour |
| `deleteList(id)` | DELETE | `/api/v1/lists/:id` | Suppression |

---

## Points (`points.ts`)

**Fichier** : `src/api/points.ts`

| Fonction | Méthode | Endpoint | Description |
|----------|---------|----------|-------------|
| `getPoints()` | GET | `/api/v1/points` | Liste des points |
| `createPoint(data)` | POST | `/api/v1/points` | Création d'un point |
| `updatePoint(id, data)` | PUT | `/api/v1/points/:id` | Mise à jour |
| `deletePoint(id)` | DELETE | `/api/v1/points/:id` | Suppression |

---

## Conversations (`conversations.ts`)

**Fichier** : `src/api/conversations.ts`

| Fonction | Endpoint | Description |
|----------|----------|-------------|
| `getConversations()` | GET `/api/v1/conversations` | Liste des conversations |
| `createConversation(data)` | POST `/api/v1/conversations` | Nouvelle conversation |
| `getMessages(conversationId)` | GET `/api/v1/messages/:id` | Messages d'une conversation |
| `sendMessage(conversationId, content)` | POST `/api/v1/messages` | Envoi d'un message |

---

## Contacts (`contacts.ts`)

**Fichier** : `src/api/contacts.ts`

| Fonction | Endpoint | Description |
|----------|----------|-------------|
| `getContacts()` | GET `/api/v1/contacts` | Liste des contacts |
| `sendContactRequest(userId)` | POST `/api/v1/contacts/request` | Demande de contact |
| `acceptContactRequest(id)` | PUT `/api/v1/contacts/:id/accept` | Accepter une demande |
| `rejectContactRequest(id)` | PUT `/api/v1/contacts/:id/reject` | Refuser une demande |

---

## Notifications (`notifications.ts`)

**Fichier** : `src/api/notifications.ts`

| Fonction | Endpoint | Description |
|----------|----------|-------------|
| `getNotifications()` | GET `/api/v1/notifications` | Liste des notifications |
| `markAsRead(id)` | PUT `/api/v1/notifications/:id/read` | Marquer comme lue |
| `markAllAsRead()` | PUT `/api/v1/notifications/read-all` | Tout marquer comme lu |

---

## Partages (`share.ts`)

**Fichier** : `src/api/share.ts`

| Fonction | Endpoint | Description |
|----------|----------|-------------|
| `getReceivedShares()` | GET `/api/v1/share/received` | Partages reçus |
| `getSentShares()` | GET `/api/v1/share/sent` | Partages envoyés |
| `shareData(userId, data)` | POST `/api/v1/share` | Partager des données |
| `acceptShare(id)` | PUT `/api/v1/share/:id/accept` | Accepter un partage |

---

## Utilisateur (`user.ts`)

**Fichier** : `src/api/user.ts`

| Fonction | Endpoint | Description |
|----------|----------|-------------|
| `getProfile()` | GET `/api/v1/users/me` | Profil courant |
| `updateProfile(data)` | PUT `/api/v1/users/me` | Mise à jour profil |
| `changePassword(data)` | PUT `/api/v1/users/me/password` | Changement mot de passe |
| `deleteAccount()` | DELETE `/api/v1/users/me` | Suppression du compte |
| `getSessions()` | GET `/api/v1/security/sessions` | Sessions actives |
| `revokeSession(sessionId)` | DELETE `/api/v1/security/sessions/:id` | Révoquer une session |

---

## Administration (`admin.ts`)

**Fichier** : `src/api/admin.ts`

Requiert un JWT avec `isAdmin: true`.

| Fonction | Endpoint | Description |
|----------|----------|-------------|
| `getUsers()` | GET `/api/v1/admin/users` | Liste de tous les utilisateurs |
| `validateUser(id)` | PUT `/api/v1/admin/users/:id/validate` | Valider un compte |
| `rejectUser(id)` | PUT `/api/v1/admin/users/:id/reject` | Refuser un compte |
| `getAuditLogs(filters)` | GET `/api/v1/admin/audit` | Logs d'audit |
| `getMetrics()` | GET `/metrics` | Métriques applicatives |

---

## Synchronisation (`sync.ts`)

**Fichier** : `src/api/sync.ts`

Synchronisation incrémentale des données (points, fiches, listes) depuis le dernier timestamp de synchronisation.

---

## Maintenance (`maintenance.ts`)

**Fichier** : `src/api/maintenance.ts`

| Fonction | Endpoint | Description |
|----------|----------|-------------|
| `getMaintenanceStatus()` | GET `/api/v1/maintenance/status` | État du mode maintenance |

---

## Géolocalisation (`geo.ts`)

**Fichier** : `src/api/geo.ts`

Appels vers les API externes de géocodage (pas le back-end Qvarry) :
- `https://geo.api.gouv.fr` — Recherche de communes françaises
- `https://api-adresse.data.gouv.fr` — Géocodage d'adresses

---

## WebSocket (`websocket.ts`)

**Fichier** : `src/api/websocket.ts`

Client WebSocket pour la messagerie temps réel.

**Fonctionnement** :
1. Connexion à `ws(s)://<API_ORIGIN>/ws` avec le JWT en cookie
2. Envoi de messages via `ws.send(JSON.stringify({ type, payload }))`
3. Réception des messages via `ws.onmessage`
4. Reconnexion automatique en cas de déconnexion

**Types de messages** :
| Type | Direction | Description |
|------|-----------|-------------|
| `message` | ↔ | Nouveau message dans une conversation |
| `conversation_update` | ← | Mise à jour d'une conversation |
| `notification` | ← | Nouvelle notification |
| `ping` | → | Keep-alive |
