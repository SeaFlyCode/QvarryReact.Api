# Documentation API Admin - QvarryReact

## 📋 Table des matières

- [Authentification](#authentification)
- [📊 Statistiques](#-statistiques)
- [👥 Gestion des utilisateurs](#-gestion-des-utilisateurs)
- [📝 Logs d'audit](#-logs-daudit)
- [🔐 Sécurité avancée](#-sécurité-avancée)
- [🆘 SOS Mode - Administration](#-sos-mode---administration)
- [💾 Gestion du stockage](#-gestion-du-stockage)

---

## Authentification

**Toutes les routes admin nécessitent :**

1. **Authentification JWT** via :
   - Cookie `qvarry_session` (recommandé), OU
   - Header HTTP : `Authorization: Bearer <token>`

2. **Permissions administrateur** :
   - Le champ `is_admin` doit être `true` en base de données
   - Vérifié par le middleware `adminMiddleware`

### Codes d'erreur communs

| Code  | Description                                           |
| ----- | ----------------------------------------------------- |
| `401` | Token JWT manquant ou invalide                        |
| `403` | Utilisateur non autorisé (pas admin)                  |
| `404` | Ressource non trouvée                                 |
| `400` | Requête invalide (paramètres manquants ou incorrects) |
| `500` | Erreur serveur interne                                |

---

## 📊 STATISTIQUES

### GET /api/v1/admin/stats

Récupère les statistiques globales de la plateforme.

**Authentification** : JWT + Admin requis

**Query Parameters** : Aucun

**Cache** : 5 minutes (protection contre race conditions)

**Réponse (200)** :

```json
{
  "users": {
    "total": 1245,
    "verified": 1180,
    "blocked": 12,
    "admins": 3,
    "newLast30Days": 145,
    "newLast7Days": 28,
    "newToday": 5,
    "activeLast24h": 432,
    "activeLast7Days": 876
  },
  "content": {
    "points": {
      "total": 8542,
      "last30Days": 1234
    },
    "fiches": {
      "total": 3421,
      "last30Days": 456
    },
    "lists": {
      "total": 987
    }
  },
  "sharing": {
    "total": 245,
    "active": 120,
    "accepted": 89
  },
  "messaging": {
    "conversations": 567,
    "messages": 12345
  },
  "generatedAt": "2026-03-24T10:30:00.000Z"
}
```

**Erreurs** :

- `500` : Erreur lors du calcul des statistiques

**Exemple curl** :

```bash
curl -X GET https://api.qvarry.fr/api/v1/admin/stats \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### GET /api/v1/admin/stats/registrations

Récupère l'évolution des inscriptions jour par jour.

**Authentification** : JWT + Admin requis

**Query Parameters** :
| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `days` | number | 30 | Nombre de jours d'historique (min: 1, max: 365) |

**Réponse (200)** :

```json
{
  "registrations": [
    {
      "date": "2026-03-01",
      "count": 12
    },
    {
      "date": "2026-03-02",
      "count": 8
    }
  ],
  "days": 30
}
```

**Erreurs** :

- `500` : Erreur lors du calcul des statistiques

**Exemple curl** :

```bash
curl -X GET "https://api.qvarry.fr/api/v1/admin/stats/registrations?days=60" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### GET /api/v1/admin/stats/activity

Récupère l'évolution de l'activité (points et fiches créés) jour par jour.

**Authentification** : JWT + Admin requis

**Query Parameters** :
| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `days` | number | 30 | Nombre de jours d'historique (min: 1, max: 365) |

**Réponse (200)** :

```json
{
  "activity": [
    {
      "date": "2026-03-01",
      "points": 145,
      "fiches": 32
    },
    {
      "date": "2026-03-02",
      "points": 178,
      "fiches": 41
    }
  ],
  "days": 30
}
```

**Erreurs** :

- `500` : Erreur lors du calcul des statistiques

**Exemple curl** :

```bash
curl -X GET "https://api.qvarry.fr/api/v1/admin/stats/activity?days=90" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## 👥 GESTION DES UTILISATEURS

### GET /api/v1/admin/users

Liste les utilisateurs avec pagination, filtres et tri.

**Authentification** : JWT + Admin requis

**Query Parameters** :
| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `page` | number | 1 | Numéro de page |
| `limit` | number | 20 | Résultats par page (max: 100) |
| `search` | string | - | Recherche dans nom, prénom, email, pseudo (max: 100 caractères) |
| `is_blocked` | boolean | - | Filtrer par statut bloqué |
| `is_verified` | boolean | - | Filtrer par statut vérifié |
| `is_admin` | boolean | - | Filtrer par statut admin |
| `sort` | string | creation_date | Champ de tri (voir liste ci-dessous) |
| `order` | string | desc | Ordre : `asc` ou `desc` |

**Champs de tri autorisés** :

- `creation_date`, `last_connection`, `name`, `surname`, `email`, `_id`, `is_admin`, `is_blocked`, `is_verified`

**Réponse (200)** :

```json
{
  "users": [
    {
      "id": "507f1f77bcf86cd799439011",
      "name": "Jean",
      "surname": "Dupont",
      "pseudo": "jdupont",
      "email": "jean.dupont@example.com",
      "is_admin": false,
      "is_blocked": false,
      "is_verified": true,
      "is_admin_validated": true,
      "admin_validation_rejected": false,
      "creation_date": "2025-01-15T08:30:00.000Z",
      "last_connection": "2026-03-24T09:45:00.000Z",
      "blocked_at": null,
      "blocked_reason": null
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1245,
    "totalPages": 63
  }
}
```

**Erreurs** :

- `400` : Recherche trop longue (>100 caractères)
- `500` : Erreur lors de la récupération

**Exemple curl** :

```bash
curl -X GET "https://api.qvarry.fr/api/v1/admin/users?page=1&limit=50&is_blocked=false&sort=last_connection&order=desc" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### GET /api/v1/admin/users/pending

Liste les utilisateurs en attente de validation admin.

**Authentification** : JWT + Admin requis

**Query Parameters** :
| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `page` | number | 1 | Numéro de page |
| `limit` | number | 20 | Résultats par page (max: 100) |

**Réponse (200)** :

```json
{
  "users": [
    {
      "id": "507f1f77bcf86cd799439011",
      "name": "Marie",
      "surname": "Martin",
      "pseudo": "mmartin",
      "email": "marie.martin@example.com",
      "creation_date": "2026-03-23T14:20:00.000Z",
      "is_verified": true
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 15,
    "totalPages": 1
  }
}
```

**Erreurs** :

- `500` : Erreur lors de la récupération

---

### GET /api/v1/admin/users/pending/count

Compte le nombre d'utilisateurs en attente de validation.

**Authentification** : JWT + Admin requis

**Query Parameters** : Aucun

**Réponse (200)** :

```json
{
  "count": 15
}
```

**Erreurs** :

- `500` : Erreur lors du comptage

---

### GET /api/v1/admin/users/storage

Liste tous les utilisateurs avec leurs informations de stockage.

**Authentification** : JWT + Admin requis

**Query Parameters** :
| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `page` | number | 1 | Numéro de page |
| `limit` | number | 50 | Résultats par page |

**Réponse (200)** :

```json
{
  "users": [
    {
      "userId": "507f1f77bcf86cd799439011",
      "email": "user@example.com",
      "used": 52428800,
      "quota": 104857600,
      "percentUsed": 50,
      "lastUpdated": "2026-03-24T10:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 1245,
    "totalPages": 25
  }
}
```

**Erreurs** :

- `500` : Erreur lors de la récupération

---

### GET /api/v1/admin/users/:userId

Récupère les détails d'un utilisateur spécifique avec ses statistiques.

**Authentification** : JWT + Admin requis

**Path Parameters** :
| Paramètre | Type | Description |
|-----------|------|-------------|
| `userId` | ObjectId | ID MongoDB de l'utilisateur |

**Réponse (200)** :

```json
{
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "name": "Jean",
    "surname": "Dupont",
    "pseudo": "jdupont",
    "email": "jean.dupont@example.com",
    "is_admin": false,
    "is_blocked": false,
    "is_verified": true,
    "creation_date": "2025-01-15T08:30:00.000Z",
    "last_connection": "2026-03-24T09:45:00.000Z",
    "blocked_at": null,
    "blocked_reason": null,
    "contact_code": "ABC123"
  },
  "stats": {
    "points": 142,
    "fiches": 38,
    "lists": 12,
    "activeSessions": 2
  }
}
```

**Erreurs** :

- `400` : ID utilisateur invalide
- `404` : Utilisateur non trouvé
- `500` : Erreur lors de la récupération

**Exemple curl** :

```bash
curl -X GET https://api.qvarry.fr/api/v1/admin/users/507f1f77bcf86cd799439011 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### POST /api/v1/admin/users/:userId/block

Bloque un utilisateur et révoque toutes ses sessions actives.

**Authentification** : JWT + Admin requis

**Path Parameters** :
| Paramètre | Type | Description |
|-----------|------|-------------|
| `userId` | ObjectId | ID MongoDB de l'utilisateur à bloquer |

**Body Parameters** :

```typescript
{
  reason?: string  // Raison du blocage (optionnel)
}
```

**Restrictions** :

- Ne peut pas se bloquer soi-même
- Ne peut pas bloquer un autre administrateur

**Réponse (200)** :

```json
{
  "success": true,
  "message": "Utilisateur jean.dupont@example.com bloqué avec succès",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "jean.dupont@example.com",
    "is_blocked": true,
    "blocked_at": "2026-03-24T10:30:00.000Z",
    "blocked_reason": "Violation des conditions d'utilisation"
  }
}
```

**Erreurs** :

- `400` : ID invalide ou tentative de se bloquer soi-même
- `403` : Tentative de bloquer un administrateur
- `404` : Utilisateur non trouvé
- `500` : Erreur lors du blocage

**Log d'audit** : Action `ADMIN_BLOCK_USER` (level: warning)

---

### POST /api/v1/admin/users/:userId/unblock

Débloque un utilisateur.

**Authentification** : JWT + Admin requis

**Path Parameters** :
| Paramètre | Type | Description |
|-----------|------|-------------|
| `userId` | ObjectId | ID MongoDB de l'utilisateur à débloquer |

**Body Parameters** : Aucun

**Réponse (200)** :

```json
{
  "success": true,
  "message": "Utilisateur jean.dupont@example.com débloqué avec succès",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "jean.dupont@example.com",
    "is_blocked": false
  }
}
```

**Erreurs** :

- `400` : ID invalide ou utilisateur déjà débloqué
- `404` : Utilisateur non trouvé
- `500` : Erreur lors du déblocage

**Log d'audit** : Action `ADMIN_UNBLOCK_USER` (level: info)

---

### POST /api/v1/admin/users/:userId/promote

Promeut un utilisateur au rang d'administrateur.

**Authentification** : JWT + Admin requis

**Path Parameters** :
| Paramètre | Type | Description |
|-----------|------|-------------|
| `userId` | ObjectId | ID MongoDB de l'utilisateur à promouvoir |

**Body Parameters** : Aucun

**Restrictions** :

- L'utilisateur ne doit pas être déjà admin
- L'utilisateur ne doit pas être bloqué

**Réponse (200)** :

```json
{
  "success": true,
  "message": "jean.dupont@example.com est maintenant administrateur",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "jean.dupont@example.com",
    "is_admin": true
  }
}
```

**Erreurs** :

- `400` : ID invalide, déjà admin ou utilisateur bloqué
- `404` : Utilisateur non trouvé
- `500` : Erreur lors de la promotion

**Log d'audit** : Action `ADMIN_PROMOTE_USER` (level: warning)

---

### POST /api/v1/admin/users/:userId/demote

Rétrograde un administrateur en utilisateur normal.

**Authentification** : JWT + Admin requis

**Path Parameters** :
| Paramètre | Type | Description |
|-----------|------|-------------|
| `userId` | ObjectId | ID MongoDB de l'admin à rétrograder |

**Body Parameters** : Aucun

**Restrictions** :

- Ne peut pas se rétrograder soi-même
- Doit rester au moins 1 administrateur sur la plateforme

**Réponse (200)** :

```json
{
  "success": true,
  "message": "jean.dupont@example.com n'est plus administrateur",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "jean.dupont@example.com",
    "is_admin": false
  }
}
```

**Erreurs** :

- `400` : ID invalide, tentative de se rétrograder soi-même, ou dernier admin
- `404` : Utilisateur non trouvé
- `500` : Erreur lors de la rétrogradation

**Log d'audit** : Action `ADMIN_DEMOTE_USER` (level: warning)

---

### POST /api/v1/admin/users/:userId/force-logout

Force la déconnexion de toutes les sessions actives d'un utilisateur.

**Authentification** : JWT + Admin requis

**Path Parameters** :
| Paramètre | Type | Description |
|-----------|------|-------------|
| `userId` | ObjectId | ID MongoDB de l'utilisateur |

**Body Parameters** : Aucun

**Réponse (200)** :

```json
{
  "success": true,
  "message": "Toutes les sessions de jean.dupont@example.com ont été révoquées",
  "revokedSessions": 3
}
```

**Erreurs** :

- `400` : ID utilisateur invalide
- `404` : Utilisateur non trouvé
- `500` : Erreur lors de la déconnexion

**Log d'audit** : Action `ADMIN_FORCE_LOGOUT` (level: info)

---

### POST /api/v1/admin/users/:userId/reset-password

Réinitialise le mot de passe d'un utilisateur et lui envoie un email.

**Authentification** : JWT + Admin requis

**Path Parameters** :
| Paramètre | Type | Description |
|-----------|------|-------------|
| `userId` | ObjectId | ID MongoDB de l'utilisateur |

**Body Parameters** : Aucun

**Actions effectuées** :

1. Génération d'un token et code de réinitialisation (valide 1h)
2. Envoi d'un email à l'utilisateur avec le lien et code
3. Révocation de toutes les sessions actives

**Réponse (200)** :

```json
{
  "success": true,
  "message": "Un email de réinitialisation a été envoyé à jean.dupont@example.com"
}
```

**Erreurs** :

- `400` : ID utilisateur invalide
- `404` : Utilisateur non trouvé
- `500` : Erreur lors de la réinitialisation

**Log d'audit** : Action `ADMIN_RESET_PASSWORD` (level: warning)

---

### POST /api/v1/admin/users/:userId/approve

Approuve un compte utilisateur en attente de validation.

**Authentification** : JWT + Admin requis

**Path Parameters** :
| Paramètre | Type | Description |
|-----------|------|-------------|
| `userId` | ObjectId | ID MongoDB de l'utilisateur |

**Body Parameters** : Aucun

**Actions effectuées** :

1. Marque l'utilisateur comme validé
2. Envoie un email de confirmation à l'utilisateur

**Réponse (200)** :

```json
{
  "success": true,
  "message": "Le compte de Jean Dupont a été approuvé. Un email de confirmation a été envoyé."
}
```

**Erreurs** :

- `400` : ID invalide ou utilisateur déjà validé
- `404` : Utilisateur non trouvé
- `500` : Erreur lors de l'approbation

**Log d'audit** : Action `USER_APPROVED` (level: info)

---

### POST /api/v1/admin/users/:userId/reject

Refuse un compte utilisateur en attente de validation.

**Authentification** : JWT + Admin requis

**Path Parameters** :
| Paramètre | Type | Description |
|-----------|------|-------------|
| `userId` | ObjectId | ID MongoDB de l'utilisateur |

**Body Parameters** :

```typescript
{
  reason?: string  // Raison du refus (optionnel)
}
```

**Actions effectuées** :

1. Marque l'utilisateur comme refusé
2. Envoie un email de refus à l'utilisateur avec la raison

**Réponse (200)** :

```json
{
  "success": true,
  "message": "Le compte de Jean Dupont a été refusé. Un email a été envoyé."
}
```

**Erreurs** :

- `400` : ID invalide ou utilisateur déjà validé
- `404` : Utilisateur non trouvé
- `500` : Erreur lors du refus

**Log d'audit** : Action `USER_REJECTED` (level: warning)

---

## 📝 LOGS D'AUDIT

### GET /api/v1/admin/audit/logs

Récupère les logs d'audit avec filtres et pagination.

**Authentification** : JWT + Admin requis

**Query Parameters** :
| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `page` | number | 1 | Numéro de page |
| `limit` | number | 50 | Résultats par page (max: 200) |
| `userId` | ObjectId | - | Filtrer par ID utilisateur |
| `action` | string | - | Filtrer par action (voir liste ci-dessous) |
| `level` | string | - | Filtrer par niveau : `info`, `warning`, `error`, `critical` |
| `startDate` | ISO8601 | - | Date de début |
| `endDate` | ISO8601 | - | Date de fin |

**Actions autorisées** :

- `LOGIN`, `LOGOUT`, `REGISTER`, `PASSWORD_CHANGE`, `PASSWORD_RESET`
- `EMAIL_CHANGE`, `PROFILE_UPDATE`, `ACCOUNT_DELETE`
- `POINT_CREATE`, `POINT_UPDATE`, `POINT_DELETE`
- `FICHE_CREATE`, `FICHE_UPDATE`, `FICHE_DELETE`
- `LIST_CREATE`, `LIST_UPDATE`, `LIST_DELETE`
- `SHARE_CREATE`, `SHARE_ACCEPT`, `SHARE_REJECT`
- `ADMIN_ACTION`, `SECURITY_ALERT`

**Réponse (200)** :

```json
{
  "logs": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "userId": "507f191e810c19729de860ea",
      "action": "LOGIN",
      "level": "info",
      "ipAddress": "192.168.1.1",
      "userAgent": "Mozilla/5.0...",
      "timestamp": "2026-03-24T10:30:00.000Z",
      "details": {
        "loginMethod": "password",
        "deviceType": "desktop"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 12345,
    "totalPages": 247
  }
}
```

**Erreurs** :

- `500` : Erreur lors de la récupération

**Exemple curl** :

```bash
curl -X GET "https://api.qvarry.fr/api/v1/admin/audit/logs?level=error&limit=100&startDate=2026-03-01" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### GET /api/v1/admin/audit/stats

Récupère les statistiques des logs d'audit.

**Authentification** : JWT + Admin requis

**Query Parameters** : Aucun

**Réponse (200)** :

```json
{
  "byLevel": {
    "info": 8542,
    "warning": 234,
    "error": 45,
    "critical": 3
  },
  "topActions": [
    {
      "action": "LOGIN",
      "count": 2345
    },
    {
      "action": "POINT_CREATE",
      "count": 1234
    }
  ],
  "recentCritical": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "action": "SECURITY_ALERT",
      "level": "critical",
      "timestamp": "2026-03-24T09:15:00.000Z",
      "details": {}
    }
  ],
  "period": {
    "levelStats": "7 derniers jours",
    "actionStats": "24 dernières heures"
  }
}
```

**Erreurs** :

- `500` : Erreur lors du calcul des statistiques

---

### GET /api/v1/admin/audit/export

Exporte les logs d'audit au format JSON ou CSV.

**Authentification** : JWT + Admin requis

**Query Parameters** :
| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `format` | string | json | Format d'export : `json` ou `csv` |
| `startDate` | ISO8601 | - | Date de début |
| `endDate` | ISO8601 | - | Date de fin |
| `level` | string | - | Filtrer par niveau |
| `action` | string | - | Filtrer par action |
| `limit` | number | 10000 | Nombre max de logs (max: 50000) |

**Réponse (200)** :

- **Content-Type** : `application/json` ou `text/csv`
- **Content-Disposition** : `attachment; filename="audit-logs-2026-03-24.json"`
- **Transfer-Encoding** : `chunked` (streaming pour performance)

**Format JSON** : Tableau de logs
**Format CSV** : Headers + lignes séparées par virgules

**Erreurs** :

- `400` : Format invalide
- `500` : Erreur lors de l'export

**Log d'audit** : Action `AUDIT_LOGS_EXPORTED` (level: info)

**Exemple curl** :

```bash
curl -X GET "https://api.qvarry.fr/api/v1/admin/audit/export?format=csv&startDate=2026-03-01&limit=5000" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -o audit-logs.csv
```

---

## 🔐 SÉCURITÉ AVANCÉE

### GET /api/v1/admin/security/dashboard

Récupère les statistiques de sécurité pour le dashboard de monitoring.

**Authentification** : JWT + Admin requis

**Query Parameters** : Aucun

**Réponse (200)** :

```json
{
  "blockedIps": {
    "total": 145,
    "last24h": 12,
    "last7days": 34
  },
  "threatScores": {
    "high": 5,
    "medium": 23,
    "low": 117
  },
  "securityAlerts": {
    "critical": 2,
    "warning": 15,
    "total": 17
  },
  "recentAlerts": [
    {
      "type": "BRUTE_FORCE_ATTEMPT",
      "level": "critical",
      "ipAddress": "192.168.1.100",
      "timestamp": "2026-03-24T10:15:00.000Z"
    }
  ]
}
```

**Erreurs** :

- `500` : Erreur lors de la récupération

---

### GET /api/v1/admin/security/blocked-ips

Liste les adresses IP bloquées avec pagination.

**Authentification** : JWT + Admin requis

**Query Parameters** :
| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `page` | number | 1 | Numéro de page |
| `limit` | number | 50 | Résultats par page (max: 200) |

**Réponse (200)** :

```json
{
  "ips": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "ipAddress": "192.168.1.100",
      "reason": "Tentatives de connexion suspectes",
      "blockedAt": "2026-03-24T08:00:00.000Z",
      "blockedUntil": "2026-03-25T08:00:00.000Z",
      "blockedBy": "507f191e810c19729de860ea",
      "permanent": false,
      "attemptCount": 15
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 145,
    "totalPages": 3
  }
}
```

**Erreurs** :

- `500` : Erreur lors de la récupération

---

### POST /api/v1/admin/security/block-ip

Bloque manuellement une adresse IP.

**Authentification** : JWT + Admin requis

**Body Parameters** :

```typescript
{
  ipAddress: string        // Adresse IP à bloquer (IPv4 ou IPv6)
  reason: string           // Raison du blocage
  durationHours?: number   // Durée en heures (optionnel, permanent si non spécifié)
}
```

**Validation IP** :

- Format IPv4 : `xxx.xxx.xxx.xxx`
- Format IPv6 : `xxxx:xxxx:xxxx:xxxx:xxxx:xxxx:xxxx:xxxx`
- Localhost : `::1` ou `::ffff:xxx.xxx.xxx.xxx`

**Réponse (200)** :

```json
{
  "success": true,
  "message": "IP 192.168.1.100 bloquée avec succès",
  "blockedIp": {
    "_id": "507f1f77bcf86cd799439011",
    "ipAddress": "192.168.1.100",
    "reason": "Activité suspecte détectée",
    "blockedAt": "2026-03-24T10:30:00.000Z",
    "blockedUntil": "2026-03-25T10:30:00.000Z",
    "permanent": false
  }
}
```

**Erreurs** :

- `400` : IP ou raison manquante, ou format d'IP invalide
- `500` : Erreur lors du blocage

**Log d'audit** : Action `ADMIN_IP_BLOCKED` (level: warning)

**Exemple curl** :

```bash
curl -X POST https://api.qvarry.fr/api/v1/admin/security/block-ip \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "ipAddress": "192.168.1.100",
    "reason": "Tentatives de brute force",
    "durationHours": 24
  }'
```

---

### DELETE /api/v1/admin/security/unblock-ip/:ipAddress

Débloque une adresse IP.

**Authentification** : JWT + Admin requis

**Path Parameters** :
| Paramètre | Type | Description |
|-----------|------|-------------|
| `ipAddress` | string | Adresse IP à débloquer |

**Réponse (200)** :

```json
{
  "success": true,
  "message": "IP 192.168.1.100 débloquée avec succès"
}
```

**Erreurs** :

- `400` : Adresse IP manquante
- `404` : IP non trouvée ou déjà débloquée
- `500` : Erreur lors du déblocage

**Log d'audit** : Action `ADMIN_IP_UNBLOCKED` (level: info)

**Exemple curl** :

```bash
curl -X DELETE https://api.qvarry.fr/api/v1/admin/security/unblock-ip/192.168.1.100 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### GET /api/v1/admin/security/threat-score/:ipAddress

Récupère le score de menace d'une adresse IP.

**Authentification** : JWT + Admin requis

**Path Parameters** :
| Paramètre | Type | Description |
|-----------|------|-------------|
| `ipAddress` | string | Adresse IP à analyser |

**Réponse (200)** :

```json
{
  "ipAddress": "192.168.1.100",
  "threatScore": {
    "ip": "192.168.1.100",
    "score": 75,
    "reasons": ["Multiple failed login attempts", "Rapid requests detected"],
    "lastUpdated": "2026-03-24T10:30:00.000Z"
  },
  "isBlocked": true,
  "blockReason": "Score de menace élevé",
  "blockedUntil": "2026-03-25T10:30:00.000Z"
}
```

**Score de menace** :

- `0-30` : Faible
- `31-60` : Moyen
- `61-100` : Élevé

**Erreurs** :

- `400` : Adresse IP manquante
- `500` : Erreur lors de la récupération

**Exemple curl** :

```bash
curl -X GET https://api.qvarry.fr/api/v1/admin/security/threat-score/192.168.1.100 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### POST /api/v1/admin/security/test-alert

Envoie une alerte de test à tous les administrateurs.

**Authentification** : JWT + Admin requis

**Body Parameters** : Aucun

**Actions effectuées** :

1. Génère une alerte de test
2. Notifie tous les administrateurs par email

**Réponse (200)** :

```json
{
  "success": true,
  "message": "Alerte de test envoyée à tous les administrateurs"
}
```

**Erreurs** :

- `500` : Erreur lors de l'envoi

**Log d'audit** : Action `TEST_ALERT_SENT` (level: info)

**Exemple curl** :

```bash
curl -X POST https://api.qvarry.fr/api/v1/admin/security/test-alert \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## 🆘 SOS MODE - ADMINISTRATION

### GET /api/v1/admin/sos/dashboard

Récupère le dashboard de surveillance des sessions SOS.

**Authentification** : JWT + Admin requis

**Query Parameters** : Aucun

**Réponse (200)** :

```json
{
  "success": true,
  "data": {
    "activeSessions": 3,
    "totalToday": 12,
    "alertsPending": 1,
    "escalationsStage2": 2,
    "recentSessions": [
      {
        "id": "507f1f77bcf86cd799439011",
        "status": "active",
        "currentStage": 1,
        "participantCount": 2,
        "activatedAt": "2026-03-24T09:00:00.000Z",
        "expiresAt": "2026-03-24T11:00:00.000Z"
      }
    ]
  }
}
```

**Erreurs** :

- `401` : Non authentifié
- `500` : Erreur serveur

---

### GET /api/v1/admin/sos/active

Liste toutes les sessions SOS actives.

**Authentification** : JWT + Admin requis

**Query Parameters** : Aucun

**Réponse (200)** :

```json
{
  "success": true,
  "sessions": [
    {
      "id": "507f1f77bcf86cd799439011",
      "status": "active",
      "currentStage": 1,
      "activatedAt": "2026-03-24T09:00:00.000Z",
      "expiresAt": "2026-03-24T11:00:00.000Z",
      "expectedDuration": 120,
      "heartbeatCount": 8,
      "extensionCount": 0,
      "participants": [
        {
          "userId": "507f191e810c19729de860ea",
          "status": "active",
          "currentStage": 1,
          "joinedAt": "2026-03-24T09:00:00.000Z",
          "lastHeartbeat": "2026-03-24T10:15:00.000Z"
        }
      ],
      "location": {
        "lat": 48.8566,
        "lng": 2.3522,
        "siteName": "Plage de Biarritz",
        "zone": "Nord",
        "depth": 15
      }
    }
  ],
  "count": 3
}
```

**Erreurs** :

- `401` : Non authentifié
- `500` : Erreur serveur

---

### GET /api/v1/admin/sos/sessions/:sessionId

Récupère les détails complets d'une session SOS.

**Authentification** : JWT + Admin requis

**Path Parameters** :
| Paramètre | Type | Description |
|-----------|------|-------------|
| `sessionId` | ObjectId | ID de la session SOS |

**Réponse (200)** :

```json
{
  "success": true,
  "data": {
    "id": "507f1f77bcf86cd799439011",
    "status": "active",
    "currentStage": 1,
    "activatedAt": "2026-03-24T09:00:00.000Z",
    "expiresAt": "2026-03-24T11:00:00.000Z",
    "expectedDuration": 120,
    "heartbeatCount": 8,
    "extensionCount": 0,
    "resolvedAt": null,
    "resolvedBy": null,
    "participants": [
      {
        "userId": "507f191e810c19729de860ea",
        "status": "active",
        "currentStage": 1,
        "joinedAt": "2026-03-24T09:00:00.000Z",
        "lastHeartbeat": "2026-03-24T10:15:00.000Z",
        "escalationHistory": [
          {
            "fromStage": 0,
            "toStage": 1,
            "timestamp": "2026-03-24T09:30:00.000Z",
            "automatic": true
          }
        ]
      }
    ],
    "location": {
      "lat": 48.8566,
      "lng": 2.3522,
      "siteName": "Plage de Biarritz",
      "zone": "Nord",
      "depth": 15
    },
    "note": "Session de plongée standard",
    "adminActions": []
  }
}
```

**Erreurs** :

- `400` : ID de session manquant
- `401` : Non authentifié
- `404` : Session non trouvée
- `500` : Erreur serveur

---

### POST /api/v1/admin/sos/sessions/:sessionId/cancel

Annule/résout une session SOS (action admin).

**Authentification** : JWT + Admin requis

**Path Parameters** :
| Paramètre | Type | Description |
|-----------|------|-------------|
| `sessionId` | ObjectId | ID de la session SOS |

**Body Parameters** :

```typescript
{
  reason?: string  // Raison de l'annulation (optionnel)
}
```

**Réponse (200)** :

```json
{
  "success": true,
  "session": {
    "id": "507f1f77bcf86cd799439011",
    "status": "cancelled",
    "resolvedAt": "2026-03-24T10:30:00.000Z",
    "resolvedBy": "admin_507f191e810c19729de860ea",
    "participantCount": 2,
    "isGroupSession": true,
    "participants": [
      {
        "userId": "507f191e810c19729de860ea",
        "status": "left",
        "leftAt": "2026-03-24T10:30:00.000Z"
      }
    ]
  },
  "message": "Session annulée avec succès."
}
```

**Erreurs** :

- `400` : ID de session manquant
- `401` : Non authentifié
- `404` : Session non trouvée ou déjà terminée
- `500` : Erreur serveur

---

### GET /api/v1/admin/sos/history

Récupère l'historique des sessions SOS.

**Authentification** : JWT + Admin requis

**Query Parameters** :
| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `limit` | number | 50 | Nombre de résultats (max: 100) |
| `status` | string | - | Filtrer par statut : `active`, `completed`, `cancelled`, `escalated` |
| `userId` | ObjectId | - | Filtrer par ID utilisateur (créateur ou participant) |
| `participantId` | ObjectId | - | Alias pour `userId` |

**Réponse (200)** :

```json
{
  "success": true,
  "sessions": [
    {
      "id": "507f1f77bcf86cd799439011",
      "status": "completed",
      "currentStage": 0,
      "activatedAt": "2026-03-23T14:00:00.000Z",
      "expiresAt": "2026-03-23T16:00:00.000Z",
      "resolvedAt": "2026-03-23T15:45:00.000Z",
      "participantCount": 1,
      "heartbeatCount": 12,
      "extensionCount": 0
    }
  ],
  "count": 145,
  "filters": {
    "limit": 50,
    "status": null,
    "userId": null
  }
}
```

**Erreurs** :

- `401` : Non authentifié
- `500` : Erreur serveur

---

### GET /api/v1/admin/sos/stats

Récupère les statistiques globales des sessions SOS.

**Authentification** : JWT + Admin requis

**Query Parameters** :
| Paramètre | Type | Description |
|-----------|------|-------------|
| `startDate` | ISO8601 | Date de début (optionnel) |
| `endDate` | ISO8601 | Date de fin (optionnel) |

**Réponse (200)** :

```json
{
  "success": true,
  "data": {
    "totalSessions": 456,
    "activeSessions": 3,
    "completedSessions": 423,
    "cancelledSessions": 12,
    "escalatedSessions": 18,
    "byStage": {
      "stage0": 405,
      "stage1": 38,
      "stage2": 13
    },
    "averageDuration": 115,
    "totalParticipants": 589,
    "averageHeartbeats": 8.5,
    "period": {
      "start": "2026-01-01T00:00:00.000Z",
      "end": "2026-03-24T23:59:59.999Z"
    }
  }
}
```

**Erreurs** :

- `400` : Date de début ou fin invalide
- `401` : Non authentifié
- `500` : Erreur serveur

---

### POST /api/v1/admin/sos/sessions/:sessionId/heartbeat

Envoie un heartbeat pour un participant (action admin).

**Authentification** : JWT + Admin requis

**Path Parameters** :
| Paramètre | Type | Description |
|-----------|------|-------------|
| `sessionId` | ObjectId | ID de la session SOS |

**Body Parameters** :

```typescript
{
  userId: string; // ID du participant pour lequel envoyer le heartbeat
}
```

**Réponse (200)** :

```json
{
  "success": true,
  "session": {
    "id": "507f1f77bcf86cd799439011",
    "status": "active",
    "expiresAt": "2026-03-24T11:00:00.000Z",
    "heartbeatCount": 9
  }
}
```

**Erreurs** :

- `400` : ID de session ou ID utilisateur manquant
- `401` : Non authentifié
- `404` : Session ou participant non trouvé
- `500` : Erreur serveur

---

### POST /api/v1/admin/sos/sessions/:sessionId/extend

Prolonge la durée d'une session SOS (action admin).

**Authentification** : JWT + Admin requis

**Path Parameters** :
| Paramètre | Type | Description |
|-----------|------|-------------|
| `sessionId` | ObjectId | ID de la session SOS |

**Body Parameters** :

```typescript
{
  additionalMinutes: number; // Durée additionnelle (15-480 minutes)
}
```

**Réponse (200)** :

```json
{
  "success": true,
  "session": {
    "id": "507f1f77bcf86cd799439011",
    "status": "active",
    "expiresAt": "2026-03-24T12:00:00.000Z",
    "extensionCount": 1
  }
}
```

**Erreurs** :

- `400` : ID de session manquant ou durée invalide (hors 15-480 min)
- `401` : Non authentifié
- `404` : Session non trouvée
- `500` : Erreur serveur

---

### POST /api/v1/admin/sos/sessions/:sessionId/force-escalation

Force l'escalade d'un participant à un stage spécifique.

**Authentification** : JWT + Admin requis

**Path Parameters** :
| Paramètre | Type | Description |
|-----------|------|-------------|
| `sessionId` | ObjectId | ID de la session SOS |

**Body Parameters** :

```typescript
{
  userId: string; // ID du participant
  targetStage: number; // Stage cible : 0, 1 ou 2
}
```

**Stages SOS** :

- `0` : Normal (vert)
- `1` : Attention (orange)
- `2` : Urgence (rouge)

**Réponse (200)** :

```json
{
  "success": true,
  "session": {
    "id": "507f1f77bcf86cd799439011",
    "status": "active",
    "currentStage": 2
  },
  "participant": {
    "userId": "507f191e810c19729de860ea",
    "currentStage": 2,
    "escalationHistory": [
      {
        "fromStage": 0,
        "toStage": 1,
        "timestamp": "2026-03-24T09:30:00.000Z",
        "automatic": true
      },
      {
        "fromStage": 1,
        "toStage": 2,
        "timestamp": "2026-03-24T10:30:00.000Z",
        "automatic": false,
        "triggeredBy": "admin_507f191e810c19729de860ea"
      }
    ]
  }
}
```

**Erreurs** :

- `400` : ID de session, ID utilisateur manquant ou stage invalide
- `401` : Non authentifié
- `404` : Session ou participant non trouvé
- `409` : Participant déjà à ce stage ou supérieur
- `500` : Erreur serveur

---

### POST /api/v1/admin/sos/sessions/activate

Active une nouvelle session SOS pour un utilisateur (action admin).

**Authentification** : JWT + Admin requis

**Body Parameters** :

```typescript
{
  targetUserId: string        // ID de l'utilisateur cible
  expectedDuration: number    // Durée prévue en minutes (15-480)
  note?: string               // Note optionnelle
  lat?: number                // Latitude GPS
  lng?: number                // Longitude GPS
  siteName?: string           // Nom du site
  zone?: string               // Zone (ex: "Nord", "Sud-Est")
  depth?: number              // Profondeur en mètres
  participantIds?: string[]   // IDs des participants additionnels
}
```

**Réponse (201)** :

```json
{
  "success": true,
  "session": {
    "id": "507f1f77bcf86cd799439011",
    "status": "active",
    "activatedAt": "2026-03-24T10:30:00.000Z",
    "expiresAt": "2026-03-24T12:30:00.000Z",
    "participants": [
      {
        "userId": "507f191e810c19729de860ea",
        "status": "active",
        "currentStage": 0
      }
    ]
  }
}
```

**Erreurs** :

- `400` : ID utilisateur ou durée manquante/invalide
- `401` : Non authentifié
- `409` : Utilisateur a déjà une session active
- `500` : Erreur serveur

---

### POST /api/v1/admin/sos/sessions/:sessionId/confirm-safe

Confirme qu'un utilisateur est en sécurité et résout la session.

**Authentification** : JWT + Admin requis

**Path Parameters** :
| Paramètre | Type | Description |
|-----------|------|-------------|
| `sessionId` | ObjectId | ID de la session SOS |

**Body Parameters** :

```typescript
{
  reason?: string  // Raison optionnelle
}
```

**Réponse (200)** :

```json
{
  "success": true,
  "session": {
    "id": "507f1f77bcf86cd799439011",
    "status": "completed",
    "resolvedAt": "2026-03-24T10:30:00.000Z",
    "resolvedBy": "admin_507f191e810c19729de860ea",
    "participantCount": 2
  }
}
```

**Erreurs** :

- `400` : ID de session manquant
- `401` : Non authentifié
- `404` : Session non trouvée
- `500` : Erreur serveur

---

### POST /api/v1/admin/sos/sessions/:sessionId/add-participant

Ajoute un participant à une session SOS existante.

**Authentification** : JWT + Admin requis

**Path Parameters** :
| Paramètre | Type | Description |
|-----------|------|-------------|
| `sessionId` | ObjectId | ID de la session SOS |

**Body Parameters** :

```typescript
{
  targetUserId: string; // ID de l'utilisateur à ajouter
}
```

**Réponse (200)** :

```json
{
  "success": true,
  "session": {
    "id": "507f1f77bcf86cd799439011",
    "participantCount": 3,
    "participants": [
      {
        "userId": "507f191e810c19729de860ea",
        "status": "active",
        "currentStage": 0,
        "joinedAt": "2026-03-24T09:00:00.000Z"
      },
      {
        "userId": "507f1f77bcf86cd799439012",
        "status": "active",
        "currentStage": 0,
        "joinedAt": "2026-03-24T10:30:00.000Z"
      }
    ]
  }
}
```

**Erreurs** :

- `400` : ID de session ou ID utilisateur manquant
- `401` : Non authentifié
- `404` : Session ou utilisateur non trouvé
- `409` : Utilisateur déjà participant ou a déjà une session active
- `500` : Erreur serveur

---

### POST /api/v1/admin/sos/sessions/:sessionId/remove-participant

Retire un participant d'une session SOS.

**Authentification** : JWT + Admin requis

**Path Parameters** :
| Paramètre | Type | Description |
|-----------|------|-------------|
| `sessionId` | ObjectId | ID de la session SOS |

**Body Parameters** :

```typescript
{
  targetUserId: string; // ID de l'utilisateur à retirer
}
```

**Réponse (200)** :

```json
{
  "success": true,
  "session": {
    "id": "507f1f77bcf86cd799439011",
    "status": "active",
    "participantCount": 1,
    "participants": [
      {
        "userId": "507f191e810c19729de860ea",
        "status": "active",
        "leftAt": null
      },
      {
        "userId": "507f1f77bcf86cd799439012",
        "status": "left",
        "leftAt": "2026-03-24T10:30:00.000Z"
      }
    ]
  }
}
```

**Erreurs** :

- `400` : ID de session ou ID utilisateur manquant
- `401` : Non authentifié
- `404` : Session ou participant non trouvé
- `409` : Participant a déjà quitté la session
- `500` : Erreur serveur

---

### POST /api/v1/admin/sos/sessions/:sessionId/trigger-sms

Déclenche l'envoi de SMS d'urgence aux contacts d'un participant.

**Authentification** : JWT + Admin requis

**Path Parameters** :
| Paramètre | Type | Description |
|-----------|------|-------------|
| `sessionId` | ObjectId | ID de la session SOS |

**Body Parameters** : Aucun

**Actions effectuées** :

1. Récupère les contacts d'urgence des participants
2. Envoie des SMS d'alerte à tous les contacts
3. Log les envois réussis/échoués

**Réponse (200)** :

```json
{
  "success": true,
  "sent": 5,
  "failed": 1
}
```

**Erreurs** :

- `400` : ID de session manquant ou aucun contact trouvé
- `401` : Non authentifié
- `404` : Session non trouvée
- `500` : Erreur serveur

---

### POST /api/v1/admin/sos/sessions/:sessionId/send-notification

Envoie une notification personnalisée à un participant.

**Authentification** : JWT + Admin requis

**Path Parameters** :
| Paramètre | Type | Description |
|-----------|------|-------------|
| `sessionId` | ObjectId | ID de la session SOS |

**Body Parameters** :

```typescript
{
  targetUserId: string; // ID du participant
  message: string; // Message (max 500 caractères)
}
```

**Réponse (200)** :

```json
{
  "success": true,
  "message": "Notification envoyée."
}
```

**Erreurs** :

- `400` : ID de session, ID utilisateur ou message manquant/invalide
- `401` : Non authentifié
- `404` : Session ou participant non trouvé
- `500` : Erreur serveur

---

## 💾 GESTION DU STOCKAGE

### GET /api/v1/admin/users/:userId/storage

Récupère les détails de stockage d'un utilisateur spécifique.

**Authentification** : JWT + Admin requis

**Path Parameters** :
| Paramètre | Type | Description |
|-----------|------|-------------|
| `userId` | ObjectId | ID MongoDB de l'utilisateur |

**Réponse (200)** :

```json
{
  "storage": {
    "userId": "507f1f77bcf86cd799439011",
    "used": 52428800,
    "quota": 104857600,
    "percentUsed": 50,
    "lastUpdated": "2026-03-24T10:00:00.000Z"
  },
  "actualStorageUsed": 52430123,
  "photos": [
    {
      "pointId": "507f191e810c19729de860ea",
      "pointName": "Épave du Cap Ferret",
      "size": 2048576,
      "uploadedAt": "2026-03-20T14:30:00.000Z",
      "checksum": "a1b2c3d4e5f6..."
    }
  ],
  "totalPhotos": 25,
  "filesOnDisk": 25
}
```

**Erreurs** :

- `400` : ID utilisateur invalide
- `500` : Erreur lors de la récupération

---

### PATCH /api/v1/admin/users/:userId/quota

Met à jour le quota de stockage d'un utilisateur.

**Authentification** : JWT + Admin requis

**Path Parameters** :
| Paramètre | Type | Description |
|-----------|------|-------------|
| `userId` | ObjectId | ID MongoDB de l'utilisateur |

**Body Parameters** :

```typescript
{
  quotaGb: number; // Nouveau quota en Go (nombre positif)
}
```

**Réponse (200)** :

```json
{
  "message": "Quota updated successfully",
  "storage": {
    "userId": "507f1f77bcf86cd799439011",
    "used": 52428800,
    "quota": 209715200,
    "percentUsed": 25,
    "lastUpdated": "2026-03-24T10:30:00.000Z"
  }
}
```

**Erreurs** :

- `400` : ID invalide ou quota invalide (doit être un nombre positif)
- `500` : Erreur lors de la mise à jour

**Exemple curl** :

```bash
curl -X PATCH https://api.qvarry.fr/api/v1/admin/users/507f1f77bcf86cd799439011/quota \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"quotaGb": 2}'
```

---

### GET /api/v1/admin/storage/stats

Récupère les statistiques globales de stockage de la plateforme.

**Authentification** : JWT + Admin requis

**Query Parameters** : Aucun

**Réponse (200)** :

```json
{
  "database": {
    "totalUsers": 1245,
    "totalUsed": 65432098765,
    "totalQuota": 130000000000,
    "averageUsed": 52545678,
    "percentUsed": 50.33,
    "usersOverQuota": 3,
    "usersNearQuota": 45
  },
  "disk": {
    "totalStorageOnDisk": 65430000000,
    "totalPhotos": 12543
  },
  "difference": {
    "bytes": 2098765,
    "percentage": "0.03"
  }
}
```

**Notes** :

- `database` : Données en base de données MongoDB
- `disk` : Stockage réel sur le système de fichiers
- `difference` : Écart entre DB et disque (fichiers orphelins, etc.)

**Erreurs** :

- `500` : Erreur lors du calcul

---

### POST /api/v1/admin/storage/cleanup

Nettoie les fichiers orphelins (fichiers sans point correspondant).

**Authentification** : JWT + Admin requis

**Body Parameters** :

```typescript
{
  dryRun?: boolean  // Mode simulation (défaut: true)
}
```

**Actions effectuées** :

1. Scanne tous les fichiers sur le disque
2. Vérifie l'existence des points correspondants en base
3. Supprime les fichiers orphelins (si `dryRun: false`)
4. Recalcule le stockage utilisé pour les utilisateurs affectés

**Réponse (200)** :

```json
{
  "message": "Cleanup completed",
  "orphans": [
    {
      "userId": "507f1f77bcf86cd799439011",
      "pointId": "507f191e810c19729de860ea",
      "deleted": true
    }
  ],
  "totalOrphans": 12,
  "deleted": 12,
  "recalculated": 8,
  "usersAffected": 8,
  "recalculationDetails": [
    {
      "userId": "507f1f77bcf86cd799439011",
      "oldUsed": 52428800,
      "newUsed": 50331648
    }
  ]
}
```

**Modes** :

- `dryRun: true` : Simulation, aucune suppression
- `dryRun: false` : Suppression effective des orphelins

**Erreurs** :

- `500` : Erreur lors du nettoyage

**Exemple curl** :

```bash
# Mode simulation
curl -X POST https://api.qvarry.fr/api/v1/admin/storage/cleanup \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true}'

# Nettoyage réel
curl -X POST https://api.qvarry.fr/api/v1/admin/storage/cleanup \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": false}'
```

---

## 📌 Notes importantes

### Sécurité

1. **Toutes les routes** nécessitent JWT + permissions admin
2. **Validation stricte** des paramètres (whitelists, limites)
3. **Protection anti-injection** : regex escapés, ObjectId validés
4. **Rate limiting** : Cache 5 min pour stats, timeouts 5s sur queries
5. **Audit logging** : Toutes les actions admin sont loggées

### Performance

1. **Cache stats** : 5 minutes avec protection race condition
2. **Pagination** : Limites max (100-200 selon endpoint)
3. **Timeouts** : 5 secondes max sur les requêtes DB
4. **Streaming** : Export CSV/JSON en mode streaming (chunked)

### Données sensibles

1. **Email masqué** dans les logs : `j***@example.com`
2. **Données chiffrées** : nom, prénom, pseudo, email
3. **Pas de contenu utilisateur** : seuls les métadonnées/compteurs
4. **Hash emails** dans l'audit pour corrélation sans exposition

### Codes d'erreur standards

| Code  | Description                            |
| ----- | -------------------------------------- |
| `200` | Succès                                 |
| `201` | Ressource créée                        |
| `400` | Requête invalide                       |
| `401` | Non authentifié                        |
| `403` | Non autorisé (pas admin)               |
| `404` | Ressource non trouvée                  |
| `409` | Conflit (déjà existant, état invalide) |
| `500` | Erreur serveur                         |

---

**Version** : 1.0  
**Dernière mise à jour** : 24 mars 2026  
**Préfixe API** : `/api/v1/admin`  
**Environnement** : Production
