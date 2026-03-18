# Service WebSocket — Application Mobile Qvarry

## Vue d'ensemble

Le service WebSocket gère la connexion temps réel entre l'application mobile et l'API Qvarry. Il est utilisé principalement pour la messagerie instantanée et les notifications en temps réel.

**URL** : `wss://api.qvarry.fr` (configuré via `ENV.WS_BASE_URL`)

---

## Architecture

```
WebSocketContext (Provider)
        │
        ├── useWebSocket() ← hook d'accès
        │
        └── src/services/api/websocket.ts ← logique de connexion
            └── src/services/websocket/ ← handlers d'événements
```

---

## `src/services/api/websocket.ts`

Gère la connexion WebSocket native avec :

- **Connexion automatique** après l'authentification
- **Reconnexion automatique** avec backoff exponentiel en cas de perte de connexion
- **Authentification** : le token Bearer est envoyé à la connexion
- **Ping/Pong** : keepalive pour détecter les connexions mortes

### Événements entrants

| Événement              | Description                                          |
| ---------------------- | ---------------------------------------------------- |
| `new_message`          | Nouveau message reçu dans une conversation           |
| `message_read`         | Message marqué comme lu par le destinataire          |
| `contact_request`      | Nouvelle demande de contact                          |
| `contact_accepted`     | Demande de contact acceptée                          |
| `sos_alert`            | Alerte SOS reçue (pour les contacts d'urgence)       |
| `notification`         | Notification in-app générique                        |

### Événements sortants

| Événement              | Description                                          |
| ---------------------- | ---------------------------------------------------- |
| `send_message`         | Envoi d'un message                                   |
| `mark_read`            | Marquer des messages comme lus                       |
| `typing`               | Indicateur de frappe                                 |

---

## `WebSocketContext`

**Fichier** : `src/contexts/WebSocketContext.tsx`

```typescript
interface WebSocketContextType {
  isConnected: boolean;
  send: (event: string, data: object) => void;
  subscribe: (event: string, callback: (data: any) => void) => () => void;
}
```

### Usage dans un composant

```typescript
const { isConnected, send, subscribe } = useWebSocket();

// S'abonner à un événement
useEffect(() => {
  const unsubscribe = subscribe('new_message', (message) => {
    // Traiter le nouveau message
    addMessageToConversation(message);
  });
  return unsubscribe; // Désabonnement automatique au démontage
}, [subscribe]);

// Envoyer un message
const handleSend = (text: string) => {
  send('send_message', {
    conversationId,
    content: text,
  });
};
```

---

## `useWebSocket` hook

**Fichier** : `src/hooks/useWebSocket.ts`

Hook simplifié pour accéder au contexte WebSocket.

```typescript
const { isConnected } = useWebSocket();
```

---

## Reconnexion automatique

Le service tente de se reconnecter automatiquement avec une stratégie de **backoff exponentiel** :

```
Tentative 1 : attendre 1s
Tentative 2 : attendre 2s
Tentative 3 : attendre 4s
Tentative 4 : attendre 8s
...
Maximum     : 30s entre les tentatives
```

La reconnexion s'arrête si :
- L'utilisateur se déconnecte explicitement
- L'app est fermée

---

## Sécurité

- Connexion uniquement via `wss://` (WebSocket Secure) en production
- Token JWT envoyé dans le premier message après connexion
- Domaine validé par `secureFetch` (whitelist : `qvarry.fr`)
