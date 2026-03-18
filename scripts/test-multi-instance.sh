#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# SCRIPT DE TEST MULTI-INSTANCE - WEBSOCKET CLUSTERING
# ═══════════════════════════════════════════════════════════════════════════
# Ce script démarre plusieurs instances de l'API localement avec un load
# balancer Nginx pour tester le clustering WebSocket via Redis Pub/Sub.
# ═══════════════════════════════════════════════════════════════════════════

set -e

# Couleurs pour les logs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
NUM_INSTANCES=3
BASE_PORT=3000
NGINX_CONFIG="/tmp/qvarry-nginx-test.conf"
NGINX_PID_FILE="/tmp/qvarry-nginx.pid"
API_PIDS_FILE="/tmp/qvarry-api-pids.txt"

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  QVARRY API - TEST MULTI-INSTANCE (WEBSOCKET CLUSTERING)${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# FONCTION : Vérifier les prérequis
# ═══════════════════════════════════════════════════════════════════════════
check_prerequisites() {
    echo -e "${YELLOW}➤ Vérification des prérequis...${NC}"
    
    # Node.js
    if ! command -v node &> /dev/null; then
        echo -e "${RED}✗ Node.js n'est pas installé${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ Node.js installé : $(node --version)${NC}"
    
    # npm
    if ! command -v npm &> /dev/null; then
        echo -e "${RED}✗ npm n'est pas installé${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ npm installé : $(npm --version)${NC}"
    
    # Redis
    if ! command -v redis-cli &> /dev/null; then
        echo -e "${RED}✗ Redis CLI n'est pas installé${NC}"
        echo -e "${YELLOW}  Installez Redis : brew install redis (macOS) ou apt install redis (Linux)${NC}"
        exit 1
    fi
    
    # Tester connexion Redis
    if ! redis-cli ping &> /dev/null; then
        echo -e "${RED}✗ Redis ne répond pas${NC}"
        echo -e "${YELLOW}  Démarrez Redis : redis-server${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ Redis opérationnel${NC}"
    
    # Nginx (optionnel)
    if command -v nginx &> /dev/null; then
        NGINX_AVAILABLE=true
        echo -e "${GREEN}✓ Nginx installé : $(nginx -v 2>&1 | cut -d'/' -f2)${NC}"
    else
        NGINX_AVAILABLE=false
        echo -e "${YELLOW}⚠ Nginx non installé (mode sans load balancer)${NC}"
    fi
    
    # Fichier .env
    if [ ! -f ".env" ]; then
        echo -e "${RED}✗ Fichier .env manquant${NC}"
        echo -e "${YELLOW}  Copiez .env.example vers .env et configurez-le${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ Fichier .env trouvé${NC}"
    
    # Dépendances npm
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}⚠ node_modules manquant, installation...${NC}"
        npm install
    fi
    echo -e "${GREEN}✓ Dépendances npm présentes${NC}"
    
    # Build TypeScript
    if [ ! -d "dist" ]; then
        echo -e "${YELLOW}⚠ Build manquant, compilation...${NC}"
        npm run build
    fi
    echo -e "${GREEN}✓ Build TypeScript présent${NC}"
    
    echo ""
}

# ═══════════════════════════════════════════════════════════════════════════
# FONCTION : Générer la configuration Nginx
# ═══════════════════════════════════════════════════════════════════════════
generate_nginx_config() {
    echo -e "${YELLOW}➤ Génération de la configuration Nginx...${NC}"
    
    cat > "$NGINX_CONFIG" <<EOF
# Configuration Nginx temporaire pour test multi-instance
worker_processes auto;
pid $NGINX_PID_FILE;

events {
    worker_connections 1024;
}

http {
    upstream api_backend {
        ip_hash;  # Sticky sessions
$(for i in $(seq 1 $NUM_INSTANCES); do
    port=$((BASE_PORT + i - 1))
    echo "        server 127.0.0.1:$port max_fails=3 fail_timeout=10s;"
done)
    }

    map \$http_upgrade \$connection_upgrade {
        default upgrade;
        ''      close;
    }

    server {
        listen 8080;
        server_name localhost;

        location /ws {
            proxy_pass http://api_backend;
            proxy_http_version 1.1;
            
            # WebSocket upgrade
            proxy_set_header Upgrade \$http_upgrade;
            proxy_set_header Connection \$connection_upgrade;
            
            # Headers
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            
            # Timeouts pour WebSocket
            proxy_connect_timeout 7d;
            proxy_send_timeout 7d;
            proxy_read_timeout 7d;
            
            proxy_buffering off;
        }

        location / {
            proxy_pass http://api_backend;
            proxy_http_version 1.1;
            
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            
            proxy_connect_timeout 30s;
            proxy_send_timeout 30s;
            proxy_read_timeout 30s;
        }
    }
}
EOF

    echo -e "${GREEN}✓ Configuration Nginx générée : $NGINX_CONFIG${NC}"
    echo ""
}

