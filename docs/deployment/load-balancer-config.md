# Configuration Load Balancer pour WebSocket Clustering

Ce guide explique comment configurer un load balancer pour distribuer le trafic WebSocket entre plusieurs instances de l'API Qvarry.

## Table des matières

- [Architecture](#architecture)
- [Prérequis](#prérequis)
- [Configuration Nginx](#configuration-nginx)
- [Configuration HAProxy](#configuration-haproxy)
- [Configuration AWS ALB](#configuration-aws-alb)
- [Tests et Vérification](#tests-et-vérification)
- [Dépannage](#dépannage)

---

## Architecture

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│Load Balancer│ (Nginx/HAProxy/ALB)
│   (Sticky)  │
└──────┬──────┘
       │
       ├────────────┬────────────┐
       ▼            ▼            ▼
  ┌─────────┐ ┌─────────┐ ┌─────────┐
  │ API 1   │ │ API 2   │ │ API 3   │
  │ :3000   │ │ :3001   │ │ :3002   │
  └────┬────┘ └────┬────┘ └────┬────┘
       │           │           │
       └───────────┴───────────┘
                   │
                   ▼
            ┌─────────────┐
            │    Redis    │
            │   Pub/Sub   │
            └─────────────┘
```

### Points clés :

- **Sticky Sessions** : Recommandé pour les WebSockets (basé sur IP ou cookie)
- **Redis Pub/Sub** : Synchronise les messages entre instances
- **Health Checks** : Surveillance continue des instances

---

## Prérequis

### Variables d'environnement (chaque instance)

```bash
# Redis configuration (partagé entre toutes les instances)
REDIS_ENABLED=true
REDIS_HOST=redis-server
REDIS_PORT=6379
REDIS_PASSWORD=votre_mot_de_passe
REDIS_PUBSUB_ENABLED=true

# Port unique pour chaque instance
PORT=3000  # Instance 1
# PORT=3001  # Instance 2
# PORT=3002  # Instance 3
```

### Redis

Assurez-vous que Redis est accessible depuis toutes les instances :

```bash
# Test de connexion Redis
redis-cli -h redis-server -p 6379 -a votre_mot_de_passe ping
# Réponse attendue: PONG
```

---

## Configuration Nginx

### Configuration complète

```nginx
# /etc/nginx/nginx.conf

upstream api_backend {
    # Sticky sessions basées sur l'IP client
    ip_hash;

    # Liste des instances API
    server 127.0.0.1:3000 max_fails=3 fail_timeout=30s;
    server 127.0.0.1:3001 max_fails=3 fail_timeout=30s;
    server 127.0.0.1:3002 max_fails=3 fail_timeout=30s;
}

# Map pour gérer les upgrades WebSocket
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name api.qvarry.fr;

    # Redirection HTTPS en production
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.qvarry.fr;

    # Certificats SSL
    ssl_certificate /etc/nginx/ssl/api.qvarry.fr.crt;
    ssl_certificate_key /etc/nginx/ssl/api.qvarry.fr.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Logs
    access_log /var/log/nginx/api_access.log;
    error_log /var/log/nginx/api_error.log;

    # Health check endpoint (bypass load balancer)
    location /health {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        access_log off;
    }

    # WebSocket endpoints (avec timeouts longs)
    location /ws {
        proxy_pass http://api_backend;
        proxy_http_version 1.1;

        # WebSocket upgrade headers
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        # Headers standards
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts pour WebSocket (long-lived connections)
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;

        # Désactiver le buffering pour WebSocket
        proxy_buffering off;

        # Keep-alive
        proxy_set_header Connection "keep-alive";
    }

    # API REST endpoints
    location /api {
        proxy_pass http://api_backend;
        proxy_http_version 1.1;

        # Headers standards
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts REST (plus courts)
        proxy_connect_timeout 30s;
        proxy_send_timeout 30s;
        proxy_read_timeout 30s;

        # Cache control
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }
}
```

### Vérification et redémarrage

```bash
# Tester la configuration
sudo nginx -t

# Recharger Nginx
sudo systemctl reload nginx

# Vérifier les logs
sudo tail -f /var/log/nginx/api_error.log
```

---

## Configuration HAProxy

### Configuration complète

```haproxy
# /etc/haproxy/haproxy.cfg

global
    log /dev/log local0
    log /dev/log local1 notice
    chroot /var/lib/haproxy
    stats socket /run/haproxy/admin.sock mode 660 level admin
    stats timeout 30s
    user haproxy
    group haproxy
    daemon

    # SSL/TLS configuration
    ssl-default-bind-ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256
    ssl-default-bind-options ssl-min-ver TLSv1.2 no-tls-tickets

defaults
    log global
    mode http
    option httplog
    option dontlognull
    option forwardfor
    timeout connect 5000
    timeout client 86400000  # 24h pour WebSocket
    timeout server 86400000  # 24h pour WebSocket

# Frontend HTTPS
frontend api_frontend
    bind *:443 ssl crt /etc/haproxy/certs/api.qvarry.fr.pem

    # WebSocket detection
    acl is_websocket hdr(Upgrade) -i WebSocket
    acl is_websocket_path path_beg /ws

    # Routing
    use_backend api_websocket if is_websocket is_websocket_path
    default_backend api_backend

# Backend pour WebSocket (sticky sessions)
backend api_websocket
    balance source  # Sticky basé sur IP source

    # Health check WebSocket
    option httpchk GET /health HTTP/1.1\r\nHost:\ api.qvarry.fr

    # Serveurs
    server api1 127.0.0.1:3000 check inter 5s rise 2 fall 3
    server api2 127.0.0.1:3001 check inter 5s rise 2 fall 3
    server api3 127.0.0.1:3002 check inter 5s rise 2 fall 3

# Backend pour API REST (round-robin)
backend api_backend
    balance roundrobin

    # Health check REST
    option httpchk GET /health HTTP/1.1\r\nHost:\ api.qvarry.fr

    # Serveurs
    server api1 127.0.0.1:3000 check inter 5s rise 2 fall 3
    server api2 127.0.0.1:3001 check inter 5s rise 2 fall 3
    server api3 127.0.0.1:3002 check inter 5s rise 2 fall 3

# Stats page
listen stats
    bind *:8404
    stats enable
    stats uri /stats
    stats refresh 30s
    stats auth admin:votre_mot_de_passe
```

### Vérification et redémarrage

```bash
# Tester la configuration
sudo haproxy -c -f /etc/haproxy/haproxy.cfg

# Redémarrer HAProxy
sudo systemctl restart haproxy

# Voir les stats
# Ouvrir http://votre-serveur:8404/stats dans un navigateur
```

---

## Configuration AWS ALB

### 1. Créer un Target Group

```bash
# Target Group pour les instances API
aws elbv2 create-target-group \
  --name qvarry-api-targets \
  --protocol HTTP \
  --port 3000 \
  --vpc-id vpc-xxxxxxxx \
  --health-check-enabled \
  --health-check-path /health \
  --health-check-interval-seconds 30 \
  --health-check-timeout-seconds 5 \
  --healthy-threshold-count 2 \
  --unhealthy-threshold-count 3 \
  --target-type instance \
  --stickiness-enabled \
  --stickiness-type lb_cookie \
  --stickiness-duration-seconds 86400
```

### 2. Créer l'Application Load Balancer

```bash
aws elbv2 create-load-balancer \
  --name qvarry-api-alb \
  --subnets subnet-xxxxxxxx subnet-yyyyyyyy \
  --security-groups sg-xxxxxxxx \
  --scheme internet-facing \
  --type application \
  --ip-address-type ipv4
```

### 3. Configurer les règles de routage

```bash
# Listener HTTPS
aws elbv2 create-listener \
  --load-balancer-arn arn:aws:elasticloadbalancing:region:account-id:loadbalancer/app/qvarry-api-alb/xxxxx \
  --protocol HTTPS \
  --port 443 \
  --certificates CertificateArn=arn:aws:acm:region:account-id:certificate/xxxxx \
  --default-actions Type=forward,TargetGroupArn=arn:aws:elasticloadbalancing:region:account-id:targetgroup/qvarry-api-targets/xxxxx
```

### 4. Configuration des Timeouts (Important pour WebSocket)

Dans la console AWS ALB :

1. Sélectionner le Load Balancer
2. Aller dans "Attributes"
3. Modifier :
   - **Idle timeout** : 3600 secondes (1 heure minimum pour WebSocket)
   - **Enable HTTP/2** : Oui
   - **Enable deletion protection** : Oui (production)

### 5. Security Group pour ALB

```bash
# Autoriser HTTPS depuis Internet
aws ec2 authorize-security-group-ingress \
  --group-id sg-xxxxxxxx \
  --protocol tcp \
  --port 443 \
  --cidr 0.0.0.0/0

# Autoriser HTTP (redirection vers HTTPS)
aws ec2 authorize-security-group-ingress \
  --group-id sg-xxxxxxxx \
  --protocol tcp \
  --port 80 \
  --cidr 0.0.0.0/0
```

### 6. Security Group pour les instances API

```bash
# Autoriser le trafic depuis l'ALB uniquement
aws ec2 authorize-security-group-ingress \
  --group-id sg-yyyyyyyy \
  --protocol tcp \
  --port 3000 \
  --source-group sg-xxxxxxxx
```

---

## Tests et Vérification

### 1. Test de connectivité de base

```bash
# Test health check
curl http://api.qvarry.fr/health

# Réponse attendue :
{
  "status": "healthy",
  "timestamp": "2026-03-18T...",
  "uptime": 12345.67,
  "environment": "production",
  "version": "1.0.0"
}
```

### 2. Test WebSocket

```bash
# Installer wscat si nécessaire
npm install -g wscat

# Test connexion WebSocket notifications
wscat -c "wss://api.qvarry.fr/ws/notifications"

# Envoyer le message d'authentification
> {"type":"auth","token":"VOTRE_TOKEN_JWT"}

# Réponse attendue :
< {"type":"connected","message":"WebSocket notifications connecté avec succès","userId":"..."}
```

### 3. Test multi-instance

```bash
# Script de test pour vérifier le clustering
# Créer un fichier test-clustering.sh

#!/bin/bash

# Obtenir 2 tokens WebSocket
TOKEN1=$(curl -s -X POST http://api.qvarry.fr/api/auth/websocket-token \
  -H "Authorization: Bearer $JWT_TOKEN" \
  | jq -r .token)

TOKEN2=$(curl -s -X POST http://api.qvarry.fr/api/auth/websocket-token \
  -H "Authorization: Bearer $JWT_TOKEN" \
  | jq -r .token)

echo "Token 1: $TOKEN1"
echo "Token 2: $TOKEN2"

# Se connecter avec 2 clients (vont potentiellement sur des instances différentes)
# Client 1
wscat -c "wss://api.qvarry.fr/ws/notifications" &
PID1=$!

sleep 2

# Client 2
wscat -c "wss://api.qvarry.fr/ws/notifications" &
PID2=$!

# Attendre et observer les messages
sleep 30

# Nettoyer
kill $PID1 $PID2
```

### 4. Vérifier les logs Redis Pub/Sub

```bash
# Sur le serveur Redis
redis-cli -h redis-server -p 6379 -a votre_mot_de_passe

# Monitor les messages Pub/Sub en temps réel
MONITOR

# Vous devriez voir des messages comme :
# "PUBLISH" "websocket:notifications" "{\"instanceId\":\"hostname-xxxx\",\"messageId\":\"...\",\"payload\":{...}}"
```

### 5. Vérifier les métriques de chaque instance

```bash
# Instance 1
curl -s http://localhost:3000/metrics \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  | jq

# Instance 2
curl -s http://localhost:3001/metrics \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  | jq

# Comparer les uptime, requests, etc.
```

---

## Dépannage

### Problème : WebSocket ne se connecte pas

**Symptômes** :

- Erreur de connexion WebSocket
- Timeout après 5 secondes

**Solutions** :

1. Vérifier les timeouts du load balancer :

   ```bash
   # Nginx
   proxy_read_timeout 7d;

   # HAProxy
   timeout client 86400000
   timeout server 86400000
   ```

2. Vérifier les headers d'upgrade :

   ```bash
   # Nginx
   proxy_set_header Upgrade $http_upgrade;
   proxy_set_header Connection $connection_upgrade;
   ```

3. Vérifier le SSL/TLS :
   ```bash
   # Le WebSocket doit utiliser wss:// en production, pas ws://
   ```

### Problème : Les messages ne sont pas synchronisés entre instances

**Symptômes** :

- Client A (instance 1) envoie un message
- Client B (instance 2) ne le reçoit pas

**Solutions** :

1. Vérifier que Redis Pub/Sub est activé :

   ```bash
   # .env
   REDIS_PUBSUB_ENABLED=true
   ```

2. Vérifier la connexion Redis depuis chaque instance :

   ```bash
   redis-cli -h redis-server -p 6379 -a password ping
   ```

3. Vérifier les logs de l'instance :

   ```bash
   tail -f logs/combined.log | grep "redis-pubsub"
   ```

4. Vérifier les channels Redis :
   ```bash
   redis-cli -h redis-server -p 6379 -a password
   > PUBSUB CHANNELS
   # Devrait lister: websocket:notifications, websocket:messages:*, websocket:broadcast
   ```

### Problème : Sticky sessions ne fonctionnent pas

**Symptômes** :

- Les clients WebSocket changent d'instance fréquemment
- Déconnexions fréquentes

**Solutions** :

1. Nginx : Vérifier `ip_hash`

   ```nginx
   upstream api_backend {
       ip_hash;  # Important !
       server ...
   }
   ```

2. HAProxy : Vérifier `balance source`

   ```haproxy
   backend api_websocket
       balance source  # Important !
   ```

3. AWS ALB : Vérifier sticky cookies
   ```bash
   aws elbv2 modify-target-group-attributes \
     --target-group-arn ... \
     --attributes Key=stickiness.enabled,Value=true Key=stickiness.type,Value=lb_cookie
   ```

### Problème : Health checks échouent

**Symptômes** :

- Instances marquées "unhealthy"
- Trafic non routé vers les instances

**Solutions** :

1. Tester manuellement le health check :

   ```bash
   curl http://localhost:3000/health
   ```

2. Vérifier que le endpoint /health est accessible :

   ```bash
   # Ne doit PAS nécessiter d'authentification
   ```

3. Vérifier les timeouts du health check :

   ```bash
   # Nginx
   proxy_connect_timeout 30s;

   # HAProxy
   timeout check 5s
   ```

### Problème : Performance dégradée

**Symptômes** :

- Latence élevée
- Messages lents

**Solutions** :

1. Vérifier la latence Redis :

   ```bash
   redis-cli -h redis-server -p 6379 -a password --latency
   ```

2. Augmenter le nombre d'instances si nécessaire

3. Vérifier les métriques système :

   ```bash
   # CPU, RAM, Network
   top
   free -h
   netstat -i
   ```

4. Activer la compression :
   ```nginx
   # Nginx
   gzip on;
   gzip_types application/json;
   ```

---

## Checklist de déploiement

- [ ] Redis installé et accessible depuis toutes les instances
- [ ] `REDIS_PUBSUB_ENABLED=true` dans chaque .env
- [ ] Load balancer configuré avec sticky sessions
- [ ] Timeouts WebSocket configurés (≥ 1 heure)
- [ ] Headers d'upgrade WebSocket configurés
- [ ] Certificats SSL/TLS installés
- [ ] Health checks configurés sur `/health`
- [ ] Tests de connectivité WebSocket réussis
- [ ] Tests de synchronisation multi-instance réussis
- [ ] Monitoring activé (logs, métriques)
- [ ] Plan de rollback préparé

---

## Ressources

- [Documentation Nginx WebSocket Proxying](https://nginx.org/en/docs/http/websocket.html)
- [Documentation HAProxy WebSocket](https://www.haproxy.com/blog/websockets-load-balancing-with-haproxy/)
- [AWS ALB WebSocket Support](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-listeners.html)
- [Redis Pub/Sub Documentation](https://redis.io/docs/manual/pubsub/)

---

## Support

En cas de problème, consulter les logs :

```bash
# Logs API
tail -f logs/combined.log

# Logs Nginx
sudo tail -f /var/log/nginx/api_error.log

# Logs HAProxy
sudo tail -f /var/log/haproxy.log

# Logs Redis
redis-cli -h redis-server -p 6379 -a password
> CLIENT LIST
> INFO stats
```

Pour toute question, contacter l'équipe DevOps : devops@qvarry.fr
