# Service SOS (Safety-Critical)

## Table des matières

- [Vue d'ensemble](#vue-densemble)
- [Constantes](#constantes)
- [activateSession](#activatesession)
- [sendHeartbeat](#sendheartbeat)
- [extendSession](#extendsession)
- [deactivateSession](#deactivatesession)
- [Escalade automatique](#escalade-automatique)
- [Sessions de groupe](#sessions-de-groupe)
- [Détection de surface](#détection-de-surface)
- [Reconnexion](#reconnexion)

---

## Vue d'ensemble

Le service SOS est le composant **le plus critique** de l'API Qvarry. Il gère le cycle de vie complet des sessions d'urgence, de l'activation à la résolution, en passant par l'escalade automatique.

> ⚠️ **Safety-critical** : toute modification de ce service doit être testée exhaustivement. Une régression peut empêcher l'envoi d'alertes d'urgence et mettre des vies en danger.

```
┌─────────────────────────────────────────────────────────────┐
│                      sosService                             │
│                                                             │
│  activateSession()    → Créer session SOS                   │
│  sendHeartbeat()      → Prolonger timer (+15 min)           │
│  extendSession()      → Prolonger manuellement              │
│  deactivateSession()  → Résoudre la session                 │
│                                                             │
│  [appelé par startSosEscalationJob toutes les 1 min]        │
│  checkEscalation()    → Vérifier et déclencher escalades    │
└─────────────────────────────────────────────────────────────┘
         │
         │ Notifications
    ┌────┼────────────────────────────┐
    ▼    ▼                            ▼
FCM Push  WebSocket           Vonage SMS
(Stage 0) (Stage 1)            (Stage 2)
```

---

## Constantes

```typescript
// Timers
const HEARTBEAT_EXTENSION_MINUTES = 15; // Prolongation par heartbeat
const STAGE_1_DELAY_MINUTES = 15; // Délai Stage 1 après expiration
const STAGE_2_DELAY_MINUTES = 30; // Délai Stage 2 après expiration

// Durées session
const MIN_DURATION_MINUTES = 15; // Durée minimale
const MAX_DURATION_MINUTES = 480; // Durée maximale (8h)

// Détection de surface
const SURFACE_DISTANCE_THRESHOLD_METERS = 200; // Distance seuil
const RECONNECTION_THRESHOLD_MS = 300_000; // 5 minutes
const MIN_HEARTBEATS_FOR_RECONNECTION = 5; // Heartbeats min
```

---

## activateSession

Crée et démarre une nouvelle session SOS.

### Signature

```typescript
sosService.activateSession(
  userId: string,
  params: {
    expectedDuration: number;        // Minutes (15-480)
    note?: string;
    location?: { lat: number; lng: number; accuracy: number };
    siteName?: string;
    zone?: string;
    depth?: number;
    sessionContacts?: SosContact[];  // Contacts temporaires
    participantIds?: string[];       // Session de groupe
  }
): Promise<SosSession>
```

### Logique interne

```
1. Vérifier qu'aucune session ACTIVE n'existe pour userId
2. Valider expectedDuration (MIN <= x <= MAX)
3. Créer SosSession en MongoDB :
   {
     userId,
     status: 'ACTIVE',
     activatedAt: now(),
     expiresAt: now() + expectedDuration,
     stage1At: expiresAt + STAGE_1_DELAY_MINUTES,
     stage2At: expiresAt + STAGE_2_DELAY_MINUTES,
     contacts: [...permanentContacts, ...sessionContacts],
     participants: participantIds.map(id => ({
       userId: id,
       status: 'ACTIVE',
       expiresAt: now() + expectedDuration,
     }))
   }
4. Si participantIds présents → notifier les participants (push + WebSocket)
5. Log audit : SOS_ACTIVATED
6. Retourner la session créée
```

---

## sendHeartbeat

Prolonge le timer de la session active.

### Signature

```typescript
sosService.sendHeartbeat(
  userId: string,
  params: {
    sessionId?: string;
    location?: { lat: number; lng: number; accuracy: number };
  }
): Promise<SosSession>
```

### Logique interne

```
1. Trouver session ACTIVE pour userId (ou par sessionId)
2. Si status != 'ACTIVE' → erreur SESSION_NOT_ACTIVE
3. Prolonger le timer :
   newExpiresAt = now() + HEARTBEAT_EXTENSION_MINUTES

   IMPORTANT : ne pas dépasser MAX_DURATION_MINUTES depuis activatedAt

4. Mettre à jour en MongoDB :
   {
     expiresAt: newExpiresAt,
     stage1At: newExpiresAt + STAGE_1_DELAY_MINUTES,
     stage2At: newExpiresAt + STAGE_2_DELAY_MINUTES,
     lastHeartbeatAt: now(),
     heartbeatCount: count + 1,
     lastLocation: location (si fourni),
   }
5. Si session de groupe : prolonger le timer du participant (pas de la session globale)
6. Retourner session mise à jour
```

---

## extendSession

Prolonge manuellement la session d'un nombre de minutes défini.

### Signature

```typescript
sosService.extendSession(
  userId: string,
  params: {
    sessionId?: string;
    minutes: number;
  }
): Promise<SosSession>
```

### Différence avec sendHeartbeat

| Aspect                        | sendHeartbeat                             | extendSession             |
| ----------------------------- | ----------------------------------------- | ------------------------- |
| Durée de prolongation         | Fixe (`HEARTBEAT_EXTENSION_MINUTES` = 15) | Personnalisée (`minutes`) |
| Incrémente `heartbeatCount`   | Oui                                       | Non                       |
| Met à jour `lastHeartbeatAt`  | Oui                                       | Non                       |
| Limite `MAX_DURATION_MINUTES` | Oui                                       | Oui                       |

---

## deactivateSession

Résout et ferme la session SOS (retour sain de l'utilisateur).

### Signature

```typescript
sosService.deactivateSession(
  userId: string,
  params: {
    sessionId?: string;
    note?: string;
  }
): Promise<SosSession>
```

### Logique interne

```
1. Trouver session ACTIVE ou ESCALATING pour userId
2. Passer status → 'RESOLVED'
3. Définir resolvedAt = now()
4. Calculer duration = (resolvedAt - activatedAt) en minutes
5. Si escalade était en cours (Stage 1 ou Stage 2) :
   → Notifier les contacts de la résolution
   → Push : "Jean Dupont est sain et sauf"
   → WebSocket : { type: 'sos_resolved', ... }
6. Log audit : SOS_DEACTIVATED
7. Retourner session résolue
```

---

## Escalade automatique

L'escalade est déclenchée par `startSosEscalationJob` (toutes les minutes). Le service expose `checkAndEscalate(session)` pour chaque session.

### Flow d'escalade complet

```
Session expire (expiresAt < now)
         │
         ▼ Status → EXPIRED
         │
         │  Stage 0 (immédiatement après expiration)
         ▼
┌──────────────────────────────────────────┐
│  Notification push à l'utilisateur        │
│  Titre : "Session SOS expirée"            │
│  Corps : "Votre session a expiré.         │
│           Confirmez votre retour sain."   │
│  Son : alarme (priorité haute)            │
└────────────────┬─────────────────────────┘
                 │
                 │  +15 min (STAGE_1_DELAY_MINUTES)
                 ▼ Status → ESCALATING (stage1Done = true)
┌──────────────────────────────────────────┐
│  Stage 1 : Alerte contacts               │
│                                          │
│  1. Push FCM à chaque contact            │
│     (si token FCM disponible)            │
│     Titre : "ALERTE SOS - Jean Dupont"   │
│                                          │
│  2. WebSocket à chaque contact           │
│     (si connexion WS active)             │
│     { type: 'sos_alert',                 │
│       escalationStage: 1,                │
│       lastLocation: { lat, lng },        │
│       userName: 'Jean Dupont' }          │
└────────────────┬─────────────────────────┘
                 │
                 │  +30 min total (STAGE_2_DELAY_MINUTES)
                 ▼ escalationStage = 2
┌──────────────────────────────────────────┐
│  Stage 2 : SMS Vonage contacts           │
│                                          │
│  Pour chaque contact avec numéro tel :   │
│  vonageService.sendSMS(phone, message)   │
│                                          │
│  Message :                               │
│  "ALERTE URGENCE - Jean Dupont           │
│   n'a pas donne signe de vie.            │
│   Derniere position : 43.29N 5.36E.      │
│   Session SOS expirée depuis 30min.      │
│   Contactez le 15."                      │
└──────────────────────────────────────────┘
```

### Priorité des contacts pour les alertes

```
1. sessionContacts (définis à l'activation, temporaires)
2. Contacts permanents (POST /sos/contacts)
3. Participants de la session de groupe
```

---

## Sessions de groupe

Plusieurs utilisateurs peuvent participer à une même session SOS.

### Modèle de participant

```typescript
interface SosParticipant {
  userId: string;
  status: "ACTIVE" | "EXPIRED" | "ESCALATING" | "RESOLVED";
  joinedAt: Date;
  expiresAt: Date;
  stage1At: Date;
  stage2At: Date;
  stage1Done: boolean;
  stage2Done: boolean;
  lastHeartbeatAt?: Date;
  heartbeatCount: number;
  escalationStage: 0 | 1 | 2;
}
```

### Règles des sessions de groupe

| Règle                   | Description                                                   |
| ----------------------- | ------------------------------------------------------------- |
| Timer indépendant       | Chaque participant a son propre timer d'escalade              |
| Heartbeat individuel    | Chaque participant envoie ses propres heartbeats              |
| Résolution individuelle | Un participant peut se résoudre sans affecter les autres      |
| Notification croisée    | Chaque participant est notifié du statut des autres           |
| Contacts partagés       | Les contacts de la session principale sont utilisés pour tous |

### Notification croisée

```
Participant A expire (pas de heartbeat)
         │
         ▼
WebSocket → Participant B :
{
  "type": "participant_sos_alert",
  "payload": {
    "participantId": "userId-A",
    "participantName": "Jean",
    "escalationStage": 1,
    "sessionId": "..."
  }
}
```

---

## Détection de surface

Quand un utilisateur remonte en surface après une plongée (reconnexion réseau), l'app peut signaler ce retour via `POST /sos/surface-detected`.

### Logique de détection

```
POST /sos/surface-detected avec { lat, lng }

Calcul de distance :
  distance = haversine(lastKnownLocation, surfaceLocation)

Si distance <= SURFACE_DISTANCE_THRESHOLD_METERS (200m) :
  → Probable retour au point de départ
  → Notification à l'utilisateur : "Êtes-vous rentré sain et sauf ?"
  → Suspension temporaire de l'escalade (10 min)
  → Si pas de réponse → reprendre escalade

Si distance > 200m :
  → Probable fausse détection (zone différente)
  → Log info, pas d'action automatique
```

---

## Reconnexion

Si l'application mobile perd sa connexion internet puis se reconnecte, le service gère la reprise de session.

### Conditions de reconnexion valide

```
Pour valider une reconnexion, les critères suivants doivent être réunis :
  1. Session toujours ACTIVE (pas encore expirée)
  2. Durée de déconnexion < RECONNECTION_THRESHOLD_MS (5 min)
  3. Nombre de heartbeats reçus >= MIN_HEARTBEATS_FOR_RECONNECTION (5)
```

### Message SOS_SERVER_RESTART

En cas de redémarrage du serveur alors que des sessions SOS sont actives :

```
Au démarrage :
  1. Charger les sessions SOS ACTIVE en MongoDB
  2. Pour chaque session :
     a. Vérifier si encore valide (non expirée)
     b. Envoyer WebSocket SOS_SERVER_RESTART aux clients connectés
     c. Enregistrer un log info : "Session SOS reprise après redémarrage"

  PendingNotification pour les sessions expirées pendant le downtime →
  Retry via startPushTokenCleanupJob
```

---

_Voir aussi : [cron-jobs.md](cron-jobs.md) — [vonage-sms.md](vonage-sms.md) — [push-notifications.md](push-notifications.md) — [sos-mode.md](../05_mobile/sos-mode.md)_
