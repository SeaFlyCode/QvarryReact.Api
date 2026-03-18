# Service Audit

## Table des matières

- [Vue d'ensemble](#vue-densemble)
- [Interface de log](#interface-de-log)
- [Actions prédéfinies](#actions-prédéfinies)
- [Niveaux d'audit](#niveaux-daudit)
- [Utilisation dans le code](#utilisation-dans-le-code)
- [Modèle MongoDB AuditLog](#modèle-mongodb-auditlog)
- [Consultation des logs](#consultation-des-logs)

---

## Vue d'ensemble

Le service d'audit enregistre les événements de sécurité et les actions sensibles de l'API dans MongoDB. Ces logs sont distincts des logs applicatifs (Winston) : ils sont structurés, persistants et consultables par les administrateurs.

```
┌─────────────────────────────────────────────────────────┐
│                    auditService                         │
│                                                         │
│  auditService.log({                                     │
│    userId?,                                             │
│    action,       ← Actions prédéfinies                  │
│    level,        ← info | warning | critical            │
│    ipAddress?,                                          │
│    userAgent?,                                          │
│    details?,     ← Objet JSON libre                     │
│  })                                                     │
│         │                                               │
│         ▼                                               │
│  Persistance MongoDB (AuditLog)                         │
│  + Log Winston si level >= warning                      │
└─────────────────────────────────────────────────────────┘
```

---

## Interface de log

```typescript
interface AuditLogParams {
  userId?: string; // ID utilisateur concerné (optionnel si non authentifié)
  action: AuditAction; // Action prédéfinie (enum)
  level: AuditLevel; // info | warning | critical
  ipAddress?: string; // IP source de la requête
  userAgent?: string; // User-Agent de la requête
  details?: object; // Données supplémentaires contextuelles
}

await auditService.log({
  userId: req.user?.id,
  action: AuditAction.LOGIN,
  level: AuditLevel.INFO,
  ipAddress: req.ip,
  userAgent: req.headers["user-agent"],
  details: {
    platform: req.headers["x-platform"],
    deviceId: req.headers["x-device-id"],
  },
});
```

---

## Actions prédéfinies

### Authentification

| Action                    | Niveau par défaut | Description                    |
| ------------------------- | ----------------- | ------------------------------ |
| `LOGIN`                   | info              | Connexion réussie              |
| `LOGIN_FAILED`            | warning           | Tentative de connexion échouée |
| `LOGOUT`                  | info              | Déconnexion                    |
| `REGISTER`                | info              | Inscription                    |
| `EMAIL_VERIFIED`          | info              | Email vérifié                  |
| `PASSWORD_CHANGE`         | warning           | Changement de mot de passe     |
| `PASSWORD_RESET_REQUEST`  | info              | Demande de reset MDP           |
| `PASSWORD_RESET_COMPLETE` | warning           | Reset MDP effectué             |

### Double authentification (2FA)

| Action               | Niveau par défaut | Description                   |
| -------------------- | ----------------- | ----------------------------- |
| `2FA_ENABLE`         | warning           | 2FA activé                    |
| `2FA_DISABLE`        | warning           | 2FA désactivé                 |
| `2FA_VERIFY_SUCCESS` | info              | Code TOTP vérifié avec succès |
| `2FA_VERIFY_FAILED`  | warning           | Échec de vérification TOTP    |

### Sécurité et accès

| Action                          | Niveau par défaut | Description                                       |
| ------------------------------- | ----------------- | ------------------------------------------------- |
| `PRIVILEGE_ESCALATION_ATTEMPT`  | critical          | Tentative d'accès à des ressources non autorisées |
| `BLOCKED_DEVICE_ACCESS_ATTEMPT` | critical          | Appareil bloqué tente un accès                    |
| `RATE_LIMIT_EXCEEDED`           | warning           | Rate limit atteint                                |
| `TOKEN_BLACKLISTED`             | warning           | Token révoqué utilisé                             |
| `UNAUTHORIZED_ACCESS`           | warning           | Tentative d'accès non autorisée                   |
| `SUSPICIOUS_ACTIVITY`           | critical          | Activité suspecte détectée                        |

### Mobile et appareils

| Action                  | Niveau par défaut | Description                           |
| ----------------------- | ----------------- | ------------------------------------- |
| `DEVICE_REGISTERED`     | info              | Nouvel appareil enregistré            |
| `DEVICE_BLOCKED`        | critical          | Appareil bloqué par admin             |
| `MULTI_DEVICE_DETECTED` | warning           | Plus de 3 appareils depuis la même IP |
| `ATTESTATION_FAILED`    | warning           | Échec d'attestation d'appareil        |

### SOS

| Action                  | Niveau par défaut | Description                               |
| ----------------------- | ----------------- | ----------------------------------------- |
| `SOS_ACTIVATED`         | info              | Session SOS activée                       |
| `SOS_DEACTIVATED`       | info              | Session SOS résolue                       |
| `SOS_ESCALATION_STAGE1` | warning           | Escalade Stage 1 déclenchée               |
| `SOS_ESCALATION_STAGE2` | critical          | Escalade Stage 2 déclenchée (SMS envoyés) |
| `SOS_SMS_FAILED`        | critical          | Échec envoi SMS SOS Stage 2               |

### Administration

| Action             | Niveau par défaut | Description                        |
| ------------------ | ----------------- | ---------------------------------- |
| `ACCOUNT_APPROVED` | info              | Compte approuvé par admin          |
| `ACCOUNT_REJECTED` | info              | Compte refusé par admin            |
| `ADMIN_LOGIN`      | warning           | Connexion admin                    |
| `DATA_EXPORT`      | warning           | Export de données utilisateur      |
| `DATA_DELETION`    | warning           | Suppression de données utilisateur |

---

## Niveaux d'audit

| Niveau     | Valeur | Usage                                                            | Log Winston               |
| ---------- | ------ | ---------------------------------------------------------------- | ------------------------- |
| `info`     | 0      | Actions normales (connexion, inscription, etc.)                  | Non                       |
| `warning`  | 1      | Actions sensibles (changement MDP, 2FA, rate limit)              | Oui (warn)                |
| `critical` | 2      | Incidents de sécurité (tentatives malveillantes, SMS SOS échoué) | Oui (error) + email admin |

### Comportement selon le niveau

```
level = 'info'
  → Persistance MongoDB uniquement

level = 'warning'
  → Persistance MongoDB
  → Log Winston warn : [AUDIT WARNING] action details

level = 'critical'
  → Persistance MongoDB
  → Log Winston error : [AUDIT CRITICAL] action details
  → Email admin (template security-alert-admin.html)
```

---

## Utilisation dans le code

### Import

```typescript
import { auditService } from "../services/auditService";
import { AuditAction, AuditLevel } from "../types/audit";
```

### Exemples d'utilisation réels

```typescript
// Dans le controller de login
try {
  const user = await authService.login(email, password);

  await auditService.log({
    userId: user.id,
    action: AuditAction.LOGIN,
    level: AuditLevel.INFO,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
    details: {
      platform: req.headers["x-platform"],
      deviceId: req.headers["x-device-id"],
      twoFactorRequired: user.twoFactorEnabled,
    },
  });
} catch (error) {
  await auditService.log({
    action: AuditAction.LOGIN_FAILED,
    level: AuditLevel.WARNING,
    ipAddress: req.ip,
    details: { email, reason: error.message },
  });
}

// Dans le middleware verifyMobilePlatform (appareil bloqué)
await auditService.log({
  action: AuditAction.BLOCKED_DEVICE_ACCESS_ATTEMPT,
  level: AuditLevel.CRITICAL,
  ipAddress: req.ip,
  details: {
    deviceId: req.headers["x-device-id"],
    platform: req.headers["x-platform"],
    route: req.path,
  },
});

// Dans l'escalade SOS Stage 2
await auditService.log({
  userId: session.userId,
  action: AuditAction.SOS_ESCALATION_STAGE2,
  level: AuditLevel.CRITICAL,
  details: {
    sessionId: session.id,
    contactsAlerted: contacts.length,
    lastLocation: session.lastLocation,
    elapsedMinutes: elapsed,
  },
});
```

---

## Modèle MongoDB AuditLog

```typescript
interface AuditLog {
  _id: ObjectId;
  userId?: ObjectId; // Référence User (peut être null)
  action: string; // AuditAction enum value
  level: string; // 'info' | 'warning' | 'critical'
  ipAddress?: string; // Adresse IP source
  userAgent?: string; // User-Agent
  details?: object; // Données contextuelles JSON
  createdAt: Date; // Horodatage automatique
}
```

### Index MongoDB recommandés

```javascript
// Index pour les requêtes admin courantes
db.auditlogs.createIndex({ userId: 1, createdAt: -1 });
db.auditlogs.createIndex({ action: 1, createdAt: -1 });
db.auditlogs.createIndex({ level: 1, createdAt: -1 });
db.auditlogs.createIndex({ ipAddress: 1, createdAt: -1 });
db.auditlogs.createIndex({ createdAt: 1 }, { expireAfterSeconds: 7776000 }); // TTL 90 jours
```

---

## Consultation des logs

### Via l'interface admin

Les logs d'audit sont consultables depuis le panel d'administration avec les filtres suivants :

- Par `userId`
- Par `action`
- Par `level` (info/warning/critical)
- Par plage de dates (`createdAt`)
- Par `ipAddress`

### Exemple de requête MongoDB

```javascript
// Tous les events critiques des 7 derniers jours
db.auditlogs
  .find({
    level: "critical",
    createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
  })
  .sort({ createdAt: -1 });

// Toutes les connexions d'un utilisateur
db.auditlogs
  .find({
    userId: ObjectId("64a1b2c3d4e5f6789012345"),
    action: { $in: ["LOGIN", "LOGIN_FAILED", "LOGOUT"] },
  })
  .sort({ createdAt: -1 })
  .limit(50);
```

### Rétention des données

Les logs d'audit sont conservés **90 jours** (TTL MongoDB). Pour des besoins légaux ou de conformité, exporter les logs avant leur expiration ou augmenter le TTL.

---

_Voir aussi : [logger-service.md](logger-service.md) — [redis-sessions.md](redis-sessions.md)_
