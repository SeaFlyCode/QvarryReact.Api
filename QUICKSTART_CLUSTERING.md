# WebSocket Clustering - Quickstart Guide

## 🚀 Démarrage rapide (5 minutes)

### Prérequis

- Redis installé et démarré
- Node.js ≥ 16
- npm ≥ 8

### Étape 1 : Configuration

```bash
# Copier le fichier .env si pas déjà fait
cp .env.example .env

# Éditer .env et s'assurer que ces variables sont configurées :
# REDIS_ENABLED=true
# REDIS_PUBSUB_ENABLED=true
# REDIS_HOST=localhost
# REDIS_PORT=6379
```

### Étape 2 : Test en mode single-instance

```bash
# Build
npm run build

# Démarrer une instance
npm start

# Tester le health check
curl http://localhost:3000/health
```

✅ Votre API fonctionne en mode single-instance (comportement par défaut)

### Étape 3 : Test en mode multi-instance (clustering)

```bash
# Démarrer 3 instances + Nginx load balancer
./scripts/test-multi-instance.sh

# Vous verrez :
# ✓ Instance 1 démarrée (PID: 12345)
# ✓ Instance 2 démarrée (PID: 12346)
# ✓ Instance 3 démarrée (PID: 12347)
# ✓ Nginx démarré sur http://localhost:8080

# Tester via le load balancer
curl http://localhost:8080/health
```

### Étape 4 : Tester la synchronisation WebSocket

```bash
# Terminal 1 : Client WebSocket sur instance 1
wscat -c ws://localhost:3000/ws/notifications
> {"type":"auth","token":"VOTRE_TOKEN_JWT"}

# Terminal 2 : Client WebSocket sur instance 2
wscat -c ws://localhost:3001/ws/notifications
> {"type":"auth","token":"AUTRE_TOKEN_JWT"}

# Terminal 3 : Envoyer une notification depuis l'API
curl -X POST http://localhost:3000/api/notifications \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"message":"Test clustering"}'

# Les 2 clients WebSocket doivent recevoir la notification ✅
```

### Étape 5 : Monitor Redis Pub/Sub

```bash
# Dans un autre terminal
redis-cli MONITOR | grep -i websocket

# Vous devriez voir des messages comme :
# "PUBLISH" "websocket:notifications" "{\"instanceId\":\"api-1-abc\",\"payload\":{...}}"
```

### Étape 6 : Arrêter

```bash
# Arrêter toutes les instances
./scripts/test-multi-instance.sh stop
```

---

## 📋 Résumé de ce qui se passe

1. **Instance 1** reçoit un message WebSocket
2. **Instance 1** le traite et :
   - Le diffuse à ses clients locaux
   - Le **publie sur Redis Pub/Sub**
3. **Instance 2 et 3** reçoivent depuis Redis
4. **Instance 2 et 3** diffusent à leurs clients locaux

✅ Tous les clients reçoivent le message, peu importe l'instance à laquelle ils sont connectés !

---

## 🛠️ Configuration avancée

### Variables d'environnement

```bash
# Dans .env

# Activer/désactiver le clustering
REDIS_PUBSUB_ENABLED=true

# Délai entre reconnexions Redis (ms)
REDIS_PUBSUB_RECONNECT_DELAY=1000

# Nombre max de tentatives de reconnexion
REDIS_PUBSUB_MAX_RETRIES=10
```

### Mode debug

```bash
# Activer les logs debug
LOG_LEVEL=debug npm start

# Filtrer les logs Redis Pub/Sub
tail -f logs/combined.log | grep redis-pubsub
```

### Métriques

```bash
# Obtenir les métriques de clustering
curl http://localhost:3000/metrics \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  | jq '.redisPubSub'

# Exemple de réponse :
# {
#   "instanceId": "api-server-1-a3f7b2c4",
#   "enabled": true,
#   "connected": true,
#   "published": 1234,
#   "received": 987,
#   "errors": 0,
#   "subscribedChannels": 5,
#   "reconnectAttempts": 0
# }
```

---

## 📚 Documentation complète

- **Architecture et fonctionnement** : `docs/api/06_services/websocket-clustering.md`
- **Configuration load balancer** : `docs/deployment/load-balancer-config.md`
- **Résumé d'implémentation** : `IMPLEMENTATION_SUMMARY.md`

---

## ❓ FAQ

### Q: Est-ce que ça fonctionne sans Redis ?

**R:** Oui ! Si `REDIS_PUBSUB_ENABLED=false`, le système fonctionne en mode single-instance (comportement classique). Les WebSockets fonctionnent normalement, mais il n'y a pas de synchronisation entre instances.

### Q: Combien d'instances puis-je démarrer ?

**R:** Autant que vous voulez ! La seule limite est la capacité de votre Redis. En pratique, 3-10 instances suffisent pour la plupart des cas.

### Q: Quelle est la latence ajoutée par Redis Pub/Sub ?

**R:** Environ **5-10ms** en moyenne (vs <1ms en local). Négligeable pour les utilisateurs.

### Q: Que se passe-t-il si Redis tombe ?

**R:** Les instances continuent de fonctionner localement, mais la synchronisation entre instances est interrompue. Les clients connectés à la même instance communiquent normalement. La reconnexion automatique à Redis rétablit la synchronisation.

### Q: Est-ce compatible avec Redis Cluster ?

**R:** Oui ! Configurez `USE_REDIS_CLUSTER=true` dans .env et listez vos nodes dans `REDIS_CLUSTER_NODES`.

---

## 🐛 Problèmes courants

### Redis ne démarre pas

```bash
# macOS
brew services start redis

# Linux
sudo systemctl start redis

# Docker
docker run -d --name redis -p 6379:6379 redis:latest
```

### wscat n'est pas installé

```bash
npm install -g wscat
```

### Nginx n'est pas installé

```bash
# macOS
brew install nginx

# Linux
sudo apt install nginx

# Sans Nginx, accédez directement aux instances :
# http://localhost:3000, 3001, 3002
```

### Les messages ne se synchronisent pas

```bash
# 1. Vérifier que Redis fonctionne
redis-cli ping
# Doit répondre : PONG

# 2. Vérifier la configuration
cat .env | grep REDIS_PUBSUB_ENABLED
# Doit être : REDIS_PUBSUB_ENABLED=true

# 3. Vérifier les logs
tail -f logs/combined.log | grep "redis-pubsub"
# Doit voir : "Redis Pub/Sub connected successfully"
```

---

## 📞 Support

En cas de problème :

1. Consultez `docs/api/06_services/websocket-clustering.md` (section Troubleshooting)
2. Vérifiez les logs : `tail -f logs/combined.log`
3. Testez Redis : `redis-cli ping`
4. Contactez l'équipe DevOps : devops@qvarry.fr

---

**Prêt pour la production ?** Consultez `docs/deployment/load-balancer-config.md` pour le déploiement en production ! 🚀
