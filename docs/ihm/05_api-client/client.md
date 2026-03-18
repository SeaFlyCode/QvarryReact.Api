# Module API `client.ts`

## Localisation

```
src/api/client.ts
```

---

## Vue d'ensemble

Client HTTP de base de l'application. Toutes les requêtes API passent par `apiFetch`. Gère le timeout (30s), la rotation automatique des tokens (401 → refresh → retry), et la détection d'expiration de session forcée.

---

## Export principal

### `apiFetch<T>(url, options?)`

```ts
async function apiFetch<T>(
  url:     string,
  options?: RequestInit & { isRetry?: boolean }
): Promise<T>
```

| Paramètre | Type | Description |
|-----------|------|-------------|
| `url` | `string` | Chemin relatif à l'API (`/auth/login`, etc.) |
| `options` | `RequestInit & { isRetry?: boolean }` | Options fetch standard + flag retry |

**Retourne** : `Promise<T>` — données désérialisées de la réponse JSON

---

## Comportements

### Timeout 30 secondes
```ts
const controller = new AbortController();
const timeoutId  = setTimeout(() => controller.abort(), 30_000);

const response = await fetch(url, {
  ...options,
  signal: controller.signal,
});
clearTimeout(timeoutId);
```

### `credentials: 'include'`
Toujours présent pour envoyer les cookies de session.

### Content-Type automatique
```ts
headers: {
  'Content-Type': 'application/json',
  ...options?.headers,
}
```

### Rotation des tokens (401 → refresh → retry)
```ts
if (response.status === 401 && !options?.isRetry) {
  const skipRoutes = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/check'];
  const isSkipped  = skipRoutes.some(r => url.includes(r));

  if (!isSkipped) {
    await refreshToken(); // src/api/tokenRefresh.ts
    return apiFetch<T>(url, { ...options, isRetry: true });
  }
}
```

**Routes exclues du refresh** :
- `/auth/login`
- `/auth/register`
- `/auth/refresh`
- `/auth/check`

Le flag `isRetry: true` empêche une boucle infinie de refresh.

### Détection `SESSION_EXPIRED`
```ts
// Même sur une réponse 200, si le corps contient SESSION_EXPIRED :
const data = await response.json();
if (data?.error === 'SESSION_EXPIRED' || data?.code === 'SESSION_EXPIRED') {
  forceSessionExpiration();
  throw new Error('Session expirée');
}
```

### Gestion des erreurs HTTP
```ts
if (!response.ok) {
  const errorData = await response.json().catch(() => ({}));
  throw {
    status:  response.status,
    message: errorData.message || 'Erreur serveur',
    code:    errorData.code,
    ...errorData,
  };
}
```

### Erreur réseau / timeout
```ts
catch (error) {
  if (error instanceof DOMException && error.name === 'AbortError') {
    throw { status: 0, message: 'Timeout de la requête', code: 'TIMEOUT' };
  }
  throw { status: 0, message: 'Erreur réseau', code: 'NETWORK_ERROR' };
}
```

---

## `forceSessionExpiration()`

```ts
function forceSessionExpiration() {
  // 1. Efface les cookies côté client (best-effort)
  // 2. Appelle window.showGlobalConfirmModal({ confirmText: 'Se reconnecter' })
  // 3. Redirige vers '/' après confirmation
}
```

---

## Résumé du flux

```
apiFetch(url, options)
  ├─ AbortController (30s timeout)
  ├─ fetch(url, { credentials:'include', ...options })
  │
  ├─ Réponse OK
  │     ├─ JSON parse
  │     ├─ SESSION_EXPIRED dans le corps → forceSessionExpiration()
  │     └─ Retourne data
  │
  ├─ 401 + pas isRetry + pas route auth
  │     ├─ refreshToken()
  │     └─ Retry avec isRetry:true
  │
  ├─ Autre erreur HTTP
  │     └─ throw { status, message, code }
  │
  └─ AbortError / Network error
        └─ throw { status:0, code:'TIMEOUT'|'NETWORK_ERROR' }
```
