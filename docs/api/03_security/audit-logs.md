# Audit Logs

## Vue d'ensemble

Le système d'audit logs enregistre toutes les actions sensibles effectuées sur l'API. Ces logs permettent de détecter les intrusions, reconstituer des incidents de sécurité et satisfaire aux exigences de conformité.

---

## Structure d'un AuditLog

### Modèle MongoDB

```typescript
interface AuditLog {
  _id: ObjectId;
  action: AuditAction; // Type d'action (enum)
  level: "info" | "warning" | "critical";
  userId: ObjectId | null; // null pour les actions non authentifiées
  targetId: ObjectId | null; // Entité cible (autre user, ressource, etc.)
  ip: string; // IP source
  userAgent: string; // User-Agent du client
  platform: "web" | "mobile" | "admin" | "system";
  details: Record<string, any>; // Contexte supplémentaire libre
  createdAt: Date; // Timestamp (indexé)
}
```

### Exemple de document

```json
{
  "_id": "64abc123def456789abc0001",
  "action": "LOGIN",
  "level": "info",
  "userId": "64abc123def456789abc0002",
  "targetId": null,
  "ip": "91.198.174.0",
  "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)...",
  "platform": "web",
  "details": {
    "email": "u***@example.com",
    "method": "password",
    "twoFactorUsed": true
  },
  "createdAt": "2026-03-18T14:30:00.000Z"
}
```

---

## Actions tracées

### Authentification

| Action              | Niveau  | Déclencheur                               |
| ------------------- | ------- | ----------------------------------------- |
| `LOGIN`             | info    | Connexion réussie                         |
| `LOGIN_FAILURE`     | warning | Échec de connexion (mauvais mot de passe) |
| `LOGIN_2FA_SUCCESS` | info    | Connexion 2FA réussie                     |
| `LOGIN_2FA_FAILURE` | warning | Code TOTP invalide                        |
| `LOGOUT`            | info    | Déconnexion                               |
| `LOGOUT_ALL`        | warning | Déconnexion de toutes les sessions        |
| `TOKEN_REFRESH`     | info    | Refresh token utilisé                     |
| `TOKEN_REVOKED`     | warning | Token révoqué (blacklist)                 |

### Compte utilisateur

| Action                   | Niveau   | Déclencheur                    |
| ------------------------ | -------- | ------------------------------ |
| `REGISTER`               | info     | Création de compte             |
| `EMAIL_VERIFIED`         | info     | Email vérifié                  |
| `PASSWORD_CHANGE`        | warning  | Changement de mot de passe     |
| `PASSWORD_RESET_REQUEST` | warning  | Demande de reset password      |
| `PASSWORD_RESET_SUCCESS` | warning  | Reset password effectué        |
| `ACCOUNT_DELETED`        | critical | Suppression de compte          |
| `ACCOUNT_SUSPENDED`      | critical | Suspension de compte (admin)   |
| `ACCOUNT_RESTORED`       | warning  | Restauration de compte (admin) |

### 2FA

| Action                           | Niveau  | Déclencheur                            |
| -------------------------------- | ------- | -------------------------------------- |
| `2FA_ENABLE`                     | warning | Activation de la 2FA                   |
| `2FA_DISABLE`                    | warning | Désactivation de la 2FA                |
| `2FA_RECOVERY_CODE_USED`         | warning | Code de récupération utilisé           |
| `2FA_RECOVERY_CODES_REGENERATED` | warning | Régénération des codes de récupération |

### Sécurité

| Action                          | Niveau   | Déclencheur                                      |
| ------------------------------- | -------- | ------------------------------------------------ |
| `PRIVILEGE_ESCALATION_ATTEMPT`  | critical | Token revendique isAdmin=true mais BDD dit false |
| `BLOCKED_DEVICE_ACCESS_ATTEMPT` | critical | Appareil bloqué tente d'accéder                  |
| `BLOCKED_IP_ACCESS_ATTEMPT`     | critical | IP bloquée tente d'accéder                       |
| `IP_AUTO_BLOCKED`               | critical | IP bloquée automatiquement (threat score)        |
| `IP_UNBLOCKED`                  | warning  | IP débloquée par admin                           |
| `MOBILE_RATE_LIMIT_TRIGGERED`   | warning  | Rate limit mobile déclenché                      |
| `SUSPICIOUS_ACTIVITY`           | warning  | Activité suspecte détectée                       |
| `CAPTCHA_FAILURE`               | warning  | Échec de vérification Turnstile                  |

### Administration

| Action                | Niveau   | Déclencheur                          |
| --------------------- | -------- | ------------------------------------ |
| `ADMIN_LOGIN`         | warning  | Connexion avec compte admin          |
| `ADMIN_USER_VIEW`     | info     | Admin consulte un profil utilisateur |
| `ADMIN_USER_SUSPEND`  | critical | Admin suspend un utilisateur         |
| `ADMIN_USER_DELETE`   | critical | Admin supprime un utilisateur        |
| `ADMIN_GRANT_ADMIN`   | critical | Admin élève un utilisateur en admin  |
| `ADMIN_REVOKE_ADMIN`  | critical | Admin retire les droits admin        |
| `ADMIN_EXPORT_DATA`   | warning  | Admin exporte des données            |
| `MAINTENANCE_ENABLE`  | critical | Mode maintenance activé              |
| `MAINTENANCE_DISABLE` | critical | Mode maintenance désactivé           |

---

## Niveaux de criticité

