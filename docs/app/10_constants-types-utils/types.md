# Types — Application Mobile Qvarry

## Vue d'ensemble

Tous les types TypeScript sont dans `src/types/`. Chaque fichier regroupe les interfaces, types et constantes liés à un domaine métier. Ces types sont partagés entre les services, les hooks, les contextes et les composants.

---

## `messaging.ts` — Messagerie

### Interfaces de base

#### `ContactInfo`

| Propriété | Type | Requis | Description |
|---|---|---|---|
| `_id` | `string` | ✅ | Identifiant MongoDB |
| `name` | `string` | ✅ | Prénom |
| `surname` | `string` | ✅ | Nom de famille |
| `userCode` | `string` | ❌ | Code public de l'utilisateur |
| `pseudo` | `string` | ❌ | Pseudo affiché |
| `showPseudo` | `boolean` | ❌ | Afficher le pseudo à la place du nom |

#### `Contact`

| Propriété | Type | Requis | Description |
|---|---|---|---|
| `_id` | `string` | ✅ | Identifiant de la relation |
| `userId` | `string` | ✅ | ID de l'utilisateur courant |
| `contactId` | `string` | ✅ | ID du contact |
| `contactCode` | `string` | ❌ | Code public du contact |
| `isBlocked` | `boolean` | ✅ | Contact bloqué |
| `status` | `'pending' \| 'accepted'` | ✅ | État de la demande |
| `isRecipient` | `boolean` | ❌ | Vrai si l'utilisateur est le destinataire |
| `contactInfo` | `ContactInfo` | ❌ | Informations du contact peuplées |
| `createdAt` | `string` | ❌ | Date de création ISO |
| `updatedAt` | `string` | ❌ | Date de mise à jour ISO |

#### `Participant`

| Propriété | Type | Requis | Description |
|---|---|---|---|
| `userId` | `string` | ✅ | ID du participant |
| `role` | `'admin' \| 'member'` | ✅ | Rôle dans la conversation |
| `joinedAt` | `string` | ✅ | Date d'entrée ISO |
| `leftAt` | `string` | ❌ | Date de départ ISO (si absent) |
| `userInfo` | `ContactInfo` | ❌ | Informations peuplées |

#### `Conversation`

| Propriété | Type | Requis | Description |
|---|---|---|---|
| `_id` | `string` | ✅ | Identifiant MongoDB |
| `name` | `string` | ❌ | Nom du groupe |
| `isGroup` | `boolean` | ✅ | Conversation de groupe |
| `creatorId` | `string` | ❌ | ID du créateur |
| `participants` | `Participant[]` | ✅ | Liste des participants |
| `lastMessage` | `string` | ❌ | Extrait du dernier message |
| `lastMessageDate` | `string` | ❌ | Date du dernier message |
| `lastMessageSenderId` | `string` | ❌ | ID de l'expéditeur |
| `deletedBy` | `string[]` | ❌ | IDs des utilisateurs ayant supprimé |
| `unreadCount` | `number` | ❌ | Nombre de messages non lus |
| `createdAt` | `string` | ✅ | Date de création ISO |
| `updatedAt` | `string` | ✅ | Date de mise à jour ISO |

#### `Message`

| Propriété | Type | Requis | Description |
|---|---|---|---|
| `_id` | `string` | ✅ | Identifiant MongoDB |
| `conversationId` | `string` | ✅ | ID de la conversation |
| `senderId` | `string` | ✅ | ID de l'expéditeur |
| `senderInfo` | `ContactInfo` | ❌ | Informations de l'expéditeur |
| `content` | `string` | ✅ | Contenu du message |
| `type` | `'text' \| 'file' \| 'image'` | ✅ | Type de message |
| `readBy` | `string[]` | ✅ | IDs des utilisateurs ayant lu |
| `replies` | `Message[]` | ✅ | Réponses imbriquées |
| `metadata` | `object` | ❌ | Métadonnées (fichier, image…) |
| `createdAt` | `string` | ✅ | Date d'envoi ISO |
| `updatedAt` | `string` | ✅ | Date de modification ISO |

#### `MessagePagination`

