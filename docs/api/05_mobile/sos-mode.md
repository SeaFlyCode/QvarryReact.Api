# Mode SOS Mobile — /api/v1/mobile/sos

## Table des matières

- [Vue d'ensemble](#vue-densemble)
- [Constantes et configuration](#constantes-et-configuration)
- [Statuts de session](#statuts-de-session)
- [POST /mobile/sos/activate](#post-mobilesosactivate)
- [POST /mobile/sos/heartbeat](#post-mobilesosheartbeat)
- [POST /mobile/sos/extend](#post-mobilesosextend)
- [POST /mobile/sos/deactivate](#post-mobilesosdeactivate)
- [GET /mobile/sos/status](#get-mobilesostatus)
- [GET /mobile/sos/contacts](#get-mobilesoscontacts)
- [POST /mobile/sos/contacts](#post-mobilesoscontacts)
- [DELETE /mobile/sos/contacts/:contactId](#delete-mobilesoscontactscontactid)
- [GET /mobile/sos/history](#get-mobilesoshistory)
- [POST /mobile/sos/surface-detected](#post-mobilesosSurface-detected)
- [Système d'escalade](#système-descalade)
- [Sessions de groupe](#sessions-de-groupe)

---

## Vue d'ensemble

Le **Mode SOS** est un système de sécurité critique permettant aux utilisateurs en situation potentiellement dangereuse (ex. plongée, randonnée isolée) d'activer une session de surveillance. Si l'utilisateur ne donne pas signe de vie (heartbeat) avant l'expiration du timer, une escalade automatique est déclenchée.

> ⚠️ **Safety-critical** : ce système est responsable d'envoyer des alertes d'urgence. Les bugs ou indisponibilités peuvent avoir des conséquences graves. Toute modification doit être testée exhaustivement.

### Headers obligatoires

```http
Authorization: Bearer eyJhbGci...
X-Platform: ios          (ou android)
X-Device-ID: <UUID v4>
X-App-Version: 2.1.0
Content-Type: application/json
```

---

## Constantes et configuration

| Constante                           | Valeur  | Description                                |
| ----------------------------------- | ------- | ------------------------------------------ |
| `HEARTBEAT_EXTENSION_MINUTES`       | 15      | Prolongation du timer par chaque heartbeat |
| `STAGE_1_DELAY_MINUTES`             | 60      | Délai avant Stage 1 après expiration (1h)  |
| `STAGE_2_DELAY_MINUTES`             | 120     | Délai avant Stage 2 après expiration (2h)  |
| `MIN_DURATION_MINUTES`              | 15      | Durée minimale d'une session SOS           |
| `MAX_DURATION_MINUTES`              | 480     | Durée maximale (8 heures)                  |
| `SURFACE_DISTANCE_THRESHOLD_METERS` | 200     | Seuil de détection de retour en surface    |
| `RECONNECTION_THRESHOLD_MS`         | 300 000 | Seuil de reconnexion (5 minutes)           |
| `MIN_HEARTBEATS_FOR_RECONNECTION`   | 5       | Heartbeats min pour confirmer reconnexion  |

---

## Statuts de session

| Statut       | Description                                   |
| ------------ | --------------------------------------------- |
| `ACTIVE`     | Session en cours, timer actif                 |
| `EXPIRED`    | Timer expiré, en attente d'escalade           |
| `ESCALATING` | Escalade en cours (Stage 1 ou Stage 2)        |
| `RESOLVED`   | Session résolue (retour sain)                 |
| `CANCELLED`  | Session annulée manuellement avant expiration |

---

## POST /mobile/sos/activate

Active une nouvelle session SOS pour l'utilisateur authentifié.

### Requête

```http
POST /api/v1/mobile/sos/activate
Authorization: Bearer eyJhbGci...
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
X-App-Version: 2.1.0
Content-Type: application/json
```

```json
{
  "expectedDuration": 90,
  "note": "Plongée épave du Dalton, prof max 35m",
  "lat": 43.2965,
  "lng": 5.3698,
  "accuracy": 10.5,
  "siteName": "Épave du Dalton",
  "zone": "Zone B - Marseille",
  "depth": 35,
  "sessionContacts": [
    {
      "name": "Sophie Martin",
      "phone": "+33612345678",
      "relationship": "Conjoint"
    }
  ],
  "participantIds": ["64a1b2c3d4e5f6789012345"]
}
```

| Champ                            | Type   | Requis | Description                                               |
| -------------------------------- | ------ | ------ | --------------------------------------------------------- |
| `expectedDuration`               | number | ✅     | Durée prévue en minutes (15-480)                          |
| `note`                           | string | ⬜     | Note libre sur la session                                 |
| `lat`                            | number | ⬜     | Latitude GPS                                              |
| `lng`                            | number | ⬜     | Longitude GPS                                             |
| `accuracy`                       | number | ⬜     | Précision GPS en mètres                                   |
| `siteName`                       | string | ⬜     | Nom du site                                               |
| `zone`                           | string | ⬜     | Zone géographique                                         |
| `depth`                          | number | ⬜     | Profondeur maximale prévue (mètres)                       |
| `sessionContacts`                | array  | ⬜     | Contacts d'urgence temporaires pour cette session         |
| `sessionContacts[].name`         | string | ✅\*   | Nom du contact                                            |
| `sessionContacts[].phone`        | string | ✅\*   | Numéro de téléphone (format international)                |
| `sessionContacts[].relationship` | string | ⬜     | Relation (Conjoint, Parent, etc.)                         |
| `participantIds`                 | array  | ⬜     | IDs des autres utilisateurs participants (session groupe) |

### Réponse succès `201 Created`

```json
{
  "sessionId": "64a1b2c3d4e5f6789099999",
  "status": "ACTIVE",
  "activatedAt": "2026-03-18T10:00:00.000Z",
  "expiresAt": "2026-03-18T11:30:00.000Z",
  "stage1At": "2026-03-18T11:45:00.000Z",
  "stage2At": "2026-03-18T12:00:00.000Z",
  "expectedDuration": 90
}
```

### Réponses d'erreur

| HTTP  | Code erreur              | Description                            |
| ----- | ------------------------ | -------------------------------------- |
| `400` | `VALIDATION_ERROR`       | Durée invalide (hors plage 15-480 min) |
| `400` | `INVALID_PHONE_FORMAT`   | Format numéro de téléphone invalide    |
| `401` | `UNAUTHORIZED`           | Token invalide                         |
| `409` | `SESSION_ALREADY_ACTIVE` | Une session SOS est déjà active        |

---

## POST /mobile/sos/heartbeat

Envoie un signal de vie pour prolonger le timer de la session active. **Chaque heartbeat prolonge la session de `HEARTBEAT_EXTENSION_MINUTES` (15 min).**

### Requête

```http
POST /api/v1/mobile/sos/heartbeat
Authorization: Bearer eyJhbGci...
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
X-App-Version: 2.1.0
Content-Type: application/json
```

```json
{
  "sessionId": "64a1b2c3d4e5f6789099999",
  "lat": 43.296,
  "lng": 5.37,
  "accuracy": 8.0
}
```

| Champ       | Type   | Requis | Description                                           |
| ----------- | ------ | ------ | ----------------------------------------------------- |
| `sessionId` | string | ⬜     | ID de session (optionnel si une seule session active) |
| `lat`       | number | ⬜     | Latitude GPS actuelle                                 |
| `lng`       | number | ⬜     | Longitude GPS actuelle                                |
| `accuracy`  | number | ⬜     | Précision GPS en mètres                               |

### Réponse succès `200 OK`

```json
{
  "sessionId": "64a1b2c3d4e5f6789099999",
  "status": "ACTIVE",
  "newExpiresAt": "2026-03-18T11:45:00.000Z",
  "heartbeatCount": 3,
  "message": "Timer prolongé de 15 minutes"
}
```

### Réponses d'erreur

| HTTP  | Code erreur         | Description                              |
| ----- | ------------------- | ---------------------------------------- |
| `401` | `UNAUTHORIZED`      | Token invalide                           |
| `404` | `SESSION_NOT_FOUND` | Aucune session active                    |
| `409` | `SESSION_EXPIRED`   | Session expirée, impossible de prolonger |

---

## POST /mobile/sos/extend

Prolonge manuellement la session d'un nombre de minutes spécifié (différent d'un heartbeat).

### Requête

```http
POST /api/v1/mobile/sos/extend
Authorization: Bearer eyJhbGci...
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
X-App-Version: 2.1.0
Content-Type: application/json
```

```json
{
  "sessionId": "64a1b2c3d4e5f6789099999",
  "minutes": 30
}
```

| Champ       | Type   | Requis | Description                                   |
| ----------- | ------ | ------ | --------------------------------------------- |
| `sessionId` | string | ⬜     | ID de session (optionnel si une seule active) |
| `minutes`   | number | ✅     | Nombre de minutes à ajouter                   |

### Réponse succès `200 OK`

```json
{
  "sessionId": "64a1b2c3d4e5f6789099999",
  "status": "ACTIVE",
  "newExpiresAt": "2026-03-18T12:15:00.000Z",
  "totalDuration": 135
}
```

---

## POST /mobile/sos/deactivate

Résout et désactive la session SOS (retour sain). Annule toute escalade en cours.

### Requête

```http
POST /api/v1/mobile/sos/deactivate
Authorization: Bearer eyJhbGci...
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
X-App-Version: 2.1.0
Content-Type: application/json
```

```json
{
  "sessionId": "64a1b2c3d4e5f6789099999",
  "note": "Retour au bateau, tout va bien"
}
```

| Champ       | Type   | Requis | Description        |
| ----------- | ------ | ------ | ------------------ |
| `sessionId` | string | ⬜     | ID de session      |
| `note`      | string | ⬜     | Note de résolution |

### Réponse succès `200 OK`

```json
{
  "sessionId": "64a1b2c3d4e5f6789099999",
  "status": "RESOLVED",
  "resolvedAt": "2026-03-18T11:20:00.000Z",
  "duration": 80
}
```

Si une escalade Stage 1 ou Stage 2 était en cours, les contacts sont notifiés de la résolution.

---

## GET /mobile/sos/status

Retourne l'état de la session SOS active.

### Requête

```http
GET /api/v1/mobile/sos/status
Authorization: Bearer eyJhbGci...
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
X-App-Version: 2.1.0
```

### Réponse succès `200 OK` (session active)

```json
{
  "hasActiveSession": true,
  "session": {
    "id": "64a1b2c3d4e5f6789099999",
    "status": "ACTIVE",
    "activatedAt": "2026-03-18T10:00:00.000Z",
    "expiresAt": "2026-03-18T11:45:00.000Z",
    "stage1At": "2026-03-18T12:00:00.000Z",
    "stage2At": "2026-03-18T12:15:00.000Z",
    "heartbeatCount": 3,
    "lastHeartbeatAt": "2026-03-18T11:30:00.000Z",
    "siteName": "Épave du Dalton",
    "participants": []
  }
}
```

### Réponse succès `200 OK` (aucune session)

```json
{
  "hasActiveSession": false,
  "session": null
}
```

---

## GET /mobile/sos/contacts

Retourne la liste des contacts SOS permanents de l'utilisateur.

### Requête

```http
GET /api/v1/mobile/sos/contacts
Authorization: Bearer eyJhbGci...
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
X-App-Version: 2.1.0
```

### Réponse succès `200 OK`

```json
{
  "contacts": [
    {
      "id": "64a1b2c3d4e5f678901234a",
      "name": "Sophie Martin",
      "phone": "+33612345678",
      "relationship": "Conjoint",
      "createdAt": "2026-01-15T08:00:00.000Z"
    },
    {
      "id": "64a1b2c3d4e5f678901234b",
      "name": "Pierre Dupont",
      "phone": "+33698765432",
      "relationship": "Parent",
      "createdAt": "2026-01-20T09:00:00.000Z"
    }
  ],
  "total": 2
}
```

---

## POST /mobile/sos/contacts

Ajoute un contact SOS permanent.

### Requête

```http
POST /api/v1/mobile/sos/contacts
Authorization: Bearer eyJhbGci...
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
X-App-Version: 2.1.0
Content-Type: application/json
```

```json
{
  "name": "Marie Lambert",
  "phone": "+33611223344",
  "relationship": "Collègue"
}
```

| Champ          | Type   | Requis | Description                                         |
| -------------- | ------ | ------ | --------------------------------------------------- |
| `name`         | string | ✅     | Nom du contact                                      |
| `phone`        | string | ✅     | Numéro de téléphone (format international `+33...`) |
| `relationship` | string | ⬜     | Relation avec l'utilisateur                         |

### Réponse succès `201 Created`

```json
{
  "contact": {
    "id": "64a1b2c3d4e5f678901234c",
    "name": "Marie Lambert",
    "phone": "+33611223344",
    "relationship": "Collègue",
    "createdAt": "2026-03-18T10:00:00.000Z"
  }
}
```

### Réponses d'erreur

| HTTP  | Code erreur              | Description                   |
| ----- | ------------------------ | ----------------------------- |
| `400` | `INVALID_PHONE_FORMAT`   | Format téléphone invalide     |
| `409` | `CONTACT_ALREADY_EXISTS` | Ce numéro est déjà enregistré |

---

## DELETE /mobile/sos/contacts/:contactId

Supprime un contact SOS permanent.

### Requête

```http
DELETE /api/v1/mobile/sos/contacts/64a1b2c3d4e5f678901234c
Authorization: Bearer eyJhbGci...
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
X-App-Version: 2.1.0
```

### Réponse succès `200 OK`

```json
{
  "message": "Contact supprimé avec succès"
}
```

### Réponses d'erreur

| HTTP  | Code erreur         | Description                                 |
| ----- | ------------------- | ------------------------------------------- |
| `404` | `CONTACT_NOT_FOUND` | Contact non trouvé                          |
| `403` | `FORBIDDEN`         | Ce contact n'appartient pas à l'utilisateur |

---

## GET /mobile/sos/history

Retourne l'historique des sessions SOS de l'utilisateur.

### Requête

```http
GET /api/v1/mobile/sos/history?page=1&limit=20
Authorization: Bearer eyJhbGci...
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
X-App-Version: 2.1.0
```

| Paramètre | Type   | Défaut | Description                  |
| --------- | ------ | ------ | ---------------------------- |
| `page`    | number | 1      | Page de résultats            |
| `limit`   | number | 20     | Nombre de résultats par page |

### Réponse succès `200 OK`

```json
{
  "sessions": [
    {
      "id": "64a1b2c3d4e5f6789099999",
      "status": "RESOLVED",
      "activatedAt": "2026-03-18T10:00:00.000Z",
      "resolvedAt": "2026-03-18T11:20:00.000Z",
      "duration": 80,
      "siteName": "Épave du Dalton",
      "escalationReached": false,
      "heartbeatCount": 3
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 15,
    "pages": 1
  }
}
```

---

## POST /mobile/sos/surface-detected

Signale une détection de retour en surface (reconnexion réseau après période sans signal).

### Requête

```http
POST /api/v1/mobile/sos/surface-detected
Authorization: Bearer eyJhbGci...
X-Platform: ios
X-Device-ID: 550e8400-e29b-41d4-a716-446655440000
X-App-Version: 2.1.0
Content-Type: application/json
```

```json
{
  "sessionId": "64a1b2c3d4e5f6789099999",
  "lat": 43.2965,
  "lng": 5.3698,
  "accuracy": 15.0,
  "offlineDurationMs": 180000
}
```

| Champ               | Type   | Requis | Description                     |
| ------------------- | ------ | ------ | ------------------------------- |
| `sessionId`         | string | ⬜     | ID de session                   |
| `lat`               | number | ⬜     | Latitude de retour en surface   |
| `lng`               | number | ⬜     | Longitude de retour en surface  |
| `accuracy`          | number | ⬜     | Précision GPS                   |
| `offlineDurationMs` | number | ⬜     | Durée d'absence de signal en ms |

### Réponse succès `200 OK`

```json
{
  "sessionId": "64a1b2c3d4e5f6789099999",
  "status": "ACTIVE",
  "surfaceDetected": true,
  "escalationCancelled": true,
  "newExpiresAt": "2026-03-18T12:00:00.000Z"
}
```

Si la distance entre le point de surface et le point d'activation est < `SURFACE_DISTANCE_THRESHOLD_METERS` (200m), l'escalade est automatiquement suspendue le temps de confirmer le retour sain.

---

## Système d'escalade

```
Session activée (expectedDuration = 90 min)
        │
        │◀── Heartbeats toutes les X min (prolongent de 15 min)
        │
        ▼
┌─────────────────┐
│  Timer expire   │  (pas de heartbeat reçu)
│  Status: EXPIRED│
└────────┬────────┘
         │
         │  +1h (STAGE_1_DELAY_MINUTES)
         ▼
┌─────────────────────────────────┐
│  STAGE 0 → Alarme locale        │  Notification push à l'utilisateur
│  (immédiat après expiration)    │  "Votre session SOS a expiré"
└────────┬────────────────────────┘
         │
         │  +1h après expiration (STAGE_1_DELAY_MINUTES)
         ▼
┌─────────────────────────────────┐
│  STAGE 1 → Alerte contacts      │  Push + WebSocket aux contacts
│  Status: ESCALATING             │  "Alerte : X n'a pas donné signe de vie"
└────────┬────────────────────────┘
         │
         │  +2h après expiration (STAGE_2_DELAY_MINUTES)
         ▼
┌─────────────────────────────────┐
│  STAGE 2 → SMS Vonage contacts  │  SMS aux contacts via Vonage
│  Status: ESCALATING             │  Message d'urgence avec coordonnées GPS
└─────────────────────────────────┘

À tout moment → POST /sos/deactivate → Status: RESOLVED
```

### Contacts alertés

L'escalade utilise dans cet ordre de priorité :

1. Contacts définis dans `sessionContacts` (temporaires pour cette session)
2. Contacts permanents (enregistrés via `POST /sos/contacts`)

---

## Sessions de groupe

Plusieurs utilisateurs peuvent rejoindre une même session SOS via `participantIds`. Chaque participant :

- A son **propre timer d'escalade** indépendant
- Peut envoyer ses propres heartbeats
- Peut désactiver sa participation sans affecter les autres
- Reçoit les notifications de statut des autres participants

```json
// Session groupe
{
  "participants": [
    {
      "userId": "64a1b2c3...",
      "status": "ACTIVE",
      "expiresAt": "2026-03-18T11:45:00.000Z",
      "lastHeartbeatAt": "2026-03-18T11:30:00.000Z"
    },
    {
      "userId": "64a1b2d4...",
      "status": "EXPIRED",
      "expiresAt": "2026-03-18T11:00:00.000Z",
      "escalationStage": 1
    }
  ]
}
```

---

_Voir aussi : [sos-service.md](../06_services/sos-service.md) — [cron-jobs.md](../06_services/cron-jobs.md) — [vonage-sms.md](../06_services/vonage-sms.md)_
