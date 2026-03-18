# Hooks personnalisés — Application Mobile Qvarry

## Vue d'ensemble

Les hooks sont situés dans `src/hooks/`. Ils encapsulent la logique métier réutilisable et l'accès aux données.

---

## Hooks de données

### `useFiches`

**Fichier** : `src/hooks/useFiches.ts`

Gère le CRUD des fiches avec support offline-first.

```typescript
const {
  fiches,          // SyncFiche[] — données du cache local
  isLoading,
  error,
  createFiche,     // (data) => Promise<string>
  updateFiche,     // (id, data) => Promise<void>
  deleteFiche,     // (id) => Promise<void>
  refresh,         // () => Promise<void> — force une sync
} = useFiches();
```

---

### `useLists`

**Fichier** : `src/hooks/useLists.ts`

Gère le CRUD des listes avec support offline-first.

```typescript
const {
  lists,
  isLoading,
  error,
  createList,
  updateList,
  deleteList,
  refresh,
} = useLists();
```

---

### `usePoints`

**Fichier** : `src/hooks/usePoints.ts`

Accès aux points de fidélité de l'utilisateur.

```typescript
const {
  points,         // score total
  transactions,   // historique des transactions
  isLoading,
  refresh,
} = usePoints();
```

---

### `useSync`

**Fichier** : `src/hooks/useSync.ts` (via `SyncContext`)

Accès à l'état et aux actions de synchronisation.

```typescript
const {
  isSyncing,
  lastSyncDate,
  pendingChangesCount,
  syncError,
  sync,             // (options?) => Promise<void>
  resetSync,        // () => Promise<void>
} = useSync();
```

---

### `useNotifications`

**Fichier** : `src/hooks/useNotifications.ts`

Gestion des notifications in-app et push.

```typescript
const {
  notifications,       // liste des notifications non lues
  unreadCount,
  markAsRead,          // (id) => Promise<void>
  markAllAsRead,
  refresh,
} = useNotifications();
```

---

## Hooks système

### `useAppPermissions`

**Fichier** : `src/hooks/useAppPermissions.ts`

Demande et vérifie les permissions système nécessaires (géolocalisation, notifications, caméra, microphone).

```typescript
const permissions = useAppPermissions(enabled);
// enabled: boolean — activer uniquement quand l'utilisateur est authentifié

// Retourne :
// { isLoading, location, notifications, camera, ... }
```

Appelé dans `AppNavigator` après l'authentification. Affiche le `SplashLoader "Autorisations"` pendant la demande.

---

### `usePushNotifications`

**Fichier** : `src/hooks/usePushNotifications.ts`

Initialise le service de notifications push Firebase FCM et enregistre le token.

```typescript
usePushNotifications(enabled);
// enabled: boolean — activer uniquement quand l'utilisateur est authentifié
```

**Actions réalisées** :
1. Demande la permission de notifications
2. Récupère le token FCM via `@react-native-firebase/messaging`
3. Enregistre le token sur le serveur via `POST /api/v1/mobile/push-tokens`
4. Configure les handlers de réception (foreground / background / quit)

---

### `useHaptics`

**Fichier** : `src/hooks/useHaptics.ts`

Wrapper sur `HapticsContext` pour le retour haptique.

```typescript
const haptics = useHaptics();

haptics.selection();  // Feedback léger (navigation)
haptics.success();    // Feedback succès
haptics.error();      // Feedback erreur
haptics.warning();    // Feedback avertissement
haptics.impact();     // Feedback impact
```

---

### `useThemedStyles`

**Fichier** : `src/hooks/useThemedStyles.ts`

Génère des styles dynamiques en fonction du thème courant (clair / sombre).

```typescript
const styles = useThemedStyles((colors) => StyleSheet.create({
  container: {
    backgroundColor: colors.background.primary,
  },
  text: {
    color: colors.text.primary,
  },
}));
```

Évite de recréer les `StyleSheet` à chaque rendu en mémoisant le résultat.

---

### `useWebSocket`

**Fichier** : `src/hooks/useWebSocket.ts`

Accès simplifié au `WebSocketContext`.

```typescript
const { isConnected, send, subscribe } = useWebSocket();
```

---

## Hooks spécialisés par module

---

## `hooks/map/` — Navigation et capteurs

### `useUserLocation`

**Fichier** : `src/hooks/map/useUserLocation.ts`

Géolocalisation GPS continue et boussole lissée en temps réel.

```typescript
const {
  latitude,                    // number | null
  longitude,                   // number | null
  accuracy,                    // number | null
  heading,                     // number | null — cap en degrés (0-360), boussole lissée
  speed,                       // number | null
  isLoading,
  error,                       // string | null
  isLocationSettingsUnsatisfied, // boolean — GPS désactivé sur Android
  onHeadingChange,             // (callback: (heading: number) => void) => () => void
} = useUserLocation();
```

