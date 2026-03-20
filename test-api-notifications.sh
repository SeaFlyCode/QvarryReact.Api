#!/bin/bash

# Test de l'endpoint GET /api/notifications
# Nécessite un token JWT valide

echo "🧪 Test de l'API Notifications"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "⚠️  Pour tester, vous devez fournir un token JWT valide"
echo ""
echo "Commande curl à exécuter manuellement:"
echo ""
echo 'curl -X GET "http://localhost:3000/api/notifications" \'
echo '  -H "Authorization: Bearer VOTRE_TOKEN_JWT" \'
echo '  -H "Content-Type: application/json" | jq'
echo ""
echo "Pour obtenir un token, connectez-vous via le frontend et copiez-le depuis:"
echo "  → DevTools → Application → Cookies → token"
echo ""
