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
┌─────────────────────────────────────────────────────────┐
│                    Client (Mobile/Web)                   │
│                                                         │
│  1. GET /api/v1/auth/ws-token  ← Obtenir token temp     │
│  2. ws://host/ws/notifications?token=<ws-token>         │
│  3. ws://host/ws/messages?token=<ws-token>              │
└────────────────────────────┬────────────────────────────┘
                             │ WebSocket
                             ▼
┌─────────────────────────────────────────────────────────┐
│                 WebSocket Server (ws)                    │
│                                                         │
│  /ws/notifications  ← Notifications en temps réel       │
│  /ws/messages       ← Messagerie en temps réel          │
│                                                         │
│  Rate limit : 60 msg/min par connexion                  │
│  Heartbeat : ping/pong automatique                      │
└─────────────────────────────────────────────────────────┘
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
  "wsToken": "a1b2c3d4e5f6...",
  "expiresIn": 300,
  "expiresAt": "2026-03-18T10:05:00.000Z"
}
```

### Utiliser le ws-token

```javascript
// Connexion avec token en query string
const ws = new WebSocket(
  "wss://api.qvarry.com/ws/notifications?token=a1b2c3d4e5f6...",
);

// Ou via header Authorization (si supporté par le client)
const ws = new WebSocket("wss://api.qvarry.com/ws/notifications", [], {
  headers: { Authorization: "Bearer a1b2c3d4e5f6..." },
});
```

> ⚠️ Le ws-token est à **usage unique** et expire après 5 minutes. En cas de reconnexion, un nouveau token doit être obtenu.

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

### /ws/messages

Messagerie en temps réel dans les conversations.

| Type de message | Description                             |
| --------------- | --------------------------------------- |
| `SEND_MESSAGE`  | Envoyer un message                      |
| `GET_MESSAGES`  | Charger les messages d'une conversation |
| `READ_MESSAGE`  | Marquer un message comme lu             |
| `REPLY`         | Répondre à un message                   |
| `EDIT`          | Modifier un message envoyé              |
| `DELETE`        | Supprimer un message                    |

---

## Messages supportés

### Format général des messages

Tous les messages WebSocket utilisent le format JSON :

```json
// Message client → serveur
{
  "type": "SEND_MESSAGE",
  "payload": { ... },
  "requestId": "req-uuid-1234"
}

// Message serveur → client
{
  "type": "MESSAGE_SENT",
  "payload": { ... },
  "requestId": "req-uuid-1234",
  "timestamp": "2026-03-18T10:00:00.000Z"
}
```

### SEND_MESSAGE

```json
// Requête
{
  "type": "SEND_MESSAGE",
  "payload": {
    "conversationId": "64a1b2c3...",
    "content": "Bonjour !",
    "type": "text"
  }
}

// Réponse
{
  "type": "MESSAGE_SENT",
  "payload": {
    "messageId": "64a1b2c3d4e5...",
    "conversationId": "64a1b2c3...",
    "content": "Bonjour !",
    "sentAt": "2026-03-18T10:00:00.000Z"
  }
}
```

### GET_MESSAGES

```json
// Requête
{
  "type": "GET_MESSAGES",
  "payload": {
    "conversationId": "64a1b2c3...",
    "before": "2026-03-18T10:00:00.000Z",
    "limit": 50
  }
}
```

### READ_MESSAGE

```json
// Requête
{
  "type": "READ_MESSAGE",
  "payload": {
    "messageId": "64a1b2c3d4e5...",
    "conversationId": "64a1b2c3..."
  }
}
```

### EDIT / DELETE

```json
// Edit
{
  "type": "EDIT",
  "payload": {
    "messageId": "64a1b2c3d4e5...",
    "newContent": "Contenu modifié"
  }
}

// Delete
{
  "type": "DELETE",
  "payload": {
    "messageId": "64a1b2c3d4e5..."
  }
}
```

### SOS_SERVER_RESTART

Message envoyé par le serveur à tous les clients connectés ayant une session SOS active lors d'un redémarrage :

```json
// Serveur → Client
{
  "type": "SOS_SERVER_RESTART",
  "payload": {
    "message": "Le serveur a redémarré. Votre session SOS est maintenue.",
    "sessionId": "64a1b2c3...",
    "status": "ACTIVE",
    "newExpiresAt": "2026-03-18T12:00:00.000Z"
  }
}
```

---

## Rate limiting WebSocket

| Paramètre                 | Valeur                          | Description                           |
| ------------------------- | ------------------------------- | ------------------------------------- |
| `MAX_MESSAGES_PER_MINUTE` | 60                              | Messages max par minute par connexion |
| Compteur                  | Par connexion WebSocket         | Indépendant du rate limit HTTP        |
| Comportement si dépassé   | Fermeture connexion (code 1008) | `Policy Violation`                    |

```javascript
// Message reçu si rate limit atteint
{
  "type": "ERROR",
  "error": "RATE_LIMIT_EXCEEDED",
  "message": "Trop de messages. Connexion fermée.",
  "code": 1008
}
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
   │  (pas de pong dans 10s)        │
   │                                │
   │  Ferme la connexion (timeout)  │
```

| Paramètre         | Valeur                        |
| ----------------- | ----------------------------- |
| Intervalle ping   | 30 secondes                   |
| Timeout pong      | 10 secondes                   |
| Action si timeout | Fermeture connexion + cleanup |

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
Requête SEND_MESSAGE :

  1. Vérifier cache[userId:conversationId]
     ├── Hit  → utiliser résultat (évite requête DB)
     └── Miss → requête MongoDB → stocker en cache

  2. Si non participant → fermer connexion
```

---

## Gestion du SOS côté WebSocket

Le service WebSocket joue un rôle dans l'escalade SOS **Stage 1** : il notifie en temps réel les contacts de l'utilisateur en alerte.

```
Session SOS expire → Stage 1 (15 min après)
        │
        ▼
SOS Service → WebSocket Service
        │
        ▼
Pour chaque contact avec session WebSocket active :
  Envoi notification /ws/notifications :
  {
    "type": "sos_alert",
    "payload": {
      "userId": "...",
      "userName": "Jean Dupont",
      "lastLocation": { "lat": 43.29, "lng": 5.37 },
      "sessionId": "...",
      "escalationStage": 1,
      "message": "Jean Dupont n'a pas donné signe de vie"
    }
  }
```

---

_Voir aussi : [sos-service.md](sos-service.md) — [push-notifications.md](push-notifications.md)_
