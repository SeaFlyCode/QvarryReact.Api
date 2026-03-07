# Panel Admin SOS - Guide d'integration Web & Mobile

## Table des matieres

1. [Vue d'ensemble](#vue-densemble)
2. [Authentification](#authentification)
3. [Architecture des endpoints](#architecture-des-endpoints)
4. [Endpoints de consultation (lecture)](#endpoints-de-consultation)
5. [Endpoints d'action (ecriture)](#endpoints-daction)
6. [Securite & restrictions](#securite--restrictions)
7. [Integration Web (React)](#integration-web-react)
8. [Integration Mobile (React Native)](#integration-mobile-react-native)
9. [Schemas de reponse](#schemas-de-reponse)
10. [Gestion des erreurs](#gestion-des-erreurs)
11. [Flux temps reel (WebSocket)](#flux-temps-reel-websocket)

---

## Vue d'ensemble

Le panel admin SOS permet a un administrateur Qvarry de **superviser et intervenir** sur toutes les sessions SOS en cours. L'admin dispose d'un **droit absolu** sur les sessions, a l'exception de l'acces aux numeros de telephone des contacts d'urgence (masques par `"***"`).

### Capacites admin

| Categorie                | Actions                                                                           |
| ------------------------ | --------------------------------------------------------------------------------- |
| **Supervision**          | Dashboard temps reel, sessions actives, details session, historique, statistiques |
| **Intervention urgente** | Heartbeat pour un user, prolonger timer, forcer escalade, declencher SMS          |
| **Gestion session**      | Activer session pour un user, annuler, confirmer en securite                      |
| **Gestion groupe**       | Ajouter/retirer un participant                                                    |
| **Communication**        | Envoyer notification push personnalisee a un participant                          |

### Restriction unique

> Les numeros de telephone des contacts d'urgence sont **toujours masques** dans les reponses admin.
> L'admin voit : `{ name: "Marie", phone: "***", relationship: "Mere" }`.
> Les SMS sont envoyes par le systeme automatiquement ou via l'endpoint `trigger-sms` sans exposer les numeros.

---

## Authentification

Toutes les routes admin sont protegees par **deux middlewares** enchaines :

```
authMiddleware → adminMiddleware → handler
```

### Web (site admin)

Le token JWT est transmis via un **cookie HTTP-only** nomme `qvarry_jwt` (configure dans `cookieConfig.ts`).

```
Cookie: qvarry_jwt=<JWT_TOKEN>
```

Aucun header `Authorization` n'est necessaire cote web : le navigateur envoie le cookie automatiquement si `credentials: "include"` est configure dans les requetes fetch/axios.

### Mobile (app admin)

Le token JWT est transmis via le header `Authorization` :

```
Authorization: Bearer <JWT_TOKEN>
```

### Conditions d'acces

Le JWT doit contenir :

- `id` : l'ID utilisateur MongoDB
- `isAdmin: true` : requis par `adminMiddleware`

Si l'utilisateur n'est pas admin, une reponse `403 Forbidden` est retournee et la tentative est loggee dans l'audit.

---

## Architecture des endpoints

**Base URL** : `/api/v1/admin/sos`

Tous les endpoints sont montes sous ce prefixe. Exemple complet :

```
POST https://api.qvarry.com/api/v1/admin/sos/sessions/:sessionId/heartbeat
```

### Tableau complet des routes

#### Consultation (GET)

| Methode | Route                      | Description                    |
| ------- | -------------------------- | ------------------------------ |
| `GET`   | `/sos/dashboard`           | Dashboard temps reel           |
| `GET`   | `/sos/active`              | Liste des sessions actives     |
| `GET`   | `/sos/sessions/:sessionId` | Details complets d'une session |
| `GET`   | `/sos/history`             | Historique pagine              |
| `GET`   | `/sos/stats`               | Statistiques/analytics         |

#### Actions (POST)

| Methode | Route                                         | Description                           |
| ------- | --------------------------------------------- | ------------------------------------- |
| `POST`  | `/sos/sessions/:sessionId/cancel`             | Annuler/resoudre une session          |
| `POST`  | `/sos/sessions/:sessionId/heartbeat`          | Envoyer heartbeat pour un participant |
| `POST`  | `/sos/sessions/:sessionId/extend`             | Prolonger le timer                    |
| `POST`  | `/sos/sessions/:sessionId/force-escalation`   | Forcer l'escalade                     |
| `POST`  | `/sos/sessions/activate`                      | Activer une session pour un user      |
| `POST`  | `/sos/sessions/:sessionId/confirm-safe`       | Confirmer en securite                 |
| `POST`  | `/sos/sessions/:sessionId/add-participant`    | Ajouter un participant                |
| `POST`  | `/sos/sessions/:sessionId/remove-participant` | Retirer un participant                |
| `POST`  | `/sos/sessions/:sessionId/trigger-sms`        | Declencher SMS d'urgence              |
| `POST`  | `/sos/sessions/:sessionId/send-notification`  | Envoyer notification push             |

---

## Endpoints de consultation

### GET /sos/dashboard

Retourne une vue d'ensemble en temps reel de toutes les sessions SOS.

**Parametres** : aucun

**Reponse** :

```json
{
  "success": true,
  "data": {
    "activeSessions": 3,
    "escalatingSessions": 1,
    "groupSessions": 1,
    "totalParticipantsAtRisk": 2,
    "resolvedToday": 5,
    "totalSessions24h": 8,
    "sessions": [
      {
        "_id": "...",
        "status": "ESCALATING",
        "currentStage": 1,
        "activatedAt": "2026-03-02T10:00:00Z",
        "expiresAt": "2026-03-02T12:00:00Z",
        "expectedDuration": 120,
        "siteName": "Carriere de Saint-Leu",
        "note": "Exploration galerie nord",
        "user": {
          "id": "...",
          "name": "Jean",
          "surname": "Dupont"
        },
        "participantCount": 2,
        "isGroupSession": true,
        "participantsOverview": [
          {
            "userId": "...",
            "name": "Jean",
            "surname": "Dupont",
            "status": "ACTIVE",
            "currentStage": -1,
            "lastHeartbeatAt": "2026-03-02T11:45:00Z"
          },
          {
            "userId": "...",
            "name": "Marie",
            "surname": "Martin",
            "status": "DISCONNECTED",
            "currentStage": 1,
            "lastHeartbeatAt": "2026-03-02T11:20:00Z"
          }
        ],
        "timeRemaining": 900,
        "timeSinceExpired": null,
        "urgencyLevel": "high"
      }
    ]
  }
}
```

**Usage UI** : Afficher un dashboard avec compteurs en haut (cartes), liste des sessions triees par urgence en dessous. Rafraichir toutes les 30 secondes ou via WebSocket.

---

### GET /sos/active

Liste uniquement les sessions en cours (ACTIVE + EXPIRED + ESCALATING).

**Reponse** : meme format que `sessions[]` du dashboard, avec `count`.

---

### GET /sos/sessions/:sessionId

Details complets d'une session specifique.

**Reponse** :

```json
{
  "success": true,
  "data": {
    "session": {
      "_id": "...",
      "status": "ESCALATING",
      "currentStage": 1,
      "user": {
        "id": "...",
        "name": "Jean",
        "surname": "Dupont",
        "email": "jean@..."
      },
      "participantCount": 2,
      "isGroupSession": true,
      "timeRemaining": 0,
      "timeSinceExpired": 1200,
      "urgencyLevel": "high",
      "siteName": "Carriere de Saint-Leu",
      "zone": "Galerie Nord",
      "depth": 25,
      "note": "Exploration prevue 2h"
    },
    "participantsDetails": [
      {
        "userId": "...",
        "name": "Jean",
        "surname": "Dupont",
        "email": "jean@...",
        "status": "ACTIVE",
        "currentStage": -1,
        "joinedAt": "2026-03-02T10:00:00Z",
        "lastHeartbeatAt": "2026-03-02T11:45:00Z",
        "lastKnownLat": 49.2044,
        "lastKnownLng": 2.265,
        "consecutiveHeartbeats": 42,
        "contacts": [
          {
            "_id": "...",
            "name": "Sophie Dupont",
            "phone": "***",
            "relationship": "Epouse",
            "isDefault": true
          }
        ]
      }
    ],
    "events": [
      {
        "type": "STAGE_CHANGE",
        "metadata": { "stage": 1, "previousStage": 0 },
        "createdAt": "2026-03-02T11:35:00Z"
      }
    ],
    "contacts": [
      { "name": "Sophie Dupont", "phone": "***", "relationship": "Epouse" }
    ],
    "deduplicatedContacts": [],
    "contactsByParticipant": {}
  }
}
```

> **Note** : `phone` est toujours `"***"` dans toutes les reponses admin.

**Usage UI** : Page de detail avec carte GPS, timeline des events, liste des participants avec indicateurs de status, et boutons d'action.

---

### GET /sos/history

Historique pagine de toutes les sessions.

**Query params** :
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | 50 | Max 100 |
| `status` | string | - | Filtrer par status : ACTIVE, EXPIRED, ESCALATING, RESOLVED, CANCELLED |
| `userId` | string | - | Filtrer par userId (createur OU participant) |

**Reponse** :

```json
{
  "success": true,
  "sessions": [...],
  "count": 42,
  "filters": { "limit": 50, "status": null, "userId": null }
}
```

---

### GET /sos/stats

Analytics avancees avec filtrage par date.

**Query params** :
| Param | Type | Description |
|-------|------|-------------|
| `startDate` | ISO string | Date de debut (optionnel) |
| `endDate` | ISO string | Date de fin (optionnel) |

**Reponse** :

```json
{
  "success": true,
  "data": {
    "period": { "startDate": "...", "endDate": "...", "totalDays": 30 },
    "overview": {
      "totalSessions": 150,
      "activeSessions": 3,
      "escalatingSessions": 1,
      "resolvedSessions": 140,
      "groupSessions": 20,
      "soloSessions": 130
    },
    "durations": {
      "totalDuration": 12000,
      "averageDuration": 85,
      "medianDuration": 60,
      "longestSession": 480,
      "shortestSession": 15
    },
    "escalation": { "...": "..." },
    "resolution": { "...": "..." },
    "sms": { "...": "..." },
    "topSites": [],
    "patterns": { "...": "..." },
    "users": { "...": "..." },
    "heartbeats": { "...": "..." },
    "groupStats": { "...": "..." }
  }
}
```

---

## Endpoints d'action

### POST /sos/sessions/:sessionId/cancel

Annule une session. Tous les participants sont marques comme LEFT.

**Body** :

```json
{
  "reason": "Fausse alerte confirmee par telephone"
}
```

**Reponse** :

```json
{
  "success": true,
  "session": {
    "id": "...",
    "status": "RESOLVED",
    "resolvedAt": "2026-03-02T12:00:00Z",
    "resolvedBy": "ADMIN",
    "participantCount": 2,
    "isGroupSession": true,
    "participants": [{ "userId": "...", "status": "LEFT", "leftAt": "..." }]
  },
  "message": "Session annulee avec succes."
}
```

---

### POST /sos/sessions/:sessionId/heartbeat

Envoie un heartbeat a la place d'un participant (utile si telephone casse/perdu).

**Body** :

```json
{
  "userId": "64f1a2b3c4d5e6f7a8b9c0d1"
}
```

**Reponse** :

```json
{
  "success": true,
  "session": {
    "id": "...",
    "status": "ACTIVE",
    "expiresAt": "2026-03-02T12:15:00Z",
    "heartbeatCount": 43
  },
  "message": "Heartbeat admin envoye avec succes."
}
```

**Cas d'usage UI** : Bouton "Envoyer heartbeat" sur la fiche d'un participant deconnecte. Permet de gagner du temps pendant qu'on contacte la personne par un autre moyen.

---

### POST /sos/sessions/:sessionId/extend

Prolonge le timer d'une session.

**Body** :

```json
{
  "additionalMinutes": 60
}
```

| Champ               | Type   | Requis | Contrainte |
| ------------------- | ------ | ------ | ---------- |
| `additionalMinutes` | number | oui    | 15 - 480   |

**Reponse** :

```json
{
  "success": true,
  "session": {
    "id": "...",
    "status": "ACTIVE",
    "expiresAt": "2026-03-02T13:00:00Z",
    "extensionCount": 2
  },
  "message": "Session prolongee avec succes."
}
```

---

### POST /sos/sessions/:sessionId/force-escalation

Force l'escalade d'un participant vers un stage superieur sans attendre les delais automatiques.

**Body** :

```json
{
  "userId": "64f1a2b3c4d5e6f7a8b9c0d1",
  "targetStage": 2
}
```

| Champ         | Type   | Valeurs       | Description                                                                                |
| ------------- | ------ | ------------- | ------------------------------------------------------------------------------------------ |
| `targetStage` | number | `0`, `1`, `2` | Stage 0 = notif participant, Stage 1 = alerte communaute, Stage 2 = SMS contacts d'urgence |

**Reponse** :

```json
{
  "success": true,
  "session": {
    "id": "...",
    "status": "ESCALATING",
    "currentStage": 2
  },
  "message": "Escalade forcee au stage 2."
}
```

> **Attention** : Le stage 2 declenche immediatement l'envoi de SMS aux contacts d'urgence.

---

### POST /sos/sessions/activate

Active une session SOS pour un utilisateur cible. Utile quand un user signale un danger par un autre canal (appel, radio...).

**Body** :

```json
{
  "targetUserId": "64f1a2b3c4d5e6f7a8b9c0d1",
  "expectedDuration": 120,
  "note": "Signalement radio - equipe bloquee galerie sud",
  "lat": 49.2044,
  "lng": 2.265,
  "siteName": "Carriere de Saint-Leu",
  "zone": "Galerie Sud",
  "depth": 30,
  "participantIds": ["64f1a2b3c4d5e6f7a8b9c0d2"]
}
```

| Champ              | Type     | Requis | Description                                 |
| ------------------ | -------- | ------ | ------------------------------------------- |
| `targetUserId`     | string   | oui    | ID de l'utilisateur pour qui activer le SOS |
| `expectedDuration` | number   | oui    | Duree en minutes (15-480)                   |
| `note`             | string   | non    | Note explicative                            |
| `lat`, `lng`       | number   | non    | Coordonnees GPS                             |
| `siteName`         | string   | non    | Nom du site                                 |
| `zone`             | string   | non    | Zone dans le site                           |
| `depth`            | number   | non    | Profondeur estimee (metres)                 |
| `participantIds`   | string[] | non    | Autres participants a ajouter               |

> **Note** : Contrairement a l'activation mobile, cette route **ne verifie pas** que l'utilisateur a des contacts d'urgence. L'admin force l'activation.

**Reponse** : `201 Created`

```json
{
  "success": true,
  "session": {
    "id": "...",
    "status": "ACTIVE",
    "activatedAt": "2026-03-02T14:00:00Z",
    "expiresAt": "2026-03-02T16:00:00Z",
    "participants": [{ "userId": "...", "status": "ACTIVE", "joinedAt": "..." }]
  },
  "message": "Session SOS activee par admin."
}
```

---

### POST /sos/sessions/:sessionId/confirm-safe

Confirme qu'un utilisateur est en securite et resout proprement la session. Distinct de `cancel` : `resolvedBy` sera `"ADMIN_CONFIRM_SAFE"` au lieu de `"ADMIN"`.

**Body** :

```json
{
  "reason": "Contact telephonique confirme - equipe en surface"
}
```

**Reponse** :

```json
{
  "success": true,
  "session": {
    "id": "...",
    "status": "RESOLVED",
    "resolvedAt": "...",
    "resolvedBy": "ADMIN_CONFIRM_SAFE",
    "participantCount": 2
  },
  "message": "Session confirmee en securite."
}
```

---

### POST /sos/sessions/:sessionId/add-participant

Ajoute un participant a une session de groupe existante.

**Body** :

```json
{
  "targetUserId": "64f1a2b3c4d5e6f7a8b9c0d3"
}
```

**Reponse** :

```json
{
  "success": true,
  "session": {
    "id": "...",
    "participantCount": 3,
    "participants": [{ "userId": "...", "status": "ACTIVE", "joinedAt": "..." }]
  },
  "message": "Participant ajoute avec succes."
}
```

**Erreurs specifiques** :

- `409 ALREADY_PARTICIPANT` : deja dans la session
- `409 USER_HAS_ACTIVE_SESSION` : a deja une session SOS active ailleurs

---

### POST /sos/sessions/:sessionId/remove-participant

Retire un participant d'une session. Si c'est le dernier participant actif, la session est automatiquement resolue.

**Body** :

```json
{
  "targetUserId": "64f1a2b3c4d5e6f7a8b9c0d3"
}
```

---

### POST /sos/sessions/:sessionId/trigger-sms

Declenche immediatement l'envoi de SMS d'urgence a TOUS les contacts de tous les participants actifs. Utile pour forcer le stage 2 sans attendre le delai automatique.

**Body** : aucun

**Reponse** :

```json
{
  "success": true,
  "sent": 4,
  "failed": 0,
  "message": "SMS d'urgence envoyes."
}
```

> **Note** : L'admin ne voit pas les numeros. Le systeme envoie directement via Vonage.

---

### POST /sos/sessions/:sessionId/send-notification

Envoie une notification push personnalisee a un participant de la session.

**Body** :

```json
{
  "targetUserId": "64f1a2b3c4d5e6f7a8b9c0d1",
  "message": "Etes-vous en securite ? Repondez SVP."
}
```

| Champ          | Type   | Requis | Contrainte                          |
| -------------- | ------ | ------ | ----------------------------------- |
| `targetUserId` | string | oui    | Doit etre participant de la session |
| `message`      | string | oui    | Max 500 caracteres                  |

---

## Securite & restrictions

### Audit trail

**Chaque action admin** est enregistree dans le systeme d'audit avec le level `"critical"` :

```json
{
  "userId": "<adminId>",
  "action": "ADMIN_SOS_SESSION_CANCELLED",
  "level": "critical",
  "details": {
    "sessionId": "...",
    "reason": "..."
  }
}
```

Actions auditees :

- `ADMIN_SOS_SESSION_CANCELLED`
- `ADMIN_SOS_HEARTBEAT`
- `ADMIN_SOS_SESSION_EXTENDED`
- `ADMIN_SOS_FORCE_ESCALATION`
- `ADMIN_SOS_SESSION_ACTIVATED`
- `ADMIN_SOS_CONFIRMED_SAFE`
- `ADMIN_SOS_PARTICIPANT_ADDED`
- `ADMIN_SOS_PARTICIPANT_REMOVED`
- `ADMIN_SOS_SMS_TRIGGERED`
- `ADMIN_SOS_NOTIFICATION_SENT`

### Masquage des telephones

Tous les contacts d'urgence retournes dans les endpoints admin ont leur champ `phone` remplace par `"***"`. Cela concerne :

- `GET /sos/sessions/:sessionId` (dans `contacts`, `deduplicatedContacts`, `contactsByParticipant`, `participantsDetails[].contacts`)

Le masquage est applique cote **service** (pas controleur), donc il est impossible de contourner.

### Rate limiting

Les routes admin sont soumises au rate limiter global admin (`adminLimiter`) configure dans `server.ts`.

---

## Integration Web (React)

### Configuration Axios

```typescript
// src/api/adminSosApi.ts
import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL + "/api/v1/admin/sos",
  withCredentials: true, // Envoie le cookie JWT automatiquement
  headers: {
    "Content-Type": "application/json",
  },
});

export default api;
```

### Exemples d'appels

```typescript
// Dashboard
const { data } = await api.get("/dashboard");
// data.data.activeSessions, data.data.sessions, etc.

// Sessions actives
const { data } = await api.get("/active");
// data.sessions[]

// Detail session
const { data } = await api.get(`/sessions/${sessionId}`);
// data.data.session, data.data.participantsDetails, data.data.events

// Historique avec filtres
const { data } = await api.get("/history", {
  params: { limit: 50, status: "ESCALATING" },
});

// Stats sur 30 jours
const { data } = await api.get("/stats", {
  params: {
    startDate: new Date(Date.now() - 30 * 86400000).toISOString(),
    endDate: new Date().toISOString(),
  },
});

// Annuler une session
await api.post(`/sessions/${sessionId}/cancel`, {
  reason: "Fausse alerte",
});

// Heartbeat admin
await api.post(`/sessions/${sessionId}/heartbeat`, {
  userId: participantId,
});

// Prolonger
await api.post(`/sessions/${sessionId}/extend`, {
  additionalMinutes: 60,
});

// Forcer escalade
await api.post(`/sessions/${sessionId}/force-escalation`, {
  userId: participantId,
  targetStage: 2,
});

// Activer pour un user
await api.post("/sessions/activate", {
  targetUserId: userId,
  expectedDuration: 120,
  note: "Signalement radio",
  siteName: "Carriere de Saint-Leu",
});

// Confirmer en securite
await api.post(`/sessions/${sessionId}/confirm-safe`, {
  reason: "Contact telephonique confirme",
});

// Ajouter participant
await api.post(`/sessions/${sessionId}/add-participant`, {
  targetUserId: userId,
});

// Retirer participant
await api.post(`/sessions/${sessionId}/remove-participant`, {
  targetUserId: userId,
});

// Declencher SMS
await api.post(`/sessions/${sessionId}/trigger-sms`);

// Notification personnalisee
await api.post(`/sessions/${sessionId}/send-notification`, {
  targetUserId: participantId,
  message: "Etes-vous en securite ?",
});
```

### Architecture de pages suggeree

```
/admin/sos/
  ├── dashboard        → GET /sos/dashboard (rafraichissement auto 30s)
  ├── sessions/
  │   ├── active       → GET /sos/active
  │   └── :sessionId   → GET /sos/sessions/:sessionId
  │       ├── Carte GPS des participants
  │       ├── Timeline des events
  │       ├── Panel actions (heartbeat, extend, escalade, etc.)
  │       └── Liste participants avec status
  ├── history          → GET /sos/history (tableau pagine + filtres)
  └── stats            → GET /sos/stats (graphiques)
```

### Composants cles

#### DashboardSOS

- 4 cartes compteurs : Sessions actives, En escalade, Groupes, Participants a risque
- Liste des sessions triees par `urgencyLevel` (critical > high > medium > low)
- Badge de couleur par urgence : rouge (critical), orange (high), jaune (medium), vert (low)
- Auto-refresh toutes les 30 secondes

#### SessionDetail

- **En-tete** : status, timer (countdown ou temps depuis expiration), site, note
- **Carte** : positions GPS des participants (lastKnownLat/Lng)
- **Participants** : liste avec status, stage, dernier heartbeat
- **Actions** : boutons contextuels selon le status de la session
- **Timeline** : events tries chronologiquement
- **Contacts** : liste (nom + relation seulement, phone masque)

#### Boutons d'action contextuels

| Status session | Actions disponibles                                                             |
| -------------- | ------------------------------------------------------------------------------- |
| ACTIVE         | Extend, Cancel, Confirm Safe, Add Participant                                   |
| EXPIRED        | Heartbeat, Extend, Force Escalade, Cancel, Trigger SMS                          |
| ESCALATING     | Heartbeat, Force Escalade, Trigger SMS, Cancel, Confirm Safe, Send Notification |
| RESOLVED       | Aucune (lecture seule)                                                          |

---

## Integration Mobile (React Native)

### Configuration API

```typescript
// src/services/adminSosService.ts
import { getAuthToken } from "./authService";

const BASE_URL = "https://api.qvarry.com/api/v1/admin/sos";

async function adminFetch(path: string, options: RequestInit = {}) {
  const token = await getAuthToken();
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.code || "UNKNOWN_ERROR");
  }

  return response.json();
}

// Exemples
export const getSosDashboard = () => adminFetch("/dashboard");

export const getActiveSession = (sessionId: string) =>
  adminFetch(`/sessions/${sessionId}`);

export const adminHeartbeat = (sessionId: string, userId: string) =>
  adminFetch(`/sessions/${sessionId}/heartbeat`, {
    method: "POST",
    body: JSON.stringify({ userId }),
  });

export const adminExtend = (sessionId: string, minutes: number) =>
  adminFetch(`/sessions/${sessionId}/extend`, {
    method: "POST",
    body: JSON.stringify({ additionalMinutes: minutes }),
  });

export const adminForceEscalation = (
  sessionId: string,
  userId: string,
  stage: number,
) =>
  adminFetch(`/sessions/${sessionId}/force-escalation`, {
    method: "POST",
    body: JSON.stringify({ userId, targetStage: stage }),
  });

export const adminActivateSession = (params: {
  targetUserId: string;
  expectedDuration: number;
  note?: string;
  lat?: number;
  lng?: number;
  siteName?: string;
  participantIds?: string[];
}) =>
  adminFetch("/sessions/activate", {
    method: "POST",
    body: JSON.stringify(params),
  });

export const adminTriggerSms = (sessionId: string) =>
  adminFetch(`/sessions/${sessionId}/trigger-sms`, { method: "POST" });

export const adminSendNotification = (
  sessionId: string,
  userId: string,
  message: string,
) =>
  adminFetch(`/sessions/${sessionId}/send-notification`, {
    method: "POST",
    body: JSON.stringify({ targetUserId: userId, message }),
  });
```

### Navigation suggeree (React Native)

```
AdminSOS (Tab Navigator)
  ├── DashboardScreen        → Dashboard temps reel
  ├── ActiveSessionsScreen   → Liste sessions actives
  ├── HistoryScreen          → Historique + recherche
  └── StatsScreen            → Graphiques analytics

SessionDetailScreen (Stack)
  ├── MapView (participants GPS)
  ├── ParticipantsList
  ├── EventTimeline
  └── ActionButtons
```

### Considerations mobile

1. **Pull-to-refresh** : Implementer sur le dashboard et la liste des sessions actives
2. **Notifications push admin** : Quand une session passe en ESCALATING, l'admin recoit une push pour reagir rapidement
3. **Offline** : Cacher le dernier etat du dashboard localement, afficher un indicateur "Derniere MAJ il y a X min"
4. **Haptic feedback** : Vibration lors des actions critiques (force escalade, trigger SMS)

---

## Schemas de reponse

### Status de session

| Status       | Description                                    |
| ------------ | ---------------------------------------------- |
| `ACTIVE`     | Session en cours, timer actif                  |
| `EXPIRED`    | Timer expire, en attente d'escalade            |
| `ESCALATING` | Au moins un participant en escalade            |
| `RESOLVED`   | Session terminee (par user, admin, ou systeme) |
| `CANCELLED`  | Session annulee                                |

### Status de participant

| Status         | Description                            |
| -------------- | -------------------------------------- |
| `ACTIVE`       | Participant connecte, heartbeats recus |
| `DISCONNECTED` | Plus de heartbeat, stage 0 declenche   |
| `ESCALATING`   | En escalade (stage 1+)                 |
| `LEFT`         | A quitte la session                    |

### Stages d'escalade

| Stage | Delai auto       | Action                                               |
| ----- | ---------------- | ---------------------------------------------------- |
| `-1`  | -                | Normal, pas d'escalade                               |
| `0`   | T+0 (expiration) | Push notification + alarme locale au participant     |
| `1`   | T+15min          | Notification a TOUS les utilisateurs Qvarry verifies |
| `2`   | T+30min          | SMS aux contacts d'urgence via Vonage                |

### Niveaux d'urgence (calcule automatiquement)

| Level      | Condition                                    |
| ---------- | -------------------------------------------- |
| `low`      | Tous les participants actifs, pas d'escalade |
| `medium`   | Stage 0 ou participant deconnecte            |
| `high`     | Stage 1 atteint                              |
| `critical` | Stage 2 atteint                              |

### resolvedBy

| Valeur               | Signification                                      |
| -------------------- | -------------------------------------------------- |
| `USER`               | Desactive par l'utilisateur                        |
| `ADMIN`              | Annule par un admin (`cancel`)                     |
| `ADMIN_CONFIRM_SAFE` | Confirme en securite par un admin (`confirm-safe`) |
| `CONTACT_CONFIRM`    | Confirme par un contact d'urgence                  |
| `SYSTEM`             | Resolu automatiquement                             |

---

## Gestion des erreurs

### Format standard

```json
{
  "error": "Message lisible en francais",
  "code": "ERROR_CODE"
}
```

### Codes d'erreur par endpoint

| Code                         | HTTP | Description                               |
| ---------------------------- | ---- | ----------------------------------------- |
| `UNAUTHORIZED`               | 401  | Token manquant ou invalide                |
| `FORBIDDEN`                  | 403  | Pas admin                                 |
| `SESSION_NOT_FOUND`          | 404  | Session inexistante ou deja terminee      |
| `PARTICIPANT_NOT_FOUND`      | 404  | Participant pas dans la session           |
| `USER_NOT_FOUND`             | 404  | Utilisateur cible inexistant              |
| `SESSION_ALREADY_ACTIVE`     | 409  | L'utilisateur a deja une session active   |
| `ALREADY_PARTICIPANT`        | 409  | Deja participant de la session            |
| `USER_HAS_ACTIVE_SESSION`    | 409  | L'utilisateur a deja une session ailleurs |
| `STAGE_ALREADY_REACHED`      | 409  | Stage deja atteint ou depasse             |
| `PARTICIPANT_ALREADY_LEFT`   | 409  | Participant deja sorti                    |
| `INVALID_DURATION`           | 400  | Duree hors bornes (15-480 min)            |
| `INVALID_EXTENSION_DURATION` | 400  | Extension hors bornes                     |
| `INVALID_STAGE`              | 400  | Stage invalide (doit etre 0, 1 ou 2)      |
| `NO_CONTACTS_FOUND`          | 400  | Aucun contact d'urgence pour le SMS       |
| `MISSING_FIELDS`             | 400  | Champs requis manquants                   |
| `INTERNAL_ERROR`             | 500  | Erreur serveur                            |

### Gestion cote client

```typescript
try {
  await adminTriggerSms(sessionId);
} catch (error) {
  switch (error.code) {
    case "SESSION_NOT_FOUND":
      toast.error("Session introuvable ou deja terminee");
      break;
    case "NO_CONTACTS_FOUND":
      toast.warning("Aucun contact d'urgence configure pour les participants");
      break;
    default:
      toast.error("Erreur inattendue");
  }
}
```

---

## Flux temps reel (WebSocket)

### Events WebSocket SOS (recus par l'admin)

Le systeme envoie des notifications WebSocket aux participants lors des actions admin. Pour un panel admin temps reel, il est recommande de :

1. **Ecouter les events SOS** via le WebSocket existant
2. **Rafraichir le dashboard** automatiquement quand un event SOS est recu

### Types d'events WebSocket pertinents

| Type                          | Declencheur                             |
| ----------------------------- | --------------------------------------- |
| `sos_session_cancelled_admin` | Session annulee par admin               |
| `sos_confirmed_safe_admin`    | Session confirmee en securite par admin |
| `sos_alarm` (stage 0/1/2)     | Escalade automatique ou forcee          |
| `sos_alert_stage1`            | Alerte communaute (stage 1)             |
| `sos_participant_added`       | Participant ajoute par admin            |
| `sos_participant_removed`     | Participant retire par admin            |
| `sos_admin_notification`      | Notification custom envoyee par admin   |

### Strategie de rafraichissement recommandee

```
WebSocket event SOS recu → Rafraichir le dashboard/session detail
Fallback si WS deconnecte → Polling toutes les 30 secondes
```
