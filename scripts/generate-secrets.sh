#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# 🔐 Script de Génération de Secrets Sécurisés - Qvarry API
# ═══════════════════════════════════════════════════════════════════════════
# Ce script génère des secrets cryptographiquement sécurisés pour l'API Qvarry.
# Les secrets sont générés avec OpenSSL et respectent les standards de sécurité.
# ═══════════════════════════════════════════════════════════════════════════

set -euo pipefail

# Couleurs pour l'affichage
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}🔐 Génération de Secrets Sécurisés pour Qvarry API${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""

# Vérifier qu'OpenSSL est installé
if ! command -v openssl &> /dev/null; then
    echo -e "${RED}❌ Erreur: OpenSSL n'est pas installé${NC}"
    echo "Installez OpenSSL avec:"
    echo "  - macOS: brew install openssl"
    echo "  - Ubuntu/Debian: sudo apt install openssl"
    echo "  - Windows: https://slproweb.com/products/Win32OpenSSL.html"
    exit 1
fi

# Fichier de sortie
OUTPUT_FILE=".env.secrets"

# Supprimer l'ancien fichier s'il existe
if [ -f "$OUTPUT_FILE" ]; then
    echo -e "${YELLOW}⚠️  Le fichier $OUTPUT_FILE existe déjà${NC}"
    read -p "Voulez-vous le remplacer? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${RED}❌ Opération annulée${NC}"
        exit 1
    fi
    rm "$OUTPUT_FILE"
fi

echo -e "${GREEN}✓${NC} Génération des secrets en cours..."
echo ""

# Créer le fichier avec un en-tête
cat > "$OUTPUT_FILE" << EOF
# ═══════════════════════════════════════════════════════════════════════════
# 🔐 SECRETS GÉNÉRÉS AUTOMATIQUEMENT - Qvarry API
# ═══════════════════════════════════════════════════════════════════════════
# Date de génération: $(date)
# ⚠️  NE JAMAIS commiter ce fichier!
# ⚠️  Copiez ces valeurs dans votre fichier .env de production
# ═══════════════════════════════════════════════════════════════════════════

EOF

# Générer les secrets
echo "# JWT Secret (64 bytes base64)" >> "$OUTPUT_FILE"
JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')
echo "JWT_SECRET=$JWT_SECRET" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

echo "# Encryption Keys (32 bytes hex = 256 bits pour AES-256)" >> "$OUTPUT_FILE"
ENCRYPTION_KEY_MASTER=$(openssl rand -hex 32)
echo "ENCRYPTION_KEY_MASTER=$ENCRYPTION_KEY_MASTER" >> "$OUTPUT_FILE"
ENCRYPTION_KEY_COMMUNICATION=$(openssl rand -hex 32)
echo "ENCRYPTION_KEY_COMMUNICATION=$ENCRYPTION_KEY_COMMUNICATION" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

echo "# IP Hash Secret (RGPD anonymization)" >> "$OUTPUT_FILE"
IP_HASH_SECRET=$(openssl rand -hex 32)
echo "IP_HASH_SECRET=$IP_HASH_SECRET" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

echo "# Email HMAC Key (rainbow table protection)" >> "$OUTPUT_FILE"
EMAIL_HMAC_KEY=$(openssl rand -hex 32)
echo "EMAIL_HMAC_KEY=$EMAIL_HMAC_KEY" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

echo "# Vonage Signature Secret (webhook validation)" >> "$OUTPUT_FILE"
VONAGE_SIGNATURE_SECRET=$(openssl rand -hex 32)
echo "VONAGE_SIGNATURE_SECRET=$VONAGE_SIGNATURE_SECRET" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

echo "# Redis Password (si Redis avec authentification)" >> "$OUTPUT_FILE"
REDIS_PASSWORD=$(openssl rand -base64 32 | tr -d '\n')
echo "REDIS_PASSWORD=$REDIS_PASSWORD" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

# Afficher un résumé
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ Secrets générés avec succès!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BLUE}📁 Fichier créé:${NC} $OUTPUT_FILE"
echo ""
echo -e "${YELLOW}🔒 Sécurité des secrets générés:${NC}"
echo "  • JWT_SECRET: $(echo -n "$JWT_SECRET" | wc -c) caractères (base64)"
echo "  • ENCRYPTION_KEY_MASTER: $(echo -n "$ENCRYPTION_KEY_MASTER" | wc -c) caractères (hex)"
echo "  • ENCRYPTION_KEY_COMMUNICATION: $(echo -n "$ENCRYPTION_KEY_COMMUNICATION" | wc -c) caractères (hex)"
echo "  • VONAGE_SIGNATURE_SECRET: $(echo -n "$VONAGE_SIGNATURE_SECRET" | wc -c) caractères (hex)"
echo ""
echo -e "${YELLOW}📋 Prochaines étapes:${NC}"
echo "  1. Copier .env.example vers .env (si pas déjà fait)"
echo "  2. Remplacer les secrets dans .env par ceux de $OUTPUT_FILE"
echo "  3. Configurer VONAGE_SIGNATURE_SECRET dans Vonage Dashboard"
echo "  4. Supprimer $OUTPUT_FILE après copie (ou le stocker de manière sécurisée)"
echo "  5. Vérifier que .env est dans .gitignore"
echo ""
echo -e "${RED}⚠️  IMPORTANT:${NC}"
echo "  • Ne JAMAIS commiter $OUTPUT_FILE dans Git"
echo "  • Ne JAMAIS partager ces secrets par email/Slack"
echo "  • En production, utiliser un gestionnaire de secrets (AWS Secrets Manager, Vault)"
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"

# Sécuriser les permissions du fichier généré
chmod 600 "$OUTPUT_FILE"
echo -e "${GREEN}✓${NC} Permissions sécurisées (chmod 600) appliquées à $OUTPUT_FILE"
echo ""
