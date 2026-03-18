# IP Blocking & Turnstile

## IP Blocking

### Vue d'ensemble

Le système de blocage IP est implémenté via le middleware `ipBlockCheckMiddleware`, appliqué à toutes les routes `/api`. Il utilise un modèle MongoDB `BlockedIps` pour persister les IPs bloquées et un système de **threat score** pour déclencher le blocage automatique.

---

## Architecture du système

```
Requête entrante → /api/*
         │
         ▼
ipBlockCheckMiddleware
         │
         ├─── Lecture IP source (CF-Connecting-IP / X-Forwarded-For / req.ip)
         │
         ├─── Lookup MongoDB : BlockedIps.findOne({ ip })
         │
         ├─── IP trouvée et blocage actif ?
         │         │
         │         ├── OUI → AuditLog (BLOCKED_IP_ACCESS_ATTEMPT)
         │         │          → 403 { error: 'IP_BLOCKED' }
         │         │
         │         └── NON → next()
         │
         └─── [Événements de sécurité] → incrementThreatScore(ip)
                   │
                   └── score >= SECURITY_AUTO_BLOCK_THRESHOLD
                             → auto-blocage (durée configurable)
                             → AuditLog (IP_AUTO_BLOCKED)
```

---

## Modèle BlockedIps (MongoDB)

```typescript
interface BlockedIp {
  ip: string; // Adresse IP (IPv4 ou IPv6)
  reason: string; // Motif du blocage
  blockedAt: Date; // Date de blocage
  expiresAt: Date | null; // null = blocage permanent
  threatScore: number; // Score de menace accumulé
  events: ThreatEvent[]; // Historique des événements
  blockedBy: "auto" | "admin"; // Blocage automatique ou manuel
  isActive: boolean; // Actif ou désactivé
}

interface ThreatEvent {
  type: string; // Type d'événement (LOGIN_FAILURE, etc.)
  timestamp: Date;
  details: string;
}
```

---

## Threat Score

### Principe

Chaque événement de sécurité suspect incrémente le **threat score** de l'IP source. Lorsque ce score dépasse le seuil configuré, le blocage automatique est déclenché.

### Événements et leur poids

| Événement               | Poids | Description                              |
| ----------------------- | ----- | ---------------------------------------- |
| `LOGIN_FAILURE`         | +1    | Échec d'authentification                 |
| `RATE_LIMIT_TRIGGERED`  | +2    | Rate limiter déclenché                   |
| `INVALID_TOKEN`         | +2    | Token JWT invalide ou malformé           |
| `BLOCKED_DEVICE_ACCESS` | +5    | Tentative d'accès depuis appareil bloqué |
| `PRIVILEGE_ESCALATION`  | +10   | Tentative d'escalade de privilèges       |
| `SUSPICIOUS_ACTIVITY`   | +3    | Activité anormale détectée               |
| `MOBILE_RATE_LIMIT`     | +3    | Rate limit mobile déclenché              |

### Seuil et durée

```
SECURITY_AUTO_BLOCK_THRESHOLD = 10  (configurable)
SECURITY_AUTO_BLOCK_HOURS     = 24  (configurable)
```

Lorsque `threatScore >= SECURITY_AUTO_BLOCK_THRESHOLD` :

1. L'IP est automatiquement bloquée
2. `expiresAt` est calculé : `now + SECURITY_AUTO_BLOCK_HOURS`
3. Un `AuditLog` de niveau `critical` est créé
4. L'événement `IP_AUTO_BLOCKED` est enregistré

---

## API Admin — Gestion des IPs bloquées

Toutes les routes d'administration des IPs sont protégées par :

- Authentification JWT (isAdmin requis)
- `adminLimiter` (60 req/min)

### Endpoints disponibles

