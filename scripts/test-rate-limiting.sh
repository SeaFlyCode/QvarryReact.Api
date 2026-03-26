#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# SCRIPT DE TEST - RATE LIMITING DIFFÉRENCIÉ
# ═══════════════════════════════════════════════════════════════════════════
# Ce script teste les 3 niveaux de rate limiting
# Usage: ./test-rate-limiting.sh [BASE_URL] [ACCESS_TOKEN]
# ═══════════════════════════════════════════════════════════════════════════

set -e  # Exit on error

# Configuration
BASE_URL="${1:-http://localhost:3000}"
ACCESS_TOKEN="${2:-}"
DEVICE_ID="test-device-$(date +%s)"
PLATFORM="ios"

# Couleurs pour output
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ═══════════════════════════════════════════════════════════════════════════
# FONCTIONS UTILITAIRES
# ═══════════════════════════════════════════════════════════════════════════

print_header() {
  echo -e "\n${BLUE}═══════════════════════════════════════════════════════════════${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}\n"
}

print_success() {
  echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
  echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
  echo -e "${RED}✗${NC} $1"
}

print_info() {
  echo -e "${BLUE}ℹ${NC} $1"
}

# ═══════════════════════════════════════════════════════════════════════════
# TEST 1: VÉRIFIER LES HEADERS X-RateLimit-*
# ═══════════════════════════════════════════════════════════════════════════

test_rate_limit_headers() {
  local endpoint="$1"
  local expected_limit="$2"
  local level_emoji="$3"
  local level_name="$4"
  
  print_header "$level_emoji TEST: Headers Rate Limit - $level_name"
  print_info "Endpoint: $endpoint"
  print_info "Limite attendue: $expected_limit req/15min"
  
  # Headers requis
  local headers=()
  if [[ ! -z "$ACCESS_TOKEN" ]]; then
    headers+=(-H "Authorization: Bearer $ACCESS_TOKEN")
  fi
  if [[ "$endpoint" == *"/mobile/"* ]]; then
    headers+=(-H "X-Platform: $PLATFORM")
    headers+=(-H "X-Device-ID: $DEVICE_ID")
  fi
  
  # Faire une requête HEAD pour obtenir les headers
  response=$(curl -sI "$BASE_URL$endpoint" "${headers[@]}" 2>&1)
  
  # Extraire les headers X-RateLimit-*
  limit=$(echo "$response" | grep -i "X-RateLimit-Limit:" | awk '{print $2}' | tr -d '\r')
  remaining=$(echo "$response" | grep -i "X-RateLimit-Remaining:" | awk '{print $2}' | tr -d '\r')
  reset=$(echo "$response" | grep -i "X-RateLimit-Reset:" | awk '{print $2}' | tr -d '\r')
  
  if [[ -z "$limit" ]]; then
    print_warning "Headers X-RateLimit-* non trouvés (requête HEAD non supportée)"
    print_info "Essai avec GET..."
    
    # Réessayer avec GET
    response=$(curl -sI "$BASE_URL$endpoint" "${headers[@]}" -X GET 2>&1)
    limit=$(echo "$response" | grep -i "X-RateLimit-Limit:" | awk '{print $2}' | tr -d '\r')
    remaining=$(echo "$response" | grep -i "X-RateLimit-Remaining:" | awk '{print $2}' | tr -d '\r')
  fi
  
  if [[ ! -z "$limit" ]]; then
    print_success "X-RateLimit-Limit: $limit"
    print_success "X-RateLimit-Remaining: $remaining"
    
    # Vérifier que la limite correspond (en dev, multiplié par 10)
    if [[ "$limit" == "$expected_limit" ]] || [[ "$limit" == "$((expected_limit * 10))" ]]; then
      print_success "Limite correcte ($limit)"
    else
      print_warning "Limite inattendue: attendu $expected_limit ou $((expected_limit * 10)) (dev), reçu $limit"
    fi
  else
    print_error "Headers X-RateLimit-* non trouvés"
  fi
}