**Fonctionnalités clés** :
- Géolocalisation GPS continue via `watchPosition` (Expo Location)
- Boussole via `@madejski/react-native-compass-heading` avec lissage d'angle à 10fps max
- `onHeadingChange` est **callback-based** pour éviter les re-renders à 10fps (ne déclenche pas de re-render à chaque variation de cap)
- Gère la permission `FOREGROUND` et la retransition foreground
- `isLocationSettingsUnsatisfied` : vrai si le GPS est désactivé côté OS (Android uniquement)

---

### `useSensorFusion`

**Fichier** : `src/hooks/map/useSensorFusion.ts`

Fusionne les données de plusieurs capteurs pour produire un cap fiable et lissé.

```typescript
const {
  fusedHeading,        // number — cap fusionné 0-360°
  confidence,          // number — 0-1 (1 = très fiable)
  isMagneticAnomaly,   // boolean — anomalie magnétique détectée
  isCalibrating,       // boolean — en cours de calibration
} = useSensorFusion();
```

**Fonctionnalités clés** :
- **Filtre de Kalman 1D** : fusionne gyroscope + magnétomètre + accéléromètre pour réduire le bruit de mesure
- **Filtre passe-bas** : α=0.8 pour lisser les variations rapides
- **Détection d'anomalie magnétique** : fenêtre glissante de 10 mesures, seuil de variation >50% déclenche `isMagneticAnomaly`
- **EMA heading** : α=0.3 appliqué sur la sortie finale pour stabiliser l'affichage
- Fréquences d'acquisition : gyroscope/accéléromètre @ 50Hz, magnétomètre @ 10Hz

---

### `usePedometerDetection`

**Fichier** : `src/hooks/map/usePedometerDetection.ts`

Détecte les pas et estime la distance parcourue à partir des données accéléromètre.

```typescript
// Props optionnelles
const {
  stepCount,    // number — nombre de pas depuis le démarrage
  stepLength,   // number — longueur de pas estimée (mètres)
  cadence,      // number — pas par minute
  portMode,     // 'hand' | 'pocket' — mode de port du téléphone détecté
  distance,     // number — distance parcourue (mètres)
  isActive,     // boolean
} = usePedometerDetection({
  externalAccelData?: { x: number; y: number; z: number }, // données accel externes
  enabled?: boolean,
});
```