# ═══════════════════════════════════════════════════════════════════════════
# FONCTION : Démarrer les instances API
# ═══════════════════════════════════════════════════════════════════════════
start_api_instances() {
    echo -e "${YELLOW}➤ Démarrage de $NUM_INSTANCES instances API...${NC}"
    
    # Nettoyer le fichier PID précédent
    > "$API_PIDS_FILE"
    
    for i in $(seq 1 $NUM_INSTANCES); do
        port=$((BASE_PORT + i - 1))
        log_file="logs/api-instance-$i.log"
        
        echo -e "${BLUE}  → Instance $i démarrant sur le port $port...${NC}"
        
        # Démarrer l'instance en arrière-plan
        PORT=$port NODE_ENV=development REDIS_PUBSUB_ENABLED=true node dist/server.js > "$log_file" 2>&1 &
        pid=$!
        
        # Sauvegarder le PID
        echo "$pid" >> "$API_PIDS_FILE"
        
        echo -e "${GREEN}    ✓ Instance $i démarrée (PID: $pid)${NC}"
        
        # Attendre que l'instance soit prête
        sleep 3
        
        # Vérifier le health check
        if curl -s "http://localhost:$port/health" > /dev/null 2>&1; then
            echo -e "${GREEN}    ✓ Health check OK${NC}"
        else
            echo -e "${RED}    ✗ Health check échoué${NC}"
            echo -e "${YELLOW}    Voir les logs : tail -f $log_file${NC}"
        fi
    done
    
    echo ""
}

# ═══════════════════════════════════════════════════════════════════════════
# FONCTION : Démarrer Nginx
# ═══════════════════════════════════════════════════════════════════════════
start_nginx() {
    if [ "$NGINX_AVAILABLE" = false ]; then
        echo -e "${YELLOW}⚠ Nginx non disponible, mode sans load balancer${NC}"
        echo -e "${YELLOW}  Accès direct aux instances : http://localhost:3000, 3001, 3002${NC}"
        echo ""
        return
    fi
    
    echo -e "${YELLOW}➤ Démarrage de Nginx...${NC}"
    
    # Tester la configuration
    if ! nginx -t -c "$NGINX_CONFIG" &> /dev/null; then
        echo -e "${RED}✗ Configuration Nginx invalide${NC}"
        nginx -t -c "$NGINX_CONFIG"
        exit 1
    fi
    
    # Démarrer Nginx
    nginx -c "$NGINX_CONFIG"
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Nginx démarré sur http://localhost:8080${NC}"
    else
        echo -e "${RED}✗ Échec du démarrage de Nginx${NC}"
        exit 1
    fi
    
    echo ""
}

