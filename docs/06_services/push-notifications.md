# Service Push Notifications (Firebase FCM)

## Table des matières

- [Vue d'ensemble](#vue-densemble)
- [Configuration Firebase](#configuration-firebase)
- [Initialisation](#initialisation)
- [Fonctions disponibles](#fonctions-disponibles)
- [Retry des notifications en attente](#retry-des-notifications-en-attente)
- [Support iOS et Android](#support-ios-et-android)

---

## Vue d'ensemble

Le service de push notifications utilise **Firebase Cloud Messaging (FCM)** pour envoyer des notifications aux appareils mobiles iOS et Android.

```
┌────────────────────────────────────────────────┐
│              pushNotificationService            │
│                                                │
│  sendNotification(token, title, body, data)    │
│  sendToUser(userId, title, body, data)         │
│  sendToAll(title, body, data)                  │
│           │                                    │
│           ▼                                    │
│  Firebase Admin SDK                            │
│           │                                    │
└───────────┼────────────────────────────────────┘
            │
            ▼
   Firebase Cloud Messaging
            │
     ┌──────┴──────┐
     ▼             ▼
  APNs (iOS)   FCM (Android)
```

---

## Configuration Firebase

### Variables d'environnement

| Variable                         | Description                                 | Priorité        |
| -------------------------------- | ------------------------------------------- | --------------- |
| `FIREBASE_SERVICE_ACCOUNT`       | JSON du compte de service Firebase (string) | 1 (prioritaire) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Chemin vers le fichier JSON de credentials  | 2 (fallback)    |

### Exemple de configuration

```env
# Option 1 : JSON inline (recommandé pour Docker/K8s)
FIREBASE_SERVICE_ACCOUNT='{"type":"service_account","project_id":"qvarry-prod","private_key_id":"abc123","private_key":"-----BEGIN RSA PRIVATE KEY-----\n...","client_email":"firebase-adminsdk@qvarry-prod.iam.gserviceaccount.com","client_id":"...","auth_uri":"...","token_uri":"..."}'

# Option 2 : Fichier (développement local)
GOOGLE_APPLICATION_CREDENTIALS=/path/to/firebase-service-account.json
```

> ⚠️ Ne jamais committer le fichier `firebase-service-account.json` en versioning. Utiliser des variables d'environnement ou un secret manager.

---

## Initialisation

Le service Firebase s'initialise au démarrage de l'application. Si la configuration est manquante, un log d'avertissement est émis mais l'API continue de fonctionner (les notifications push seront silencieusement ignorées).

```typescript
// Au démarrage (index.ts)
import { pushNotificationService } from "./services/pushNotificationService";

pushNotificationService.initialize();

// Vérification
if (!pushNotificationService.isReady()) {
  logger.warn(
    "[FCM] Service push non initialisé - les notifications push sont désactivées",
  );
}
```

### Séquence d'initialisation

```
Démarrage application
        │
        ▼
Lire FIREBASE_SERVICE_ACCOUNT (JSON string)
        │
  ┌─────┴─────┐
  │           │
  ▼           ▼
JSON valide  JSON absent/invalide
  │               │
  ▼               ▼
  │         Lire GOOGLE_APPLICATION_CREDENTIALS
  │               │
  │         ┌─────┴─────┐
  │         │           │
  │         ▼           ▼
  │     Fichier OK   Fichier KO
  │         │           │
  └────┬────┘           ▼
       │           Log WARNING
       ▼           Service désactivé
  firebase.initializeApp()
  isReady() → true
```

---

## Fonctions disponibles

### sendNotification(token, notification)

Envoie une notification push à un token FCM spécifique.

```typescript
await pushNotificationService.sendNotification(
  "fMEjhG8zQ9y3vV7nKpT2dP:APA91bHd...",
  {
    title: "Alerte SOS",
    body: "Jean Dupont n'a pas donné signe de vie",
    data: {
      type: "sos_alert",
      sessionId: "64a1b2c3...",
      userId: "64a1b2c3...",
    },
    badge: 1, // iOS uniquement
    sound: "sos", // Son personnalisé
  },
);
```

| Paramètre            | Type   | Description                        |
| -------------------- | ------ | ---------------------------------- |
| `token`              | string | Token FCM de l'appareil            |
| `notification.title` | string | Titre de la notification           |
| `notification.body`  | string | Corps du message                   |
| `notification.data`  | object | Données custom (key/value strings) |
| `notification.badge` | number | Badge iOS (optionnel)              |
| `notification.sound` | string | Son iOS (optionnel)                |

### sendToUser(userId, notification)

Envoie une notification à **tous les appareils** d'un utilisateur (récupère tous ses tokens FCM actifs).

```typescript
await pushNotificationService.sendToUser("64a1b2c3d4e5f6789012345", {
  title: "Nouveau message",
  body: "Sophie vous a envoyé un message",
  data: {
    type: "message_received",
    conversationId: "64a1b2...",
  },
});
```

Si l'utilisateur a plusieurs appareils enregistrés, la notification est envoyée à **chacun**. Les erreurs sur un token invalide sont gérées individuellement (suppression du token invalide).

### sendToAll(notification)

Envoie une notification à **tous les utilisateurs** ayant un push token actif.

> ⚠️ Utiliser avec précaution. Réservé aux notifications système critiques (ex: maintenance planifiée).

```typescript
await pushNotificationService.sendToAll({
  title: "Maintenance programmée",
  body: "L'application sera indisponible de 3h à 5h",
  data: { type: "system_maintenance" },
});
```

---

## Retry des notifications en attente

Au **démarrage du serveur**, le service vérifie les notifications en attente stockées dans MongoDB (modèle `PendingNotification`) et les retente.

```
Démarrage application
        │
        ▼
PendingNotification.find({ status: 'pending' })
        │
        ▼
Pour chaque notification en attente :
  1. Tenter l'envoi FCM
  2. Si succès → status: 'sent', sentAt: now
  3. Si échec → incrementer attempts
     Si attempts >= MAX_ATTEMPTS (3) → status: 'failed'
```

### Modèle PendingNotification

```typescript
{
  userId: ObjectId,
  token: string,
  title: string,
  body: string,
  data: Record<string, string>,
  status: 'pending' | 'sent' | 'failed',
  attempts: number,         // Nombre de tentatives
  createdAt: Date,
  sentAt?: Date,
  error?: string,           // Dernière erreur FCM
}
```

### Cas d'usage du retry

Les notifications sont stockées en `PendingNotification` et retenteées au redémarrage dans ces cas :

- **SOS Stage 1** : alerte de contacts (critique, ne doit pas être perdue)
- **SOS_SERVER_RESTART** : information de reprise de session après redémarrage

---

## Support iOS et Android

### Différences de configuration

| Aspect             | iOS                        | Android            |
| ------------------ | -------------------------- | ------------------ |
| Canal de livraison | APNs via FCM               | FCM direct         |
| Badge de l'icône   | Supporté (`badge`)         | Non standardisé    |
| Sons personnalisés | Supporté (`sound`)         | Supporté (`sound`) |
| Priorité           | `apns-priority: 10` (high) | `priority: high`   |
| Expiration         | `apns-expiration`          | `ttl`              |

### Payload FCM complet

```json
{
  "token": "fMEjhG8zQ9y3vV7nKpT2dP:APA91bHd...",
  "notification": {
    "title": "Alerte SOS",
    "body": "Jean Dupont n'a pas donné signe de vie"
  },
  "data": {
    "type": "sos_alert",
    "sessionId": "64a1b2c3..."
  },
  "apns": {
    "headers": {
      "apns-priority": "10"
    },
    "payload": {
      "aps": {
        "badge": 1,
        "sound": "sos_alert.aiff",
        "content-available": 1
      }
    }
  },
  "android": {
    "priority": "high",
    "notification": {
      "sound": "sos_alert",
      "channel_id": "sos_alerts"
    }
  }
}
```

### Gestion des tokens invalides

Lorsque FCM retourne une erreur `registration-token-not-registered` ou `invalid-registration-token` :

1. Le token est **supprimé automatiquement** de la base de données
2. Un log `info` est enregistré : `[FCM] Token invalide supprimé : <token truncated>`

---

_Voir aussi : [push-tokens.md](../05_mobile/push-tokens.md) — [cron-jobs.md](./cron-jobs.md) — [sos-service.md](./sos-service.md)_
