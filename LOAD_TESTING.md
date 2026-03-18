# 📊 Tests de Charge WebSocket

Ce projet inclut des tests de charge complets pour les endpoints WebSocket.

## 🚀 Quick Start

### Installation

```bash
npm install
```

### Lancer les tests

```bash
# Tests basiques (Artillery)
npm run test:load

# Tests de stress (Artillery)
npm run test:load:stress

# Tests personnalisés (TypeScript)
npm run test:load:custom
```

## 📖 Documentation complète

Voir [docs/api/06_services/websocket-load-testing.md](./docs/api/06_services/websocket-load-testing.md)

## 🎯 Commandes disponibles

| Commande                   | Description                               |
| -------------------------- | ----------------------------------------- |
| `npm run test:load`        | Tests Artillery basiques (50 users, 30s)  |
| `npm run test:load:stress` | Tests de stress (ramp 1→200 users, 5 min) |
| `npm run test:load:custom` | Script TypeScript personnalisé            |

## 🔧 Options du script personnalisé

```bash
# Nombre d'utilisateurs
npm run test:load:custom -- --users 100

# Durée du test (secondes)
npm run test:load:custom -- --duration 120

# Endpoint spécifique
npm run test:load:custom -- --endpoint notifications
npm run test:load:custom -- --endpoint messages
npm run test:load:custom -- --endpoint both

# Fichier de sortie
npm run test:load:custom -- --output ./results.json

# Combinaison
npm run test:load:custom -- --users 200 --duration 180 --endpoint messages
```

## 📈 Métriques collectées

- ⚡ Temps de connexion WebSocket (p50, p95, p99)
- 📡 Latence des messages (p50, p95, p99)
- ✅ Taux de succès/échec
- 📊 Débit (messages/sec)
- 🚨 Erreurs par type

## 🎯 Performances attendues

| Métrique               | Valeur cible |
| ---------------------- | ------------ |
| Connexions simultanées | ≥ 500        |
| Temps connexion (p95)  | < 150ms      |
| Latence message (p95)  | < 100ms      |
| Taux de succès         | ≥ 99%        |

## 🛠️ Prérequis

Avant de lancer les tests, démarrer le serveur :

```bash
npm run dev
```

## 📁 Fichiers clés

- `artillery-websocket.yml` : Configuration Artillery avec scénarios prédéfinis
- `scripts/artillery-functions.js` : Fonctions personnalisées Artillery
- `scripts/load-test-websocket.ts` : Script TypeScript personnalisé avec métriques détaillées
- `docs/api/06_services/websocket-load-testing.md` : Documentation complète

## 🐛 Troubleshooting

### "Connection timeout"

```bash
# Vérifier que le serveur tourne
npm run dev

# Tester manuellement
curl http://localhost:3000/health
```

### Taux d'échec élevé

```bash
# Réduire le nombre d'utilisateurs
npm run test:load:custom -- --users 25
```

Voir la [documentation complète](./docs/api/06_services/websocket-load-testing.md#troubleshooting) pour plus de solutions.

## 📊 Exemple de résultat

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
   • Médiane (p50): 67ms
   • p95: 145ms
   • p99: 187ms

📡 LATENCE DES MESSAGES (ms):
   • Médiane (p50): 54ms
   • p95: 123ms
   • p99: 178ms

✅ VERDICT: Performance excellente!
```

## 🔗 Ressources

- [Documentation WebSocket](./docs/api/06_services/websocket.md)
- [Artillery Documentation](https://www.artillery.io/docs)
- [Node.js ws library](https://github.com/websockets/ws)