# ═══════════════════════════════════════════════════════════════════════════
# TEST 2: TESTER LES LIMITES (MULTIPLE REQUESTS)
# ═══════════════════════════════════════════════════════════════════════════

test_rate_limit_threshold() {
  local endpoint="$1"
  local num_requests="$2"
  local level_emoji="$3"
  local level_name="$4"
  local method="${5:-GET}"
  
  print_header "$level_emoji TEST: Seuil Rate Limit - $level_name"
  print_info "Endpoint: $endpoint"
  print_info "Nombre de requêtes: $num_requests"
  print_info "Méthode: $method"
  
  local success_count=0
  local rate_limited_count=0
  
  # Headers requis
  local headers=()
  if [[ ! -z "$ACCESS_TOKEN" ]]; then
    headers+=(-H "Authorization: Bearer $ACCESS_TOKEN")
  fi
  if [[ "$endpoint" == *"/mobile/"* ]]; then
    headers+=(-H "X-Platform: $PLATFORM")
    headers+=(-H "X-Device-ID: $DEVICE_ID")
    headers+=(-H "Content-Type: application/json")
  fi
  
  for i in $(seq 1 $num_requests); do
    # Préparer le body si POST
    local body_arg=""
    if [[ "$method" == "POST" ]]; then
      if [[ "$endpoint" == *"/push-tokens"* ]]; then
        body_arg='-d {"token":"ExponentPushToken[test-'$i']"}'
      fi
    fi
    
    # Faire la requête
    status=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$BASE_URL$endpoint" "${headers[@]}" $body_arg 2>&1)
    
    if [[ "$status" == "200" ]] || [[ "$status" == "201" ]]; then
      ((success_count++))
      echo -ne "\r${GREEN}✓${NC} Requête $i/$num_requests: HTTP $status (${GREEN}OK${NC})    "
    elif [[ "$status" == "429" ]]; then
      ((rate_limited_count++))
      echo -ne "\r${YELLOW}⚠${NC} Requête $i/$num_requests: HTTP $status (${YELLOW}RATE LIMITED${NC})"
      break
    else
      echo -ne "\r${RED}✗${NC} Requête $i/$num_requests: HTTP $status (${RED}ERROR${NC})    "
    fi
    
    # Petit délai pour éviter de surcharger
    sleep 0.1
  done
  
  echo ""  # Nouvelle ligne après la boucle
  print_info "Résultats:"
  print_success "$success_count requêtes réussies"
  if [[ $rate_limited_count -gt 0 ]]; then
    print_warning "$rate_limited_count requêtes limitées (429)"
  fi
}

# ═══════════════════════════════════════════════════════════════════════════
# TEST 3: VÉRIFIER LE MESSAGE D'ERREUR 429
# ═══════════════════════════════════════════════════════════════════════════

test_429_error_message() {
  local endpoint="$1"
  local expected_code="$2"
  local level_emoji="$3"
  local level_name="$4"
  
  print_header "$level_emoji TEST: Message d'erreur 429 - $level_name"
  print_info "Endpoint: $endpoint"
  print_info "Code d'erreur attendu: $expected_code"
  
  # Headers requis
  local headers=()
  if [[ ! -z "$ACCESS_TOKEN" ]]; then
    headers+=(-H "Authorization: Bearer $ACCESS_TOKEN")
  fi
  if [[ "$endpoint" == *"/mobile/"* ]]; then
    headers+=(-H "X-Platform: $PLATFORM")
    headers+=(-H "X-Device-ID: test-device-429")
  fi
  
  print_info "Déclenchement du rate limit (requêtes répétées)..."
  
  # Faire beaucoup de requêtes pour déclencher le 429
  for i in $(seq 1 200); do
    response=$(curl -s -w "\n%{http_code}" "$BASE_URL$endpoint" "${headers[@]}" 2>&1)
    status=$(echo "$response" | tail -n 1)
    
    if [[ "$status" == "429" ]]; then
      body=$(echo "$response" | head -n -1)
      print_success "Rate limit déclenché après $i requêtes"
      
      # Extraire le code d'erreur
      code=$(echo "$body" | grep -oP '"code":\s*"\K[^"]+' || echo "")
      error=$(echo "$body" | grep -oP '"error":\s*"\K[^"]+' || echo "")
      
      if [[ "$code" == "$expected_code" ]]; then
        print_success "Code d'erreur correct: $code"
      else
        print_warning "Code d'erreur inattendu: attendu $expected_code, reçu $code"
      fi
      
      if [[ ! -z "$error" ]]; then
        print_info "Message: $error"
      fi
      
      # Afficher le JSON complet
      echo -e "\n${BLUE}Réponse complète:${NC}"
      echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
      
      return 0
    fi
    
    sleep 0.05
  done
  
  print_warning "Rate limit non déclenché après 200 requêtes (limite dev très élevée?)"
}

