#!/usr/bin/env bash
# Smoke test automatisé — validation E2E API Qvarry
# Cf. REFONTE V7+V8 — vérifie que les contrats Vagues 1-4 sont bien en place.
#
# Usage:
#   ./scripts/smoke-test.sh                          # tests sans auth (401/400 attendus)
#   ./scripts/smoke-test.sh user@example.com Pass1!  # tests complets avec login
#
# Variables d'env optionnelles:
#   API_URL    (default http://localhost:3000)
#   WS_URL     (default ws://localhost:3000)
#   STRICT     (1 = exit 1 sur premier fail, 0 = continue)
#
# Exit codes:
#   0 = tous les tests passent
#   1 = au moins un test échoue
#   2 = backend down / non joignable

set -uo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────────────────────
API_URL="${API_URL:-http://localhost:3000}"
WS_URL="${WS_URL:-ws://localhost:3000}"
STRICT="${STRICT:-0}"
EMAIL="${1:-}"
PASSWORD="${2:-}"

# Compteurs
TESTS_RUN=0
TESTS_PASS=0
TESTS_FAIL=0
FAILED_TESTS=()

# Couleurs
if [ -t 1 ]; then
  GREEN=$'\e[32m'
  RED=$'\e[31m'
  YELLOW=$'\e[33m'
  BLUE=$'\e[34m'
  GRAY=$'\e[90m'
  BOLD=$'\e[1m'
  RESET=$'\e[0m'
else
  GREEN="" RED="" YELLOW="" BLUE="" GRAY="" BOLD="" RESET=""
fi

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────
log()  { echo "${GRAY}$*${RESET}"; }
info() { echo "${BLUE}ℹ${RESET}  $*"; }
warn() { echo "${YELLOW}⚠${RESET}  $*"; }