**Fonctionnalités clés** :
- **Modèle de Weinberg** : longueur de pas calculée via `K × ⁴√(accMax - accMin)`, K ajustable via calibration GPS
- **ZUPT** (Zero Velocity Update) : détecte les arrêts complets et remet la vitesse à zéro pour éviter la dérive
- **Seuil adaptatif** : s'adapte automatiquement au niveau d'activité (marche lente vs rapide)
- Détection du mode de port : `hand` = tenu en main, `pocket` = dans la poche (affecte l'orientation des axes)
- Calcule la cadence en pas/minute sur une fenêtre glissante

---

### `useBarometer`

**Fichier** : `src/hooks/map/useBarometer.ts`

Mesure l'altitude et détecte les changements d'étage via le capteur de pression atmosphérique.

```typescript
const {
  altitude,          // number | null — altitude calculée (mètres)
  pressure,          // number | null — pression atmosphérique (hPa)
  floorChanges,      // number — nombre de changements d'étage détectés
  climbedMeters,     // number — total montée cumulée (m)
  descendedMeters,   // number — total descente cumulée (m)
  isAvailable,       // boolean — baromètre disponible sur l'appareil
} = useBarometer();
```

**Fonctionnalités clés** :
- **Formule barométrique** : `h = 44330 × (1 - (P/P₀)^0.1903)` avec P₀=1013.25 hPa comme pression de référence standard
- **Filtre passe-bas** : lisse les variations de pression pour éviter les faux positifs
- Détection de changements d'étage avec seuil de ~3m de dénivelé
- Accumulation des montées et descentes cumulées pour le bilan altimétrique global

---

### `useUndergroundNavigation`

**Fichier** : `src/hooks/map/useUndergroundNavigation.ts`

Orchestrateur principal de navigation en intérieur/souterrain, sans GPS.

```typescript
const {
  state,             // 'idle' | 'calibrating' | 'active' | 'paused' | 'completed'
  currentPosition,   // { latitude: number; longitude: number } | null
  path,              // Array<{ latitude: number; longitude: number }>
  confidence,        // number — 0-1 (décroît avec distance/temps/anomalie magnétique)
  distanceTraveled,  // number — mètres
  heading,           // number — direction actuelle (degrés)
  stepCount,         // number
  start,             // (startPos) => void
  pause,             // () => void
  resume,            // () => void
  stop,              // () => void
  calibrate,         // () => void — recalibre avec GPS si disponible
} = useUndergroundNavigation();
```

**Fonctionnalités clés** :
- **PDR** (Pedestrian Dead Reckoning) : orchestrateur principal qui combine `useSensorFusion`, `usePedometerDetection` et `useBarometer`
- **Calibration GPS** : requiert ~20m de marche en espace ouvert, timeout 60s ; ajuste le coefficient K du podomètre en comparant la distance GPS et podomètre
- **Loop closure GPS** : si le GPS redevient disponible en sous-sol (puits, sortie partielle), recale la position estimée sur la position GPS
- **Détection de demi-tours** : détecte les retours en arrière via un changement de cap >150° et ajuste la trajectoire en conséquence
- **Score de confiance** : décroît avec la distance parcourue, le temps écoulé et les anomalies magnétiques détectées
- **Vitesse max** : 3m/s — filtre les téléportations GPS parasites

---

## `hooks/messaging/` — Messagerie

### `useConversations`

**Fichier** : `src/hooks/messaging/useConversations.ts`

Gère la liste des conversations avec enrichissement des participants et mises à jour temps réel.

```typescript
const {
  conversations,      // ConversationListItem[] — triées par date du dernier message
  isLoading,
  error,              // string | null
  refresh,            // () => Promise<void>
  totalUnreadCount,   // number
  hideConversation,   // (conversationId: string) => Promise<void>
} = useConversations();
```

**Fonctionnalités clés** :
- Chargement initial via API REST `GET /conversations`
- **Enrichissement des participants** : pour les conversations privées, résout chaque `userId` en `Contact` via l'API avec cache négatif pour les 404 connus (utilisateurs inconnus ou supprimés)
- **Temps réel via WebSocket** : écoute les événements `conversation_update`, `new_conversation`, `group_deleted`, `conversation_read` (ce dernier étant émis par `useMessages` lors d'un `markAsRead`)
- Tri automatique par `lastMessageDate` décroissant après chaque mise à jour WebSocket

---

### `useMessages`

**Fichier** : `src/hooks/messaging/useMessages.ts`

Gère les messages d'une conversation avec pagination, envoi optimiste et temps réel.

```typescript
const {
  messages,       // Message[] — triés chronologiquement (plus anciens en premier)
  isLoading,
  isSending,      // boolean
  error,          // string | null
  hasMore,        // boolean — pagination disponible
  refresh,        // () => Promise<void>
  loadMore,       // () => Promise<void> — charge 50 messages plus anciens
  sendMessage,    // (content: string) => Promise<void>
  markAsRead,     // () => Promise<void>
} = useMessages(conversationId: string);
```

**Fonctionnalités clés** :
- Chargement paginé par tranches de 50 messages via `GET /conversations/:id/messages`
- **Message optimiste** : après `sendMessage`, insère localement le message avec l'ID retourné par l'API avant de recevoir la confirmation WebSocket (évite le doublon)
- **Temps réel** : écoute `new_message`, `message_read`, `message_edited`, `message_deleted`, filtrés par `conversationId` pour n'appliquer que les changements pertinents
- `markAsRead` : marque tous les messages non lus, met à jour l'état local et émet `conversation_read` pour que `useConversations` mette à jour son compteur

---

### `useContacts`

**Fichier** : `src/hooks/messaging/useContacts.ts`

Gère la liste des contacts et les demandes d'ajout en attente.

```typescript
const {
  contacts,         // Contact[] — contacts acceptés
  pendingRequests,  // Contact[] — demandes en attente (reçues)
  isLoading,
  error,            // string | null
  refresh,          // () => Promise<void>
  addContact,       // (contactCode: string) => Promise<void>
  acceptRequest,    // (contactId: string) => Promise<void>
  refuseRequest,    // (contactId: string) => Promise<void>
  deleteContact,    // (contactId: string) => Promise<void>
} = useContacts();
```

**Fonctionnalités clés** :
- Chargement parallèle de `getAcceptedContacts()` et `getPendingRequests()` via `Promise.all` pour réduire la latence initiale
- `acceptRequest` : déplace optimistement le contact de `pendingRequests` vers `contacts` sans attendre la confirmation serveur
- `refuseRequest` et `deleteContact` : suppression locale optimiste, la liste est mise à jour immédiatement

---

## `hooks/admin/` — Administration

### `useAdminSosPolling`

**Fichier** : `src/hooks/admin/useAdminSosPolling.ts`

Maintient le tableau de bord admin synchronisé via un mode hybride WebSocket + polling de fallback.

```typescript
// Signature
useAdminSosPolling(intervalMs?: number, enabled?: boolean): void

// Exemple d'usage
useAdminSosPolling(60000, isAdmin); // polling toutes les 60s, actif si admin
```

**Paramètres** :
- `intervalMs` : intervalle de polling en ms (défaut : `60000` = 60s)
- `enabled` : active ou désactive le hook (défaut : `true`)

**Fonctionnalités clés** :
- **Mode hybride WebSocket + polling** : le WebSocket gère les mises à jour critiques en temps réel, le polling garantit la synchronisation en cas d'événement manqué
- **WebSocket** : s'abonne aux notifications de type `'sos'` via `NotificationWebSocketService` ; à chaque notification reçue, déclenche immédiatement `refreshDashboard()` + `refreshActiveSessions()`
- **Polling de fallback** : intervalle de 60s (allégé par rapport à 30s car le WebSocket couvre les cas urgents), assure une re-synchronisation périodique
- Effectue un refresh immédiat au montage du composant (premier chargement sans attendre l'intervalle)
- Cleanup automatique (`clearInterval` + `removeListener`) au démontage du composant
