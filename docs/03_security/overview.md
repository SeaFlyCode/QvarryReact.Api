# Vue d'ensemble de la sécurité

## Philosophie

L'API Qvarry applique une stratégie de **défense en profondeur** : chaque couche de sécurité est indépendante et complémentaire. La compromission d'une couche n'entraîne pas la compromission de l'ensemble du système.

Principes fondamentaux appliqués :

- **Moindre privilège** : chaque utilisateur, service et processus n'accède qu'aux ressources strictement nécessaires à son fonctionnement.
- **Défense en profondeur** : les contrôles de sécurité sont superposés. Un attaquant doit franchir plusieurs barrières indépendantes.
- **Échec sécurisé** : en cas d'erreur ou d'état inconnu, le système refuse l'accès plutôt que de l'accorder.
- **Zéro confiance** : aucune requête n'est considérée comme fiable par défaut, même en provenance du réseau interne.
- **Auditabilité** : toutes les actions sensibles sont enregistrées avec contexte (IP, user-agent, userId, timestamp).

---

## Couches de sécurité

```
┌─────────────────────────────────────────────────────────────────────┐
│                         REQUÊTE ENTRANTE                            │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  COUCHE 1 — RÉSEAU                                                  │
│  Cloudflare (DDoS, WAF, TLS termination)                           │
│  HSTS (2 ans, preload, includeSubDomains)                          │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  COUCHE 2 — HEADERS & CORS                                          │
│  Helmet (CSP, X-Frame-Options, X-Content-Type-Options, HSTS)       │
│  CORS (origines whitelist, credentials: true)                      │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  COUCHE 3 — RATE LIMITING                                           │
│  globalRateLimiter (1000 req/min)                                  │
│  Limiters spécifiques par route (auth, mobile, admin, ws…)         │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  COUCHE 4 — IP BLOCKING                                             │
│  ipBlockCheckMiddleware (MongoDB BlockedIps)                       │
│  Threat score par IP, auto-blocage configurable                    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  COUCHE 5 — CAPTCHA (Web uniquement)                                │
│  Cloudflare Turnstile (verifyTurnstile middleware)                 │
│  Routes : login, register                                          │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  COUCHE 6 — AUTHENTIFICATION JWT                                    │
│  Vérification token (signature, expiration, key version)           │
│  Blacklist Redis (JTI révoqués)                                    │
│  Validation session (JTI en Redis)                                 │
│  Vérification isAdmin en base (anti privilege escalation)          │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  COUCHE 7 — AUTORISATION                                            │
│  Vérification des rôles (isAdmin, ownership)                       │
│  Validation des paramètres (Zod / validators)                      │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  COUCHE 8 — DONNÉES                                                 │
│  Chiffrement AES-256-GCM (données sensibles, communications)       │
│  HMAC des emails (protection rainbow table)                        │
│  bcrypt des mots de passe (rounds = 12)                            │
│  RSA pour échanges de clés                                         │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  COUCHE 9 — AUDIT                                                   │
│  Enregistrement AuditLog (toutes actions sensibles)                │
│  Niveaux : info / warning / critical                               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Checklist de sécurité

### Authentification & Sessions

| Contrôle                      | Statut     | Détail                                     |
| ----------------------------- | ---------- | ------------------------------------------ |
| JWT signé avec clé versionnée | Implémenté | `kv` dans le payload, rotation jusqu'à V10 |
| Cookie HTTP-only (web)        | Implémenté | `qvarry_jwt`, SameSite=Strict              |
| Bearer token (mobile)         | Implémenté | Header `Authorization: Bearer <token>`     |
| Blacklist JTI Redis           | Implémenté | Vérification à chaque requête              |
| Validation session Redis      | Implémenté | JTI présent en session                     |
| Vérification isAdmin en BDD   | Implémenté | Anti privilege escalation                  |
| Expiration access token       | Implémenté | 15 minutes (configurable)                  |
| Expiration refresh token      | Implémenté | 48 heures (configurable)                   |
| Max sessions par utilisateur  | Implémenté | 5 sessions simultanées                     |

### 2FA

| Contrôle               | Statut     | Détail                      |
| ---------------------- | ---------- | --------------------------- |
| TOTP via `otpauth`     | Implémenté | RFC 6238                    |
| Secret chiffré en base | Implémenté | AES-256-GCM                 |
| Codes de récupération  | Implémenté | Hashés bcrypt               |
| Rate limiting 2FA      | Implémenté | 5 req / 5 min               |
| Flow temp token (web)  | Implémenté | Token court durée avant 2FA |

### Transport & Headers

| Contrôle               | Statut     | Détail                        |
| ---------------------- | ---------- | ----------------------------- |
| TLS obligatoire        | Implémenté | HSTS 2 ans, preload           |
| CSP configurée         | Implémenté | `defaultSrc 'self'`           |
| X-Frame-Options DENY   | Implémenté | Via Helmet                    |
| X-Content-Type-Options | Implémenté | `nosniff`                     |
| Permissions-Policy     | Implémenté | camera, microphone désactivés |
| CORS restrictif        | Implémenté | Whitelist par environnement   |

### Données

| Contrôle                   | Statut     | Détail                                    |
| -------------------------- | ---------- | ----------------------------------------- |
| Chiffrement AES-256-GCM    | Implémenté | Données sensibles utilisateurs            |
| Chiffrement communications | Implémenté | Clé dédiée `ENCRYPTION_KEY_COMMUNICATION` |
| Hash mots de passe bcrypt  | Implémenté | Rounds = 12                               |
| HMAC emails                | Implémenté | Protection rainbow table                  |
| RSA échanges de clés       | Implémenté | Chiffrement asymétrique                   |

### Infrastructure

| Contrôle                | Statut     | Détail                   |
| ----------------------- | ---------- | ------------------------ |
| Rate limiting global    | Implémenté | 1000 req/min prod        |
| Rate limiting par route | Implémenté | 17 limiters spécifiques  |
| IP blocking             | Implémenté | MongoDB + threat score   |
| Auto-blocage IP         | Implémenté | Seuil configurable       |
| Turnstile CAPTCHA (web) | Implémenté | Login, register          |
| Audit logs              | Implémenté | Toutes actions sensibles |

---

## Documents associés

- [Authentification JWT](./authentication.md)
- [2FA (TOTP)](./two-factor-auth.md)
- [Rate Limiting](./rate-limiting.md)
- [CORS & Helmet](./cors-helmet.md)
- [Chiffrement](./encryption.md)
- [IP Blocking & Turnstile](./ip-blocking.md)
- [Audit Logs](./audit-logs.md)
