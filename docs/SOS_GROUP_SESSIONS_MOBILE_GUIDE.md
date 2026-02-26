# SOS Group Sessions — Guide d'integration mobile

> Document a destination du developpeur mobile (React Native).
> Decrit toutes les modifications API pour supporter les **sessions SOS de groupe**.

---

## Table des matieres

1. [Resume des changements](#1-resume-des-changements)
2. [Concepts cles](#2-concepts-cles)
3. [Endpoints modifies](#3-endpoints-modifies)
4. [Nouveaux evenements WebSocket](#4-nouveaux-evenements-websocket)
5. [Flows UX complets](#5-flows-ux-complets)
6. [Types TypeScript pour le mobile](#6-types-typescript-pour-le-mobile)
7. [Gestion des erreurs](#7-gestion-des-erreurs)
8. [Migration / Retrocompatibilite](#8-migration--retrocompatibilite)
9. [Checklist d'implementation](#9-checklist-dimplementation)

---

## 1. Resume des changements

### Avant (session solo)

- 1 utilisateur = 1 session SOS
- Escalade sur toute la session quand le timer expire
- Desactivation = fin de la session

### Apres (session de groupe)

- 1 utilisateur **cree** la session et peut y **ajouter d'autres utilisateurs Qvarry**
- Chaque participant envoie ses propres heartbeats independamment
- L'escalade est **par participant** (seuls les deconnectes declenchent l'escalade)
- La desactivation a 2 scopes : `"self"` (quitter seul) ou `"all"` (fin pour tout le monde)
- Les sessions solo fonctionnent exactement comme avant (1 participant = le createur)

### Regles metier

| Regle                     | Detail                                                                |
| ------------------------- | --------------------------------------------------------------------- |
| Ajout de participants     | A la creation uniquement, par userId. Pas d'acceptation requise.      |
| Modification du groupe    | Impossible. Supprimer et recreer.                                     |
| Limite de participants    | Aucune                                                                |
| Session simultanee        | Un utilisateur ne peut PAS etre dans 2 sessions actives en meme temps |
| Contacts SMS (stage 2)    | Agreges depuis TOUS les participants, dedupliques par telephone       |
| Qui peut prolonger        | N'importe quel participant                                            |
| Qui peut desactiver "all" | N'importe quel participant                                            |

---

## 2. Concepts cles

### Statuts de participant

```
ACTIVE         → Participant actif, heartbeat OK
DISCONNECTED   → Heartbeat expire, stage 0 declenche (push notification)
ESCALATING     → Stage 1+ declenche (tous les utilisateurs Qvarry notifies)
LEFT           → A quitte la session (scope "self") ou session terminee
```

### Stages d'escalade (par participant)

```
Stage -1  → Normal, heartbeat OK
Stage 0   → Heartbeat expire → push notification AU participant deconnecte uniquement
Stage 1   → +15 min sans reponse → notification a TOUS les utilisateurs Qvarry
Stage 2   → +30 min sans reponse → SMS aux contacts d'urgence de TOUS les participants
```

### Scope de desactivation

```
scope: "all"  → (defaut) Resout la session pour TOUT LE MONDE. Tous les participants → LEFT.
scope: "self" → L'appelant quitte la session. La session continue pour les autres.
                Si c'etait le dernier participant → session auto-resolue.
```

---

## 3. Endpoints modifies

### 3.1. POST `/api/mobile/sos/activate`

#### Request body (nouveau champ `participantIds`)

```json
{
  "expectedDuration": 120,
  "note": "Galerie nord",
  "siteName": "Carriere de Pont-Rean",
  "zone": "Galerie Nord",
  "depth": 150,
  "lat": 48.8566,
  "lng": 2.3522,
  "accuracy": 10,
  "participantIds": ["64f1a2b3c4d5e6f7a8b9c0d1", "64f1a2b3c4d5e6f7a8b9c0d2"],
  "sessionContacts": {
    "permanentContactIds": ["id1", "id2"],
    "additionalContacts": [
      {
        "name": "Jean Dupont",
        "phone": "+33612345678",
        "relationship": "Collegue"
      }
    ]
  }
}
```

> `participantIds` est **optionnel**. S'il est absent ou vide → session solo classique.
> Les IDs doivent etre des ObjectId MongoDB valides d'utilisateurs existants.
> Le createur est automatiquement ajoute comme premier participant (ne PAS l'inclure dans `participantIds`).

#### Response 201 (nouveau champ `participants`)

```json
{
  "success": true,
  "session": {
    "id": "64f...",
    "status": "ACTIVE",
    "activatedAt": "2026-02-25T10:00:00.000Z",
    "expiresAt": "2026-02-25T12:00:00.000Z",
    "expectedDuration": 120,
    "currentStage": -1,
    "participants": [
      {
        "userId": "64f...abc",
        "status": "ACTIVE",
        "joinedAt": "2026-02-25T10:00:00.000Z"
      },
      {
        "userId": "64f...def",
        "status": "ACTIVE",
        "joinedAt": "2026-02-25T10:00:00.000Z"
      },
      {
        "userId": "64f...ghi",
        "status": "ACTIVE",
        "joinedAt": "2026-02-25T10:00:00.000Z"
      }
    ]
  }
}
```

#### Nouveaux codes d'erreur

| Code                      | HTTP | Quand                                                        |
| ------------------------- | ---- | ------------------------------------------------------------ |
| `INVALID_PARTICIPANT_IDS` | 400  | Un ou plusieurs IDs de participants n'existent pas en base   |
| `SESSION_ALREADY_ACTIVE`  | 409  | Le createur OU un des participants a deja une session active |

---

### 3.2. POST `/api/mobile/sos/heartbeat` (inchange)

Le heartbeat fonctionne comme avant. Le serveur identifie automatiquement le participant via le userId du token JWT.

```json
// Request
{ "lat": 48.8566, "lng": 2.3522, "accuracy": 10 }

// Response 200
{
  "success": true,
  "session": {
    "id": "64f...",
    "status": "ACTIVE",
    "expiresAt": "2026-02-25T12:15:00.000Z",
    "heartbeatCount": 5,
    "currentStage": -1
  }
}
```

> **Comportement groupe** : le heartbeat met a jour uniquement le participant appelant.
> Le `expiresAt` de la session est recalcule a partir du heartbeat le plus recent de tous les participants actifs.
> Si le participant etait en `DISCONNECTED` ou `ESCALATING`, il repasse en `ACTIVE` automatiquement.

---

### 3.3. POST `/api/mobile/sos/extend` (inchange)

N'importe quel participant peut prolonger pour l'ensemble de la session.

```json
// Request
{ "additionalMinutes": 60 }

// Response 200
{
  "success": true,
  "session": {
    "id": "64f...",
    "status": "ACTIVE",
    "expiresAt": "2026-02-25T13:00:00.000Z",
    "extensionCount": 1,
    "currentStage": -1
  }
}
```

> Si la session etait en `ESCALATING`, l'extension remet TOUS les participants escalading en `ACTIVE`.

---

### 3.4. POST `/api/mobile/sos/deactivate`

#### Request body (nouveau champ `scope`)

```json
{
  "sessionId": "64f...",
  "scope": "self"
}
```

| Champ       | Type                | Defaut   | Description                                              |
| ----------- | ------------------- | -------- | -------------------------------------------------------- |
| `sessionId` | string              | _(auto)_ | Optionnel. Si absent, prend la session active.           |
| `scope`     | `"self"` \| `"all"` | `"all"`  | `"self"` = quitter seul. `"all"` = desactiver pour tous. |

#### Response 200 — scope "all" (session resolue)

```json
{
  "success": true,
  "session": {
    "id": "64f...",
    "status": "RESOLVED",
    "resolvedAt": "2026-02-25T11:30:00.000Z",
    "resolvedBy": "USER"
  }
}
```

#### Response 200 — scope "self" (session continue pour les autres)

```json
{
  "success": true,
  "session": {
    "id": "64f...",
    "status": "ACTIVE",
    "resolvedAt": null,
    "resolvedBy": null,
    "participants": [
      {
        "userId": "64f...abc",
        "status": "LEFT",
        "joinedAt": "...",
        "leftAt": "..."
      },
      {
        "userId": "64f...def",
        "status": "ACTIVE",
        "joinedAt": "...",
        "leftAt": null
      },
      {
        "userId": "64f...ghi",
        "status": "ACTIVE",
        "joinedAt": "...",
        "leftAt": null
      }
    ]
  }
}
```

> Le champ `participants` est retourne UNIQUEMENT quand `scope === "self"` ET la session est toujours `ACTIVE`.
> Si c'etait le dernier participant, la session passe en `RESOLVED` (meme reponse que scope "all").

---

### 3.5. POST `/api/mobile/sos/:sessionId/deactivate`

Meme logique que 3.4, mais avec `sessionId` dans l'URL.

```json
// Request body
{ "scope": "self" }
```

---

### 3.6. GET `/api/mobile/sos/status`

#### Response 200 (nouveaux champs)

```json
{
  "success": true,
  "active": true,
  "session": {
    "id": "64f...",
    "status": "ACTIVE",
    "activatedAt": "2026-02-25T10:00:00.000Z",
    "expiresAt": "2026-02-25T12:15:00.000Z",
    "expectedDuration": 120,
    "currentStage": -1,
    "heartbeatCount": 5,
    "extensionCount": 0,
    "lastHeartbeatAt": "2026-02-25T10:45:00.000Z",
    "note": "Galerie nord",
    "siteName": "Carriere de Pont-Rean",
    "zone": "Galerie Nord",
    "depth": 150,
    "creatorId": "64f...abc",
    "isGroupSession": true,
    "participants": [
      {
        "userId": "64f...abc",
        "status": "ACTIVE",
        "joinedAt": "2026-02-25T10:00:00.000Z",
        "leftAt": null,
        "currentStage": -1,
        "lastHeartbeatAt": "2026-02-25T10:45:00.000Z"
      },
      {
        "userId": "64f...def",
        "status": "DISCONNECTED",
        "joinedAt": "2026-02-25T10:00:00.000Z",
        "leftAt": null,
        "currentStage": 0,
        "lastHeartbeatAt": "2026-02-25T10:20:00.000Z"
      },
      {
        "userId": "64f...ghi",
        "status": "ACTIVE",
        "joinedAt": "2026-02-25T10:00:00.000Z",
        "leftAt": null,
        "currentStage": -1,
        "lastHeartbeatAt": "2026-02-25T10:44:00.000Z"
      }
    ]
  }
}
```

| Nouveau champ                    | Type         | Description                                                |
| -------------------------------- | ------------ | ---------------------------------------------------------- |
| `creatorId`                      | string       | ObjectId du createur de la session                         |
| `isGroupSession`                 | boolean      | `true` si > 1 participant                                  |
| `participants`                   | array        | Liste de tous les participants avec leur statut individuel |
| `participants[].currentStage`    | number       | Stage d'escalade individuel (-1, 0, 1, 2)                  |
| `participants[].lastHeartbeatAt` | string\|null | Dernier heartbeat de CE participant                        |

---

### 3.7. GET `/api/mobile/sos/history` (inchange dans la structure)

La query inclut desormais les sessions ou l'utilisateur est **createur OU participant**. Pas de changement de structure de reponse.

---

### 3.8. GET `/api/mobile/sos/active` (inchange dans la structure)

Retourne les sessions en escalade (stage 1+) des AUTRES utilisateurs. Exclut les sessions ou l'utilisateur courant est participant.

---

### 3.9. POST `/api/mobile/sos/:sessionId/confirm-safe` (inchange)

Confirme que tous les participants sont en securite. Resout toute la session, tous les participants → `LEFT`.

---

## 4. Nouveaux evenements WebSocket

### 4.1. Evenements recus par les PARTICIPANTS AJOUTES

#### `sos_participant_added`

Recu par chaque participant ajoute lors de la creation de la session.

```json
{
  "type": "sos_participant_added",
  "sessionId": "64f...",
  "creatorName": "Matheo",
  "creatorId": "64f...abc",
  "message": "Tu as ete ajoute a une session SOS par Matheo"
}
```

> **Action UI** : Afficher une alerte/modale informant l'utilisateur qu'il fait partie d'une session SOS de groupe. Proposer d'ouvrir l'ecran SOS.

---

#### `sos_participant_left`

Recu par les participants RESTANTS quand un participant quitte (scope "self").

```json
{
  "type": "sos_participant_left",
  "sessionId": "64f...",
  "userName": "Lucas",
  "userId": "64f...def",
  "message": "Lucas a quitte la session SOS"
}
```

> **Action UI** : Mettre a jour la liste des participants. Afficher un toast/snackbar.

---

#### `sos_session_deactivated_all`

Recu par tous les autres participants quand quelqu'un desactive pour tous (scope "all").

```json
{
  "type": "sos_session_deactivated_all",
  "sessionId": "64f...",
  "userName": "Matheo",
  "userId": "64f...abc",
  "message": "La session SOS a ete desactivee par Matheo"
}
```

> **Action UI** : Fermer l'ecran SOS. Afficher une confirmation que la session est terminee.

---

#### `sos_session_cancelled_admin`

Recu par tous les participants quand un admin annule la session.

```json
{
  "type": "sos_session_cancelled_admin",
  "sessionId": "64f...",
  "message": "Votre session SOS a ete annulee par un administrateur.",
  "reason": "Fausse alerte confirmee"
}
```

> **Action UI** : Fermer l'ecran SOS. Afficher un message d'information.

---

### 4.2. Evenements d'alarme (existants, inchanges mais par participant)

#### `sos_alarm` (stages 0, 1, 2)

Envoye uniquement au participant dont le heartbeat a expire.

```json
{
  "type": "sos_alarm",
  "stage": 0,
  "sessionId": "64f...",
  "message": "Timer SOS expire -- Donnez un signe de vie !"
}
```

```json
{
  "type": "sos_alarm",
  "stage": 1,
  "sessionId": "64f...",
  "message": "Escalade Stage 1 -- D'autres utilisateurs sont notifies !"
}
```

```json
{
  "type": "sos_alarm",
  "stage": 2,
  "sessionId": "64f...",
  "message": "Escalade Stage 2 -- SMS envoyes aux contacts d'urgence !"
}
```

---

#### `sos_alert_stage1` (notification aux autres utilisateurs Qvarry)

Envoye a TOUS les utilisateurs verifies Qvarry (SAUF les participants de la session).

```json
{
  "type": "sos_alert_stage1",
  "stage": 1,
  "sessionId": "64f...",
  "userName": "Lucas",
  "participantId": "64f...def",
  "message": "Lucas a besoin d'aide ! Consultez la carte SOS."
}
```

> **Nouveau champ** : `participantId` identifie le participant specifique en danger (pas le createur de la session).

---

### 4.3. Evenements de detection (existants, par participant)

#### `sos_surface_detected`

```json
{
  "type": "sos_surface_detected",
  "sessionId": "64f...",
  "message": "Tu sembles t'etre deplace significativement. Es-tu en surface ?",
  "distance": 350
}
```

#### `sos_reconnection_detected`

```json
{
  "type": "sos_reconnection_detected",
  "sessionId": "64f...",
  "message": "Tu sembles avoir une connexion stable depuis plus de 5 minutes. Desactiver le Mode SOS ?",
  "connectedSince": "2026-02-25T10:40:00.000Z",
  "heartbeatCount": 6
}
```

---

## 5. Flows UX complets

### 5.1. Creation d'une session de groupe

```
┌─────────────────────────────────────────────────────────┐
│ Ecran "Activer le SOS"                                  │
│                                                         │
│  [Duree: 2h            ]                                │
│  [Site: Carriere X     ]                                │
│  [Note: Galerie nord   ]                                │
│                                                         │
│  ┌─────────────────────────────────────┐                │
│  │ Participants (optionnel)            │                │
│  │                                     │                │
│  │  [Rechercher un utilisateur...]     │                │
│  │                                     │                │
│  │  ✓ Lucas M.        [x supprimer]   │                │
│  │  ✓ Antoine R.      [x supprimer]   │                │
│  │                                     │                │
│  └─────────────────────────────────────┘                │
│                                                         │
│  [ ACTIVER LE SOS ]                                     │
└─────────────────────────────────────────────────────────┘

→ POST /api/mobile/sos/activate
  { expectedDuration: 120, participantIds: ["id1", "id2"], ... }

→ Lucas et Antoine recoivent :
  - Push notification "Tu as ete ajoute a une session SOS"
  - WebSocket "sos_participant_added"
```

### 5.2. Ecran SOS actif (session de groupe)

```
┌─────────────────────────────────────────────────────────┐
│ SESSION SOS ACTIVE                          [Groupe]    │
│                                                         │
│  Timer: 01:42:30 restant                                │
│  Site: Carriere X — Galerie Nord                        │
│                                                         │
│  ┌── Participants ──────────────────────┐               │
│  │ ● Moi (Matheo)       ACTIVE    ✓    │               │
│  │ ● Lucas M.           ACTIVE    ✓    │               │
│  │ ○ Antoine R.         DECONNECTE ⚠   │               │
│  └──────────────────────────────────────┘               │
│                                                         │
│  [ HEARTBEAT ]    [ PROLONGER ]                         │
│                                                         │
│  [ Quitter la session (moi seul) ]                      │
│  [ Desactiver pour tous          ]                      │
└─────────────────────────────────────────────────────────┘
```

> Utiliser `GET /api/mobile/sos/status` pour afficher le statut de chaque participant.
> Les statuts des participants se mettent a jour via le polling status ou via les WebSocket events.

### 5.3. Flow de desactivation (groupe)

```
Utilisateur appuie "Quitter la session" :

  ┌────────────────────────────────────────┐
  │ Que voulez-vous faire ?                │
  │                                        │
  │ [ Quitter (moi seul) ]                 │
  │   → scope: "self"                      │
  │   → Je quitte, les autres continuent   │
  │                                        │
  │ [ Desactiver pour tous ]               │
  │   → scope: "all"                       │
  │   → Session terminee pour tout le      │
  │     monde                              │
  │                                        │
  │ [ Annuler ]                            │
  └────────────────────────────────────────┘
```

> Pour une session **solo** (`isGroupSession === false`), pas besoin de cette modale. Un seul bouton "Desactiver" suffit (scope "all" par defaut).

### 5.4. Flow quand on est ajoute a une session

```
WebSocket: sos_participant_added

  ┌────────────────────────────────────────┐
  │ 🆘 Session SOS de groupe              │
  │                                        │
  │ Matheo t'a ajoute a une session SOS.   │
  │                                        │
  │ Pense a envoyer des heartbeats         │
  │ reguliers pendant que tu es sous       │
  │ terre !                                │
  │                                        │
  │ [ Voir la session ]   [ OK ]           │
  └────────────────────────────────────────┘

→ "Voir la session" → Ouvrir l'ecran SOS actif (GET /status)
```

### 5.5. Flow d'escalade (ce qui change cote UI)

L'escalade est maintenant **par participant**. Ce qui veut dire :

```
Scenario : Session de groupe [Matheo, Lucas, Antoine]

1. Antoine perd le reseau
   → Son heartbeat expire individuellement
   → Antoine recoit push "Timer expire" (stage 0)
   → Matheo et Lucas : rien ne change, session toujours ACTIVE

2. +15 min, Antoine ne repond pas
   → Stage 1 pour Antoine uniquement
   → TOUS les utilisateurs Qvarry (sauf Matheo, Lucas, Antoine) recoivent
     "Antoine a besoin d'aide !"
   → Matheo et Lucas voient Antoine en "ESCALATING" dans le statut

3. +30 min, Antoine ne repond pas
   → Stage 2 pour Antoine
   → SMS envoyes aux contacts d'urgence de TOUS (Matheo + Lucas + Antoine)
   → Deduplication par telephone

4. Antoine envoie un heartbeat
   → Antoine repasse en ACTIVE automatiquement
   → Son stage revient a -1
```

---

## 6. Types TypeScript pour le mobile

```typescript
// ═══════════════════════════════════════════════════
// TYPES SOS — A utiliser dans l'app mobile
// ═══════════════════════════════════════════════════

type SosSessionStatus = "ACTIVE" | "ESCALATING" | "RESOLVED";

type SosParticipantStatus = "ACTIVE" | "DISCONNECTED" | "ESCALATING" | "LEFT";

type SosResolvedBy = "USER" | "HEARTBEAT_AUTO" | "ADMIN" | "CONTACT_CONFIRM";

type SosDeactivateScope = "self" | "all";

// ─── Participant ───

interface SosParticipant {
  userId: string;
  status: SosParticipantStatus;
  joinedAt: string; // ISO date
  leftAt: string | null; // ISO date, null si toujours actif
  currentStage: number; // -1, 0, 1, 2
  lastHeartbeatAt: string | null;
}

// ─── Session (reponse /status) ───

interface SosSessionStatus {
  id: string;
  status: SosSessionStatus;
  activatedAt: string;
  expiresAt: string;
  expectedDuration: number;
  currentStage: number;
  heartbeatCount: number;
  extensionCount: number;
  lastHeartbeatAt: string | null;
  note: string | null;
  siteName: string | null;
  zone: string | null;
  depth: number | null;
  creatorId: string; // NOUVEAU
  isGroupSession: boolean; // NOUVEAU
  participants: SosParticipant[]; // NOUVEAU
}

// ─── Request: Activer ───

interface ActivateSosRequest {
  expectedDuration: number; // 15-480 minutes
  note?: string;
  siteName?: string;
  zone?: string;
  depth?: number;
  lat?: number;
  lng?: number;
  accuracy?: number;
  participantIds?: string[]; // NOUVEAU — IDs des participants (optionnel)
  sessionContacts?: {
    permanentContactIds?: string[];
    additionalContacts?: Array<{
      name: string;
      phone: string;
      relationship?: string;
    }>;
  };
}

// ─── Request: Desactiver ───

interface DeactivateSosRequest {
  sessionId?: string;
  scope?: SosDeactivateScope; // NOUVEAU — "self" | "all" (defaut: "all")
}

// ─── WebSocket Events ───

interface WsSosParticipantAdded {
  type: "sos_participant_added";
  sessionId: string;
  creatorName: string;
  creatorId: string;
  message: string;
}

interface WsSosParticipantLeft {
  type: "sos_participant_left";
  sessionId: string;
  userName: string;
  userId: string;
  message: string;
}

interface WsSosDeactivatedAll {
  type: "sos_session_deactivated_all";
  sessionId: string;
  userName: string;
  userId: string;
  message: string;
}

interface WsSosCancelledAdmin {
  type: "sos_session_cancelled_admin";
  sessionId: string;
  message: string;
  reason?: string;
}

interface WsSosAlarm {
  type: "sos_alarm";
  stage: 0 | 1 | 2;
  sessionId: string;
  message: string;
}

interface WsSosAlertStage1 {
  type: "sos_alert_stage1";
  stage: 1;
  sessionId: string;
  userName: string;
  participantId: string; // NOUVEAU — ID du participant en danger
  message: string;
}

interface WsSosSurfaceDetected {
  type: "sos_surface_detected";
  sessionId: string;
  message: string;
  distance: number;
}

interface WsSosReconnectionDetected {
  type: "sos_reconnection_detected";
  sessionId: string;
  message: string;
  connectedSince: string;
  heartbeatCount: number;
}
```

---

## 7. Gestion des erreurs

### Nouveaux codes d'erreur

| Code                      | HTTP | Endpoint    | Description                                                  |
| ------------------------- | ---- | ----------- | ------------------------------------------------------------ |
| `INVALID_PARTICIPANT_IDS` | 400  | `/activate` | Un ou plusieurs IDs de participants n'existent pas           |
| `SESSION_ALREADY_ACTIVE`  | 409  | `/activate` | Le createur OU un des participants a deja une session active |

### Codes d'erreur existants (inchanges)

| Code                    | HTTP | Endpoint                               |
| ----------------------- | ---- | -------------------------------------- |
| `MISSING_DURATION`      | 400  | `/activate`                            |
| `INVALID_DURATION`      | 400  | `/activate`                            |
| `NO_EMERGENCY_CONTACTS` | 400  | `/activate`                            |
| `INVALID_CONTACT_IDS`   | 400  | `/activate`                            |
| `INVALID_PHONE_FORMAT`  | 400  | `/activate`                            |
| `NO_ACTIVE_SESSION`     | 404  | `/heartbeat`, `/extend`, `/deactivate` |
| `UNAUTHORIZED`          | 401  | Tous                                   |

### Point d'attention : `SESSION_ALREADY_ACTIVE`

Ce code est retourne si **n'importe quel** participant (y compris ceux dans `participantIds`) a deja une session active. L'app doit gerer ce cas en indiquant a l'utilisateur quel participant pose probleme. L'API ne precise pas QUEL participant bloque — il faudra faire un appel prealable si besoin.

> **Suggestion UX** : Avant d'activer, verifier cote app si les participants selectionnes ont deja une session active (via un endpoint dedie ou une logique locale).

---

## 8. Migration / Retrocompatibilite

### Ce qui ne change PAS

- Les sessions **solo** fonctionnent exactement comme avant
- Si `participantIds` est absent/vide → session solo avec `participants: [{ userId: createur }]`
- Les endpoints heartbeat, extend, confirm-safe ont le meme body
- Les contacts d'urgence sont inchanges

### Ce qui change (breaking changes mineurs)

| Changement                                                           | Impact                                                                                                           |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `GET /status` retourne `participants`, `isGroupSession`, `creatorId` | Nouveaux champs, l'ancien format est un sous-ensemble. **Non-breaking** si le parser ignore les champs inconnus. |
| `POST /activate` retourne `participants` dans la reponse             | Idem, nouveau champ.                                                                                             |
| `POST /deactivate` accepte `scope` dans le body                      | Optionnel avec defaut `"all"`. **Non-breaking**.                                                                 |
| `POST /deactivate` avec scope "self" retourne `participants`         | Nouveau champ conditionnel.                                                                                      |

### Strategie de migration recommandee

1. **Phase 1** : Mettre a jour le parsing des reponses pour supporter les nouveaux champs (`participants`, `isGroupSession`, `creatorId`) — ca ne casse rien
2. **Phase 2** : Ajouter le listener WebSocket pour les nouveaux events (`sos_participant_added`, `sos_participant_left`, `sos_session_deactivated_all`, `sos_session_cancelled_admin`)
3. **Phase 3** : Ajouter l'UI de selection des participants dans l'ecran d'activation
4. **Phase 4** : Ajouter le scope "self"/"all" dans l'ecran de desactivation
5. **Phase 5** : Afficher les participants et leur statut individuel dans l'ecran SOS actif

---

## 9. Checklist d'implementation

### Ecran d'activation SOS

- [ ] Ajouter un selecteur de participants (recherche utilisateurs Qvarry)
- [ ] Envoyer `participantIds` dans le body de `/activate`
- [ ] Gerer l'erreur `INVALID_PARTICIPANT_IDS`
- [ ] Gerer l'erreur `SESSION_ALREADY_ACTIVE` (peut venir d'un participant)
- [ ] Stocker `participants` et `isGroupSession` dans le state local

### Ecran SOS actif

- [ ] Afficher le badge "Groupe" si `isGroupSession === true`
- [ ] Afficher la liste des participants avec leur statut individuel
- [ ] Code couleur par statut : `ACTIVE` = vert, `DISCONNECTED` = orange, `ESCALATING` = rouge, `LEFT` = gris
- [ ] Afficher le `currentStage` de chaque participant
- [ ] Distinguer le createur (`creatorId`) visuellement
- [ ] Rafraichir les statuts participants via polling `/status` ou WebSocket

### Desactivation

- [ ] Si `isGroupSession` : afficher la modale "Quitter seul" / "Desactiver pour tous"
- [ ] Si session solo : desactiver directement (scope "all")
- [ ] Envoyer `scope` dans le body de `/deactivate`
- [ ] Gerer la reponse avec `participants` quand scope = "self"

### WebSocket handlers

- [ ] `sos_participant_added` → Afficher alerte + ouvrir ecran SOS
- [ ] `sos_participant_left` → Mettre a jour liste participants + toast
- [ ] `sos_session_deactivated_all` → Fermer ecran SOS + confirmation
- [ ] `sos_session_cancelled_admin` → Fermer ecran SOS + message info
- [ ] `sos_alert_stage1` → Nouveau champ `participantId` (identifier qui est en danger)

### Push notifications

- [ ] `sos_alert` / "Tu as ete ajoute a une session SOS" → Ouvrir l'ecran SOS
- [ ] Les push existantes fonctionnent comme avant

### Tests a effectuer

- [ ] Creer une session solo → Verifier que tout fonctionne comme avant
- [ ] Creer une session de groupe avec 2-3 participants
- [ ] Verifier que chaque participant peut envoyer des heartbeats independamment
- [ ] Verifier qu'un participant peut quitter seul (scope "self")
- [ ] Verifier que la session se termine quand le dernier participant quitte
- [ ] Verifier que scope "all" termine la session pour tout le monde
- [ ] Verifier les notifications WebSocket recues par chaque participant
- [ ] Verifier qu'on ne peut pas creer une session si un participant est deja dans une session active
- [ ] Verifier le comportement d'escalade per-participant (laisser un participant sans heartbeat)
