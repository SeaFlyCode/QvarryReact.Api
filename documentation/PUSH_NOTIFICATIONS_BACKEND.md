# Documentation Backend - Push Notifications Qvarry

## Vue d'ensemble

Ce document décrit l'implémentation backend nécessaire pour le système de push notifications de l'application mobile Qvarry. L'application cliente est déjà configurée et prête à recevoir des notifications.

### Architecture

Le serveur communique **directement avec l'API Firebase Cloud Messaging (FCM)** sans intermédiaire. FCM gère automatiquement la distribution vers Android (FCM natif) et iOS (proxy vers APNs), ce qui signifie qu'un seul endpoint suffit pour les deux plateformes.

- **Android** : FCM HTTP v1 API
- **iOS** : FCM HTTP v1 API (qui proxie automatiquement vers APNs)
- **Authentification** : Service Account JSON (OAuth2 Bearer Token)

## Informations techniques du projet

- **Projet Firebase** : `com.sealfy.Qvarryphone`
- **EAS Project ID** : `180c2683-90ab-4c86-adc8-127647c4498e`
- **Bundle iOS** : `com.sealfy.Qvarryphone`
- **Package Android** : `com.sealfy.Qvarryphone`

## Cycle de vie des tokens côté client

Le client mobile gère automatiquement les tokens FCM :

1. **Au login** : Le client récupère un token FCM via `@react-native-firebase/messaging`
2. **Enregistrement** : Le token est envoyé au backend via `POST /mobile/push-tokens`
3. **Rafraîchissement** : Si FCM invalide le token, le client en génère un nouveau et l'enregistre automatiquement
4. **Au logout** : Le client supprime le token via `DELETE /mobile/push-tokens`

## Endpoints à implémenter

### 1. POST /mobile/push-tokens

**Description** : Enregistre ou met à jour un token FCM pour un appareil.

**Authentification** : Requise (JWT ou session)

**Body** :
```json
{
  "token": "fcm_token_string",
  "platform": "ios" | "android",
  "deviceId": "uuid-device-id"
}
```

**Logique** :
- Associer le token au `userId` authentifié
- Utiliser un **upsert** basé sur `deviceId` : si un token existe déjà pour cet appareil, le remplacer
- Stocker la plateforme et la date de dernière mise à jour

**Réponse** :
```json
{
  "success": true
}
```

