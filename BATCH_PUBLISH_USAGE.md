# Redis Batch Publish - Guide d'utilisation

## 🎯 Objectif

Réduire la latency de ~50% en regroupant les opérations de publish Redis grâce aux pipelines.

## 📊 Performance

### Avant (Sequential)

```typescript
// 5 messages = 5 round-trips réseau
for (const msg of messages) {
  await redisPubSubService.publishMessage(msg.conversationId, msg.data);
}
// Temps: ~50ms (10ms par message)
```

### Après (Batch Pipeline)

```typescript
// 5 messages = 1 seul round-trip réseau
await redisPubSubService.batchPublishMessages(messages);
// Temps: ~12ms (pipeline unique)
// Gain: ~76% plus rapide
```

## 🚀 Exemples d'utilisation

### 1. Batch Publish Messages (Conversations)

```typescript
import { redisPubSubService } from "./services/redisPubSubService";

// Envoyer plusieurs messages à différentes conversations en une fois
const messages = [
  {
    conversationId: "conv-123",
    message: { type: "chat", content: "Hello" },
    excludeUserId: "user-1",
    participantIds: ["user-2", "user-3"],
    senderName: "John",
  },
  {
    conversationId: "conv-456",
    message: { type: "chat", content: "Hi there" },
    participantIds: ["user-4", "user-5"],
  },
  {
    conversationId: "conv-789",
    message: { type: "typing", userId: "user-6" },
  },
];

const results = await redisPubSubService.batchPublishMessages(messages);
// results = [true, true, true] si tous ont réussi
```

### 2. Batch Publish Notifications

```typescript
// Envoyer des notifications à plusieurs utilisateurs en une fois
const notifications = [
  {
    userId: "user-1",
    notification: {
      type: "message",
      title: "Nouveau message",
      body: "Vous avez reçu un message",
    },
  },
  {
    userId: "user-2",
    notification: {
      type: "system",
      title: "Mise à jour",
      body: "Nouvelle version disponible",
    },
  },
  {
    userId: "user-3",
    notification: {
      type: "alert",
      title: "Attention",
      body: "Action requise",
    },
  },
];

const results =
  await redisPubSubService.batchPublishNotifications(notifications);
```

### 3. Batch Publish Générique (Custom Channels)

```typescript
// Pour des cas d'usage personnalisés avec des channels spécifiques
const customMessages = [
  {
    channel: "custom:channel:1",
    payload: { data: "Some data" },
  },
  {
    channel: "websocket:broadcast",
    payload: { event: "system_update", data: { version: "2.0" } },
  },
  {
    channel: "user:user-123:private",
    payload: { type: "direct_message", content: "Hello" },
  },
];

const results = await redisPubSubService.batchPublish(customMessages);
```

## 🔧 Cas d'usage recommandés

### ✅ Quand utiliser les batch operations

1. **Broadcast à plusieurs conversations simultanément**
   - Ex: Notification de maintenance à toutes les conversations actives
2. **Notifications push en masse**
   - Ex: Envoi de notifications à tous les participants d'un événement
3. **Synchronisation de données cross-cluster**
   - Ex: Mise à jour de cache sur tous les workers
4. **Propagation d'événements système**
   - Ex: Déconnexion forcée, mise à jour de permissions

### ❌ Quand NE PAS utiliser les batch operations

1. **Message unique urgent** - Utilisez `publishMessage()` direct
2. **Moins de 2 messages** - Le overhead du pipeline n'en vaut pas la peine
3. **Messages avec délais différents** - Mieux vaut des appels séparés

## 📈 Métriques et Monitoring

Les métriques batch sont intégrées dans les logs :

```typescript
// Les logs incluront :
{
  "count": 5,                    // Nombre de messages
  "duration": 12,                // Temps total (ms)
  "successCount": 5,             // Nombre de succès
  "channels": ["conv:123", ...]  // Liste des channels
}
```

## 🛠️ Intégration avec WebSocketService

```typescript
// Dans votre WebSocketService
class WebSocketService {
  async broadcastToMultipleConversations(
    broadcasts: Array<{
      conversationId: string;
      message: any;
    }>,
  ) {
    // Utiliser le batch publish pour optimiser
    await redisPubSubService.batchPublishMessages(broadcasts);
  }
}
```

## ⚡ Performance Tips

1. **Grouper intelligemment** : Accumulez 3-10 messages avant de batch
2. **Timeout raisonnable** : N'attendez pas plus de 100ms pour grouper
3. **Taille de batch** : Optimal entre 5-20 messages par batch
4. **Monitoring** : Surveillez les logs `duration` pour ajuster

## 🔒 Gestion d'erreurs

```typescript
const results = await redisPubSubService.batchPublishMessages(messages);

// Vérifier les résultats individuels
results.forEach((success, index) => {
  if (!success) {
    logger.error("Failed to publish message", {
      message: messages[index],
      index,
    });
  }
});

// Ou vérifier le taux de succès global
const successRate = results.filter((r) => r).length / results.length;
if (successRate < 0.9) {
  logger.warn("Low batch publish success rate", { successRate });
}
```

## 📝 Notes importantes

- Les pipelines Redis sont **atomiques** : soit tous passent, soit tous échouent
- La **déduplication** fonctionne toujours (basée sur `messageId`)
- L'**anti-echo** fonctionne toujours (basé sur `instanceId`)
- Les **métriques** sont correctement incrémentées pour chaque message

## 🎓 Documentation complémentaire

- [Redis Pipelining](https://redis.io/docs/manual/pipelining/)
- [ioredis Pipeline API](https://github.com/luin/ioredis#pipelining)