| Propriété | Type | Description |
|---|---|---|
| `offset` | `number` | Décalage de la page |
| `limit` | `number` | Taille de la page |
| `total` | `number` | Total de messages |
| `hasMore` | `boolean` | Il existe des messages plus anciens |
| `oldestMessageId` | `string` | ID du message le plus ancien chargé |

#### `ConversationListItem extends Conversation`

Étend `Conversation` avec les champs calculés pour l'affichage :

| Propriété | Type | Description |
|---|---|---|
| `displayName` | `string` | Nom affiché (groupe ou prénom du contact) |
| `avatarInitials` | `string` | Initiales pour l'avatar généré |
| `isOnline` | `boolean` | Présence en ligne (optionnel) |

### Payloads

```typescript
interface CreatePrivateConversationPayload {
  participantId: string;
}

interface CreateGroupConversationPayload {
  name: string;
  participantIds: string[];
}

interface SendMessagePayload {
  conversationId: string;
  content: string;
  type: 'text' | 'file' | 'image';
  replyToId?: string;
}

interface AddContactPayload {
  contactCode: string;
}
```

---

## `fiche.ts` — Fiches de sites

### `Fiche`

Interface principale de stockage. Les champs de catégorie utilisent des **identifiants numériques** référençant les constantes de `fiches.ts`.

| Propriété | Type | Description |
|---|---|---|
| `_id` | `string` | Identifiant MongoDB |
| `userId` | `string` | Propriétaire |
| `name` | `string` | Nom du site |
| `description` | `string` | Description |
| `type` | `number` | ID du type (→ `FICHE_TYPES`) |
| `etat` | `number` | ID de l'état (→ `FICHE_ETATS`) |
| `accessibilite` | `number` | ID de l'accessibilité (→ `FICHE_ACCESSIBILITES`) |
| `difficulte_acces` | `number` | ID de la difficulté (→ `FICHE_DIFFICULTES`) |
| `risque_oxygene` | `number` | ID du risque O₂ (→ `FICHE_RISQUES_O2`) |
| `etat_general` | `number` | ID de l'état général (→ `FICHE_ETATS_GENERAUX`) |
| `praticites` | `number[]` | IDs de praticité (→ `FICHE_PRATICITES`) |
| `equipements` | `number[]` | IDs d'équipements (→ `FICHE_EQUIPEMENTS`) |
| `surface` | `number` | ID de la superficie (→ `FICHE_SURFACES`) |
| `types_galeries` | `number[]` | IDs de types de galeries |
| `latitude` | `number` | Coordonnée GPS |
| `longitude` | `number` | Coordonnée GPS |
| `photos` | `string[]` | URLs des photos |
| `createdAt` | `string` | Date de création ISO |
| `updatedAt` | `string` | Date de mise à jour ISO |

### `Fiche3D`

Interface de présentation UI avec **labels lisibles** à la place des IDs. Utilisée pour l'affichage dans les écrans de détail.

```typescript
interface Fiche3D {
  // Même structure que Fiche mais :
  type: string;           // ex: "Carrière ⛏️"
  etat: string;           // ex: "Ouvert"
  accessibilite: string;  // ex: "Libre"
  difficulte_acces: string;
  risque_oxygene: string;
  etat_general: string;
  praticites: string[];
  equipements: string[];
  surface: string;
  types_galeries: string[];
}
```

### Payloads

```typescript
type CreateFichePayload = Omit<Fiche, '_id' | 'userId' | 'createdAt' | 'updatedAt'>;
type UpdateFichePayload = Partial<CreateFichePayload>;
```

### Helpers theme-aware

```typescript
// Couleurs dynamiques selon le thème pour les badges
getEtatColors(colors: Colors): Record<number, BadgeColors>
getAccessibiliteColors(colors: Colors): Record<number, BadgeColors>
```

### `TYPE_ICONS`

```typescript
// Map emoji par ID de type
const TYPE_ICONS: Record<number, string> = {
  1: '⛏️', // Carrière
  2: '⚒️', // Mine
  3: '🕳️', // Grotte
  ...
};
```

---

## `sos.ts` — SOS

### Types de base