**Exemple d'implémentation (Node.js/Express)** :
```javascript
router.post('/mobile/push-tokens', authenticateUser, async (req, res) => {
  try {
    const { token, platform, deviceId } = req.body;
    const userId = req.user.id;

    // Validation
    if (!token || !platform || !deviceId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!['ios', 'android'].includes(platform)) {
      return res.status(400).json({ error: 'Invalid platform' });
    }

    // Upsert du token
    await PushToken.findOneAndUpdate(
      { deviceId, userId },
      {
        token,
        platform,
        userId,
        deviceId,
        updatedAt: new Date()
      },
      { upsert: true, new: true }
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving push token:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

### 2. DELETE /mobile/push-tokens

**Description** : Supprime le token FCM d'un appareil (généralement au logout).

**Authentification** : Requise

**Body** :
```json
{
  "deviceId": "uuid-device-id"
}
```

**Logique** :
- Supprimer le token associé au `deviceId` et `userId` de l'utilisateur authentifié

**Réponse** :
```json
{
  "success": true
}
```

**Exemple d'implémentation** :
```javascript
router.delete('/mobile/push-tokens', authenticateUser, async (req, res) => {
  try {
    const { deviceId } = req.body;
    const userId = req.user.id;

    if (!deviceId) {
      return res.status(400).json({ error: 'Missing deviceId' });
    }

    await PushToken.deleteOne({ deviceId, userId });

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting push token:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

## Modèle de données MongoDB

### Collection `push_tokens`

```javascript
const PushTokenSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  deviceId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  token: {
    type: String,
    required: true
  },
  platform: {
    type: String,
    enum: ['ios', 'android'],
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Index composé pour retrouver rapidement les tokens d'un utilisateur
PushTokenSchema.index({ userId: 1, deviceId: 1 }, { unique: true });

const PushToken = mongoose.model('PushToken', PushTokenSchema);
```

## Format des notifications push

Le client attend un payload FCM avec cette structure :

```json
{
  "notification": {
    "title": "Titre de la notification",
    "body": "Corps de la notification"
  },
  "data": {
    "type": "message|contact|share|sos_alarm|system",
    "conversationId": "...",
    "contactId": "...",
    "sosId": "..."
  }
}
```

### Types de notifications

| Type | Description | Données additionnelles |
|------|-------------|------------------------|
| `message` | Nouveau message dans une conversation | `conversationId` |
| `contact` | Demande de contact | `contactId` |
| `share` | Partage de fiche ou liste | `conversationId`, `shareType` |
| `sos_alarm` | Alarme SOS (priorité critique) | `sosId`, `location` |
| `system` | Notification système | `message`, `action` |

### Exemples de payloads

**Message** :
```json
{
  "notification": {
    "title": "Nouveau message de Jean Dupont",
    "body": "Salut, tu as vu mon dernier message ?"
  },
  "data": {
    "type": "message",
    "conversationId": "conv_123456"
  }
}
```

**Alarme SOS** :
```json
{
  "notification": {
    "title": "ALERTE SOS",
    "body": "Marie Durand a déclenché une alarme SOS"
  },
  "data": {
    "type": "sos_alarm",
    "sosId": "sos_789012",
    "location": "48.8566,2.3522"
  },
  "android": {
    "priority": "high"
  },
  "apns": {
    "headers": {
      "apns-priority": "10"
    },
    "payload": {
      "aps": {
        "sound": "critical",
        "badge": 1
      }
    }
  }
}
```

## Envoi de notifications via FCM

### Configuration

1. **Obtenir le Service Account JSON** depuis la console Firebase
2. **Stocker le fichier** de manière sécurisée (hors du dépôt Git)
3. **Configurer la variable d'environnement** : `GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json`

### Installation de la dépendance

```bash
npm install firebase-admin
```

### Initialisation de Firebase Admin SDK

```javascript
const admin = require('firebase-admin');

// Initialiser Firebase Admin (une seule fois au démarrage)
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'com.sealfy.Qvarryphone'
});
```

### Service d'envoi de notifications

```javascript
// services/pushNotificationService.js

const admin = require('firebase-admin');
const PushToken = require('../models/PushToken');

class PushNotificationService {
  /**
   * Envoie une notification push à un utilisateur
   * @param {string} userId - ID de l'utilisateur
   * @param {object} notification - { title, body }
   * @param {object} data - Données custom à envoyer
   * @param {object} options - Options additionnelles (priority, etc.)
   */
  async sendToUser(userId, notification, data, options = {}) {
    try {
      // Récupérer tous les tokens de l'utilisateur
      const tokens = await PushToken.find({ userId }).lean();

      if (tokens.length === 0) {
        console.log(`No push tokens found for user ${userId}`);
        return { success: true, sent: 0 };
      }

      // Préparer les messages pour chaque token
      const messages = tokens.map(tokenDoc => ({
        token: tokenDoc.token,
        notification,
        data: this._sanitizeData(data),
        ...this._buildPlatformConfig(tokenDoc.platform, options)
      }));

      // Envoi batch
      const response = await admin.messaging().sendAll(messages);

      // Gérer les tokens invalides
      await this._handleFailedTokens(response, tokens);

      console.log(`Sent ${response.successCount} notifications to user ${userId}`);
      return {
        success: true,
        sent: response.successCount,
        failed: response.failureCount
      };
    } catch (error) {
      console.error('Error sending push notification:', error);
      throw error;
    }
  }

  /**
   * Envoie une notification à plusieurs utilisateurs
   */
  async sendToMultipleUsers(userIds, notification, data, options = {}) {
    const results = await Promise.allSettled(
      userIds.map(userId => this.sendToUser(userId, notification, data, options))
    );

    const successCount = results.filter(r => r.status === 'fulfilled').length;
    return { success: true, sent: successCount, total: userIds.length };
  }

  /**
   * Envoie une notification SOS (priorité critique)
   */
  async sendSosAlert(userId, sosData) {
    return this.sendToUser(
      userId,
      {
        title: 'ALERTE SOS',
        body: sosData.message
      },
      {
        type: 'sos_alarm',
        sosId: sosData.sosId,
        location: sosData.location
      },
      { priority: 'critical' }
    );
  }

  /**
   * Construit la config spécifique à la plateforme
   */
  _buildPlatformConfig(platform, options) {
    const isCritical = options.priority === 'critical';

    const config = {};

    if (platform === 'android') {
      config.android = {
        priority: isCritical ? 'high' : 'normal',
        notification: {
          channelId: isCritical ? 'sos_alerts' : 'default'
        }
      };
    }

    if (platform === 'ios') {
      config.apns = {
        headers: {
          'apns-priority': isCritical ? '10' : '5'
        },
        payload: {
          aps: {
            sound: isCritical ? 'critical' : 'default',
            badge: 1,
            ...(isCritical && {
              'interruption-level': 'critical',
              'content-available': 1
            })
          }
        }
      };
    }

    return config;
  }

  /**
   * Sanitize les données pour FCM (toutes les valeurs doivent être des strings)
   */
  _sanitizeData(data) {
    const sanitized = {};
    for (const [key, value] of Object.entries(data)) {
      sanitized[key] = String(value);
    }
    return sanitized;
  }

  /**
   * Gère les tokens invalides/expirés
   */
  async _handleFailedTokens(response, tokens) {
    const tokensToDelete = [];

    response.responses.forEach((resp, idx) => {
      if (!resp.success) {
        const errorCode = resp.error?.code;
        
        // Codes d'erreur indiquant un token invalide
        if (
          errorCode === 'messaging/invalid-registration-token' ||
          errorCode === 'messaging/registration-token-not-registered'
        ) {
          tokensToDelete.push(tokens[idx].deviceId);
        }
      }
    });

    // Supprimer les tokens invalides
    if (tokensToDelete.length > 0) {
      await PushToken.deleteMany({ deviceId: { $in: tokensToDelete } });
      console.log(`Deleted ${tokensToDelete.length} invalid tokens`);
    }
  }
}

module.exports = new PushNotificationService();
```

## Utilisation dans le code métier

### Exemple 1 : Notification de nouveau message

```javascript
// controllers/messageController.js

const pushService = require('../services/pushNotificationService');

async function sendMessage(req, res) {
  const { conversationId, content } = req.body;
  const senderId = req.user.id;

  // Créer le message
  const message = await Message.create({
    conversationId,
    senderId,
    content
  });

  // Récupérer les participants de la conversation
  const conversation = await Conversation.findById(conversationId)
    .populate('participants');

  // Envoyer une notification aux autres participants
  const recipientIds = conversation.participants
    .filter(p => p._id.toString() !== senderId)
    .map(p => p._id.toString());

  const sender = await User.findById(senderId);

  await pushService.sendToMultipleUsers(
    recipientIds,
    {
      title: `Nouveau message de ${sender.name}`,
      body: content.substring(0, 100)
    },
    {
      type: 'message',
      conversationId: conversationId.toString()
    }
  );

  res.json({ success: true, message });
}
```

### Exemple 2 : Notification SOS

```javascript
// controllers/sosController.js

const pushService = require('../services/pushNotificationService');

async function triggerSosAlert(req, res) {
  const { location, emergencyContacts } = req.body;
  const userId = req.user.id;

  // Créer l'alerte SOS
  const sosAlert = await SosAlert.create({
    userId,
    location,
    triggeredAt: new Date()
  });

  const user = await User.findById(userId);

  // Envoyer aux contacts d'urgence
  await pushService.sendToMultipleUsers(
    emergencyContacts,
    {
      title: 'ALERTE SOS',
      body: `${user.name} a déclenché une alarme SOS`
    },
    {
      type: 'sos_alarm',
      sosId: sosAlert._id.toString(),
      location
    },
    { priority: 'critical' }
  );

  res.json({ success: true, sosAlert });
}
```

### Exemple 3 : Demande de contact

```javascript
// controllers/contactController.js

const pushService = require('../services/pushNotificationService');

async function sendContactRequest(req, res) {
  const { recipientId } = req.body;
  const senderId = req.user.id;

  // Créer la demande
  const contactRequest = await ContactRequest.create({
    senderId,
    recipientId,
    status: 'pending'
  });

  const sender = await User.findById(senderId);

  // Notifier le destinataire
  await pushService.sendToUser(
    recipientId,
    {
      title: 'Nouvelle demande de contact',
      body: `${sender.name} souhaite vous ajouter à ses contacts`
    },
    {
      type: 'contact',
      contactId: contactRequest._id.toString()
    }
  );

  res.json({ success: true, contactRequest });
}
```

## Gestion des erreurs et des tokens invalides

### Codes d'erreur FCM à gérer

| Code d'erreur | Action |
|---------------|--------|
| `messaging/invalid-registration-token` | Supprimer le token de la base |
| `messaging/registration-token-not-registered` | Supprimer le token de la base |
| `messaging/invalid-argument` | Logger et investiguer |
| `messaging/authentication-error` | Vérifier les credentials Firebase |
| `messaging/server-unavailable` | Retry avec backoff exponentiel |

### Stratégie de retry

```javascript
async function sendWithRetry(message, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await admin.messaging().send(message);
    } catch (error) {
      if (error.code === 'messaging/server-unavailable' && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000; // Backoff exponentiel
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
}
```

## Notifications critiques (SOS)

Les notifications SOS nécessitent une configuration spéciale pour bypasser le mode "Ne pas déranger" :

### Configuration Android

```javascript
{
  "android": {
    "priority": "high",
    "notification": {
      "channelId": "sos_alerts",
      "priority": "max",
      "visibility": "public"
    }
  }
}
```

### Configuration iOS

```javascript
{
  "apns": {
    "headers": {
      "apns-priority": "10",
      "apns-push-type": "alert"
    },
    "payload": {
      "aps": {
        "sound": "critical",
        "badge": 1,
        "interruption-level": "critical",
        "content-available": 1
      }
    }
  }
}
```

Note : Sur iOS, les sons critiques nécessitent un entitlement spécial dans l'app.

## Tests et debugging

### Tester l'envoi de notifications

```javascript
// scripts/testPushNotification.js

const pushService = require('./services/pushNotificationService');

async function testPush() {
  try {
    const result = await pushService.sendToUser(
      'USER_ID_HERE',
      {
        title: 'Test Notification',
        body: 'Ceci est un test'
      },
      {
        type: 'system',
        message: 'test'
      }
    );
    console.log('Result:', result);
  } catch (error) {
    console.error('Error:', error);
  }
}

testPush();
```

### Logs recommandés

- Enregistrer chaque tentative d'envoi avec le `userId` et le type de notification
- Logger les tokens invalides supprimés
- Tracker les taux de succès/échec par plateforme
- Monitorer la latence d'envoi pour les notifications SOS

## Sécurité

1. **Service Account** : Ne jamais commiter le fichier JSON dans Git
2. **Validation** : Toujours valider que l'utilisateur authentifié possède le droit d'envoyer une notification
3. **Rate limiting** : Implémenter un rate limit sur l'envoi de notifications (ex: max 10 SOS par heure)
4. **Sanitization** : Toujours sanitizer les données avant envoi (pas de scripts, pas de HTML)

```javascript
function sanitizeNotificationContent(text) {
  return text
    .replace(/<[^>]*>/g, '') // Supprimer HTML
    .substring(0, 200) // Limiter la longueur
    .trim();
}
```

## Performance et optimisation

### Envoi batch

Pour envoyer à plusieurs utilisateurs, utiliser `sendAll()` plutôt que plusieurs `send()` :

```javascript
// Bon
const messages = tokens.map(token => ({ token, notification, data }));
await admin.messaging().sendAll(messages);

// Moins performant
for (const token of tokens) {
  await admin.messaging().send({ token, notification, data });
}
```

### Indexation MongoDB

Créer des index sur les champs fréquemment interrogés :

```javascript
PushTokenSchema.index({ userId: 1 });
PushTokenSchema.index({ deviceId: 1 }, { unique: true });
PushTokenSchema.index({ userId: 1, deviceId: 1 });
```

### Nettoyage des tokens obsolètes

Mettre en place un job CRON pour supprimer les tokens non utilisés depuis plus de 90 jours :

```javascript
// jobs/cleanupPushTokens.js

async function cleanupOldTokens() {
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const result = await PushToken.deleteMany({
    updatedAt: { $lt: ninetyDaysAgo }
  });

  console.log(`Deleted ${result.deletedCount} old tokens`);
}
```

## Checklist d'implémentation

- [ ] Créer le modèle `PushToken` dans MongoDB
- [ ] Implémenter `POST /mobile/push-tokens`
- [ ] Implémenter `DELETE /mobile/push-tokens`
- [ ] Configurer Firebase Admin SDK avec Service Account
- [ ] Créer le service `PushNotificationService`
- [ ] Intégrer les notifications dans les contrôleurs métier (messages, contacts, SOS)
- [ ] Implémenter la gestion des tokens invalides
- [ ] Configurer les notifications critiques pour SOS
- [ ] Ajouter des logs et du monitoring
- [ ] Tester sur Android et iOS
- [ ] Mettre en place un job de nettoyage des tokens obsolètes
- [ ] Documenter les variables d'environnement nécessaires

## Support et documentation externe

- [Firebase Cloud Messaging - Documentation officielle](https://firebase.google.com/docs/cloud-messaging)
- [Firebase Admin SDK pour Node.js](https://firebase.google.com/docs/admin/setup)
- [APNs - Apple Push Notification Service](https://developer.apple.com/documentation/usernotifications)
- [Format des messages FCM](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages)

## Contact

Pour toute question sur l'implémentation backend des push notifications, contacter l'équipe mobile.
