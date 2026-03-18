# Sécurité — IHM Qvarry

## Vue d'ensemble

La sécurité de l'IHM Qvarry est implémentée en couches successives, depuis le middleware Edge jusqu'aux composants React.

---

## 1. Middleware Edge — `src/middleware.ts`

Le middleware Next.js s'exécute dans l'Edge Runtime avant tout rendu de page. Il gère deux responsabilités principales :

### 1.1 Protection des routes (Auth Guard)

Les routes protégées nécessitent un cookie JWT valide :

```typescript
const PROTECTED_ROUTES = [
  "/dashboard",
  "/admin",
  "/fiches",
  "/import",
  "/partage",
  "/profil",
  "/messaging",
];
```

- Si aucun cookie JWT → redirection vers `/`
- Si JWT présent mais rôle non-admin sur `/admin` → redirection vers `/dashboard`

> ⚠️ Cette vérification côté middleware est une **protection UX** : elle ne vérifie pas la signature du JWT (pas de clé secrète dans l'Edge Runtime). La vraie vérification se fait côté back-end sur chaque requête API.

### 1.2 Content Security Policy (CSP) avec Nonces

**Référence QVARRY-SEC-005**

Pour chaque requête, le middleware :
1. Génère un nonce unique via `btoa(crypto.randomUUID())`
2. Construit une CSP stricte incluant ce nonce pour `script-src`
3. Propage le nonce au layout Server Component via les headers de requête internes
4. Ajoute le header `Content-Security-Policy` à la réponse

```
script-src 'self' 'nonce-<nonce>' 'strict-dynamic' https://challenges.cloudflare.com <API_ORIGIN>
```

- `'strict-dynamic'` propage la confiance aux scripts chargés dynamiquement par un script noncé
- `'unsafe-inline'` est **absent** de `script-src` pour les navigateurs modernes
- `style-src` conserve `'unsafe-inline'` (requis pour Tailwind + Leaflet)

### 1.3 Autres headers de sécurité

Next.js gère les headers HSTS, X-Frame-Options, etc. Le back-end Helmet complète la protection côté API.

---

## 2. Cookie JWT HTTP-only

### Fonctionnement

| Environnement | Nom du cookie | Propriétés |
|---------------|---------------|-----------|
| Production | `__Host-token` | `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/` |
| Développement | `token` | `HttpOnly`, `SameSite=Lax` |

- **`HttpOnly`** : Le cookie n'est pas accessible en JavaScript (`document.cookie`) → protection contre le vol de token via XSS
- **`Secure`** : Transmis uniquement via HTTPS en production
- **`__Host-` prefix** : Sécurité supplémentaire imposée par le back-end — lie le cookie au domaine exact (pas de sous-domaine)

### Fichier de référence

```typescript
// src/lib/cookieNames.ts
export const JWT_COOKIE_NAME = process.env.NODE_ENV === 'production' 
  ? '__Host-token' 
  : 'token';
```

---

## 3. Cloudflare Turnstile (CAPTCHA)

**Composant** : `src/components/auth/Turnstile.tsx`

Le widget Turnstile est intégré aux formulaires de connexion et d'inscription. Il génère un token côté client que le serveur valide via le middleware `turnstileMiddleware.ts` avant de traiter la requête.

**Configuration** :
- Clé publique (site key) : `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (exposée côté client, c'est normal)
- Validation back-end via l'API Cloudflare (clé secrète côté serveur uniquement)

---

## 4. Authentification à deux facteurs (2FA)

**Composants** : `TwoFactorVerifyModal.tsx`, `TwoFactorSection.tsx`

### Flux d'activation (profil)
1. L'utilisateur clique "Activer la 2FA" dans `/profil/security`
2. `setup2FA()` → retourne un QR code et un secret TOTP
3. L'utilisateur scanne avec une app TOTP (Authy, Google Authenticator…)
4. `verify2FA(code)` → valide le premier code pour confirmer la configuration

### Flux de connexion
1. `login()` → si l'utilisateur a la 2FA activée, le back-end retourne `{ requiresTwoFactor: true, tempToken }`
2. `TwoFactorVerifyModal` est affiché
3. `confirm2FALogin(tempToken, code)` → finalise la connexion

---

## 5. Détection Mobile

**Contexte** : `src/contexts/MobileContext.tsx`

L'application web est interdite sur mobile (`MobileBlocker`). Cette détection évite que des utilisateurs sur smartphone accèdent à une interface non adaptée à leur écran. Sur mobile, seule la page d'inscription (`/`) est accessible.

---

## 6. Interception des logs console

**Fichier** : `src/middleware/console-interceptor.ts`

En production, les `console.log` et `console.debug` sont neutralisés pour éviter de fuiter des informations techniques (tokens partiels, états internes, URLs) dans la console du navigateur.

---

## 7. Propagation du Nonce CSP

**Contexte** : `src/contexts/NonceContext.tsx`

Le nonce généré par le middleware Edge est transmis aux composants React qui en ont besoin (scripts inline, widgets tiers) via un contexte React dédié.

**Flux** :
```
middleware.ts          → header 'x-nonce' (request headers internes)
     ↓
layout.tsx             → headers().get('x-nonce')
     ↓
ClientProviders.tsx    → prop nonce
     ↓
NonceProvider          → contexte React
     ↓
Composants             → useNonce()
```

---

## 8. Refresh Token Automatique

**Fichier** : `src/api/tokenRefresh.ts`

Si une requête API retourne `401 Unauthorized` :
1. Le client tente automatiquement `POST /api/v1/auth/refresh`
2. Si succès → re-tentative de la requête originale
3. Si échec → déconnexion et redirection vers `/`

Cela maintient la session active de manière transparente pour l'utilisateur.

---

## 9. RGPD

**Composant** : `src/components/ui/GdprConsentBanner.tsx`

Bannière de consentement aux cookies affichée à la première visite. Le consentement est stocké en `localStorage`.

Page dédiée : `/privacy` avec la politique de confidentialité complète.