```typescript
type SosRelationship = 'family' | 'friend' | 'colleague' | 'other';
type SosStage = -1 | 0 | 1 | 2;          // -1=inactif, 0=actif, 1=alerte, 2=urgence
type SosSessionStatus = 'active' | 'resolved' | 'cancelled' | 'expired';
type SosParticipantStatus = 'active' | 'resolved' | 'cancelled';
type SosDeactivateScope = 'self' | 'all';
type SosResolvedBy = 'user' | 'admin' | 'timeout' | 'contact';
```

### `SosContact`

| Propriété | Type | Description |
|---|---|---|
| `id` | `string` | Identifiant |
| `name` | `string` | Nom affiché |
| `phone` | `string` | Numéro de téléphone |
| `relationship` | `SosRelationship` | Lien avec l'utilisateur |
| `isDefault` | `boolean` | Contact par défaut |
| `createdAt` | `string` | Date ISO |
| `updatedAt` | `string` | Date ISO |

### `SosSession`

| Propriété | Type | Description |
|---|---|---|
| `id` | `string` | Identifiant de session |
| `userId` | `string` | Propriétaire |
| `status` | `SosSessionStatus` | État de la session |
| `expectedDuration` | `number` | Durée prévue (minutes) |
| `activatedAt` | `string` | Date d'activation ISO |
| `expiresAt` | `string` | Date d'expiration ISO |
| `currentStage` | `SosStage` | Stade courant |
| `ficheId` | `string` | Fiche de site associée (optionnel) |
| `note` | `string` | Note de l'utilisateur (optionnel) |
| `lastKnownLat` | `number` | Dernière latitude connue |
| `lastKnownLng` | `number` | Dernière longitude connue |
| `lastKnownAccuracy` | `number` | Précision GPS (mètres) |
| `contactIds` | `string[]` | IDs des contacts alertés |
| `heartbeatCount` | `number` | Nombre de heartbeats reçus |
| `lastHeartbeatAt` | `string` | Dernier heartbeat (optionnel) |
| `creatorId` | `string` | Créateur (session de groupe) |
| `isGroupSession` | `boolean` | Session multi-participants |
| `participants` | `SosParticipant[]` | Participants (session de groupe) |

### Payloads

```typescript
interface SosActivatePayload {
  expectedDuration: number;  // minutes
  ficheId?: string;
  note?: string;
  contactIds: string[];
}

interface SosActivateResponse {
  session: SosSession;
  message: string;
}

interface SosHeartbeatPayload {
  sessionId: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
}

interface SosHeartbeatResponse {
  success: boolean;
  session: SosSession;
  nextHeartbeatIn: number;  // secondes
}

interface SosExtendPayload {
  sessionId: string;
  additionalMinutes: number;
}
```

### `SosState`

État complet du contexte React SOS :

```typescript
interface SosState {
  session: SosSession | null;
  contacts: SosContact[];
  isLoading: boolean;
  isActivating: boolean;
  isDeactivating: boolean;
  error: string | null;
  lastHeartbeatAt: Date | null;
}
```

### Événements WebSocket

| Événement | Description |
|---|---|
| `WsSosParticipantAdded` | Un participant rejoint une session de groupe |
| `WsSosParticipantLeft` | Un participant quitte |
| `WsSosDeactivatedAll` | Désactivation globale par l'utilisateur |
| `WsSosCancelledAdmin` | Annulation par un administrateur |
| `WsSosAlarm` | Déclenchement de l'alarme sonore |
| `WsSosAlertStage1` | Passage au stade 1 (alerte) |
| `WsSosSurfaceDetected` | Retour en surface détecté |
| `WsSosReconnectionDetected` | Reconnexion réseau détectée |

### Constantes

| Constante | Valeur | Description |
|---|---|---|
| `SOS_MAX_CONTACTS` | `5` | Max contacts par session |
| `SOS_MIN_DURATION` | `15` | Durée min (min) |
| `SOS_MAX_DURATION` | `480` | Durée max (8h) |
| `SOS_QUICK_DURATIONS` | `[15, 60, 120, 240]` | Durées rapides proposées (min) |
| `SOS_HEARTBEAT_INTERVAL` | `60` | Intervalle heartbeat (s) |
| `SOS_ALARM_DURATION` | `3 * 60` | Durée alarme (3 min) |
| `SOS_STAGE_DELAY` | `15 * 60` | Délai avant escalade de stade (15 min) |

### Labels et couleurs des stades

