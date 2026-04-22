# =============================================================================
# QvarryReact API - Production Dockerfile
# SÉCURITÉ MAXIMALE + TAILLE OPTIMISÉE
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Build (compilation TypeScript)
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app

# Copie des fichiers de dépendances et config
COPY package*.json ./
COPY tsconfig.json ./
COPY tsconfig.prod.json ./

# Installation des dépendances (--ignore-scripts évite d'exécuter "prepare" qui lance le build)
RUN npm ci --ignore-scripts

# Copie du code source
COPY . .

# Build du serveur TypeScript
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 2: Obfuscation du code compilé
# -----------------------------------------------------------------------------
FROM node:20-alpine AS obfuscator
WORKDIR /app

# Copie uniquement le code compilé et les scripts d'obfuscation
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/obfuscator.json ./obfuscator.json
COPY --from=builder /app/scripts/obfuscate.js ./scripts/obfuscate.js
COPY --from=builder /app/scripts/verify-obfuscation.js ./scripts/verify-obfuscation.js

# Installation de javascript-obfuscator (version isolée)
RUN npm init -y && npm install javascript-obfuscator@4.1.1

# Exécution de l'obfuscation avec stack size augmentée
RUN node --stack-size=8192 scripts/obfuscate.js

# Vérification que l'obfuscation a réussi
RUN node scripts/verify-obfuscation.js

# -----------------------------------------------------------------------------
# Stage 3: Dépendances de production uniquement
# -----------------------------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app

# Copie package.json et installation des deps de production
COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev --ignore-scripts && \
    npm cache clean --force

# -----------------------------------------------------------------------------
# Stage 4: Image finale minimale et sécurisée
# -----------------------------------------------------------------------------
FROM node:20-alpine AS production

# Métadonnées de sécurité
LABEL security.obfuscation="enabled" \
      security.level="enterprise" \
      security.source-code="removed" \
      security.source-maps="removed" \
      security.dev-dependencies="removed" \
      security.logging="structured-winston" \
      org.opencontainers.image.title="QvarryReact API" \
      org.opencontainers.image.description="QvarryReact API Production - Obfuscated" \
      org.opencontainers.image.vendor="QvarryReact Security Team"

WORKDIR /app

# Sécurité: Créer un utilisateur non-root avec UID/GID fixes
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs appuser

# Dossier de logs avec permissions pour appuser
RUN mkdir -p /app/logs && chown -R appuser:nodejs /app/logs && chmod -R 770 /app/logs

# =============================================================================
# API: Code obfusqué + dépendances de production
# =============================================================================
COPY --from=obfuscator --chown=appuser:nodejs /app/dist ./dist
COPY --from=deps --chown=appuser:nodejs /app/node_modules ./node_modules

# Templates d'email (nécessaires au runtime)
COPY --from=builder --chown=appuser:nodejs /app/src/templates ./dist/templates

# Package.json pour les infos de version (optionnel)
COPY --from=builder --chown=appuser:nodejs /app/package.json ./

# =============================================================================
# NETTOYAGE FINAL
# =============================================================================
RUN find /app -name "*.ts" -type f -delete 2>/dev/null || true && \
    find /app -name "*.tsx" -type f -delete 2>/dev/null || true && \
    find /app -name "*.map" -type f -delete 2>/dev/null || true && \
    find /app -name "*.d.ts" -type f -delete 2>/dev/null || true && \
    find /app -name ".env*" -type f -delete 2>/dev/null || true && \
    find /app -name "*.md" -type f -delete 2>/dev/null || true && \
    find /app -name "*.log" -type f -delete 2>/dev/null || true && \
    find /app -name ".git*" -type f -delete 2>/dev/null || true && \
    find /app -name "node_modules/.cache" -type d -exec rm -rf {} + 2>/dev/null || true

# Sécurité: Permissions restrictives mais accessibles par appuser
RUN chown -R appuser:nodejs /app && \
    chmod -R 550 /app

# Sécurité: Variables d'environnement de production
ENV NODE_ENV=production \
    NODE_OPTIONS="--no-deprecation" \
    HOSTNAME="0.0.0.0" \
    LOG_DIR="/app/logs"

# Basculer vers l'utilisateur non-root
USER appuser

# Port exposé (API Express)
EXPOSE 3000

# Healthcheck: vérifie que l'API répond
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Démarrage de l'API
CMD ["node", "dist/server.js"]
