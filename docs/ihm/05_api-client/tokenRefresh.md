# Module API `tokenRefresh.ts`

## Localisation

```
src/api/tokenRefresh.ts
```

---

## Vue d'ensemble

Gestion du rafraîchissement automatique des tokens JWT. Implémente un timer qui rafraîchit le token 1 minute avant son expiration (JWT de 14 minutes). Maximum 5 tentatives. Les erreurs réseau ne consomment pas les tentatives. Déduplication des appels concurrents.

---

## Exports

---

### `refreshToken()`

```ts
async function refreshToken(): Promise<void>
```

**Endpoint** : `POST /auth/refresh`

**Comportements** :

| Cas | Action |
|-----|--------|
| Succès | `resetRefreshAttempts()`, continue |
| Erreur réseau (status 0 / timeout) | **Ne compte pas** comme tentative |
| 401 ou 403 | `handleRefreshFailure()` |
| 500 ou autre | Incrémente le compteur de tentatives |
| `success: false` dans la réponse | `handleRefreshFailure()` |
| Déjà à 5 tentatives | Court-circuite immédiatement |

**Déduplication** :
```ts
let refreshPendingRequest: Promise<void> | null = null;

if (refreshPendingRequest) return refreshPendingRequest;
refreshPendingRequest = performRefresh().finally(() => {
  refreshPendingRequest = null;
});
```

---

### `handleRefreshFailure()`

```ts
function handleRefreshFailure(): void
```

Appelée quand le refresh est définitivement impossible :
1. Appel API `POST /auth/logout` (côté serveur)
2. Efface les cookies côté client (best-effort)
3. `forceSessionExpiration()` → modal "Se reconnecter"

---

### `startAutoRefreshTimer()`

```ts
function startAutoRefreshTimer(): void
```

Démarre un timer qui déclenche `refreshToken()` **1 minute avant** l'expiration du JWT (durée JWT = 14 minutes → timer = 13 minutes).

```ts
const JWT_DURATION_MS   = 14 * 60 * 1000; // 14 min
const REFRESH_BEFORE_MS =  1 * 60 * 1000; //  1 min avant expiry
const TIMER_DELAY       = JWT_DURATION_MS - REFRESH_BEFORE_MS; // 13 min

// Minimum absolu : 30 secondes (sécurité)
const delay = Math.max(TIMER_DELAY, 30_000);
```

**Comportements** :
- Remplace le timer existant s'il y en a un (pas de doublon)
- Après un refresh réussi, **redémarre automatiquement** le timer
- S'arrête après un échec (`handleRefreshFailure()` appelé)

---

### `stopAutoRefreshTimer()`

```ts
function stopAutoRefreshTimer(): void
```

Arrête le timer en cours. Appelé au logout.

---

### `resetRefreshAttempts()`

```ts
function resetRefreshAttempts(): void
```

Remet le compteur de tentatives à 0. Appelé après un refresh réussi et après une connexion réussie.

---

## Compteur de tentatives

```ts
let refreshAttempts = 0;
const MAX_REFRESH_ATTEMPTS = 5;

// Erreur réseau : ne pas incrémenter
if (error.status === 0 || error.code === 'TIMEOUT') {
  return; // Pas de forceSessionExpiration non plus
}

refreshAttempts++;
if (refreshAttempts >= MAX_REFRESH_ATTEMPTS) {
  handleRefreshFailure();
}
```

---

## Flux complet

```
startAutoRefreshTimer()
  └─ setTimeout(13 min)
        └─ refreshToken()
              ├─ Succès
              │     ├─ resetRefreshAttempts()
              │     └─ startAutoRefreshTimer() (relance)
              │
              ├─ Erreur réseau
              │     └─ (pas de comptage, timer non relancé — sera relancé au prochain checkAuth)
              │
              ├─ 401/403 ou success:false
              │     └─ handleRefreshFailure()
              │           ├─ POST /auth/logout
              │           └─ forceSessionExpiration()
              │
              └─ Autre erreur
                    ├─ attempts++
                    └─ Si attempts >= 5 → handleRefreshFailure()
```