```typescript
const SOS_STAGE_LABELS: Record<SosStage, string> = {
  [-1]: 'Inactif',
  [0]:  'Actif',
  [1]:  'Alerte',
  [2]:  'Urgence',
};

// Couleurs associées à chaque stade
const SOS_STAGE_COLORS: Record<SosStage, string>;

// Descriptions détaillées pour l'UI
const SOS_STAGE_DESCRIPTIONS: Record<SosStage, string>;
```

### Types historique et statistiques

```typescript
interface SosHistoryItem { ... }      // Entrée de l'historique
interface SosHistoryResponse { ... }  // Réponse paginée
interface SosHistoryEvent { ... }     // Événement détaillé
interface SosHistoryDetail { ... }    // Détail d'une session passée
interface SosStats { ... }            // Statistiques agrégées
interface SosWidgetData { ... }       // Données pour le widget natif
```

---

## `navigation.ts` — Navigation

### Arbre de navigation

```
RootStack
├── AuthStack
│   ├── Welcome
│   ├── Login
│   ├── Register
│   └── ForgotPassword
└── MainTab
    ├── MapStack
    ├── FichesStack
    ├── ListsStack
    ├── MessagesStack
    ├── ProfileStack
    └── AdminSosTab
        └── AdminSosStack
```

### `RootStackParamList`

```typescript
type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList>;
  Main: NavigatorScreenParams<MainTabParamList>;
};
```

### `AuthStackParamList`

```typescript
type AuthStackParamList = {
  Welcome:        undefined;
  Login:          undefined;
  Register:       undefined;
  ForgotPassword: undefined;
};
```

### `MainTabParamList`

```typescript
type MainTabParamList = {
  MapTab:       NavigatorScreenParams<MapStackParamList>;
  FichesTab:    NavigatorScreenParams<FichesStackParamList>;
  ListsTab:     NavigatorScreenParams<ListsStackParamList>;
  MessagesTab:  NavigatorScreenParams<MessagesStackParamList>;
  ProfileTab:   NavigatorScreenParams<ProfileStackParamList>;
  AdminSosTab:  NavigatorScreenParams<AdminSosTabParamList>;
};
```

### Props helpers

```typescript
// Utilisation dans les écrans
type RootStackScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;

type AuthStackScreenProps<T extends keyof AuthStackParamList> =
  NativeStackScreenProps<AuthStackParamList, T>;

type MainTabScreenProps<T extends keyof MainTabParamList> =
  BottomTabScreenProps<MainTabParamList, T>;

type MapStackScreenProps<T extends keyof MapStackParamList> =
  NativeStackScreenProps<MapStackParamList, T>;

// ... idem pour FichesStack, ListsStack, MessagesStack, ProfileStack, AdminSosStack
```

```typescript
// Exemple d'utilisation dans un écran
const LoginScreen: React.FC<AuthStackScreenProps<'Login'>> = ({ navigation, route }) => {
  const handleSuccess = () => navigation.navigate('Main', { screen: 'MapTab' });
};
```

---

## `point.ts` — Points

### `Point`

| Propriété | Type | Description |
|---|---|---|
| `_id` | `string` | Identifiant MongoDB |
| `userId` | `string` | Propriétaire |
| `name` | `string` | Nom du point |
| `description` | `string` | Description |
| `location` | `GeoJSONPoint` | Géométrie GeoJSON `{ type: 'Point', coordinates: [lng, lat] }` |
| `ficheId` | `string` | Fiche de site associée (optionnel) |
| `accessType` | `AccessType` | Niveau d'accès |
| `createdAt` | `string` | Date ISO |
| `updatedAt` | `string` | Date ISO |

### `AccessType`

```typescript
type AccessType = 'public' | 'privé' | 'restreint' | 'interdit';
```

### `ACCESS_TYPE_COLORS`

Couleurs par type d'accès, utilisées pour les marqueurs et badges :

| Type | `bg` | `text` | `border` | `marker` |
|---|---|---|---|---|
| `public` | Vert clair | Vert foncé | Vert | Vert |
| `privé` | Bleu clair | Bleu foncé | Bleu | Bleu |
| `restreint` | Orange clair | Orange foncé | Orange | Orange |
| `interdit` | Rouge clair | Rouge foncé | Rouge | Rouge |

