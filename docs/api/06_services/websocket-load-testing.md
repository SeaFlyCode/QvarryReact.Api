# Tests de Charge WebSocket - Guide Complet

## Table des matières

- [Vue d'ensemble](#vue-densemble)
- [Installation et prérequis](#installation-et-prérequis)
- [Tests Artillery (YAML)](#tests-artillery-yaml)
  - [Lancer les tests basiques](#lancer-les-tests-basiques)
  - [Lancer les tests de stress](#lancer-les-tests-de-stress)
  - [Environnements disponibles](#environnements-disponibles)
  - [Scénarios de test](#scénarios-de-test)
- [Tests personnalisés (TypeScript)](#tests-personnalisés-typescript)
  - [Utilisation basique](#utilisation-basique)
  - [Options avancées](#options-avancées)
- [Interprétation des résultats](#interprétation-des-résultats)
- [Performances attendues](#performances-attendues)
- [Troubleshooting](#troubleshooting)
- [Exemples de résultats](#exemples-de-résultats)

---

## Vue d'ensemble

Les tests de charge WebSocket permettent de valider la performance, la stabilité et la scalabilité des endpoints WebSocket de l'API Qvarry.

**Deux approches de test sont disponibles :**

1. **Artillery (YAML)** : Tests déclaratifs avec scénarios prédéfinis
2. **Script TypeScript personnalisé** : Tests programmatiques avec métriques détaillées

**Endpoints testés :**

- `/ws/notifications` : Canal de notifications en lecture seule (push serveur → client)
- `/ws/messages` : Canal de messagerie bidirectionnel (client ↔ serveur)

**Métriques collectées :**

- Temps de connexion WebSocket
- Latence des messages (p50, p75, p90, p95, p99)
- Taux de succès/échec des connexions
- Débit de messages par seconde
- Taux d'erreur par type
- Utilisation CPU/mémoire (via outils système)

---

## Installation et prérequis

### 1. Dépendances

Les dépendances Artillery sont déjà incluses dans `package.json` :

```json
{
  "devDependencies": {
    "artillery": "^2.0.21",
    "artillery-engine-ws": "^7.1.2"
  }
}
```

Installation :

```bash
npm install
```

### 2. Serveur de test

Le serveur API doit être démarré **avant** de lancer les tests :

```bash
# Terminal 1 : Démarrer le serveur API
npm run dev

# Terminal 2 : Lancer les tests de charge
npm run test:load
```

### 3. Configuration (optionnel)

Vous pouvez modifier les URLs de base dans les fichiers de configuration :

- **Artillery** : `artillery-websocket.yml` (section `environments`)
- **TypeScript** : `scripts/load-test-websocket.ts` (variables `baseUrl` et `wsBaseUrl`)

---

## Tests Artillery (YAML)

Artillery est un framework de test de charge déclaratif. Les scénarios sont définis dans `artillery-websocket.yml`.

### Lancer les tests basiques

```bash
npm run test:load
```

Équivalent :

```bash
artillery run artillery-websocket.yml
```

**Résultat attendu :**

```
Summary report @ 15:30:45
  Scenarios launched:  50
  Scenarios completed: 50
  Requests completed:  150
  Mean response/req:   87ms
  Response time (msec):
    min: 12
    max: 234
    median: 78
    p95: 156
    p99: 189
```

### Lancer les tests de stress

Le test de stress simule une montée en charge progressive de **1 à 200 utilisateurs** sur 2 minutes :

```bash
npm run test:load:stress
```

Équivalent :

```bash
artillery run artillery-websocket.yml --target stress
```

**Phases du test de stress :**

| Phase           | Durée | Utilisateurs | Description                 |
| --------------- | ----- | ------------ | --------------------------- |
| Ramp up         | 60s   | 1 → 50       | Montée progressive          |
| Peak load       | 120s  | 50 (stable)  | Charge soutenue             |
| Spike test      | 30s   | 50 → 200     | Pic de charge brutal        |
| Sustained spike | 60s   | 200 (stable) | Maintien du pic             |
| Ramp down       | 30s   | 200 → 10     | Retour à une charge normale |

### Environnements disponibles

L'artillery-websocket.yml définit plusieurs environnements :

#### Local (par défaut)

```bash
artillery run artillery-websocket.yml
# Ou
artillery run artillery-websocket.yml --target local
```

- URL : `ws://localhost:3000`
- 30 secondes, 10 utilisateurs/sec

#### Staging

```bash
artillery run artillery-websocket.yml --target staging
```

- URL : `wss://staging-api.qvarry.fr`
- 60 secondes, 20 utilisateurs/sec
- ⚠️ Nécessite un accès réseau au serveur staging

#### Stress

```bash
artillery run artillery-websocket.yml --target stress
# Ou
npm run test:load:stress
```

- URL : `ws://localhost:3000`
- Test de montée en charge (voir tableau ci-dessus)

### Scénarios de test

Le fichier `artillery-websocket.yml` contient 6 scénarios avec pondération :

| Scénario                | Poids | Description                                       |
| ----------------------- | ----- | ------------------------------------------------- |
| WebSocket Notifications | 30%   | Test du canal `/ws/notifications` (lecture seule) |
| WebSocket Messages      | 50%   | Test du canal `/ws/messages` (bidirectionnel)     |
| Compression Level 0     | 5%    | Test sans compression                             |
| Compression Level 6     | 5%    | Test compression moyenne                          |
| Compression Level 9     | 5%    | Test compression maximale                         |
| Rate Limiting Test      | 5%    | Test de dépassement des limites                   |

**Exemple de flux :** Scénario "WebSocket Messages"

```yaml
1. POST /api/v1/auth/register → Créer expéditeur
2. POST /api/v1/auth/register → Créer destinataire
3. POST /api/v1/conversations → Créer conversation
4. POST /api/v1/auth/ws-token → Obtenir token WebSocket
5. WebSocket connect → ws://localhost:3000/ws/messages?conv=<id>
6. Send auth message → {"type":"auth","token":"..."}
7. Loop 10x : Send message → {"type":"message","content":"Test"}
8. Send getMessages → {"type":"getMessages","query":{"limit":50}}
9. Close connection
```

---

## Tests personnalisés (TypeScript)

Le script `scripts/load-test-websocket.ts` offre une approche programmatique avec contrôle total.

### Utilisation basique

```bash
npm run test:load:custom
```

Équivalent :

```bash
ts-node scripts/load-test-websocket.ts
```

**Configuration par défaut :**

- 50 utilisateurs simultanés
- 60 secondes de test
- Endpoint : `both` (alternance notifications/messages)
- Output : `./load-test-results.json`

### Options avancées

#### Nombre d'utilisateurs

```bash
npm run test:load:custom -- --users 100
```

Simule 100 utilisateurs simultanés.

#### Durée du test

```bash
npm run test:load:custom -- --duration 120
```

Test de 2 minutes.

#### Endpoint spécifique

```bash
# Tester uniquement /ws/notifications
npm run test:load:custom -- --endpoint notifications

# Tester uniquement /ws/messages
npm run test:load:custom -- --endpoint messages

# Tester les deux (alternance)
npm run test:load:custom -- --endpoint both
```

#### Fichier de sortie personnalisé

```bash
npm run test:load:custom -- --output ./results/test-$(date +%s).json
```

#### Combinaison d'options

```bash
npm run test:load:custom -- --users 200 --duration 180 --endpoint messages --output ./stress-test.json
```

Test de stress : 200 utilisateurs pendant 3 minutes sur `/ws/messages`.

### Affichage en temps réel

Le script affiche une barre de progression en temps réel :

```
╔═══════════════════════════════════════════════════════════════════════════╗
║              DÉMARRAGE DU TEST DE CHARGE WEBSOCKET                        ║
╚═══════════════════════════════════════════════════════════════════════════╝

📋 Configuration:
   • Base URL: http://localhost:3000/api/v1
   • WebSocket URL: ws://localhost:3000
   • Utilisateurs: 100
   • Durée: 120s
   • Endpoint: both
   • Ramp-up: 10s

📈 Phase 1: Montée en charge progressive...
   ⏳ Création des utilisateurs: 100/100 (100.0%)
   ✅ Tous les utilisateurs sont connectés

🔥 Phase 2: Test de charge soutenu...
   ⏱️  Temps écoulé: 45s | Restant: 65s | Connexions: 98/100 | Messages: 1234
```

---

## Interprétation des résultats

### Métriques Artillery

Après un test Artillery, vous obtenez un rapport comme celui-ci :

```
Summary report @ 15:30:45(+01:00)
  Scenarios launched:  150
  Scenarios completed: 148
  Requests completed:  450
  Mean response/req:   87ms
  Response time (msec):
    min: 12
    max: 456
    median: 78
    p95: 189
    p99: 234
  Codes:
    101: 148
```

**Analyse :**

| Métrique            | Valeur attendue                | Interprétation                                                         |
| ------------------- | ------------------------------ | ---------------------------------------------------------------------- |
| Scenarios completed | ≥ 95% de launched              | Taux de succès (ici : 148/150 = 98.7% ✅)                              |
| Mean response/req   | < 100ms                        | Latence moyenne acceptable                                             |
| Median (p50)        | < 80ms                         | 50% des requêtes répondent en moins de 80ms                            |
| p95                 | < 200ms                        | 95% des requêtes répondent en moins de 200ms                           |
| p99                 | < 500ms                        | 99% des requêtes répondent en moins de 500ms (tolérance pour outliers) |
| Codes: 101          | Nombre de connexions WebSocket | Code 101 = "Switching Protocols" (WebSocket upgrade réussi)            |

### Métriques TypeScript

Le script TypeScript génère un rapport détaillé :

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                        RÉSULTATS DU TEST DE CHARGE                        ║
╚═══════════════════════════════════════════════════════════════════════════╝

📊 STATISTIQUES GLOBALES:
   • Durée totale: 70.23s
   • Utilisateurs cibles: 100
   • Connexions réussies: 98 (98.00%)
   • Connexions échouées: 2 (2.00%)
   • Messages totaux: 2456
   • Débit: 34.97 msg/s

⚡ TEMPS DE CONNEXION (ms):
   • Minimum: 23ms
   • Médiane (p50): 67ms
   • p95: 145ms
   • p99: 187ms
   • Maximum: 234ms
   • Moyenne: 78ms

📡 LATENCE DES MESSAGES (ms):
   • Minimum: 12ms
   • Médiane (p50): 54ms
   • p95: 123ms
   • p99: 178ms
   • Maximum: 289ms
   • Moyenne: 65ms

✅ VERDICT: Performance excellente!
```

**Critères de verdict :**

| Verdict                     | Conditions                                 |
| --------------------------- | ------------------------------------------ |
| ✅ Performance excellente   | Succès ≥ 99% ET p95 < 200ms                |
| ⚠️ Performance acceptable   | Succès ≥ 95% ET p95 < 500ms                |
| ❌ Performance insuffisante | Sinon (échecs > 5% ou latence trop élevée) |

### Fichier de résultats JSON

Le script TypeScript génère un fichier `load-test-results.json` :

```json
{
  "config": {
    "baseUrl": "http://localhost:3000/api/v1",
    "wsBaseUrl": "ws://localhost:3000",
    "maxUsers": 100,
    "testDurationSeconds": 60,
    "endpoint": "both"
  },
  "metrics": {
    "totalConnections": 100,
    "successfulConnections": 98,
    "failedConnections": 2,
    "totalMessages": 2456,
    "messagesPerSecond": 40.93,
    "errors": [
      {
        "type": "WS_AUTH_ERROR",
        "message": "Invalid token",
        "timestamp": "2026-03-18T14:23:45.123Z"
      }
    ],
    "latencies": [23, 45, 67, ...],
    "connectionTimes": [34, 56, 78, ...],
    "startTime": "2026-03-18T14:23:00.000Z",
    "endTime": "2026-03-18T14:24:10.234Z",
    "durationMs": 70234
  },
  "percentiles": {
    "connectionTimes": {
      "p50": 67,
      "p75": 89,
      "p90": 112,
      "p95": 145,
      "p99": 187,
      "min": 23,
      "max": 234,
      "avg": 78
    },
    "latencies": {
      "p50": 54,
      "p75": 78,
      "p90": 98,
      "p95": 123,
      "p99": 178,
      "min": 12,
      "max": 289,
      "avg": 65
    }
  }
}
```

Vous pouvez analyser ce fichier avec des outils externes (Grafana, Jupyter, Excel, etc.).

---

## Performances attendues

### Baseline (conditions idéales)

Serveur local, machine de développement moderne (16 Go RAM, CPU 8 cœurs) :

| Métrique                 | Valeur attendue       |
| ------------------------ | --------------------- |
| Connexions simultanées   | ≥ 500                 |
| Temps de connexion (p95) | < 150ms               |
| Latence message (p95)    | < 100ms               |
| Débit messages           | ≥ 50 msg/s            |
| Taux de succès           | ≥ 99%                 |
| Rate limiting respecté   | Oui (60 msg/min/conn) |

### Limites du système

Les limites configurées dans le système :

| Paramètre                    | Valeur      | Code d'erreur si dépassé         |
| ---------------------------- | ----------- | -------------------------------- |
| Connexions par IP par minute | 10          | WebSocket close code 4029        |
| Messages par minute (WS)     | 60          | Error type `RATE_LIMIT_EXCEEDED` |
| Token WebSocket TTL          | 5 minutes   | Error type `INVALID_TOKEN`       |
| Auth timeout                 | 5 secondes  | WebSocket close code 4001        |
| Heartbeat interval           | 30 secondes | Connexion fermée si pas de pong  |

### Impact de la compression

Tests comparatifs avec charge moyenne (50 utilisateurs, 30s) :

| Niveau compression | Latence p95 | Bande passante | CPU serveur |
| ------------------ | ----------- | -------------- | ----------- |
| 0 (pas de comp.)   | 78ms        | 100%           | Baseline    |
| 6 (moyen)          | 82ms        | ~60%           | +12%        |
| 9 (max)            | 95ms        | ~45%           | +28%        |

**Recommandation :** Niveau 6 pour équilibre latence/bande passante.

---

## Troubleshooting

### Problème : "Connection timeout"

**Symptôme :**

```
❌ ERREURS RENCONTRÉES:
   • WS_ERROR: connect ETIMEDOUT
```

**Causes possibles :**

1. Serveur API non démarré
2. Port 3000 occupé par un autre processus
3. Firewall bloquant les connexions WebSocket

**Solutions :**

```bash
# Vérifier que le serveur tourne
npm run dev

# Vérifier le port 3000
lsof -i :3000

# Tester manuellement
wscat -c ws://localhost:3000/ws/notifications
```

### Problème : Taux d'échec élevé (> 5%)

**Symptôme :**

```
Connexions échouées: 15 (15.00%)
```

**Causes possibles :**

1. Rate limiting atteint (10 connexions/min par IP)
2. Base de données MongoDB surchargée
3. Redis indisponible (sessions)

**Solutions :**

```bash
# Augmenter les limites (temporairement en dev)
# Dans .env
RATE_LIMIT_MAX_REQUESTS=100

# Vérifier MongoDB
mongo --eval "db.adminCommand('ping')"

# Vérifier Redis
redis-cli ping
```

### Problème : "Invalid token"

**Symptôme :**

```
❌ ERREURS RENCONTRÉES:
   • WS_AUTH_ERROR: Invalid token
```

**Causes possibles :**

1. Token expiré (TTL 5 minutes)
2. JWT_SECRET non configuré
3. Token utilisé deux fois (JTI à usage unique)

**Solutions :**

```bash
# Vérifier JWT_SECRET dans .env
cat .env | grep JWT_SECRET

# Réduire le délai entre token generation et connexion
# Dans le script, réduire les "think" times
```

### Problème : Latence élevée (p95 > 500ms)

**Symptôme :**

```
📡 LATENCE DES MESSAGES (ms):
   • p95: 678ms
```

**Causes possibles :**

1. Charge CPU/mémoire trop élevée
2. Trop d'utilisateurs simultanés pour la machine
3. Réseau local surchargé

**Solutions :**

```bash
# Surveiller les ressources
top -pid $(pgrep -f "node.*server.ts")

# Réduire le nombre d'utilisateurs
npm run test:load:custom -- --users 25

# Augmenter le ramp-up (montée progressive)
# Modifier dans scripts/load-test-websocket.ts :
rampUpSeconds: 20 // au lieu de 10
```

### Problème : Artillery "module not found"

**Symptôme :**

```
Error: Cannot find module 'artillery-engine-ws'
```

**Solution :**

```bash
# Réinstaller les dépendances
npm install
```

### Problème : Script TypeScript "Cannot find module 'ws'"

**Symptôme :**

```
Error: Cannot find module 'ws'
```

**Solution :**

```bash
# ws est déjà installé, mais @types/ws peut manquer
npm install --save-dev @types/ws
```

---

## Exemples de résultats

### Exemple 1 : Test basique réussi (Artillery)

```bash
npm run test:load
```

```
Summary report @ 15:45:23(+01:00)
  Scenarios launched:  50
  Scenarios completed: 50
  Requests completed:  200
  Mean response/req:   72ms
  Response time (msec):
    min: 15
    max: 189
    median: 68
    p95: 134
    p99: 167
  Scenario counts:
    WebSocket Notifications - Connection Test: 15 (30%)
    WebSocket Messages - Bidirectional Test: 25 (50%)
    WebSocket Compression Level 0: 3 (6%)
    WebSocket Compression Level 6: 4 (8%)
    WebSocket Compression Level 9: 2 (4%)
    Rate Limiting Test: 1 (2%)
  Codes:
    101: 50
```

**Analyse :**

- ✅ 100% de succès (50/50)
- ✅ p95 = 134ms (< 200ms)
- ✅ p99 = 167ms (< 500ms)
- ✅ Distribution conforme aux poids

**Verdict : Performance excellente**

### Exemple 2 : Test de stress avec dégradation

```bash
npm run test:load:stress
```

```
Summary report @ 16:10:45(+01:00)
  Scenarios launched:  850
  Scenarios completed: 807
  Requests completed:  2421
  Mean response/req:   245ms
  Response time (msec):
    min: 23
    max: 1234
    median: 156
    p95: 567
    p99: 823
  Errors:
    ETIMEDOUT: 43
  Codes:
    101: 807
```

**Analyse :**

- ⚠️ 95% de succès (807/850)
- ⚠️ p95 = 567ms (> 200ms mais < 1000ms)
- ❌ 43 timeouts (5% d'erreurs)
- 📊 Dégradation progressive pendant le pic (200 users)

**Verdict : Limite atteinte à ~180 utilisateurs simultanés**

**Recommandations :**

1. Optimiser les requêtes MongoDB (index, agrégation)
2. Activer le clustering Node.js (plusieurs workers)
3. Mettre en cache les vérifications de participation
4. Augmenter les ressources serveur (CPU/RAM)

### Exemple 3 : Test personnalisé avec compression niveau 9

```bash
npm run test:load:custom -- --users 50 --duration 60 --endpoint notifications
```

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                        RÉSULTATS DU TEST DE CHARGE                        ║
╚═══════════════════════════════════════════════════════════════════════════╝

📊 STATISTIQUES GLOBALES:
   • Durée totale: 70.12s
   • Utilisateurs cibles: 50
   • Connexions réussies: 50 (100.00%)
   • Connexions échouées: 0 (0.00%)
   • Messages totaux: 856
   • Débit: 12.21 msg/s

⚡ TEMPS DE CONNEXION (ms):
   • Minimum: 34ms
   • Médiane (p50): 89ms
   • p95: 178ms
   • p99: 201ms
   • Maximum: 234ms
   • Moyenne: 95ms

📡 LATENCE DES MESSAGES (ms):
   • Minimum: 23ms
   • Médiane (p50): 112ms
   • p95: 234ms
   • p99: 289ms
   • Maximum: 345ms
   • Moyenne: 123ms

✅ VERDICT: Performance acceptable

💾 Résultats sauvegardés dans: /path/to/load-test-results.json
```

**Analyse :**

- ✅ 100% de succès
- ⚠️ Latence légèrement élevée (compression niveau 9)
- 📉 Trade-off : économie bande passante vs latence

**Recommandation : Utiliser compression niveau 6 pour réduire latence**

### Exemple 4 : Test de rate limiting

Artillery exécute automatiquement le scénario "Rate Limiting Test" (5% des scénarios).

**Résultat attendu :**

```
  Errors:
    RATE_LIMIT_EXCEEDED: 10
```

Cela signifie que le rate limiting fonctionne correctement :

- Les 60 premiers messages par minute passent
- Les suivants (61-70) sont rejetés avec erreur `RATE_LIMIT_EXCEEDED`
- La connexion n'est pas fermée (juste rejet du message)

---

## Intégration CI/CD (optionnel)

### GitHub Actions

Ajoutez un workflow `.github/workflows/load-tests.yml` :

```yaml
name: WebSocket Load Tests

on:
  pull_request:
    branches: [main]
  schedule:
    - cron: "0 2 * * *" # Tous les jours à 2h du matin

jobs:
  load-test:
    runs-on: ubuntu-latest
    services:
      mongodb:
        image: mongo:6
        ports:
          - 27017:27017
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: "18"

      - name: Install dependencies
        run: npm ci

      - name: Build server
        run: npm run build

      - name: Start API server
        run: npm start &
        env:
          NODE_ENV: production
          MONGODB_URI: mongodb://localhost:27017/test
          REDIS_HOST: localhost

      - name: Wait for server
        run: npx wait-on http://localhost:3000/health -t 30000

      - name: Run load tests
        run: npm run test:load

      - name: Upload Artillery report
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: artillery-report
          path: artillery-report.json
```

---

## Ressources supplémentaires

- **Artillery Documentation** : https://www.artillery.io/docs
- **WebSocket RFC 6455** : https://datatracker.ietf.org/doc/html/rfc6455
- **Node.js `ws` library** : https://github.com/websockets/ws
- **Documentation WebSocket interne** : [websocket.md](./websocket.md)

---

_Dernière mise à jour : 18 mars 2026_
