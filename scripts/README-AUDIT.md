# Infrastructure Security Audit Scripts

Ce dossier contient des scripts d'audit pour tester la fiabilité et la sécurité de l'infrastructure Qvarry.

## Scripts disponibles

### 1. `audit-infrastructure.ts` - Audit de sécurité complet

Teste tous les aspects de la sécurité de l'application :

- **Authentication** : Login/logout, validation des credentials
- **Token Refresh** : Rotation des tokens, endpoint de refresh
- **Rate Limiting** : Protection contre les requêtes excessives
- **Cookie Security** : HttpOnly, Secure, SameSite flags
- **Session Management** : Protection des routes, blacklisting des tokens
- **WebSocket Authentication** : Tokens temporaires, rejection sans auth
- **Security Headers** : X-Content-Type-Options, X-Frame-Options, HSTS, CSP
- **Input Validation** : Protection SQL injection, XSS
- **Brute Force Protection** : Blocage après échecs multiples
- **CORS** : Configuration sécurisée
- **2FA** : Endpoints et validation

```bash
npm run audit

# Mode verbose (détails complets)
npm run audit:verbose

# Avec URL personnalisée
API_URL=https://api.example.com npm run audit
```

### 2. `audit-token-refresh.ts` - Audit approfondi des tokens

Tests spécifiques pour le mécanisme de refresh token :

- **Rotation des tokens** : Vérification que les tokens changent
- **Expiration** : Analyse de la durée de vie des tokens
- **Réutilisation d'anciens tokens** : Détection de vol de token
- **Requêtes concurrentes** : Gestion des race conditions
- **Refresh après logout** : Invalidation des sessions
- **Modification de token** : Détection de tampering
- **Sécurité des cookies** : Flags de sécurité
- **Sessions multiples** : Comportement multi-device

```bash
npm run audit:tokens
```

### 3. `audit-stress-test.ts` - Test de charge

Évalue la résilience du système sous stress :

- **Auth Check Load** : Charge sur l'endpoint de vérification d'auth
- **Token Refresh Load** : Charge sur le refresh de tokens
- **Rate Limiter Stress** : Test du rate limiter sous pression
- **WebSocket Stress** : Connexions WebSocket multiples
- **Mixed Workload** : Simulation de trafic mixte réaliste

```bash
npm run audit:stress

# Avec configuration personnalisée
CONCURRENCY=20 ITERATIONS=100 npm run audit:stress
```

## Configuration

### Variables d'environnement

| Variable | Description | Défaut |
|----------|-------------|--------|
| `API_URL` | URL de l'API à tester | `http://localhost:3000` |
| `TEST_EMAIL` | Email du compte de test | `audit-test@example.com` |
| `TEST_PASSWORD` | Mot de passe du compte de test | `AuditTest123!@#` |
| `VERBOSE` | Mode verbose | `false` |
| `CONCURRENCY` | Nombre de requêtes parallèles (stress test) | `10` |
| `ITERATIONS` | Nombre d'itérations (stress test) | `50` |

### Créer un compte de test

Avant d'exécuter les audits, créez un compte de test dédié :

```bash
# Via l'API ou l'interface
POST /api/auth/register
{
  "email": "audit-test@example.com",
  "password": "AuditTest123!@#",
  "username": "audit-test"
}
```

## Exécution complète

Pour lancer tous les audits :

```bash
npm run audit:all
```

## Interprétation des résultats

### Codes de sortie

- `0` : Tous les tests passent
- `1` : Au moins un test a échoué

### Indicateurs de sécurité

| Icône | Signification |
|-------|---------------|
| ✓ PASS | Test réussi |
| ✗ FAIL | Test échoué (action requise) |
| ⚠ WARN | Avertissement (recommandation) |

### Catégories critiques

Les tests suivants sont **critiques** - un échec nécessite une correction immédiate :

1. **HttpOnly flag** sur les cookies (XSS)
2. **Token blacklisting** après logout
3. **Tampered token rejection** (signature verification)
4. **Old refresh token reuse blocked** (token theft)
5. **Protected routes require authentication**

### Recommandations par catégorie

#### Cookie Security
- Toujours avoir `HttpOnly` sur les tokens
- Utiliser `SameSite=Strict` en production
- Activer `Secure` en HTTPS

#### Rate Limiting
- Vérifier que le rate limiter se déclenche
- Headers `X-RateLimit-*` recommandés

#### Session Management
- Invalider tous les tokens au logout
- Implémenter le token blacklisting

#### Security Headers
- Utiliser Helmet.js pour les headers automatiques
- CSP recommandé en production

## Intégration CI/CD

Exemple pour GitHub Actions :

```yaml
audit:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v3
    - uses: actions/setup-node@v3
      with:
        node-version: '20'
    - run: npm install
      working-directory: server
    - run: npm run audit
      working-directory: server
      env:
        API_URL: ${{ secrets.TEST_API_URL }}
        TEST_EMAIL: ${{ secrets.TEST_EMAIL }}
        TEST_PASSWORD: ${{ secrets.TEST_PASSWORD }}
```

## Bonnes pratiques

1. **Exécuter régulièrement** : Intégrer dans la CI/CD
2. **Environnement dédié** : Ne pas tester en production
3. **Compte de test isolé** : Utiliser un compte dédié
4. **Analyser les échecs** : Investiguer chaque échec
5. **Documenter les exceptions** : Si un test échoue volontairement

## Dépannage

### "Server not reachable"
- Vérifier que le serveur est démarré
- Vérifier l'URL dans `API_URL`

### "Login failed"
- Vérifier que le compte de test existe
- Vérifier les credentials dans `TEST_EMAIL`/`TEST_PASSWORD`

### Rate limit pendant les tests
- Attendre le délai de blocage
- Réduire `CONCURRENCY` et `ITERATIONS`

### WebSocket tests fail
- Vérifier que les WebSockets sont activés
- Vérifier les CORS pour WebSocket
