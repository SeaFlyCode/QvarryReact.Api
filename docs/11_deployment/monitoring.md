# Monitoring et observabilité

## Endpoints de santé

### GET /health

Endpoint public utilisé pour vérifier l'état général de l'API. C'est cet endpoint qui est sondé par le HEALTHCHECK Docker.

**Accès :** Public, aucune authentification requise.

**Réponse nominale (200) :**

```json
{
  "status": "ok",
  "uptime": 3600.52,
  "timestamp": "2026-01-15T10:30:00.000Z",
  "version": "1.4.2"
}
```

| Champ       | Type   | Description                               |
| ----------- | ------ | ----------------------------------------- |
| `status`    | string | `"ok"` si l'API répond correctement       |
| `uptime`    | number | Secondes depuis le démarrage du processus |
| `timestamp` | string | Horodatage ISO 8601 de la réponse         |
| `version`   | string | Version de l'API (depuis package.json)    |

### GET /health/sos

Endpoint public dédié à la vérification du service SOS. Permet de s'assurer que le sous-système d'urgence est opérationnel.

**Accès :** Public.

**Usage :** Peut être sondé indépendamment pour monitorer spécifiquement la disponibilité des fonctionnalités SOS.

### GET /metrics

Métriques détaillées de l'application.

**Accès :** Administrateurs uniquement (middleware admin requis).

**Usage :** Fournit des métriques applicatives avancées pour le monitoring interne.

---

## HEALTHCHECK Docker

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --spider http://localhost:3000/health || exit 1
```

| Paramètre      | Valeur | Description                                  |
| -------------- | ------ | -------------------------------------------- |
| `interval`     | 30s    | Fréquence des vérifications                  |
| `timeout`      | 10s    | Délai maximum pour une réponse               |
| `start-period` | 30s    | Délai initial (laisse le temps au démarrage) |
| `retries`      | 3      | Tentatives avant de passer en état UNHEALTHY |

**Commande npm :**

```bash
npm run health
# Équivalent à : curl -f http://localhost:3000/health
```

### États Docker possibles

```
STARTING  → pendant les 30 premières secondes
HEALTHY   → /health répond en moins de 10s
UNHEALTHY → 3 échecs consécutifs → intervention requise
```

---

## Système de logs — Winston

### Architecture des transports

```
Logger Winston
    │
    ├─► [Transport 1] DailyRotateFile → logs/error-YYYY-MM-DD.log
    │       └── Niveau : error + critical uniquement
    │
    ├─► [Transport 2] DailyRotateFile → logs/app-YYYY-MM-DD.log
    │       └── Niveau : info et supérieur
    │
    └─► [Transport 3] Console
            ├── Développement : texte coloré
            └── Production    : format JSON
```

### Configuration des fichiers rotatifs

**Fichier d'erreurs :**

| Paramètre   | Valeur                       |
| ----------- | ---------------------------- |
| Fichier     | `logs/error-YYYY-MM-DD.log`  |
| Niveau      | `error` (et `critical`)      |
| Format      | JSON                         |
| Taille max  | 50 MB                        |
| Rétention   | 30 jours                     |
| Compression | gzip (`zippedArchive: true`) |

**Fichier applicatif :**

| Paramètre   | Valeur                       |
| ----------- | ---------------------------- |
| Fichier     | `logs/app-YYYY-MM-DD.log`    |
| Niveau      | `info` et supérieur          |
| Format      | JSON                         |
| Taille max  | 100 MB                       |
| Rétention   | 14 jours                     |
| Compression | gzip (`zippedArchive: true`) |

---

## Niveaux de log

Les niveaux suivent une hiérarchie numérique (valeur basse = priorité haute) :

| Niveau     | Valeur | Usage                                                |
| ---------- | ------ | ---------------------------------------------------- |
| `critical` | 0      | Erreurs fatales, incidents SOS, défaillances système |
| `error`    | 1      | Erreurs applicatives récupérables                    |
| `warn`     | 2      | Avertissements — comportement anormal non bloquant   |
| `info`     | 3      | Événements normaux (démarrage, actions utilisateur)  |
| `http`     | 4      | Requêtes HTTP loggées via Morgan                     |
| `debug`    | 5      | Informations de débogage (développement uniquement)  |

### Niveau actif par environnement

| Environnement | Niveau minimum | Niveaux visibles            |
| ------------- | -------------- | --------------------------- |
| Production    | `info`         | critical, error, warn, info |
| Développement | `debug`        | Tous (critical → debug)     |

---

## Format des logs

### Format JSON (production)

```json
{
  "timestamp": "2026-01-15 10:30:45",
  "level": "info",
  "message": "Utilisateur connecté",
  "correlationId": "req-abc123",
  "userId": "507f1f77bcf86cd799439011",
  "ip": "192.168.1.1",
  "stack": "Error: ...\n    at ..."
}
```

Le champ `stack` est inclus automatiquement pour les objets `Error`.

### Format console (développement)

```
2026-01-15 10:30:45 [INFO] : Utilisateur connecté | correlationId=req-abc123
2026-01-15 10:30:46 [ERROR]: Mot de passe incorrect | userId=507f... ip=192.168.1.1
```

---

## Correlation ID

Chaque requête HTTP reçoit un identifiant unique injecté par le `correlationMiddleware`. Cet ID est automatiquement inclus dans tous les logs produits pendant le traitement de la requête, permettant de tracer l'ensemble des logs d'une même requête.

---

## Gestion du répertoire de logs

```typescript
const logDir = process.env.LOG_DIR || "logs";
fs.mkdirSync(logDir, { recursive: true }); // Créé automatiquement si absent
```

**En Docker :** Le répertoire `/app/logs` est défini via `LOG_DIR`. Il est recommandé de monter ce chemin comme volume :

```bash
docker run -v /host/logs:/app/logs docker.matheovieilleville.fr/qvarry-api:latest
```

---

## Sanitisation automatique des logs

Toutes les métadonnées passent par `sanitizeLogData()` avant d'être écrites. Les clés suivantes sont automatiquement remplacées par `"[REDACTED]"` :

```
password          token             secret
authorization     cookie            jwt
apikey            access_token      refresh_token
bearer            credentials       auth
sessionid         privatekey        secretkey
```

Cette sanitisation est transparente et garantit qu'aucune donnée sensible n'est enregistrée dans les fichiers de log.
