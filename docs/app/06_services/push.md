# Services de Notifications Push — Application Mobile Qvarry

## Vue d'ensemble

Les notifications push de Qvarry reposent sur deux services complémentaires :

| Service | Fichier | Rôle |
| ------- | ------- | ---- |
| `PushNotificationService` | `src/services/push/PushNotificationService.ts` | Initialisation Firebase/FCM, routing des notifications, gestion du badge |
| `SosNotificationService` | `src/services/sos/SosNotificationService.ts` | Notifications locales SOS (alarme critique), création des canaux Android |

**Librairies utilisées** :
- [`@react-native-firebase/messaging`](https://rnfirebase.io/messaging/usage) — réception des messages FCM
- [`@notifee/react-native`](https://notifee.app) — affichage des notifications locales, gestion des canaux et du badge

---

## Architecture

```
Firebase Cloud Messaging (FCM)
        │
        ▼
PushNotificationService
        │
        ├── Foreground  → notifee (affichage local)
        ├── Background  → notifee onBackgroundEvent (tap)
        └── Terminated  → notifee getInitialNotification (navigation)
                │
                ▼
        SosNotificationService
                │
                ├── Création des canaux Android (6 canaux)
                └── Notifications locales d'alarme SOS (Critical Alert iOS)
```

---

## `PushNotificationService`

**Fichier** : `src/services/push/PushNotificationService.ts`

### Types

#### `PushNotificationType`

Union de 18 valeurs couvrant l'ensemble des événements applicatifs :

```typescript
type PushNotificationType =
  | 'new_message'            // Nouveau message reçu
  | 'new_conversation'       // Nouvelle conversation créée
  | 'contact_request'        // Demande de contact reçue
  | 'contact_accepted'       // Demande de contact acceptée
  | 'group_invitation'       // Invitation dans un groupe
  | 'group_message'          // Nouveau message dans un groupe
  | 'sos_alarm'              // Alarme SOS (stage 0/1/2)
  | 'sos_alert_stage1'       // Alerte SOS stade 1
  | 'sos_resolved'           // SOS résolu
  | 'sos_cancelled'          // SOS annulé
  | 'sos_participant_added'  // Participant ajouté à une session SOS
  | 'sos_participant_left'   // Participant a quitté une session SOS
  | 'sos_deactivated_all'    // SOS désactivé pour tous
  | 'share_received'         // Partage de liste reçu
  | 'share_accepted'         // Partage accepté
  | 'system'                 // Notification système
  | 'heartbeat_reminder'     // Rappel heartbeat SOS
  | 'group_deleted';         // Groupe supprimé
```

#### `PushNotificationConfig`

Configuration passée à l'initialisation du service :

```typescript
interface PushNotificationConfig {
  // Appelé quand l'utilisateur tape sur une notification (foreground ou background)
  onNotificationTap?: (notification: Notification) => void;

  // Appelé quand un message FCM est reçu en foreground
  onForegroundNotification?: (notification: RemoteMessage) => void;
}
```

---

### Initialisation

#### `initializeFirebase(): Promise<boolean>`

Importe le module `@react-native-firebase/messaging` de façon **conditionnelle** pour éviter les erreurs sur simulateur ou sur le web.

- Retourne `true` si Firebase Messaging est disponible sur l'appareil
- Retourne `false` sinon (environnement web, simulateur sans Firebase, etc.)

#### `getFCMToken(): Promise<string | null>`

1. Demande les permissions de notification (iOS — sur Android elles sont accordées par défaut)
2. Récupère le token FCM via `messaging().getToken()`
3. Retourne le token (à enregistrer côté serveur via `pushToken.ts`)
4. Retourne `null` si les permissions sont refusées ou si Firebase est indisponible

#### `initializePushNotifications(config): Promise<string | null>`

Fonction principale d'initialisation. À appeler une seule fois au démarrage de l'application (typiquement dans `App.tsx` ou `AppContext`).

```typescript
const token = await initializePushNotifications({
  onNotificationTap: (notification) => {
    // Naviguer vers la conversation ou l'écran SOS correspondant
    router.push(`/conversations/${notification.data?.conversationId}`);
  },
  onForegroundNotification: (remoteMessage) => {
    console.log('Message FCM reçu en foreground :', remoteMessage);
  },
});

// Enregistrer le token FCM sur le serveur
if (token) {
  await registerPushToken(token);
}
```

---

### Gestion des handlers

Le service configure trois handlers distincts selon l'état de l'application au moment de la réception :

#### 1. Foreground — `firebase/messaging().onMessage()`

L'app est ouverte et active :

- Si la notification concerne la **conversation actuellement ouverte** (vérifiée via `setActiveConversation`) → la notification est **ignorée** (l'utilisateur voit déjà les messages en temps réel)
- Sinon → une **notification locale** est affichée via `notifee` avec le canal Android approprié

#### 2. Background — `notifee.onBackgroundEvent()`

L'app est en arrière-plan (processus actif, mais UI non visible) :

- Gère l'événement `PRESS` sur la notification
- Déclenche le callback `onNotificationTap` avec les données de la notification
- Permet la navigation vers le bon écran au retour au premier plan

#### 3. État terminated — `notifee.getInitialNotification()`

L'app était complètement fermée et a été ouverte via un tap sur une notification :

- Appelé au démarrage de l'app
- Si une notification initiale est détectée, déclenche `onNotificationTap` pour naviguer directement vers le bon écran

```
État de l'app      Handler                       Action
─────────────────────────────────────────────────────────────────
Foreground         messaging().onMessage()       Notification locale (si hors conversation active)
Background         notifee.onBackgroundEvent()   Tap → callback onNotificationTap
Terminated         notifee.getInitialNotification()  Navigation directe à l'ouverture
```

---

### Sélection des canaux Android

Le service sélectionne intelligemment le canal de notification selon le type `PushNotificationType` :

| Type(s) | Canal | Importance |
| ------- | ----- | ---------- |
| `sos_alarm`, `sos_alert_stage1` | `qvarry-sos-alarm` | **MAX** + bypass DND |
| `sos_resolved`, `sos_cancelled`, `heartbeat_reminder`, `sos_participant_added`, `sos_participant_left`, `sos_deactivated_all` | `qvarry-sos-info` | HIGH |
| `new_message`, `group_message`, `new_conversation` | `qvarry-messages` | HIGH |
| `contact_request`, `contact_accepted`, `group_invitation`, `group_deleted` | `qvarry-contacts` | DEFAULT |
| `share_received`, `share_accepted` | `qvarry-share` | DEFAULT |
| autres (`system`, inconnu…) | `qvarry-system` | DEFAULT |

> **Note** : Les canaux sont créés par `SosNotificationService` (voir ci-dessous). `PushNotificationService` se contente de les référencer.

---

### API

```typescript
// Initialisation complète (Firebase + FCM token + handlers)
initializePushNotifications(config: PushNotificationConfig): Promise<string | null>

// Initialisation Firebase seule (import conditionnel)
initializeFirebase(): Promise<boolean>

// Obtenir le token FCM (après demande de permissions)
getFCMToken(): Promise<string | null>

// Déclarer la conversation actuellement ouverte (évite les doublons de notif)
setActiveConversation(conversationId: string | null): void

// Mettre à jour le badge de l'icône app (iOS uniquement)
updateBadgeCount(count: number): Promise<void>

// Nettoyer tous les abonnements Firebase/Notifee
cleanupPushNotifications(): void
```

#### `setActiveConversation`

```typescript
// Dans l'écran de conversation, signaler que la conversation est active
useEffect(() => {
  setActiveConversation(conversationId);
  return () => setActiveConversation(null); // Nettoyage au démontage
}, [conversationId]);
```

#### `updateBadgeCount`

```typescript
// Mettre à jour le badge après lecture des notifications
await updateBadgeCount(unreadCount);

// Réinitialiser le badge à 0
await updateBadgeCount(0);
```

#### `cleanupPushNotifications`

```typescript
// À appeler lors de la déconnexion ou en cleanup de l'app
cleanupPushNotifications();
```

---

## `SosNotificationService`

**Fichier** : `src/services/sos/SosNotificationService.ts`

### Canaux Android

Le service crée les **6 canaux Android** utilisés par l'ensemble de l'application push. Chaque canal correspond à une catégorie de notification avec son niveau d'importance propre :

| ID | Nom affiché | Importance | Particularités |
| -- | ----------- | ---------- | -------------- |
| `qvarry-sos-alarm` | Alarmes SOS | MAX | `bypassDnd: true`, son personnalisé, vibrations longues |
| `qvarry-sos-info` | Informations SOS | HIGH | — |
| `qvarry-messages` | Messages | HIGH | — |
| `qvarry-contacts` | Contacts | DEFAULT | — |
| `qvarry-share` | Partages | DEFAULT | — |
| `qvarry-system` | Système | DEFAULT | — |

> Le canal `qvarry-sos-alarm` est configuré pour **passer outre le mode Ne pas déranger** (`bypassDnd: true`) afin que les alarmes SOS atteignent l'utilisateur en toutes circonstances.

---

### Permissions

#### `requestSosNotificationPermissions(): Promise<boolean>`

Demande les permissions nécessaires aux notifications SOS :

- **Android** : vérifie la permission `POST_NOTIFICATIONS` (Android 13+)
- **iOS** : demande les autorisations standard **et** les **Critical Alerts** — notifications qui sonnent même si l'appareil est en mode silencieux ou en mode Ne pas déranger

```typescript
const granted = await requestSosNotificationPermissions();
if (!granted) {
  // Afficher un message expliquant pourquoi les permissions sont nécessaires
  Alert.alert(
    'Permissions requises',
    'Les notifications SOS nécessitent les permissions d\'alerte critique pour fonctionner correctement.'
  );
}
```

> **iOS — Critical Alerts** : cette permission nécessite un entitlement Apple spécifique (`com.apple.developer.usernotifications.critical-alerts`). Elle est demandée séparément des permissions standard et peut être refusée indépendamment.

---

### Notifications d'alarme SOS

#### `sendSosAlarmNotification(stage: 0 | 1 | 2): Promise<void>`

Envoie une **notification locale immédiate** correspondant au stade de l'alarme SOS. Utilisé quand le minuteur SOS expire ou lors de l'escalade des stades.

| Stage | Titre | Corps |
| ----- | ----- | ----- |
| `0` | ⏰ Timer SOS expiré | Envoyer un heartbeat pour signaler que tout va bien |
| `1` | 🚨 ALERTE SOS - Stade 1 | Les utilisateurs Qvarry du site ont été alertés |
| `2` | 🆘 ALERTE SOS CRITIQUE - Stade 2 | SMS envoyés à vos contacts d'urgence |

Comportement :
- Canal `qvarry-sos-alarm` (importance MAX, bypass DND)
- **iOS** : `critical: true` si la permission Critical Alert a été accordée — la notification sonne même en mode silencieux
- Tag `sos-alarm` utilisé pour permettre l'annulation ciblée

```typescript
// Déclencher une alarme SOS au stade 1
await sendSosAlarmNotification(1);

// Déclencher l'alarme critique stade 2
await sendSosAlarmNotification(2);
```

#### `cancelAllSosNotifications(): Promise<void>`

Annule toutes les notifications locales SOS actuellement affichées (identifiées par le tag `sos-alarm`).

```typescript
// À appeler quand le SOS est résolu ou annulé
await cancelAllSosNotifications();
```

---

### API

```typescript
// Créer les 6 canaux Android et demander les permissions SOS
requestSosNotificationPermissions(): Promise<boolean>

// Envoyer une notification d'alarme SOS selon le stade (0, 1 ou 2)
sendSosAlarmNotification(stage: 0 | 1 | 2): Promise<void>

// Annuler toutes les notifications SOS affichées
cancelAllSosNotifications(): Promise<void>
```

---

## Flux complet

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Démarrage de l'app                           │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
                  initializePushNotifications()
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
     initializeFirebase()  getFCMToken()   Enregistrement
       (import conditionnel)  (permissions   token FCM sur
                              iOS demandées) le serveur
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
        Handler            Handler           Handler
       Foreground          Background        Terminated
    (onMessage FCM)  (onBackgroundEvent)  (getInitialNotification)
              │                │                │
              ▼                ▼                ▼
    Conversation active ?  Tap détecté ?   Notification initiale ?
         │      │               │                    │
        OUI    NON         onNotificationTap()   onNotificationTap()
         │      │           → navigation           → navigation
      Ignoré   Affichage                           au démarrage
               notifee
               (canal selon type)
                    │
                    ▼
         ┌──────────────────────────┐
         │    Canaux Android        │
         │  (créés par             │
         │  SosNotificationService) │
         │                          │
         │  sos-alarm  → MAX+DND    │
         │  sos-info   → HIGH       │
         │  messages   → HIGH       │
         │  contacts   → DEFAULT    │
         │  share      → DEFAULT    │
         │  system     → DEFAULT    │
         └──────────────────────────┘

─────────────────────────────────────────────────────────────────────

Flux SOS (notification locale)
───────────────────────────────

Timer SOS expiré / Escalade de stade
              │
              ▼
  sendSosAlarmNotification(stage)
              │
    ┌─────────┴─────────┐
    ▼                   ▼
  iOS                 Android
critical: true      Canal qvarry-sos-alarm
(si permission      (importance MAX,
 Critical Alert)     bypassDnd: true)
              │
              ▼
  Notification affichée même en
  mode silencieux / Ne pas déranger
              │
  SOS résolu / annulé
              ▼
  cancelAllSosNotifications()
```

---

## Intégration dans l'application

```typescript
// App.tsx — initialisation au démarrage
import { initializePushNotifications, cleanupPushNotifications } from '@/services/push/PushNotificationService';
import { requestSosNotificationPermissions } from '@/services/sos/SosNotificationService';
import { registerPushToken } from '@/services/api/pushToken';

// Dans le composant racine
useEffect(() => {
  let cleanup: (() => void) | undefined;

  const setup = async () => {
    // 1. Permissions SOS (crée aussi les canaux Android)
    await requestSosNotificationPermissions();

    // 2. Initialisation push principale
    const token = await initializePushNotifications({
      onNotificationTap: (notification) => {
        const { type, conversationId, sosSessionId } = notification.data ?? {};
        if (type === 'new_message' || type === 'group_message') {
          router.push(`/conversations/${conversationId}`);
        } else if (type?.startsWith('sos_')) {
          router.push(`/sos/${sosSessionId}`);
        }
      },
    });

    // 3. Enregistrement du token FCM sur le serveur
    if (token) {
      await registerPushToken({ token, platform: Platform.OS });
    }

    cleanup = cleanupPushNotifications;
  };

  setup();
  return () => cleanup?.();
}, []);
```
