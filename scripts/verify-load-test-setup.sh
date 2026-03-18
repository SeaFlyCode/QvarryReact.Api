#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# QVARRY API - VERIFICATION SCRIPT POUR TESTS DE CHARGE WEBSOCKET
# ═══════════════════════════════════════════════════════════════════════════
# Script de vérification pour s'assurer que tout est en place pour les tests
# ═══════════════════════════════════════════════════════════════════════════

echo "╔═══════════════════════════════════════════════════════════════════════════╗"
echo "║         VÉRIFICATION DE L'INSTALLATION DES TESTS DE CHARGE              ║"
echo "╚═══════════════════════════════════════════════════════════════════════════╝"
echo ""

# Compteur d'erreurs
ERRORS=0

# Vérifier Artillery
echo "📦 Vérification d'Artillery..."
if command -v npx &> /dev/null && npx artillery --version &> /dev/null; then
    VERSION=$(npx artillery --version | grep "Artillery:" | awk '{print $2}')
    echo "   ✅ Artillery installé (version $VERSION)"
else
    echo "   ❌ Artillery non trouvé"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# Vérifier les fichiers de configuration
echo "📄 Vérification des fichiers de configuration..."

if [ -f "artillery-websocket.yml" ]; then
    echo "   ✅ artillery-websocket.yml trouvé"
else
    echo "   ❌ artillery-websocket.yml manquant"
    ERRORS=$((ERRORS + 1))
fi

if [ -f "scripts/artillery-functions.js" ]; then
    echo "   ✅ scripts/artillery-functions.js trouvé"
else
    echo "   ❌ scripts/artillery-functions.js manquant"
    ERRORS=$((ERRORS + 1))
fi

if [ -f "scripts/load-test-websocket.ts" ]; then
    echo "   ✅ scripts/load-test-websocket.ts trouvé"
else
    echo "   ❌ scripts/load-test-websocket.ts manquant"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# Vérifier la documentation
echo "📚 Vérification de la documentation..."

if [ -f "docs/api/06_services/websocket-load-testing.md" ]; then
    echo "   ✅ Documentation complète trouvée"
else
    echo "   ❌ Documentation manquante"
    ERRORS=$((ERRORS + 1))
fi

if [ -f "LOAD_TESTING.md" ]; then
    echo "   ✅ README des tests de charge trouvé"
else
    echo "   ❌ README des tests de charge manquant"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# Vérifier les scripts npm
echo "🔧 Vérification des scripts npm..."

if grep -q "test:load" package.json; then
    echo "   ✅ Script 'npm run test:load' configuré"
else
    echo "   ❌ Script 'npm run test:load' manquant"
    ERRORS=$((ERRORS + 1))
fi

if grep -q "test:load:stress" package.json; then
    echo "   ✅ Script 'npm run test:load:stress' configuré"
else
    echo "   ❌ Script 'npm run test:load:stress' manquant"
    ERRORS=$((ERRORS + 1))
fi

if grep -q "test:load:custom" package.json; then
    echo "   ✅ Script 'npm run test:load:custom' configuré"
else
    echo "   ❌ Script 'npm run test:load:custom' manquant"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# Vérifier que le serveur est démarré
echo "🌐 Vérification du serveur API..."
if curl -s http://localhost:3000/health > /dev/null 2>&1; then
    echo "   ✅ Serveur API accessible sur http://localhost:3000"
    echo "   ℹ️  Vous pouvez lancer les tests maintenant"
else
    echo "   ⚠️  Serveur API non accessible sur http://localhost:3000"
    echo "   ℹ️  Démarrez le serveur avec: npm run dev"
fi
echo ""

# Résumé
echo "═══════════════════════════════════════════════════════════════════════════"
if [ $ERRORS -eq 0 ]; then
    echo "✅ TOUT EST EN PLACE ! Vous pouvez lancer les tests de charge."
    echo ""
    echo "Commandes disponibles:"
    echo "  • npm run test:load         → Tests basiques (30s, 5 users/sec)"
    echo "  • npm run test:load:stress  → Tests de stress (2min, ramp 1→20 users)"
    echo "  • npm run test:load:custom  → Script TypeScript personnalisé"
    echo "  • npm run test:load:report  → Tests + génération rapport HTML"
    echo ""
    echo "Documentation complète:"
    echo "  • LOAD_TESTING.md"
    echo "  • docs/api/06_services/websocket-load-testing.md"
    exit 0
else
    echo "❌ ERREURS DÉTECTÉES: $ERRORS problème(s) trouvé(s)"
    echo ""
    echo "Exécutez: npm install"
    exit 1
fi