# ═══════════════════════════════════════════════════════════════════════════
# TESTS PRINCIPAUX
# ═══════════════════════════════════════════════════════════════════════════

print_header "🧪 TEST RATE LIMITING DIFFÉRENCIÉ"
echo -e "Base URL: ${BLUE}$BASE_URL${NC}"
echo -e "Device ID: ${BLUE}$DEVICE_ID${NC}"

if [[ -z "$ACCESS_TOKEN" ]]; then
  print_warning "ACCESS_TOKEN non fourni - Certains tests seront limités"
  print_info "Usage: $0 [BASE_URL] [ACCESS_TOKEN]"
fi

# ═══════════════════════════════════════════════════════════════════════════
# 🔴 STRICT TESTS
# ═══════════════════════════════════════════════════════════════════════════

print_header "🔴 STRICT - Authentification sensible (10 req/15min)"

# Note: Ces tests ne nécessitent pas de token (routes publiques)
test_rate_limit_headers "/api/auth/check" 10 "🔴" "STRICT AUTH"
# test_rate_limit_threshold "/api/auth/check" 15 "🔴" "STRICT AUTH" "GET"

# ═══════════════════════════════════════════════════════════════════════════
# 🟡 MODERATE TESTS
# ═══════════════════════════════════════════════════════════════════════════

print_header "🟡 MODERATE - API standard (100 req/15min)"

if [[ ! -z "$ACCESS_TOKEN" ]]; then
  test_rate_limit_headers "/api/users" 100 "🟡" "MODERATE API"
  # test_rate_limit_threshold "/api/users" 15 "🟡" "MODERATE API" "GET"
else
  print_warning "Tests MODERATE ignorés (ACCESS_TOKEN requis)"
fi

# ═══════════════════════════════════════════════════════════════════════════
# 🟢 PERMISSIVE TESTS (PRINCIPAL FIX)
# ═══════════════════════════════════════════════════════════════════════════

print_header "🟢 PERMISSIVE - Mobile fonctionnel (150 req/15min)"

if [[ ! -z "$ACCESS_TOKEN" ]]; then
  # Test headers
  test_rate_limit_headers "/api/mobile/push-tokens" 150 "🟢" "PERMISSIVE MOBILE"
  
  # Test seuil (faire 20 requêtes, devrait toutes passer)
  test_rate_limit_threshold "/api/mobile/push-tokens" 20 "🟢" "PERMISSIVE MOBILE" "POST"
  
  # Test message 429
  # test_429_error_message "/api/mobile/push-tokens" "PERMISSIVE_MOBILE_RATE_LIMIT_EXCEEDED" "🟢" "PERMISSIVE MOBILE"
else
  print_warning "Tests PERMISSIVE ignorés (ACCESS_TOKEN requis)"
fi

# ═══════════════════════════════════════════════════════════════════════════
# RÉSUMÉ
# ═══════════════════════════════════════════════════════════════════════════

print_header "📊 RÉSUMÉ DES TESTS"

echo -e "${GREEN}✓${NC} Tests des headers X-RateLimit-* completés"
echo -e "${GREEN}✓${NC} Tests de seuil completés"
echo -e "${BLUE}ℹ${NC} Pour tester les messages 429, décommentez les tests correspondants"
echo -e "${BLUE}ℹ${NC} En développement, les limites sont multipliées par 10"

print_header "✅ TESTS TERMINÉS"