---

## `websocket.ts` — WebSocket

### `WebSocketConfig`

```typescript
interface WebSocketConfig {
  url: string;
  token: string;
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
}
```

### `WebSocketState`

```typescript
interface WebSocketState {
  isConnected: boolean;
  isReconnecting: boolean;
  reconnectAttempts: number;
  lastError: string | null;
}
```

### Canal Notifications (serveur → client)

| Événement | Description |
|---|---|
| `connected` | Connexion WebSocket établie |
| `notification` | Nouvelle notification push |
| `sync_update` | Mise à jour de synchronisation disponible |
| `notification_read` | Notification marquée comme lue |
| `conversation_update` | Mise à jour d'une conversation |
| `new_conversation` | Nouvelle conversation créée |
| `group_deleted` | Groupe supprimé |
| `group_update` | Mise à jour d'un groupe |
| `member_removed` | Membre retiré d'un groupe |
| `group_name_changed` | Nom du groupe modifié |
| `message_read` | Message marqué comme lu |

### Canal Messages (serveur → client)

| Événement | Description |
|---|---|
| `new_message` | Nouveau message reçu |
| `messages` | Liste de messages (pagination) |
| `message_read` | Accusé de lecture |
| `message_reply` | Réponse à un message |
| `message_edited` | Message modifié |
| `message_deleted` | Message supprimé |
| `error` | Erreur du canal |

### Canal Messages (client → serveur)

| Payload | Description |
|---|---|
| `message` | Envoyer un nouveau message |
| `getMessages` | Récupérer des messages paginés |
| `markMessageAsRead` | Marquer un message comme lu |
| `replyToMessage` | Répondre à un message |
| `editMessage` | Modifier un message |
| `deleteMessage` | Supprimer un message |

### Types utilitaires

```typescript
// Callback générique pour les événements de notification
type NotificationWsEventCallback<T = unknown> = (data: T) => void;

// Callback pour les événements du canal messages
type MessageWsServerEventCallback<T = unknown> = (data: T) => void;

// Handler typé pour un événement WebSocket spécifique
type WebSocketEventHandler<T> = (payload: T) => void;
```

---

## `sync.ts` — Synchronisation

### Entités synchronisées

```typescript
interface SyncPoint      extends Point      { localId?: string; }
interface SyncFiche      extends Fiche      { localId?: string; }
interface SyncList       extends List       { localId?: string; }
interface SyncSosContact extends SosContact { localId?: string; }
```

### `SyncChanges<T>`

```typescript
interface SyncChanges<T> {
  created: T[];
  updated: T[];
  deleted: string[];  // IDs supprimés
}
```

### `SyncResponse`

```typescript
interface SyncResponse {
  success: boolean;
  points:      SyncChanges<SyncPoint>;
  fiches:      SyncChanges<SyncFiche>;
  lists:       SyncChanges<SyncList>;
  sosContacts: SyncChanges<SyncSosContact>;
  lastSyncDate:  string;
  totalChanges:  number;
  syncDuration:  number;  // ms
}
```

### `LocalChange`

Représente une modification locale en attente de push :

```typescript
interface LocalChange {
  type:      'point' | 'fiche' | 'list' | 'sosContact';
  action:    'create' | 'update' | 'delete';
  id?:       string;   // ID serveur si connu
  localId?:  string;   // ID local temporaire
  data?:     unknown;  // Corps de la modification
  timestamp: number;   // Date de modification (ms)
}
```

### `PushSyncPayload` / `PushSyncResponse`

```typescript
interface PushSyncPayload {
  changes: LocalChange[];
  lastSyncDate?: string;
}

interface PushSyncResponse {
  synced:    string[];   // IDs traités avec succès
  conflicts: string[];   // IDs en conflit
  errors:    string[];   // IDs en erreur
  idMapping: Record<string, string>;  // localId → serverId
}
```

### `SyncStatus`

```typescript
type SyncStatus = 'idle' | 'syncing' | 'success' | 'error' | 'offline';
```

### `SyncErrorCode` — 12 codes d'erreur