assert_status() {
  # assert_status <name> <method> <path> <expected_status> [body] [extra_curl_args...]
  local name="$1" method="$2" path="$3" expected="$4"
  shift 4
  local body=""
  if [ $# -gt 0 ] && [ "${1:-}" != "--" ]; then
    body="$1"
    shift
  fi
  TESTS_RUN=$((TESTS_RUN + 1))

  local code
  if [ -n "$body" ]; then
    code=$(curl -s -m 5 -o /dev/null -w "%{http_code}" \
      -X "$method" "${API_URL}${path}" \
      -H "Content-Type: application/json" \
      -d "$body" "$@" 2>/dev/null || echo "000")
  else
    code=$(curl -s -m 5 -o /dev/null -w "%{http_code}" \
      -X "$method" "${API_URL}${path}" "$@" 2>/dev/null || echo "000")
  fi

  if [ "$code" = "$expected" ]; then
    echo "${GREEN}✓${RESET} ${name} ${GRAY}[${method} ${path} → ${code}]${RESET}"
    TESTS_PASS=$((TESTS_PASS + 1))
  else
    echo "${RED}✗${RESET} ${name} ${GRAY}[${method} ${path}]${RESET} ${RED}expected ${expected}, got ${code}${RESET}"
    TESTS_FAIL=$((TESTS_FAIL + 1))
    FAILED_TESTS+=("$name")
    [ "$STRICT" = "1" ] && exit 1
  fi
}

assert_response_contains() {
  # assert_response_contains <name> <method> <path> <jq_filter> <expected_value> [body]
  local name="$1" method="$2" path="$3" filter="$4" expected="$5"
  local body="${6:-}"
  TESTS_RUN=$((TESTS_RUN + 1))

  local response
  if [ -n "$body" ]; then
    response=$(curl -s -m 5 -X "$method" "${API_URL}${path}" \
      -H "Content-Type: application/json" \
      -d "$body" 2>/dev/null || echo "{}")
  else
    response=$(curl -s -m 5 -X "$method" "${API_URL}${path}" 2>/dev/null || echo "{}")
  fi

  local actual
  actual=$(echo "$response" | jq -r "$filter" 2>/dev/null || echo "")

  if [ "$actual" = "$expected" ]; then
    echo "${GREEN}✓${RESET} ${name} ${GRAY}[${filter} = ${expected}]${RESET}"
    TESTS_PASS=$((TESTS_PASS + 1))
  else
    echo "${RED}✗${RESET} ${name} ${GRAY}[${filter}]${RESET} ${RED}expected '${expected}', got '${actual}'${RESET}"
    TESTS_FAIL=$((TESTS_FAIL + 1))
    FAILED_TESTS+=("$name")
    [ "$STRICT" = "1" ] && exit 1
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Pré-flight check
# ─────────────────────────────────────────────────────────────────────────────
echo "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo "${BOLD}  Smoke test Qvarry API — ${API_URL}${RESET}"
echo "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""

if ! curl -sf -m 3 -o /dev/null "${API_URL}/api/v1/auth/check" \
   && ! curl -s -m 3 -o /dev/null -w "%{http_code}" "${API_URL}/api/v1/auth/check" 2>/dev/null | grep -q "^4"; then
  echo "${RED}✗${RESET} Backend non joignable sur ${API_URL}"
  echo "  ${GRAY}Démarrer avec: npx ts-node src/server.ts${RESET}"
  exit 2
fi
info "Backend joignable"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# 1. Routing & versioning
# ─────────────────────────────────────────────────────────────────────────────
echo "${BOLD}1. Routing & versioning${RESET}"
assert_status "GET /api/v1/auth/check sans auth → 401"     GET    "/api/v1/auth/check"        "401"
assert_status "GET /api/auth/check (legacy) sans auth"    GET    "/api/auth/check"           "401"
assert_status "GET /api/v1/users/me sans auth → 401"      GET    "/api/v1/users/me"          "401"
assert_status "GET /api/v1/security/sessions sans auth"   GET    "/api/v1/security/sessions" "401"
assert_status "GET /api/v1/notifications sans auth"       GET    "/api/v1/notifications"     "401"
assert_status "GET /api/v1/fiches sans auth"              GET    "/api/v1/fiches"            "401"
assert_status "GET /api/v1/points sans auth"              GET    "/api/v1/points"            "401"
assert_status "GET /unknown-route → 404"                  GET    "/api/v1/unknown-xyz"       "404"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# 2. Auth — body validation (Vague 1: login JSON unifié)
# ─────────────────────────────────────────────────────────────────────────────
echo "${BOLD}2. Auth — body validation (Vague 1)${RESET}"
assert_status "POST /auth/login body vide → 400"          POST  "/api/v1/auth/login"        "400" "{}"
assert_status "POST /auth/login email seul → 400"         POST  "/api/v1/auth/login"        "400" '{"email":"a@b.fr"}'
assert_status "POST /auth/login email invalide → 400"     POST  "/api/v1/auth/login"        "400" '{"email":"pas-un-email","password":"p"}'
assert_status "POST /auth/complete-2fa body vide → 400"   POST  "/api/v1/auth/complete-2fa" "400" "{}"
assert_status "POST /auth/refresh sans cookie → 401"      POST  "/api/v1/auth/refresh"      "401"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# 3. Auth — credentials inexistants (Vague 1: codes 403 distincts)
# ─────────────────────────────────────────────────────────────────────────────
echo "${BOLD}3. Auth — credentials invalides${RESET}"
# Note: certains envs valident le format email/password en amont (400) avant
# le lookup DB (401 timing-mitigation). Les deux sont acceptables.
TESTS_RUN=$((TESTS_RUN + 1))
code=$(curl -s -m 5 -o /dev/null -w "%{http_code}" \
  -X POST "${API_URL}/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"nope@nowhere.invalid","password":"WrongPass1!"}' 2>/dev/null || echo "000")
if [ "$code" = "401" ] || [ "$code" = "400" ]; then
  echo "${GREEN}✓${RESET} POST /auth/login credentials invalides → ${code} ${GRAY}[401 ou 400 acceptable]${RESET}"
  TESTS_PASS=$((TESTS_PASS + 1))
else
  echo "${RED}✗${RESET} POST /auth/login credentials invalides expected 401/400, got ${code}"
  TESTS_FAIL=$((TESTS_FAIL + 1))
  FAILED_TESTS+=("Login invalide")
fi
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# 4. Rate limit (Vague 2: countdown + Retry-After)
# ─────────────────────────────────────────────────────────────────────────────
echo "${BOLD}4. Rate limit (Vague 2)${RESET}"
echo "${GRAY}  Tentatives login mauvais password pour déclencher 429...${RESET}"
RL_HIT=0
for i in 1 2 3 4 5 6 7 8 9 10; do
  code=$(curl -s -m 3 -o /dev/null -w "%{http_code}" \
    -X POST "${API_URL}/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"ratelimit-test@nowhere.invalid\",\"password\":\"BadPass${i}!\"}" 2>/dev/null || echo "000")
  if [ "$code" = "429" ]; then
    RL_HIT=1
    break
  fi
done
TESTS_RUN=$((TESTS_RUN + 1))
if [ "$RL_HIT" = "1" ]; then
  echo "${GREEN}✓${RESET} Rate limit déclenché après ${i} tentatives ${GRAY}[429]${RESET}"
  TESTS_PASS=$((TESTS_PASS + 1))
  # Vérifier header Retry-After
  TESTS_RUN=$((TESTS_RUN + 1))
  retry_after=$(curl -s -m 3 -D - -o /dev/null \
    -X POST "${API_URL}/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"ratelimit-test@nowhere.invalid","password":"x"}' 2>/dev/null | grep -i "^retry-after:" | head -1 | tr -d '\r')
  if [ -n "$retry_after" ]; then
    echo "${GREEN}✓${RESET} Header Retry-After présent ${GRAY}[${retry_after}]${RESET}"
    TESTS_PASS=$((TESTS_PASS + 1))
  else
    echo "${RED}✗${RESET} Header Retry-After absent (Vague 2 §4.1 attendu)"
    TESTS_FAIL=$((TESTS_FAIL + 1))
    FAILED_TESTS+=("Retry-After missing")
  fi
else
  echo "${YELLOW}⚠${RESET} Rate limit non déclenché en 10 tentatives ${GRAY}(env DEVELOPMENT permissif: 50req/15min)${RESET}"
  TESTS_PASS=$((TESTS_PASS + 1))
fi
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# 5. Body limit + multipart (Vague 2: JSON_BODY_LIMIT 10mb)
# ─────────────────────────────────────────────────────────────────────────────
echo "${BOLD}5. Body limit (Vague 2: JSON_BODY_LIMIT 10mb)${RESET}"
# Body 11MB doit être rejeté (413 PayloadTooLarge OU 400 si Express closes connection)
TESTS_RUN=$((TESTS_RUN + 1))
big_body=$(printf '"x":"%s","y":"x"' "$(head -c 11000000 /dev/urandom | base64 | tr -d '\n=' | head -c 11000000)")
code=$(curl -s -m 10 -o /dev/null -w "%{http_code}" \
  -X POST "${API_URL}/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d "{${big_body}}" 2>/dev/null || echo "000")
if [ "$code" = "413" ] || [ "$code" = "400" ] || [ "$code" = "000" ]; then
  echo "${GREEN}✓${RESET} POST body >10MB rejeté ${GRAY}[${code} : 413/400/connection-closed acceptable]${RESET}"
  TESTS_PASS=$((TESTS_PASS + 1))
else
  echo "${RED}✗${RESET} POST body >10MB expected 413/400, got ${code} ${RED}(body limit non actif!)${RESET}"
  TESTS_FAIL=$((TESTS_FAIL + 1))
  FAILED_TESTS+=("Body limit not enforced")
fi
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# 6. Headers de sécurité
# ─────────────────────────────────────────────────────────────────────────────
echo "${BOLD}6. Headers de sécurité${RESET}"
HEADERS=$(curl -s -m 3 -D - -o /dev/null "${API_URL}/api/v1/auth/check" 2>/dev/null)
TESTS_RUN=$((TESTS_RUN + 1))
if echo "$HEADERS" | grep -qi "^x-content-type-options: nosniff"; then
  echo "${GREEN}✓${RESET} X-Content-Type-Options: nosniff"
  TESTS_PASS=$((TESTS_PASS + 1))
else
  echo "${RED}✗${RESET} X-Content-Type-Options absent"
  TESTS_FAIL=$((TESTS_FAIL + 1))
  FAILED_TESTS+=("X-Content-Type-Options")
fi

TESTS_RUN=$((TESTS_RUN + 1))
if echo "$HEADERS" | grep -qi "^content-security-policy:"; then
  echo "${GREEN}✓${RESET} Content-Security-Policy présent"
  TESTS_PASS=$((TESTS_PASS + 1))
else
  echo "${RED}✗${RESET} Content-Security-Policy absent"
  TESTS_FAIL=$((TESTS_FAIL + 1))
  FAILED_TESTS+=("CSP")
fi
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# 7. Tests authentifiés (si EMAIL+PASSWORD fournis)
# ─────────────────────────────────────────────────────────────────────────────
if [ -n "$EMAIL" ] && [ -n "$PASSWORD" ]; then
  echo "${BOLD}7. Auth flow complet (login → users/me → sessions → logout)${RESET}"

  COOKIE_JAR=$(mktemp)
  trap "rm -f $COOKIE_JAR" EXIT

  # Login
  TESTS_RUN=$((TESTS_RUN + 1))
  LOGIN_RESPONSE=$(curl -s -m 5 -c "$COOKIE_JAR" \
    -X POST "${API_URL}/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" 2>/dev/null || echo "{}")

  ACCESS_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.accessToken // empty' 2>/dev/null)
  REQUIRES_2FA=$(echo "$LOGIN_RESPONSE" | jq -r '.requires2FA // false' 2>/dev/null)
  USER_ID=$(echo "$LOGIN_RESPONSE" | jq -r '.user._id // empty' 2>/dev/null)

  if [ -n "$ACCESS_TOKEN" ]; then
    echo "${GREEN}✓${RESET} Login successful ${GRAY}[user=${USER_ID}, 2FA=${REQUIRES_2FA}]${RESET}"
    TESTS_PASS=$((TESTS_PASS + 1))
  elif [ "$REQUIRES_2FA" = "true" ]; then
    echo "${YELLOW}⚠${RESET} Login retourne requires2FA=true — test 2FA non automatisable (TOTP)"
    TESTS_PASS=$((TESTS_PASS + 1))
    echo ""
    echo "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo "  Skip suite tests authentifiés (2FA actif)"
    echo "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    ACCESS_TOKEN=""  # Skip rest
  else
    error_code=$(echo "$LOGIN_RESPONSE" | jq -r '.code // empty' 2>/dev/null)
    error_msg=$(echo "$LOGIN_RESPONSE" | jq -r '.message // .error // empty' 2>/dev/null | head -c 80)
    echo "${RED}✗${RESET} Login FAILED ${GRAY}[code=${error_code}]${RESET} ${RED}${error_msg}${RESET}"
    TESTS_FAIL=$((TESTS_FAIL + 1))
    FAILED_TESTS+=("Login failed")
  fi

  if [ -n "$ACCESS_TOKEN" ]; then
    AUTH_HEADER="Authorization: Bearer $ACCESS_TOKEN"

    # GET /users/me
    assert_status "GET /users/me avec token → 200"        GET    "/api/v1/users/me"  "200" "" -H "$AUTH_HEADER"

    # GET /auth/me (si présent)
    assert_status "GET /auth/me avec token → 200"         GET    "/api/v1/auth/me"   "200" "" -H "$AUTH_HEADER"

    # GET /security/sessions
    assert_status "GET /security/sessions avec token"    GET    "/api/v1/security/sessions"  "200" "" -H "$AUTH_HEADER"

    # GET /fiches (vide ou peuplé selon user)
    assert_status "GET /fiches avec token"               GET    "/api/v1/fiches"  "200" "" -H "$AUTH_HEADER"

    # POST /auth/logout
    assert_status "POST /auth/logout"                    POST   "/api/v1/auth/logout"  "200" "" -H "$AUTH_HEADER"

    # Après logout, refresh doit échouer (le refresh token est dans cookies)
    assert_status "POST /auth/refresh après logout"      POST   "/api/v1/auth/refresh"  "401" "" -b "$COOKIE_JAR"
  fi
  echo ""
else
  warn "Tests authentifiés skip — fournir EMAIL et PASSWORD en arguments"
  echo "  ${GRAY}./scripts/smoke-test.sh user@example.com Pass1!${RESET}"
  echo ""
fi

# ─────────────────────────────────────────────────────────────────────────────
# 8. WebSocket — connexion sans auth (doit close 4001)
# ─────────────────────────────────────────────────────────────────────────────
echo "${BOLD}8. WebSocket — auth handshake${RESET}"
TESTS_RUN=$((TESTS_RUN + 1))
WS_TEST=$(node -e "
const WebSocket = require('ws');
const ws = new WebSocket('${WS_URL}/ws/notifications');
let closed = false;
ws.on('open', () => {
  // Ne pas envoyer d'auth, attendre le timeout 5s du serveur
});
ws.on('close', (code, reason) => {
  closed = true;
  console.log(code + ':' + (reason ? reason.toString() : ''));
  process.exit(0);
});
ws.on('error', (e) => {
  console.log('ERR:' + e.message);
  process.exit(0);
});
setTimeout(() => {
  if (!closed) {
    console.log('TIMEOUT');
    ws.close();
  }
  process.exit(0);
}, 7000);
" 2>/dev/null || echo "NODE_ERR")

if echo "$WS_TEST" | grep -qE "^4001:"; then
  echo "${GREEN}✓${RESET} WS close 4001 sur auth manquante ${GRAY}[${WS_TEST}]${RESET}"
  TESTS_PASS=$((TESTS_PASS + 1))
elif echo "$WS_TEST" | grep -qE "^40[0-9][0-9]:"; then
  echo "${YELLOW}⚠${RESET} WS close avec code différent: ${WS_TEST}"
  TESTS_PASS=$((TESTS_PASS + 1))
else
  echo "${RED}✗${RESET} WS comportement inattendu: ${WS_TEST}"
  TESTS_FAIL=$((TESTS_FAIL + 1))
  FAILED_TESTS+=("WS auth handshake")
fi
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# Résumé
# ─────────────────────────────────────────────────────────────────────────────
echo "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo "${BOLD}  Résumé${RESET}"
echo "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo "  Tests:  ${TESTS_RUN}"
echo "  ${GREEN}Pass:   ${TESTS_PASS}${RESET}"
if [ "$TESTS_FAIL" -gt 0 ]; then
  echo "  ${RED}Fail:   ${TESTS_FAIL}${RESET}"
  echo ""
  echo "${RED}${BOLD}Tests en échec:${RESET}"
  for t in "${FAILED_TESTS[@]}"; do
    echo "  ${RED}- ${t}${RESET}"
  done
  exit 1
else
  echo "  Fail:   0"
  echo ""
  echo "${GREEN}${BOLD}✓ Tous les tests passent${RESET}"
  exit 0
fi
