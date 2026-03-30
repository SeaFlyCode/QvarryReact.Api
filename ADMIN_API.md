# API Admin — Documentation complète

Base URL : `/api/v1/admin`

**Authentification requise sur tous les endpoints :** JWT Bearer token + rôle admin (`is_admin: true`).

---

## Table des matières

1. [Statistiques](#statistiques)
2. [Gestion des utilisateurs](#gestion-des-utilisateurs)
3. [Validation des comptes](#validation-des-comptes)
4. [Logs d'audit](#logs-daudit)
5. [Sécurité — IP & Monitoring](#sécurité--ip--monitoring)
6. [Mode SOS — Consultation](#mode-sos--consultation)
7. [Mode SOS — Actions admin](#mode-sos--actions-admin)
8. [Stockage](#stockage)

---

## Statistiques

### `GET /stats`

Statistiques globales de la plateforme. Résultat mis en cache 5 minutes.

**Réponse 200**
```json
{
  "users": {
    "total": 1200,
    "verified": 980,
    "blocked": 12,
    "admins": 3,
    "newLast30Days": 45,
    "newLast7Days": 10,
    "newToday": 2,
    "activeLast24h": 300,
    "activeLast7Days": 750
  },
  "content": {
    "points": { "total": 5000, "last30Days": 200 },
    "fiches": { "total": 3200, "last30Days": 120 },
    "lists": { "total": 800 }
  },
  "sharing": {
    "total": 1500,
    "active": 300,
    "accepted": 900
  },
  "messaging": {
    "conversations": 600,
    "messages": 12000
  },
  "generatedAt": "2026-03-30T10:00:00.000Z"
}
```

---

### `GET /stats/registrations`

Évolution quotidienne des inscriptions. Les jours sans inscription apparaissent avec `count: 0`.

**Query params**

| Param | Type | Défaut | Max | Description |
|-------|------|--------|-----|-------------|
| `days` | number | 30 | 365 | Nombre de jours à couvrir |

**Réponse 200**
```json
{
  "registrations": [
    { "date": "2026-03-01", "count": 5 },
    { "date": "2026-03-02", "count": 0 },
    { "date": "2026-03-03", "count": 8 }
  ],
  "days": 30
}
```

---

### `GET /stats/activity`

Évolution quotidienne de la création de points et fiches.

**Query params**

| Param | Type | Défaut | Max |
|-------|------|--------|-----|
| `days` | number | 30 | 365 |

**Réponse 200**
```json
{
  "activity": [
    { "date": "2026-03-01", "points": 12, "fiches": 4 },
    { "date": "2026-03-02", "points": 0, "fiches": 0 }
  ],
  "days": 30
}
```

---

## Gestion des utilisateurs

### `GET /users`

Liste paginée des utilisateurs avec filtres. Données personnelles déchiffrées à la volée.

**Query params**

| Param | Type | Description |
|-------|------|-------------|
| `page` | number | Page (défaut: 1) |
| `limit` | number | Par page, max 100 (défaut: 20) |
| `search` | string | Recherche sur nom, prénom, email, pseudo (max 100 car.) |
| `is_blocked` | `true`/`false` | Filtre par statut de blocage |
| `is_verified` | `true`/`false` | Filtre par vérification email |
| `is_admin` | `true` | Filtre les admins uniquement |
| `sort` | string | Champ de tri parmi : `creation_date`, `last_connection`, `name`, `surname`, `email`, `_id`, `is_admin`, `is_blocked`, `is_verified` |
| `order` | `asc`/`desc` | Ordre de tri (défaut: desc) |

**Réponse 200**
```json
{
  "users": [
    {
      "id": "507f1f77bcf86cd799439011",
      "name": "Jean",
      "surname": "Dupont",
      "pseudo": "jdupont",
      "email": "jean@example.com",
      "is_admin": false,
      "is_blocked": false,
      "is_verified": true,
      "is_admin_validated": true,
      "admin_validation_rejected": false,
      "creation_date": "2026-01-15T08:00:00.000Z",
      "last_connection": "2026-03-29T14:00:00.000Z",
      "blocked_at": null,
      "blocked_reason": null
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1200,
    "totalPages": 60
  }
}
```

**Erreurs**
- `400 SEARCH_TOO_LONG` — recherche dépasse 100 caractères

---

### `GET /users/pending`

Liste des comptes vérifiés mais en attente de validation admin.

**Query params** : `page`, `limit` (max 100)

**Réponse 200**
```json
{
  "users": [
    {
      "id": "507f1f77bcf86cd799439011",
      "name": "Jean",
      "surname": "Dupont",
      "pseudo": "jdupont",
      "email": "jean@example.com",
      "creation_date": "2026-03-28T10:00:00.000Z",
      "is_verified": true
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 5, "totalPages": 1 }
}
```

---

### `GET /users/pending/count`

Nombre de comptes en attente de validation. Utile pour un badge de notification.

**Réponse 200**
```json
{ "count": 5 }
```

---

### `GET /users/:userId`

Détails complets d'un utilisateur + statistiques de contenu.

**Réponse 200**
```json
{
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "name": "Jean",
    "surname": "Dupont",
    "pseudo": "jdupont",
    "email": "jean@example.com",
    "is_admin": false,
    "is_blocked": false,
    "is_verified": true,
    "creation_date": "2026-01-15T08:00:00.000Z",
    "last_connection": "2026-03-29T14:00:00.000Z",
    "blocked_at": null,
    "blocked_reason": null,
    "contact_code": "ABC123"
  },
  "stats": {
    "points": 42,
    "fiches": 15,
    "lists": 3,
    "activeSessions": 1
  }
}
```

**Erreurs**
- `404` — utilisateur non trouvé

---

### `POST /users/:userId/block`

Bloque un utilisateur et révoque toutes ses sessions. Impossible de bloquer un admin ou soi-même.

**Body**
```json
{ "reason": "Comportement abusif" }
```

**Réponse 200**
```json
{
  "success": true,
  "message": "Utilisateur jean@example.com bloqué avec succès",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "jean@example.com",
    "is_blocked": true,
    "blocked_at": "2026-03-30T10:00:00.000Z",
    "blocked_reason": "Comportement abusif"
  }
}
```

**Erreurs**
- `400` — bloquer soi-même
- `403` — cible est un admin
- `404` — utilisateur non trouvé

---

### `POST /users/:userId/unblock`

Débloque un utilisateur.

**Réponse 200**
```json
{
  "success": true,
  "message": "Utilisateur jean@example.com débloqué avec succès",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "jean@example.com",
    "is_blocked": false
  }
}
```

**Erreurs**
- `400` — utilisateur non bloqué
- `404` — utilisateur non trouvé

---

### `POST /users/:userId/promote`

Promène un utilisateur en administrateur. Impossible si l'utilisateur est bloqué.

**Réponse 200**
```json
{
  "success": true,
  "message": "jean@example.com est maintenant administrateur",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "jean@example.com",
    "is_admin": true
  }
}
```

**Erreurs**
- `400` — déjà admin ou utilisateur bloqué
- `404` — utilisateur non trouvé

---

### `POST /users/:userId/demote`

Rétrograde un admin en utilisateur normal. Impossible de se rétrograder soi-même ou s'il ne reste qu'un seul admin.

**Réponse 200**
```json
{
  "success": true,
  "message": "jean@example.com n'est plus administrateur",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "jean@example.com",
    "is_admin": false
  }
}
```

**Erreurs**
- `400` — rétrograder soi-même, pas admin, ou dernier admin restant
- `404` — utilisateur non trouvé

---

### `POST /users/:userId/force-logout`

Révoque toutes les sessions actives d'un utilisateur.

**Réponse 200**
```json
{
  "success": true,
  "message": "Toutes les sessions de jean@example.com ont été révoquées",
  "revokedSessions": 3
}
```

**Erreurs**
- `404` — utilisateur non trouvé

---

### `POST /users/:userId/reset-password`

Génère un token de réinitialisation, envoie un email à l'utilisateur et révoque toutes ses sessions.

**Réponse 200**
```json
{
  "success": true,
  "message": "Un email de réinitialisation a été envoyé à jean@example.com"
}
```

**Erreurs**
- `404` — utilisateur non trouvé

---

## Validation des comptes

### `POST /users/:userId/approve`

Valide un compte en attente. Envoie un email de confirmation à l'utilisateur.

**Réponse 200**
```json
{
  "success": true,
  "message": "Le compte de Jean Dupont a été approuvé. Un email de confirmation a été envoyé."
}
```

**Erreurs**
- `400` — compte déjà validé
- `404` — utilisateur non trouvé

---

### `POST /users/:userId/reject`

Refuse un compte en attente. Envoie un email de refus à l'utilisateur.

**Body**
```json
{ "reason": "Documents insuffisants" }
```

**Réponse 200**
```json
{
  "success": true,
  "message": "Le compte de Jean Dupont a été refusé. Un email a été envoyé."
}
```

**Erreurs**
- `400` — compte déjà validé
- `404` — utilisateur non trouvé

---

## Logs d'audit

### `GET /audit/logs`

Liste paginée des logs d'audit avec filtres.

**Query params**

| Param | Type | Description |
|-------|------|-------------|
| `page` | number | Défaut: 1 |
| `limit` | number | Max 200, défaut: 50 |
| `userId` | ObjectId | Filtre par utilisateur |
| `action` | string | Doit être dans la liste des actions autorisées¹ |
| `level` | string | `info`, `warning`, `error`, `critical` |
| `startDate` | ISO date | Date de début |
| `endDate` | ISO date | Date de fin |

> ¹ Actions valides : `LOGIN`, `LOGOUT`, `REGISTER`, `PASSWORD_CHANGE`, `PASSWORD_RESET`, `EMAIL_CHANGE`, `PROFILE_UPDATE`, `ACCOUNT_DELETE`, `POINT_CREATE`, `POINT_UPDATE`, `POINT_DELETE`, `FICHE_CREATE`, `FICHE_UPDATE`, `FICHE_DELETE`, `LIST_CREATE`, `LIST_UPDATE`, `LIST_DELETE`, `SHARE_CREATE`, `SHARE_ACCEPT`, `SHARE_REJECT`, `ADMIN_ACTION`, `SECURITY_ALERT`

**Réponse 200**
```json
{
  "logs": [
    {
      "_id": "...",
      "userId": "507f1f77bcf86cd799439011",
      "action": "LOGIN",
      "level": "info",
      "ipAddress": "192.168.1.1",
      "userAgent": "...",
      "details": {},
      "timestamp": "2026-03-30T09:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 50, "total": 5000, "totalPages": 100 }
}
```

---

### `GET /audit/stats`

Statistiques des logs d'audit : répartition par niveau (7 jours) et top 10 actions (24h).

**Réponse 200**
```json
{
  "byLevel": {
    "info": 4500,
    "warning": 200,
    "error": 30,
    "critical": 2
  },
  "topActions": [
    { "action": "LOGIN", "count": 350 },
    { "action": "POINT_CREATE", "count": 120 }
  ],
  "recentCritical": [...],
  "period": {
    "levelStats": "7 derniers jours",
    "actionStats": "24 dernières heures"
  }
}
```

---

### `GET /audit/export`

Export des logs d'audit en JSON (streaming) ou CSV (téléchargement direct).

**Query params**

| Param | Type | Description |
|-------|------|-------------|
| `format` | `json`/`csv` | Format d'export (défaut: json) |
| `startDate` | ISO date | Date de début |
| `endDate` | ISO date | Date de fin |
| `level` | string | Filtre niveau |
| `action` | string | Filtre action |
| `limit` | number | Max 50 000, défaut: 10 000 |

**Réponse** : fichier téléchargeable (`Content-Disposition: attachment`), nom `audit-logs-YYYY-MM-DD.json` ou `.csv`

**Erreurs**
- `400` — format invalide (`json` ou `csv` attendu)

---

## Sécurité — IP & Monitoring

### `GET /security/dashboard`

Dashboard de monitoring sécurité : alertes récentes, IPs suspectes, tentatives de connexion échouées, etc. Contenu dépend du `securityAlertService`.

**Réponse 200** : objet de statistiques de sécurité (structure définie par `securityAlertService.getSecurityStats()`)

---

### `GET /security/blocked-ips`

Liste paginée des IPs bloquées.

**Query params** : `page`, `limit` (max 200)

**Réponse 200**
```json
{
  "ips": [
    {
      "ipAddress": "1.2.3.4",
      "reason": "Brute force",
      "blockedAt": "2026-03-29T08:00:00.000Z",
      "blockedUntil": "2026-03-30T08:00:00.000Z",
      "blockedBy": "507f1f77bcf86cd799439011"
    }
  ],
  "pagination": { "page": 1, "limit": 50, "total": 10, "totalPages": 1 }
}
```

---

### `POST /security/block-ip`

Bloque manuellement une adresse IP (IPv4 ou IPv6).

**Body**
```json
{
  "ipAddress": "1.2.3.4",
  "reason": "Activité suspecte",
  "durationHours": 24
}
```

> `durationHours` est optionnel — si absent, blocage permanent jusqu'à déblocage manuel.

**Réponse 200**
```json
{
  "success": true,
  "message": "IP 1.2.3.4 bloquée avec succès",
  "blockedIp": { ... }
}
```

**Erreurs**
- `400` — IP ou raison manquante, format IP invalide

---

### `DELETE /security/unblock-ip/:ipAddress`

Débloque une adresse IP.

**Réponse 200**
```json
{
  "success": true,
  "message": "IP 1.2.3.4 débloquée avec succès"
}
```

**Erreurs**
- `404` — IP non trouvée ou déjà débloquée

---

### `GET /security/threat-score/:ipAddress`

Score de menace calculé pour une IP et son statut de blocage actuel.

**Réponse 200**
```json
{
  "ipAddress": "1.2.3.4",
  "threatScore": {
    "ip": "1.2.3.4",
    "score": 75,
    "reasons": ["brute_force", "rate_limit_exceeded"],
    "lastUpdated": "2026-03-30T09:00:00.000Z"
  },
  "isBlocked": true,
  "blockReason": "Brute force",
  "blockedUntil": "2026-03-31T09:00:00.000Z"
}
```

---

### `POST /security/test-alert`

Envoie une alerte de test à tous les administrateurs via le `securityAlertService`.

**Réponse 200**
```json
{
  "success": true,
  "message": "Alerte de test envoyée à tous les administrateurs"
}
```

---

## Mode SOS — Consultation

### `GET /sos/dashboard`

Dashboard agrégé du Mode SOS : sessions actives, statistiques récentes.

**Réponse 200**
```json
{
  "success": true,
  "data": { ... }
}
```

---

### `GET /sos/active`

Liste de toutes les sessions SOS actuellement actives.

**Réponse 200**
```json
{
  "success": true,
  "sessions": [ ... ],
  "count": 3
}
```

---

### `GET /sos/sessions/:sessionId`

Détails complets d'une session SOS.

**Réponse 200**
```json
{
  "success": true,
  "data": { ... }
}
```

**Erreurs**
- `404 SESSION_NOT_FOUND`

---

### `GET /sos/history`

Historique des sessions SOS avec filtres.

**Query params**

| Param | Type | Description |
|-------|------|-------------|
| `limit` | number | Max 100, défaut: 50 |
| `status` | string | Filtre par statut de session |
| `userId` | ObjectId | Filtre par créateur |
| `participantId` | ObjectId | Alias de `userId` |

**Réponse 200**
```json
{
  "success": true,
  "sessions": [ ... ],
  "count": 25,
  "filters": {
    "limit": 50,
    "status": "resolved",
    "userId": null
  }
}
```

---

### `GET /sos/stats`

Statistiques globales SOS avec filtre de période optionnel.

**Query params**

| Param | Type | Description |
|-------|------|-------------|
| `startDate` | ISO date | Date de début |
| `endDate` | ISO date | Date de fin |

**Réponse 200**
```json
{
  "success": true,
  "data": { ... }
}
```

**Erreurs**
- `400 INVALID_START_DATE` / `400 INVALID_END_DATE`

---

## Mode SOS — Actions admin

### `POST /sos/sessions/activate`

Crée et active une session SOS pour le compte d'un utilisateur.

**Body**
```json
{
  "targetUserId": "507f1f77bcf86cd799439011",
  "expectedDuration": 60,
  "note": "Plongée profonde",
  "lat": 43.296482,
  "lng": 5.381195,
  "siteName": "Calanque de Morgiou",
  "zone": "Zone A",
  "depth": 30,
  "participantIds": ["507f1f77bcf86cd799439012"]
}
```

> `expectedDuration` : 15–480 minutes. `lat`, `lng`, `siteName`, `zone`, `depth`, `participantIds` sont optionnels.

**Réponse 201**
```json
{
  "success": true,
  "session": {
    "id": "...",
    "status": "active",
    "activatedAt": "2026-03-30T10:00:00.000Z",
    "expiresAt": "2026-03-30T11:00:00.000Z",
    "participants": [
      { "userId": "...", "status": "active", "currentStage": 0 }
    ]
  }
}
```

**Erreurs**
- `400 MISSING_TARGET_USER_ID` / `400 INVALID_DURATION` / `400 INVALID_PARTICIPANT_IDS`
- `409 SESSION_ALREADY_ACTIVE`

---

### `POST /sos/sessions/:sessionId/cancel`

Annule / résout une session SOS. Révoque la session et notifie les participants.

**Body**
```json
{ "reason": "Fausse alerte" }
```

**Réponse 200**
```json
{
  "success": true,
  "session": {
    "id": "...",
    "status": "cancelled",
    "resolvedAt": "2026-03-30T10:30:00.000Z",
    "resolvedBy": "507f1f77bcf86cd799439011",
    "participantCount": 2,
    "isGroupSession": true,
    "participants": [
      { "userId": "...", "status": "left", "leftAt": "2026-03-30T10:30:00.000Z" }
    ]
  },
  "message": "Session annulée avec succès."
}
```

**Erreurs**
- `404 SESSION_NOT_FOUND`

---

### `POST /sos/sessions/:sessionId/confirm-safe`

Marque une session comme résolue — utilisateur en sécurité confirmé par l'admin.

**Body**
```json
{ "reason": "Contact établi, situation sous contrôle" }
```

**Réponse 200**
```json
{
  "success": true,
  "session": {
    "id": "...",
    "status": "resolved",
    "resolvedAt": "2026-03-30T10:45:00.000Z",
    "resolvedBy": "507f1f77bcf86cd799439011",
    "participantCount": 1
  }
}
```

**Erreurs**
- `404 SESSION_NOT_FOUND`

---

### `POST /sos/sessions/:sessionId/extend`

Prolonge la durée d'expiration d'une session.

**Body**
```json
{ "additionalMinutes": 30 }
```

> `additionalMinutes` : 15–480 minutes.

**Réponse 200**
```json
{
  "success": true,
  "session": {
    "id": "...",
    "status": "active",
    "expiresAt": "2026-03-30T11:30:00.000Z",
    "extensionCount": 1
  }
}
```

**Erreurs**
- `400 INVALID_EXTENSION_DURATION`
- `404 SESSION_NOT_FOUND`

---

### `POST /sos/sessions/:sessionId/heartbeat`

Envoie un heartbeat pour le compte d'un participant (renouvelle son activité).

**Body**
```json
{ "userId": "507f1f77bcf86cd799439012" }
```

**Réponse 200**
```json
{
  "success": true,
  "session": {
    "id": "...",
    "status": "active",
    "expiresAt": "2026-03-30T11:00:00.000Z",
    "heartbeatCount": 5
  }
}
```

**Erreurs**
- `404 SESSION_NOT_FOUND` / `404 PARTICIPANT_NOT_FOUND`

---

### `POST /sos/sessions/:sessionId/force-escalation`

Force le passage à un stage d'escalade pour un participant.

**Body**
```json
{
  "userId": "507f1f77bcf86cd799439012",
  "targetStage": 2
}
```

> `targetStage` : `0`, `1` ou `2`. Ne peut pas rétrograder un participant déjà à ce stage ou supérieur.

**Réponse 200**
```json
{
  "success": true,
  "session": {
    "id": "...",
    "status": "active",
    "currentStage": 2
  },
  "participant": {
    "userId": "...",
    "currentStage": 2,
    "escalationHistory": [ ... ]
  }
}
```

**Erreurs**
- `400 INVALID_STAGE`
- `404 SESSION_NOT_FOUND` / `404 PARTICIPANT_NOT_FOUND`
- `409 STAGE_ALREADY_REACHED`

---

### `POST /sos/sessions/:sessionId/add-participant`

Ajoute un utilisateur comme participant à une session active.

**Body**
```json
{ "targetUserId": "507f1f77bcf86cd799439013" }
```

**Réponse 200**
```json
{
  "success": true,
  "session": {
    "id": "...",
    "participantCount": 3,
    "participants": [
      { "userId": "...", "status": "active", "currentStage": 0, "joinedAt": "..." }
    ]
  }
}
```

**Erreurs**
- `404 SESSION_NOT_FOUND` / `404 USER_NOT_FOUND`
- `409 ALREADY_PARTICIPANT` / `409 USER_HAS_ACTIVE_SESSION`

---

### `POST /sos/sessions/:sessionId/remove-participant`

Retire un participant d'une session active.

**Body**
```json
{ "targetUserId": "507f1f77bcf86cd799439013" }
```

**Réponse 200**
```json
{
  "success": true,
  "session": {
    "id": "...",
    "status": "active",
    "participantCount": 2,
    "participants": [
      { "userId": "...", "status": "left", "leftAt": "..." }
    ]
  }
}
```

**Erreurs**
- `404 SESSION_NOT_FOUND` / `404 PARTICIPANT_NOT_FOUND`
- `409 PARTICIPANT_ALREADY_LEFT`

---

### `POST /sos/sessions/:sessionId/trigger-sms`

Déclenche manuellement l'envoi de SMS d'urgence aux contacts de la session.

**Réponse 200**
```json
{
  "success": true,
  "sent": 2,
  "failed": 0
}
```

**Erreurs**
- `400 NO_CONTACTS_FOUND`
- `404 SESSION_NOT_FOUND`

---

### `POST /sos/sessions/:sessionId/send-notification`

Envoie une notification push/WebSocket à un participant spécifique.

**Body**
```json
{
  "targetUserId": "507f1f77bcf86cd799439012",
  "message": "Vérification de sécurité en cours."
}
```

> `message` : 1–500 caractères.

**Réponse 200**
```json
{
  "success": true,
  "message": "Notification envoyée."
}
```

**Erreurs**
- `400 INVALID_MESSAGE` / `400 MESSAGE_TOO_LONG`
- `404 SESSION_NOT_FOUND` / `404 PARTICIPANT_NOT_FOUND`

---

## Stockage

### `GET /users/storage`

Liste paginée de tous les utilisateurs avec leurs informations de stockage.

**Query params** : `page`, `limit` (défaut: 50)

**Réponse 200** : structure définie par `storageQuotaService.getAllUsersStorage()`

---

### `GET /users/:userId/storage`

Détails de stockage d'un utilisateur : quota, espace utilisé réel, liste des photos.

**Réponse 200**
```json
{
  "storage": {
    "quota": 5368709120,
    "used": 102400000,
    "available": 5266309120,
    "usedPercentage": 1.9
  },
  "actualStorageUsed": 98304000,
  "photos": [
    {
      "pointId": "507f1f77bcf86cd799439011",
      "pointName": "Épave du Dalton",
      "size": 2097152,
      "uploadedAt": "2026-02-10T08:00:00.000Z",
      "checksum": "abc123..."
    }
  ],
  "totalPhotos": 5,
  "filesOnDisk": 5
}
```

**Erreurs**
- `400` — ID utilisateur invalide

---

### `PATCH /users/:userId/quota`

Met à jour le quota de stockage d'un utilisateur.

**Body**
```json
{ "quotaGb": 10 }
```

> `quotaGb` doit être un nombre positif (en Go).

**Réponse 200**
```json
{
  "message": "Quota updated successfully",
  "storage": {
    "quota": 10737418240,
    "used": 102400000,
    "available": 10635018240,
    "usedPercentage": 0.95
  }
}
```

**Erreurs**
- `400` — ID invalide ou quota invalide

---

### `GET /storage/stats`

Statistiques globales de stockage : comparaison entre les données en base et le disque réel.

**Réponse 200**
```json
{
  "database": {
    "totalUsers": 1200,
    "totalUsed": 5368709120,
    "totalQuota": 6442450944,
    "usagePercentage": 83.3
  },
  "disk": {
    "totalStorageOnDisk": 5200000000,
    "totalPhotos": 4800
  },
  "difference": {
    "bytes": 168709120,
    "percentage": "3.14"
  }
}
```

---

### `POST /storage/cleanup`

Détecte et supprime optionnellement les fichiers orphelins (fichiers sur disque sans point correspondant en base).

**Body**
```json
{ "dryRun": true }
```

> `dryRun: true` (défaut) — analyse uniquement sans supprimer. `dryRun: false` — suppression effective + recalcul des quotas.

**Réponse 200**
```json
{
  "message": "Dry run completed - no files were deleted",
  "orphans": [
    { "userId": "...", "pointId": "...", "deleted": false }
  ],
  "totalOrphans": 3,
  "deleted": 0,
  "recalculated": 0,
  "usersAffected": 2,
  "recalculationDetails": []
}
```

---

## Codes d'erreur communs

| Code HTTP | Signification |
|-----------|---------------|
| 400 | Paramètre invalide ou manquant |
| 401 | Non authentifié |
| 403 | Accès interdit (non admin) |
| 404 | Ressource non trouvée |
| 409 | Conflit d'état (ex. session déjà active) |
| 500 | Erreur serveur interne |

Toutes les erreurs retournent un objet `{ "error": "...", "code": "..." }` (le champ `code` est présent sur les endpoints SOS, absent sur les autres).