| Méthode  | Route                                                | Description                   |
| -------- | ---------------------------------------------------- | ----------------------------- |
| `GET`    | `/api/v1/admin/security/blocked-ips`                 | Liste des IPs bloquées        |
| `GET`    | `/api/v1/admin/security/blocked-ips/:ip`             | Détail d'une IP bloquée       |
| `POST`   | `/api/v1/admin/security/blocked-ips`                 | Bloquer une IP manuellement   |
| `DELETE` | `/api/v1/admin/security/blocked-ips/:ip`             | Débloquer une IP              |
| `GET`    | `/api/v1/admin/security/threat-scores`               | Top IPs par threat score      |
| `POST`   | `/api/v1/admin/security/blocked-ips/:ip/reset-score` | Réinitialiser le threat score |

### Blocage manuel

```
POST /api/v1/admin/security/blocked-ips
Authorization: Bearer <admin_token>

{
  "ip": "192.168.1.100",
  "reason": "Activité suspecte détectée manuellement",
  "expiresAt": "2026-12-31T00:00:00Z",  // null pour blocage permanent
  "permanent": false
}
```

### Déblocage

```
DELETE /api/v1/admin/security/blocked-ips/192.168.1.100
Authorization: Bearer <admin_token>

→ Passe isActive à false
→ Conserve l'historique pour audit
→ AuditLog (IP_UNBLOCKED, userId de l'admin)
```

---

## Cloudflare Turnstile (CAPTCHA)

### Vue d'ensemble

[Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) est le mécanisme CAPTCHA utilisé sur les routes web sensibles. Il remplace reCAPTCHA et ne requiert généralement pas d'interaction de la part de l'utilisateur (challenge invisible).

### Routes protégées

| Route               | Méthode | Protection                   |
| ------------------- | ------- | ---------------------------- |
| `/auth/login`       | `POST`  | `verifyTurnstile` middleware |
| `/auth/register`    | `POST`  | `verifyTurnstile` middleware |
| `/users` (création) | `POST`  | `verifyTurnstile` middleware |

### Middleware `verifyTurnstile`

```typescript
// Flow de vérification
async function verifyTurnstile(req, res, next) {
  const token = req.body["cf-turnstile-response"];

  if (!token) {
    return res.status(400).json({ error: "CAPTCHA_REQUIRED" });
  }

  // Vérification auprès de l'API Cloudflare
  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      body: JSON.stringify({
        secret: process.env.TURNSTILE_SECRET_KEY,
        response: token,
        remoteip: req.ip,
      }),
    },
  );

  const data = await response.json();

  if (!data.success) {
    // Incrément threat score pour IP
    await incrementThreatScore(req.ip, "CAPTCHA_FAILURE", 2);
    return res.status(403).json({ error: "CAPTCHA_INVALID" });
  }

  next();
}
```

### Bypass en développement

```
BYPASS_CAPTCHA=true
```

Lorsque cette variable est définie à `true`, le middleware `verifyTurnstile` est court-circuité. Cela permet de tester les routes protégées sans avoir à intégrer Turnstile dans l'environnement de développement.

⚠️ Ne jamais définir `BYPASS_CAPTCHA=true` en production.

### Mobile — Pas de Turnstile

Les clients mobiles natifs n'utilisent pas Turnstile. La protection équivalente est assurée par le `mobileSecurityMiddleware` qui vérifie :

- Device fingerprint
- User-Agent spécifique à l'application
- Signature de requête (hmac)
- Certificate pinning côté client

---

## Variables d'environnement associées

| Variable                        | Obligatoire | Description                           | Exemple          |
| ------------------------------- | ----------- | ------------------------------------- | ---------------- |
| `TURNSTILE_SECRET_KEY`          | Oui (prod)  | Clé secrète Cloudflare Turnstile      | `0x4AAAAAAA...`  |
| `TURNSTILE_SITE_KEY`            | Oui (prod)  | Clé publique (intégration frontend)   | `0x4AAAAAAA...`  |
| `BYPASS_CAPTCHA`                | Non         | Désactiver Turnstile en dev           | `true` / `false` |
| `SECURITY_AUTO_BLOCK_THRESHOLD` | Non         | Seuil d'auto-blocage                  | `10`             |
| `SECURITY_AUTO_BLOCK_HOURS`     | Non         | Durée du blocage automatique (heures) | `24`             |
