# Module API `auth.ts`

## Localisation

```
src/api/auth.ts
```

---

## Vue d'ensemble

Module d'authentification. Expose les fonctions de login, logout, inscription, vérification de session, et gestion des mots de passe. `checkAuth()` intègre un cache mémoire 10 secondes et une déduplication des requêtes concurrentes.

---

## Exports

---

### `login(email, password, turnstileToken)`

```ts
async function login(
  email:          string,
  password:       string,
  turnstileToken: string
): Promise<LoginResult>
```

**Endpoint** : `POST /auth/login`

**Retourne** :
```ts
type LoginResult =
  | { success: true; requires2FA: false }
  | { success: true; requires2FA: true; sessionToken: string }
```

**Erreurs possibles** :
| Code | Signification |
|------|--------------|
| `INVALID_CREDENTIALS` | Email ou mot de passe incorrect |
| `EMAIL_NOT_VERIFIED` | Email non vérifié |
| `TOO_MANY_ATTEMPTS` | Rate limit (avec `waitTime` en minutes) |
| `MAINTENANCE_MODE` | Application en maintenance |

---

### `logout()`

```ts
async function logout(): Promise<void>
```

**Endpoint** : `POST /auth/logout`

**Actions** :
1. Appel API logout
2. `invalidateAuthCache()` — efface le cache mémoire
3. `window.dispatchEvent(new CustomEvent('auth-state-change', { detail: { authenticated: false } }))`

---

### `checkAuth()`

```ts
async function checkAuth(): Promise<AuthResult>
```

**Endpoint** : `GET /auth/check`

**Retourne** :
```ts
type AuthResult =
  | { authenticated: true;  user: User }
  | { authenticated: false; error?: 'network_error' }
```

**Cache mémoire 10 secondes** :
```ts
let authCache: AuthResult | null = null;
let cacheTime: number            = 0;
const CACHE_TTL = 10_000; // 10s

// Seul authenticated:true est mis en cache
if (result.authenticated) {
  authCache = result;
  cacheTime = Date.now();
}
```

**Déduplication** :
```ts
let authPendingRequest: Promise<AuthResult> | null = null;

// Si une requête est déjà en vol, retourner la même Promise
if (authPendingRequest) return authPendingRequest;

authPendingRequest = performCheck().finally(() => {
  authPendingRequest = null;
});
return authPendingRequest;
```

**Événement émis** :
```ts
window.dispatchEvent(new CustomEvent('auth-state-change', {
  detail: { authenticated: result.authenticated, user: result.user }
}));
```

**Erreur réseau** :
- Status 0 ou timeout → `{ authenticated: false, error: 'network_error' }`
- Démarre `startAutoRefreshTimer()` si authentifié

---

### `invalidateAuthCache()`

```ts
function invalidateAuthCache(): void
```

Efface `authCache` et `cacheTime`. Appelé après logout, 2FA, ou toute opération changeant l'état de session.

---

### `register(username, email, password, turnstileToken)`

```ts
async function register(
  username:       string,
  email:          string,
  password:       string,
  turnstileToken: string
): Promise<void>
```

**Endpoint** : `POST /auth/register`

**Erreurs** : `EMAIL_ALREADY_EXISTS`, `USERNAME_ALREADY_EXISTS`, `INVALID_EMAIL`, `WEAK_PASSWORD`, `TURNSTILE_FAILED`

---

### `forgotPassword(email)`

```ts
async function forgotPassword(email: string): Promise<void>
```

**Endpoint** : `POST /auth/forgot-password`

**Erreurs** : `TOO_MANY_ATTEMPTS`

---

### `resetPassword(token, otp, newPassword)`

```ts
async function resetPassword(
  token:       string,
  otp:         string,
  newPassword: string
): Promise<void>
```

**Endpoint** : `POST /auth/reset-password`

**Erreurs** : `INVALID_TOKEN`, `EXPIRED_TOKEN`, `WEAK_PASSWORD`

---

### `verifyEmail(token, otp)`

```ts
async function verifyEmail(token: string, otp: string): Promise<void>
```

**Endpoint** : `POST /auth/verify-email`

**Erreurs** : `INVALID_TOKEN`, `EXPIRED_TOKEN`, `ALREADY_VERIFIED`

---

## Événement `auth-state-change`

```ts
// Payload
interface AuthStateChangeDetail {
  authenticated: boolean;
  user?:         User;
}

// Écoute
window.addEventListener('auth-state-change', (e: CustomEvent<AuthStateChangeDetail>) => {
  // Réagir au changement d'état d'auth
});
```

Émis par `checkAuth()` et `logout()`.
