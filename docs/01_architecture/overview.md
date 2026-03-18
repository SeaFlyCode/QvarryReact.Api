# Vue d'ensemble de l'API Qvarry

## Description générale

L'API Qvarry est le backend de l'application Qvarry, développée en Node.js/Express/TypeScript. Elle expose une API REST versionnée sous `/api/v1/` et des endpoints WebSocket temps réel. Elle gère l'authentification des utilisateurs web et mobiles, la gestion de fiches, listes et points, la messagerie chiffrée, le partage de données, les notifications push, un système SOS, ainsi que les opérations d'administration et de maintenance.

**Version** : 1.4.2  
**Port par défaut** : 3000  
**Préfixe API** : `/api/v1/`

---

## Architecture générale

```
┌──────────────────────────────────────────────────────────────────┐
│                          CLIENTS                                 │
│                                                                  │
│   ┌─────────────────┐          ┌──────────────────────────────┐  │
│   │  Web (React)    │          │  Mobile (iOS / Android)      │  │
│   │  Cookie HTTP-   │          │  Bearer Token (JWT)          │  │
│   │  only (JWT)     │          │  /api/v1/mobile/*            │  │
│   └────────┬────────┘          └──────────────┬───────────────┘  │
└────────────┼──────────────────────────────────┼──────────────────┘
             │  HTTPS                           │  HTTPS
             ▼                                  ▼
┌──────────────────────────────────────────────────────────────────┐
│                        QVARRY API                                │
│                   Node.js / Express v5                           │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                  Middleware Chain                            │ │
│  │  globalRateLimiter → correlationMiddleware → requestCount   │ │
│  │  → ipBlockCheck → helmet → cors → json → morgan             │ │
│  │  → cookieParser → routeRateLimiters → maintenanceMiddleware │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │  REST Routes │  │  WebSocket   │  │  Webhooks / Public   │   │
│  │  /api/v1/*   │  │  /ws/*       │  │  /webhooks/vonage    │   │
│  └──────┬───────┘  └──────┬───────┘  │  /public             │   │
│         │                 │          └──────────────────────┘   │
│  ┌──────▼─────────────────▼──────────────────────────────────┐  │
│  │              Controllers / Services                        │  │
│  └──────┬──────────────────────────────────────┬─────────────┘  │
└─────────┼──────────────────────────────────────┼────────────────┘
          │                                       │
          ▼                                       ▼
┌──────────────────────┐             ┌────────────────────────────┐
│     MongoDB Atlas    │             │    Services externes        │
│   (QvarryStorage)    │             │                            │
│   SSL/TLS activé     │             │  ┌──────────────────────┐  │
│   Pool : 50 (prod)   │             │  │  Redis (sessions,    │  │
│                      │             │  │  cache, rate limit)  │  │
└──────────────────────┘             │  └──────────────────────┘  │
                                     │  ┌──────────────────────┐  │
                                     │  │  Firebase FCM        │  │
                                     │  │  (push notifications)│  │
                                     │  └──────────────────────┘  │
                                     │  ┌──────────────────────┐  │
                                     │  │  Vonage SMS          │  │
                                     │  │  (alertes SOS)       │  │
                                     │  └──────────────────────┘  │
                                     │  ┌──────────────────────┐  │
                                     │  │  SMTP (Nodemailer)   │  │
                                     │  │  (emails transac.)   │  │
                                     │  └──────────────────────┘  │
                                     └────────────────────────────┘
```

---

## Domaines fonctionnels couverts

- **Authentification** : inscription, connexion, déconnexion, gestion des sessions, refresh tokens
- **Authentification à deux facteurs (2FA)** : TOTP via application, backup codes
- **Gestion des utilisateurs** : profil, paramètres, suppression de compte
- **Fiches** : création, lecture, mise à jour, suppression de fiches personnelles
- **Listes** : organisation de contenu en listes structurées
- **Points** : système de points/récompenses
- **Messagerie** : conversations chiffrées, messages temps réel via WebSocket
- **Contacts** : gestion des contacts, demandes de contact
- **Partage de données** : partage sécurisé de fiches/données entre utilisateurs
- **Notifications** : notifications in-app et push (Firebase FCM)
- **SOS** : système d'alerte d'urgence avec SMS (Vonage) et contacts d'urgence
- **Sécurité** : gestion des sessions, IPs bloquées, alertes de sécurité, audit logs
- **Administration** : gestion des utilisateurs, validation de comptes, supervision
- **Maintenance** : mode maintenance, contrôle des versions mobiles minimales
- **Mobile** : endpoints dédiés (auth, 2FA, synchronisation, SOS, push tokens)
- **Webhooks** : réception des delivery receipts Vonage

---

## Flux de requête type

```
1. Requête HTTP entrante
         │
         ▼
2. globalRateLimiter
   └─ Bloque si trop de requêtes toutes routes confondues
         │
         ▼
3. correlationMiddleware
   └─ Génère/propage un X-Correlation-ID pour le tracing
         │
         ▼
4. requestCount
   └─ Incrémente le compteur de requêtes (métriques)
         │
         ▼
5. ipBlockCheckMiddleware  (uniquement sur /api/*)
   └─ Vérifie si l'IP est bloquée en base (BlockedIps)
         │
         ▼
6. helmet
   └─ Applique les headers de sécurité (CSP, HSTS, X-Frame-Options, etc.)
         │
         ▼
7. cors
   └─ Vérifie l'origine autorisée (CLIENT_URL / FRONTEND_URL)
         │
         ▼
8. express.json({ limit: "1mb" })
   └─ Parse le body JSON, limite à 1 Mo
         │
         ▼
9. morgan
   └─ Log la requête HTTP (méthode, path, status, durée)
         │
         ▼
10. cookieParser
    └─ Parse les cookies HTTP-only (JWT web)
         │
         ▼
11. Rate limiters par route
    └─ Limites spécifiques selon la route (auth, fiches, messages…)
         │
         ▼
12. maintenanceMiddleware
    └─ Retourne 503 si mode maintenance actif (sauf admin)
         │
         ▼
13. Router → Controller → Service → Model (MongoDB)
         │
         ▼
14. Réponse JSON
```

---

## Endpoints de monitoring

### GET /health

Vérification de l'état général du serveur.

```
GET /health
Authorization : aucune

Réponse 200 :
{
  "status": "ok",
  "uptime": 3600,
  "timestamp": "2026-03-18T12:00:00.000Z"
}
```

### GET /health/sos

Vérification de l'état du sous-système SOS (Vonage, contacts d'urgence).

```
GET /health/sos
Authorization : aucune

Réponse 200 :
{
  "status": "ok",
  "sos": { ... }
}
```

### GET /metrics

Endpoint de métriques applicatives. Requiert une authentification administrateur.

```
GET /metrics
Authorization : JWT admin

Réponse 200 :
{
  "requestCount": 15420,
  "uptime": 3600,
  "memory": { ... },
  ...
}
```

> ⚠️ L'endpoint `/metrics` est protégé par le middleware `adminMiddleware`. Ne jamais l'exposer publiquement sans authentification.
