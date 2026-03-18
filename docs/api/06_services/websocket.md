# Service WebSocket

## Table des matières

- [Vue d'ensemble](#vue-densemble)
- [Authentification](#authentification)
- [Namespaces](#namespaces)
- [Messages supportés](#messages-supportés)
- [Rate limiting WebSocket](#rate-limiting-websocket)
- [Heartbeat et détection de connexions mortes](#heartbeat-et-détection-de-connexions-mortes)
- [Cache de participation](#cache-de-participation)
- [Gestion du SOS côté WebSocket](#gestion-du-sos-côté-websocket)

---

## Vue d'ensemble

Le service WebSocket utilise la librairie **`ws`** (natif Node.js WebSocket, pas Socket.io) pour fournir des communications bidirectionnelles en temps réel.

> ⚠️ La librairie utilisée est **`ws`** et non Socket.io. Le protocole est WebSocket standard (RFC 6455). Les clients doivent utiliser l'API `WebSocket` native du navigateur ou une librairie compatible.

```
┌─────────────────────────────────────────────────────────────┐
│                    Client (Mobile/Web)                       │
│                                                             │
│  1. GET /api/v1/auth/ws-token                               │
│     → { notificationsToken, messagesToken, expiresIn }      │
│                                                             │
│  2. ws://host/ws/notifications                              │
│     → send({ type: "auth", token: notificationsToken })     │
│                                                             │
│  3. ws://host/ws/messages?conv=<conversationId>             │
│     → send({ type: "auth", token: messagesToken })          │
└──────────────────────────────┬──────────────────────────────┘
                               │ WebSocket (ws library)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 WebSocket Server (ws)                        │
│                                                             │
│  /ws/notifications  ← Notifications en temps réel (readonly)│
│  /ws/messages       ← Messagerie bidirectionnelle           │
│                                                             │
│  Rate limit : 60 msg/min + 10 conn/min par IP              │
│  Heartbeat : ping/pong automatique (30s)                    │
│  Auth timeout : 5 secondes max                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Authentification

Les connexions WebSocket utilisent un **token temporaire** distinct du JWT principal, valable 5 minutes.

### Obtenir un ws-token

```http
GET /api/v1/auth/ws-token
Authorization: Bearer eyJhbGci...
```

Réponse :

```json
{
  "notificationsToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "messagesToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 300
}
```

> 💡 **Deux tokens distincts** sont générés : un pour `/ws/notifications` et un pour `/ws/messages`. Chaque token contient un JTI unique et ne peut être utilisé qu'une seule fois.

### Utiliser les ws-tokens

L'authentification se fait en **deux étapes** :

1. **Établir la connexion WebSocket** (sans authentification initiale)
2. **Envoyer un message d'authentification** dans les 5 secondes

#### Pour `/ws/notifications` :

```javascript
// 1. Ouvrir la connexion
const ws = new WebSocket("wss://api.qvarry.com/ws/notifications");

// 2. Authentifier via message applicatif
ws.onopen = () => {
  ws.send(
    JSON.stringify({
      type: "auth",
      token: notificationsToken, // Token obtenu via /api/v1/auth/ws-token
    }),
  );
};

// 3. Écouter la confirmation
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === "connected") {
    console.log("✓ Authentifié :", msg.message);
  }
};
```

#### Pour `/ws/messages` :

```javascript
// 1. Ouvrir la connexion avec le paramètre conv (conversationId)
const conversationId = "64a1b2c3d4e5f6...";
const ws = new WebSocket(
  `wss://api.qvarry.com/ws/messages?conv=${conversationId}`,
);

// 2. Authentifier via message applicatif
ws.onopen = () => {
  ws.send(
    JSON.stringify({
      type: "auth",
      token: messagesToken, // Token obtenu via /api/v1/auth/ws-token
    }),
  );
};

// 3. Écouter la confirmation
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === "connected") {
    console.log("✓ Authentifié :", msg.message);
  }
};
```

> ⚠️ **Règles d'authentification :**
>
> - Les tokens sont à **usage unique** (JTI consommé après première utilisation)
> - Timeout de 5 secondes : si le message `{ type: "auth", token: "..." }` n'est pas envoyé dans les 5 secondes, la connexion est fermée avec le code `4001` (Auth timeout)
> - Les tokens expirent après 5 minutes
> - Chaque token est spécifique à un namespace (`notificationsToken` pour `/ws/notifications`, `messagesToken` pour `/ws/messages`)
> - En cas de reconnexion, un nouveau token doit être obtenu via `/api/v1/auth/ws-token`

### Validation de l'origine

Les connexions WebSocket sont restreintes aux origines autorisées :

```
Variable env : ALLOWED_WS_ORIGINS
Exemple : https://app.qvarry.com,https://qvarry.com

En développement : toutes les origines locales acceptées
En production : liste blanche stricte
```

---

## Namespaces

### /ws/notifications

Flux de notifications en temps réel pour l'utilisateur authentifié.

**Caractéristiques :**

- Canal **en lecture seule** : le client ne peut pas envoyer de messages (sauf l'authentification initiale)
- Le serveur envoie des notifications push au client
- Nécessite le `notificationsToken` obtenu via `/api/v1/auth/ws-token`

| Type de notification | Déclencheur                                   |
| -------------------- | --------------------------------------------- |
| `contact_request`    | Nouvelle demande de contact reçue             |
| `contact_accepted`   | Demande de contact acceptée                   |
| `message_received`   | Nouveau message dans une conversation         |
| `sos_alert`          | Alerte SOS d'un contact (Stage 1)             |
| `sos_resolved`       | Session SOS résolue                           |
| `sos_server_restart` | Redémarrage du serveur (sessions SOS actives) |
| `account_approved`   | Compte approuvé par admin                     |
| `share_notification` | Données partagées par un contact              |

> ⚠️ Si le client envoie un message autre que l'auth initiale, il recevra une erreur `CHANNEL_READONLY`.

### /ws/messages

Messagerie en temps réel dans les conversations.

**Caractéristiques :**

- Canal **bidirectionnel** : le client peut envoyer et recevoir des messages
- Nécessite le paramètre `conv` (conversationId) dans l'URL : `/ws/messages?conv=<conversationId>`
- Nécessite le `messagesToken` obtenu via `/api/v1/auth/ws-token`
- L'utilisateur doit être **participant** de la conversation spécifiée

| Type de message     | Description                             |
| ------------------- | --------------------------------------- |
| `message`           | Envoyer un message                      |
| `getMessages`       | Charger les messages d'une conversation |
| `markMessageAsRead` | Marquer un message comme lu             |
| `replyToMessage`    | Répondre à un message                   |
| `editMessage`       | Modifier un message envoyé              |
| `deleteMessage`     | Supprimer un message                    |

---

## Messages supportés

### Format général des messages

Tous les messages WebSocket utilisent le format JSON avec des types en **camelCase** :

```json
// Message client → serveur
{
  "type": "message",
  "content": "Bonjour !",
  "messageType": "text"
}

// Message serveur → client
{
  "type": "messageSent",
  "messageId": "64a1b2c3d4e5...",
  "sentAt": "2026-03-18T10:00:00.000Z"
}
```

### Types de messages supportés

#### 1. `message` — Envoyer un message

```json
// Requête
{
  "type": "message",
  "content": "Bonjour !",
  "messageType": "text",
  "metadata": {}
}

// Réponse
{
  "type": "messageSent",
  "messageId": "64a1b2c3d4e5...",
  "conversationId": "64a1b2c3...",
  "content": "Bonjour !",
  "sentAt": "2026-03-18T10:00:00.000Z"
}
```

**Validation :**

- `content` : string, min 1 caractère, max 10 000 caractères
- `messageType` : optionnel (ex: "text", "image", "file")
- `metadata` : optionnel, objet libre

#### 2. `getMessages` — Charger les messages

```json
// Requête
{
  "type": "getMessages",
  "query": {
    "before": "2026-03-18T10:00:00.000Z",
    "limit": 50,
    "offset": 0
  }
}

// Réponse
{
  "type": "messagesList",
  "messages": [
    {
      "messageId": "64a1b2c3d4e5...",
      "content": "Contenu du message",
      "sentAt": "2026-03-18T09:55:00.000Z",
      "senderId": "64a1b2c3..."
    }
  ],
  "hasMore": true
}
```

**Validation :**

- `query.limit` : optionnel, entier entre 1 et 100
- `query.offset` : optionnel, entier >= 0
- `query.before` : optionnel, date ISO 8601

#### 3. `markMessageAsRead` — Marquer un message comme lu

```json
// Requête
{
  "type": "markMessageAsRead",
  "messageId": "64a1b2c3d4e5..."
}

// Réponse
{
  "type": "messageRead",
  "messageId": "64a1b2c3d4e5...",
  "readAt": "2026-03-18T10:00:00.000Z"
}
```

#### 4. `replyToMessage` — Répondre à un message

```json
// Requête
{
  "type": "replyToMessage",
  "messageId": "64a1b2c3d4e5...",
  "content": "Ma réponse"
}

// Réponse
{
  "type": "messageSent",
  "messageId": "64a1b2c3d4e5f6...",
  "replyTo": "64a1b2c3d4e5...",
  "content": "Ma réponse",
  "sentAt": "2026-03-18T10:00:00.000Z"
}
```

**Validation :**

- `messageId` : string, min 1 caractère (ID du message parent)
- `content` : string, min 1 caractère, max 10 000 caractères

#### 5. `editMessage` — Modifier un message

```json
// Requête
{
  "type": "editMessage",
  "messageId": "64a1b2c3d4e5...",
  "content": "Contenu modifié"
}

// Réponse
{
  "type": "messageEdited",
  "messageId": "64a1b2c3d4e5...",
  "content": "Contenu modifié",
  "editedAt": "2026-03-18T10:00:00.000Z"
}
```

**Validation :**

- `messageId` : string, min 1 caractère
- `content` : string, min 1 caractère, max 10 000 caractères

#### 6. `deleteMessage` — Supprimer un message

```json
// Requête
{
  "type": "deleteMessage",
  "messageId": "64a1b2c3d4e5..."
}

// Réponse
{
  "type": "messageDeleted",
  "messageId": "64a1b2c3d4e5...",
  "deletedAt": "2026-03-18T10:00:00.000Z"
}
```

### Messages d'erreur

En cas d'erreur, le serveur envoie un message avec le type `error` :

```json
{
  "type": "error",
  "code": "VALIDATION_ERROR",
  "message": "Données invalides",
  "field": "content"
}
```

**Codes d'erreur possibles :**

| Code                   | Description                                  |
| ---------------------- | -------------------------------------------- |
| `INVALID_JSON`         | Le message n'est pas un JSON valide          |
| `INVALID_MESSAGE_TYPE` | Type de message non supporté                 |
| `VALIDATION_ERROR`     | Validation Zod échouée (champ invalide)      |
| `ACCESS_REVOKED`       | L'utilisateur n'est plus participant         |
| `RATE_LIMIT_EXCEEDED`  | Trop de messages envoyés (> 60 msg/min)      |
| `MESSAGE_TOO_LARGE`    | Message > 64 KB                              |
| `CHANNEL_READONLY`     | Tentative d'envoi sur le canal notifications |

### Codes de fermeture WebSocket

| Code   | Raison               | Description                                    |
| ------ | -------------------- | ---------------------------------------------- |
| `1000` | Normal closure       | Fermeture propre                               |
| `4001` | Auth required        | Pas d'authentification dans les 5 secondes     |
| `4002` | Invalid token        | Token JWT invalide ou mauvais type             |
| `4003` | Not a participant    | Utilisateur non participant de la conversation |
| `4029` | Too many connections | Rate limit dépassé (> 10 connexions/min)       |

### Message serveur : `sos_server_restart`

Message envoyé par le serveur à tous les clients connectés ayant une session SOS active lors d'un redémarrage :

```json
// Serveur → Client (canal /ws/notifications)
{
  "type": "sos_server_restart",
  "message": "Le serveur a redémarré. Votre session SOS est maintenue.",
  "sessionId": "64a1b2c3...",
  "status": "ACTIVE",
  "newExpiresAt": "2026-03-18T12:00:00.000Z"
}
```

---

## Rate limiting WebSocket

### Rate limiting par message (canal `/ws/messages`)

| Paramètre                 | Valeur                       | Description                           |
| ------------------------- | ---------------------------- | ------------------------------------- |
| `MAX_MESSAGES_PER_MINUTE` | 60                           | Messages max par minute par connexion |
| Compteur                  | Par connexion WebSocket      | Indépendant du rate limit HTTP        |
| Fenêtre temporelle        | 60 secondes glissantes       | Réinitialisé après 1 minute           |
| Comportement si dépassé   | Message d'erreur (pas fermé) | `RATE_LIMIT_EXCEEDED`                 |

```json
// Message reçu si rate limit atteint
{
  "type": "error",
  "code": "RATE_LIMIT_EXCEEDED",
  "message": "Trop de messages envoyés. Veuillez ralentir."
}
```

> 💡 La connexion n'est **pas fermée** immédiatement, mais le message n'est pas traité. Le compteur se réinitialise après 1 minute.

### Rate limiting par connexion (nombre de connexions par IP)

| Paramètre                    | Valeur    | Description                              |
| ---------------------------- | --------- | ---------------------------------------- |
| `MAX_CONNECTIONS_PER_MINUTE` | 10        | Connexions max par minute par IP         |
| Durée de blocage             | 5 minutes | Si limite dépassée, IP bloquée 5 minutes |
| Code de fermeture            | `4029`    | `Too many connections`                   |

```json
// Connexion refusée si rate limit atteint
// Code de fermeture : 4029
// Raison : "Trop de tentatives de connexion. Bloqué pour 5 minutes."
```

---

## Heartbeat et détection de connexions mortes

Le serveur envoie des **pings** réguliers pour détecter les connexions zombies (fermées côté client sans fermeture propre).

```
Serveur                          Client
   │                                │
   │──── ping ─────────────────────▶│
   │                                │
   │◀─── pong ──────────────────────│
   │                                │
   │  (30s plus tard)               │
   │──── ping ─────────────────────▶│
   │                                │ (connexion morte)
   │  (pas de pong reçu)            │
   │                                │
   │  Ferme la connexion (timeout)  │
```

| Paramètre         | Valeur                        | Variable d'environnement   |
| ----------------- | ----------------------------- | -------------------------- |
| Intervalle ping   | 30 secondes (par défaut)      | `WS_HEARTBEAT_INTERVAL_MS` |
| Timeout pong      | Jusqu'au prochain ping        | —                          |
| Action si timeout | Fermeture connexion + cleanup | `client.terminate()`       |

> 💡 Le client **n'a pas besoin** de gérer manuellement les pongs : le navigateur répond automatiquement aux pings WebSocket (protocole natif).

---

## Cache de participation

Un cache en mémoire optimise les vérifications de participation aux conversations pour éviter des requêtes MongoDB répétées.

| Paramètre  | Valeur                  | Description                             |
| ---------- | ----------------------- | --------------------------------------- |
| TTL        | 5 minutes               | Durée de vie d'une entrée cache         |
| Taille max | 10 000 entrées          | Cache LRU (éviction des plus anciennes) |
| Clé        | `userId:conversationId` | Paire utilisateur/conversation          |
| Valeur     | `boolean`               | `true` = participant autorisé           |

```
Requête message (type: "message", "markMessageAsRead", etc.) :

  1. Vérifier cache[userId:conversationId]
     ├── Hit  → utiliser résultat (évite requête DB)
     └── Miss → requête MongoDB → stocker en cache

  2. Si non participant → envoyer erreur ACCESS_REVOKED + fermer connexion (code 4003)
```

**Invalidation du cache :**

Le cache est automatiquement invalidé dans les cas suivants :

- Utilisateur ajouté ou retiré d'une conversation → méthode `invalidateConversationCache(conversationId)`
- Entrée expirée (> 5 minutes)
- Taille du cache > 10 000 entrées → éviction LRU des entrées les plus anciennes

---

## Gestion du SOS côté WebSocket

Le service WebSocket joue un rôle dans l'escalade SOS **Stage 1** : il notifie en temps réel les contacts de l'utilisateur en alerte via le canal `/ws/notifications`.

```
Session SOS expire → Stage 1 (15 min après)
        │
        ▼
SOS Service → WebSocket Service
        │
        ▼
Pour chaque contact avec session WebSocket active (/ws/notifications) :
  Envoi notification :
  {
    "type": "sos_alert",
    "userId": "...",
    "userName": "Jean Dupont",
    "lastLocation": { "lat": 43.29, "lng": 5.37 },
    "sessionId": "...",
    "escalationStage": 1,
    "message": "Jean Dupont n'a pas donné signe de vie"
  }
```

**Méthodes WebSocket utilisées :**

- `notifySOSAlert(userId, data)` : Envoie une alerte SOS via `/ws/notifications`
- `notifySOSResolved(userId, data)` : Notifie la résolution d'une session SOS
- Si WebSocket échoue → fallback sur push notification (Firebase FCM)

---

_Voir aussi : [sos-service.md](sos-service.md) — [push-notifications.md](push-notifications.md)_