| Niveau     | Usage                                           | Exemples                                                         |
| ---------- | ----------------------------------------------- | ---------------------------------------------------------------- |
| `info`     | Actions normales du système                     | LOGIN, LOGOUT, EMAIL_VERIFIED                                    |
| `warning`  | Actions à surveiller, potentiellement sensibles | PASSWORD_CHANGE, 2FA_DISABLE, MOBILE_RATE_LIMIT                  |
| `critical` | Incidents de sécurité, actions irréversibles    | PRIVILEGE_ESCALATION_ATTEMPT, IP_AUTO_BLOCKED, ADMIN_GRANT_ADMIN |

---

## API de consultation

Toutes les routes d'audit sont protégées par :

- Authentification JWT (isAdmin requis)
- `adminLimiter` (60 req/min)

### Liste des logs

```
GET /api/v1/admin/audit/logs
Authorization: Bearer <admin_token>

Query parameters :
  userId     : string   - Filtrer par ID utilisateur
  action     : string   - Filtrer par type d'action
  level      : string   - Filtrer par niveau (info / warning / critical)
  platform   : string   - Filtrer par plateforme (web / mobile / admin)
  ip         : string   - Filtrer par IP source
  startDate  : ISO8601  - Début de la plage de dates
  endDate    : ISO8601  - Fin de la plage de dates
  page       : number   - Numéro de page (défaut: 1)
  limit      : number   - Résultats par page (défaut: 50, max: 200)
  sortBy     : string   - Champ de tri (défaut: createdAt)
  sortOrder  : asc|desc - Ordre de tri (défaut: desc)

Réponse :
{
  "data": [ ...AuditLog[] ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 1234,
    "totalPages": 25
  }
}
```

### Statistiques

```
GET /api/v1/admin/audit/stats
Authorization: Bearer <admin_token>

Query parameters :
  startDate  : ISO8601  - Début de la plage (défaut: -7j)
  endDate    : ISO8601  - Fin de la plage (défaut: maintenant)
  groupBy    : day|hour - Granularité temporelle (défaut: day)

Réponse :
{
  "total": 12543,
  "byLevel": {
    "info": 10200,
    "warning": 2100,
    "critical": 243
  },
  "byAction": {
    "LOGIN": 5000,
    "PRIVILEGE_ESCALATION_ATTEMPT": 3,
    ...
  },
  "timeline": [
    { "date": "2026-03-18", "count": 1823, "critical": 12 },
    ...
  ],
  "topIps": [
    { "ip": "91.198.174.0", "count": 234, "threatScore": 8 },
    ...
  ]
}
```

### Export CSV

```
GET /api/v1/admin/audit/export
Authorization: Bearer <admin_token>

Query parameters :
  Identiques à /logs (sans pagination)
  format : csv|json (défaut: csv)

Réponse :
  Content-Type: text/csv
  Content-Disposition: attachment; filename="audit_logs_2026-03-18.csv"

  id,action,level,userId,ip,platform,createdAt,...
  64abc...,LOGIN,info,64def...,91.198.174.0,web,2026-03-18T14:30:00Z,...
```

⚠️ L'export CSV est tracé dans les audit logs lui-même (`ADMIN_EXPORT_DATA`). Tout export de données sensibles est ainsi audité.

### Détail d'un log

```
GET /api/v1/admin/audit/logs/:id
Authorization: Bearer <admin_token>

Réponse :
{
  "_id": "64abc123def456789abc0001",
  "action": "PRIVILEGE_ESCALATION_ATTEMPT",
  "level": "critical",
  "userId": "64abc123def456789abc0002",
  "targetId": null,
  "ip": "91.198.174.0",
  "userAgent": "...",
  "platform": "web",
  "details": {
    "tokenIsAdmin": true,
    "dbIsAdmin": false,
    "jti": "a1b2c3d4-..."
  },
  "createdAt": "2026-03-18T14:30:00.000Z"
}
```

---

## Filtres disponibles — Récapitulatif

| Paramètre   | Type                       | Description                      | Exemple                           |
| ----------- | -------------------------- | -------------------------------- | --------------------------------- |
| `userId`    | ObjectId string            | Logs d'un utilisateur spécifique | `?userId=64abc...`                |
| `action`    | string (enum)              | Type d'action                    | `?action=LOGIN_FAILURE`           |
| `level`     | info\|warning\|critical    | Niveau de criticité              | `?level=critical`                 |
| `platform`  | web\|mobile\|admin\|system | Plateforme source                | `?platform=mobile`                |
| `ip`        | string                     | IP source                        | `?ip=91.198.174.0`                |
| `startDate` | ISO 8601                   | Début de plage de dates          | `?startDate=2026-03-01T00:00:00Z` |
| `endDate`   | ISO 8601                   | Fin de plage de dates            | `?endDate=2026-03-18T23:59:59Z`   |
| `page`      | number                     | Page courante                    | `?page=2`                         |
| `limit`     | number (max 200)           | Résultats par page               | `?limit=100`                      |

---

## Rétention des logs

Les audit logs sont conservés indéfiniment par défaut. Une politique de rétention peut être définie selon les exigences légales :

```typescript
// Exemple de purge des logs info > 90 jours
await AuditLog.deleteMany({
  level: "info",
  createdAt: { $lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
});
```

⚠️ Les logs de niveau `critical` ne doivent jamais être purgés automatiquement. Ils peuvent être requis pour des investigations légales.

---

## Index MongoDB recommandés

```javascript
// Index pour les requêtes fréquentes
db.auditlogs.createIndex({ createdAt: -1 });
db.auditlogs.createIndex({ userId: 1, createdAt: -1 });
db.auditlogs.createIndex({ action: 1, createdAt: -1 });
db.auditlogs.createIndex({ level: 1, createdAt: -1 });
db.auditlogs.createIndex({ ip: 1, createdAt: -1 });

// Index composé pour les filtres combinés courants
db.auditlogs.createIndex({ level: 1, action: 1, createdAt: -1 });
```