| Code | Description |
|---|---|
| `NETWORK_ERROR` | Pas de réseau |
| `AUTH_ERROR` | Token invalide ou expiré |
| `SERVER_ERROR` | Erreur côté serveur |
| `CONFLICT_ERROR` | Conflit de données |
| `TIMEOUT_ERROR` | Délai dépassé |
| `STORAGE_ERROR` | Erreur de stockage local |
| `PARSE_ERROR` | Erreur de désérialisation |
| `VALIDATION_ERROR` | Données invalides |
| `QUOTA_ERROR` | Quota dépassé |
| `UNKNOWN_ERROR` | Erreur inconnue |
| `PARTIAL_SYNC_ERROR` | Synchronisation partielle |
| `VERSION_MISMATCH` | Version API incompatible |

---

## `adminSos.ts` — Administration SOS

### Types de base

```typescript
type AdminSosUrgencyLevel      = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type AdminSosSessionStatus     = 'ACTIVE' | 'RESOLVED' | 'CANCELLED' | 'EXPIRED';
type AdminSosParticipantStatus = 'ACTIVE' | 'RESOLVED' | 'CANCELLED';
type AdminSosResolvedBy        = 'USER' | 'ADMIN' | 'TIMEOUT' | 'CONTACT';
```

### `AdminSosDashboardSession`

| Propriété | Type | Description |
|---|---|---|
| `_id` | `string` | Identifiant |
| `status` | `AdminSosSessionStatus` | État de la session |
| `currentStage` | `SosStage` | Stade courant |
| `activatedAt` | `string` | Date d'activation ISO |
| `expiresAt` | `string` | Date d'expiration ISO |
| `user` | `ContactInfo` | Utilisateur en détresse |
| `participantCount` | `number` | Nombre de participants |
| `isGroupSession` | `boolean` | Session de groupe |
| `participantsOverview` | `AdminSosParticipantOverview[]` | Aperçu des participants |
| `timeRemaining` | `number` | Secondes restantes |
| `timeSinceExpired` | `number` | Secondes depuis expiration |
| `urgencyLevel` | `AdminSosUrgencyLevel` | Niveau d'urgence calculé |

### `AdminSosDashboardData`

```typescript
interface AdminSosDashboardData {
  activeSessions:          number;
  escalatingSessions:      number;
  groupSessions:           number;
  totalParticipantsAtRisk: number;
  resolvedToday:           number;
  totalSessions24h:        number;
  sessions:                AdminSosDashboardSession[];
}
```

### `AdminSosSessionDetail`

Détail complet d'une session pour l'écran admin :

```typescript
interface AdminSosSessionDetail {
  session:                  AdminSosDashboardSession;
  participantsDetails:      AdminSosParticipantDetail[];
  events:                   SosHistoryEvent[];
  contacts:                 SosContact[];
  deduplicatedContacts:     SosContact[];
  contactsByParticipant:    Record<string, SosContact[]>;
}
```

### Réponses des actions admin

| Type | Description |
|---|---|
| `AdminSosCancelResponse` | Annulation d'une session |
| `AdminSosHeartbeatResponse` | Forcer un heartbeat |
| `AdminSosExtendResponse` | Prolonger une session |
| `AdminSosForceEscalationResponse` | Forcer l'escalade de stade |
| `AdminSosActivateResponse` | Activer une session au nom d'un utilisateur |
| `AdminSosConfirmSafeResponse` | Confirmer la mise en sécurité |
| `AdminSosParticipantResponse` | Actions sur un participant |
| `AdminSosTriggerSmsResponse` | Déclencher l'envoi d'un SMS |

### Constantes d'affichage

```typescript
// Couleurs par niveau d'urgence
const ADMIN_SOS_URGENCY_COLORS: Record<AdminSosUrgencyLevel, string>;

// Labels FR par niveau d'urgence
const ADMIN_SOS_URGENCY_LABELS: Record<AdminSosUrgencyLevel, string>;

// Labels FR par statut de session
const ADMIN_SOS_STATUS_LABELS: Record<AdminSosSessionStatus, string>;

// Couleurs par statut de session
const ADMIN_SOS_STATUS_COLORS: Record<AdminSosSessionStatus, string>;

// Labels FR par statut de participant
const ADMIN_SOS_PARTICIPANT_STATUS_LABELS: Record<AdminSosParticipantStatus, string>;
```
