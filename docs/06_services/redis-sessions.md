# Service Redis Sessions

## Table des matières

- [Vue d'ensemble](#vue-densemble)
- [Configuration](#configuration)
- [Modes de connexion](#modes-de-connexion)
- [Préfixes de clés Redis](#préfixes-de-clés-redis)
- [Fonctions disponibles](#fonctions-disponibles)
- [Fallback mémoire](#fallback-mémoire)
- [Politique de production](#politique-de-production)

---

## Vue d'ensemble

Le service Redis gère plusieurs aspects critiques de l'API :

- **Gestion des sessions** et blacklist de tokens JWT
- **Rate limiting mobile** (IP + DeviceID composite)
- **Synchronisation mobile** (état de sync par appareil)

```
┌────────────────────────────────────────────────────────┐
│                  redisService                          │
│                                                        │
│  createSession()         ← Sessions utilisateurs       │
│  validateSessionJti()    ← Vérification JTI tokens     │
│  blacklistToken()        ← Révocation de tokens        │
│  isTokenBlacklisted()    ← Vérification blacklist      │
│  getMobileRateLimit()    ← Lecture rate limit mobile   │
│  setMobileRateLimit()    ← Écriture rate limit mobile  │
└───────────────────────────┬────────────────────────────┘
                            │
                    ┌───────┴───────┐
                    │               │
              Redis Standalone   Redis Cluster
              (single node)      (production HA)
```

---

## Configuration

### Variables d'environnement

| Variable              | Description       | Défaut    | Requis en prod |
| --------------------- | ----------------- | --------- | -------------- |
| `REDIS_ENABLED`       | Active Redis      | `false`   | Oui (`true`)   |
| `REDIS_URL`           | URL de connexion  | —         | Oui            |
| `REDIS_TLS`           | Activer TLS       | `false`   | Recommandé     |
| `REDIS_CLUSTER`       | Mode cluster      | `false`   | Selon infra    |
| `REDIS_CLUSTER_NODES` | Noeuds du cluster | —         | Si cluster     |
| `REDIS_KEY_PREFIX`    | Préfixe global    | `qvarry:` | Non            |

### Exemples de configuration

```env
# Standalone (développement)
REDIS_ENABLED=true
REDIS_URL=redis://localhost:6379

# Standalone avec TLS (production)
REDIS_ENABLED=true
REDIS_URL=rediss://redis.qvarry.com:6380
REDIS_TLS=true

# Cluster Redis
REDIS_ENABLED=true
REDIS_CLUSTER=true
REDIS_CLUSTER_NODES=redis-node1:6379,redis-node2:6379,redis-node3:6379
REDIS_TLS=true
```

---

## Modes de connexion

### Mode Standalone

Connexion à un seul noeud Redis. Adapté pour le développement et les petites instances de production.

```
API Server → Redis (single node)
```

### Mode Cluster

Connexion à un cluster Redis avec plusieurs noeuds. Les données sont shardées automatiquement.

```
              ┌─────────────────┐
API Server ──▶│  Redis Cluster  │
              │                 │
              │  Node 1 (M)     │  Shard 0-5460
              │  Node 2 (M)     │  Shard 5461-10922
              │  Node 3 (M)     │  Shard 10923-16383
              │  Node 1R (R)    │  Replica Node 1
              │  Node 2R (R)    │  Replica Node 2
              │  Node 3R (R)    │  Replica Node 3
              └─────────────────┘
```

> ⚠️ En mode cluster, toutes les clés utilisées dans une même transaction MULTI/EXEC doivent être dans le même shard. Respecter les hash tags `{prefix}` si nécessaire.

---

## Préfixes de clés Redis

Toutes les clés sont préfixées pour éviter les collisions en cas de Redis partagé :

| Préfixe                  | Usage                              | TTL                              |
| ------------------------ | ---------------------------------- | -------------------------------- |
| `qvarry:session:`        | Sessions utilisateurs              | Durée de la session              |
| `qvarry:jti:`            | JTI des tokens JWT valides         | Durée du token                   |
| `qvarry:blacklist:`      | Tokens révoqués                    | Durée de vie résiduelle du token |
| `qvarry:mobile_rl:`      | Rate limit routes auth mobile      | 15 min (900s)                    |
| `qvarry:mobile_sync_rl:` | Rate limit routes sync mobile      | 15 min (900s)                    |
| `qvarry:ws_token:`       | Tokens temporaires WebSocket       | 5 min (300s)                     |
| `qvarry:device:`         | Informations appareil mobile       | 30 jours                         |
| `qvarry:sync_state:`     | État de synchronisation par device | 7 jours                          |

### Exemples de clés

```
qvarry:session:64a1b2c3d4e5f6789012345
qvarry:jti:eyJhbGci-jti-part
qvarry:blacklist:sha256(token)
qvarry:mobile_rl:sha256(192.168.1.42:550e8400-e29b-41d4-a716-446655440000)
qvarry:mobile_sync_rl:sha256(10.0.0.1:660f9511-f30c-52e5-b827-557766551111)
qvarry:ws_token:a1b2c3d4e5f6789012345
```

---

## Fonctions disponibles

### createSession(userId, sessionData)

Crée une nouvelle session utilisateur en Redis.

```typescript
await redisService.createSession(userId, {
  jti: "unique-token-id",
  deviceId: "550e8400-...",
  platform: "ios",
  createdAt: Date.now(),
  expiresAt: Date.now() + 15 * 60 * 1000, // 15 min
});
```

### validateSessionJti(jti)

Vérifie qu'un JTI est valide (non révoqué, non expiré).

```typescript
const isValid = await redisService.validateSessionJti(jti);
// true → token valide
// false → token invalide ou expiré
```

### blacklistToken(token, expiresIn)

Ajoute un token à la blacklist lors d'un logout ou révocation.

```typescript
// Lors du logout
await redisService.blacklistToken(accessToken, remainingTtlSeconds);
```

Le TTL est défini à la durée de vie **résiduelle** du token : inutile de conserver un token déjà expiré en blacklist.

### isTokenBlacklisted(token)

Vérifie si un token est dans la blacklist.

```typescript
const blacklisted = await redisService.isTokenBlacklisted(accessToken);
if (blacklisted) {
  return res.status(401).json({ error: "TOKEN_BLACKLISTED" });
}
```

### getMobileRateLimit(key)

Lit le compteur de rate limit pour une clé composite.

```typescript
const rateData = await redisService.getMobileRateLimit("sha256(ip:deviceId)");
// { count: 3, firstRequestAt: 1710756000000 }
```

### setMobileRateLimit(key, data, ttlSeconds)

Écrit/met à jour le compteur de rate limit.

```typescript
await redisService.setMobileRateLimit(
  "sha256(ip:deviceId)",
  { count: 4, firstRequestAt: 1710756000000 },
  900, // TTL 15 minutes
);
```

---

## Fallback mémoire

Si Redis est **indisponible** (connexion échouée ou `REDIS_ENABLED=false`) :

| Fonctionnalité   | Comportement fallback                   |
| ---------------- | --------------------------------------- |
| Sessions         | Stockage `Map` en mémoire Node.js       |
| Blacklist tokens | Stockage `Map` en mémoire               |
| Rate limiting    | Stockage `Map` en mémoire (non partagé) |

> ⚠️ Le fallback mémoire est **non partagé entre instances**. Dans un déploiement multi-instance (load balancer), le rate limiting ne sera pas coordonné entre les instances et la blacklist de tokens ne sera pas synchronisée.

### Log en cas de fallback

```
[REDIS] Redis indisponible - utilisation du fallback mémoire
[REDIS] ATTENTION : le rate limiting n'est pas partagé entre instances
```

---

## Politique de production

> ⚠️ `REDIS_ENABLED=true` est **obligatoire en production**. Si Redis n'est pas disponible au démarrage, le processus se termine immédiatement.

```typescript
// Au démarrage (index.ts)
if (process.env.NODE_ENV === "production" && !redisService.isConnected()) {
  logger.critical("[REDIS] Redis est requis en production. Arrêt du service.");
  process.exit(1);
}
```

### Checklist production Redis

- [ ] `REDIS_ENABLED=true`
- [ ] `REDIS_URL` configurée avec credentials
- [ ] `REDIS_TLS=true` pour les connexions distantes
- [ ] Mode cluster pour la haute disponibilité
- [ ] Politique d'éviction : `allkeys-lru` ou `volatile-lru`
- [ ] Persistence : `AOF` activé pour les sessions critiques
- [ ] Monitoring : métriques `connected_clients`, `used_memory`, `keyspace_hits`

---

_Voir aussi : [security-middleware.md](../05_mobile/security-middleware.md) — [audit-service.md](./audit-service.md)_