# ═══════════════════════════════════════════════════════════════════════════
# FONCTION : Afficher les informations
# ═══════════════════════════════════════════════════════════════════════════
show_info() {
    echo -e "${GREEN}═══════════════════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  INSTANCES API DÉMARRÉES${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════════════════════════${NC}"
    echo ""
    
    for i in $(seq 1 $NUM_INSTANCES); do
        port=$((BASE_PORT + i - 1))
        echo -e "${BLUE}Instance $i :${NC}"
        echo -e "  URL  : http://localhost:$port"
        echo -e "  Logs : tail -f logs/api-instance-$i.log"
        echo ""
    done
    
    if [ "$NGINX_AVAILABLE" = true ]; then
        echo -e "${BLUE}Load Balancer (Nginx) :${NC}"
        echo -e "  URL  : http://localhost:8080"
        echo -e "  PID  : $(cat $NGINX_PID_FILE 2>/dev/null || echo 'N/A')"
        echo ""
    fi
    
    echo -e "${BLUE}Redis Pub/Sub :${NC}"
    echo -e "  Monitor : redis-cli MONITOR | grep websocket"
    echo ""
    
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}  TESTS DISPONIBLES${NC}"
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════════════════════${NC}"
    echo ""
    
    echo -e "${BLUE}1. Test Health Check :${NC}"
    if [ "$NGINX_AVAILABLE" = true ]; then
        echo -e "   curl http://localhost:8080/health"
    else
        echo -e "   curl http://localhost:3000/health"
    fi
    echo ""
    
    echo -e "${BLUE}2. Test WebSocket (wscat requis) :${NC}"
    echo -e "   npm install -g wscat"
    if [ "$NGINX_AVAILABLE" = true ]; then
        echo -e "   wscat -c ws://localhost:8080/ws/notifications"
    else
        echo -e "   wscat -c ws://localhost:3000/ws/notifications"
    fi
    echo -e "   > {\"type\":\"auth\",\"token\":\"VOTRE_TOKEN\"}"
    echo ""
    
    echo -e "${BLUE}3. Monitor Redis Pub/Sub :${NC}"
    echo -e "   redis-cli MONITOR | grep -i websocket"
    echo ""
    
    echo -e "${BLUE}4. Logs en temps réel :${NC}"
    echo -e "   tail -f logs/api-instance-*.log"
    echo ""
    
    echo -e "${GREEN}═══════════════════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  Pour arrêter toutes les instances : ./scripts/test-multi-instance.sh stop${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════════════════════════${NC}"
    echo ""
}

# ═══════════════════════════════════════════════════════════════════════════
# FONCTION : Arrêter toutes les instances
# ═══════════════════════════════════════════════════════════════════════════
stop_all() {
    echo -e "${YELLOW}➤ Arrêt de toutes les instances...${NC}"
    
    # Arrêter Nginx
    if [ -f "$NGINX_PID_FILE" ]; then
        nginx_pid=$(cat "$NGINX_PID_FILE")
        if kill -0 "$nginx_pid" 2>/dev/null; then
            echo -e "${BLUE}  → Arrêt de Nginx (PID: $nginx_pid)...${NC}"
            kill "$nginx_pid"
            rm -f "$NGINX_PID_FILE"
            echo -e "${GREEN}    ✓ Nginx arrêté${NC}"
        fi
    fi
    
    # Arrêter les instances API
    if [ -f "$API_PIDS_FILE" ]; then
        while read -r pid; do
            if kill -0 "$pid" 2>/dev/null; then
                echo -e "${BLUE}  → Arrêt de l'instance API (PID: $pid)...${NC}"
                kill "$pid"
                echo -e "${GREEN}    ✓ Instance arrêtée${NC}"
            fi
        done < "$API_PIDS_FILE"
        rm -f "$API_PIDS_FILE"
    fi
    
    # Nettoyer les fichiers temporaires
    rm -f "$NGINX_CONFIG"
    
    echo -e "${GREEN}✓ Toutes les instances arrêtées${NC}"
    echo ""
}

# ═══════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════

# Gestion des arguments
if [ "$1" = "stop" ]; then
    stop_all
    exit 0
fi

# Piège pour nettoyer en cas d'interruption
trap stop_all EXIT INT TERM

# Exécution
check_prerequisites
generate_nginx_config
start_api_instances

if [ "$NGINX_AVAILABLE" = true ]; then
    start_nginx
fi

show_info

# Attendre indéfiniment (Ctrl+C pour arrêter)
echo -e "${YELLOW}Appuyez sur Ctrl+C pour arrêter toutes les instances...${NC}"
wait
