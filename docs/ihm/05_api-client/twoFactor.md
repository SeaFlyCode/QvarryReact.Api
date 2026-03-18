# Module API `twoFactor.ts`

## Localisation

```
src/api/twoFactor.ts
```

---

## Vue d'ensemble

Module de gestion de l'authentification à deux facteurs (TOTP). Gère la configuration, la vérification à la connexion, et la complétion de session post-2FA. `completeLoginAfter2FA()` est la fonction la plus critique : elle réinitialise l'intégralité de l'état de session.

---

## Exports

---

### `getTwoFactorStatus()`

```ts
async function getTwoFactorStatus(): Promise<{
  enabled:                boolean;
  recoveryCodesRemaining: number;
}>
```

**Endpoint** : `GET /auth/2fa/status`

---

### `setupTwoFactor()`

```ts
async function setupTwoFactor(): Promise<{
  qrCodeUrl: string;
  secret:    string;  // Pour saisie manuelle dans l'app TOTP
}>
```

**Endpoint** : `POST /auth/2fa/setup`

---

### `verifyTwoFactorSetup(code)`

```ts
async function verifyTwoFactorSetup(code: string): Promise<{
  recoveryCodes: string[];
}>
```

**Endpoint** : `POST /auth/2fa/verify-setup`

**Description** : Valide le premier code TOTP pour confirmer que l'app est correctement configurée. Retourne les codes de récupération.

---

### `disableTwoFactor(code)`

```ts
async function disableTwoFactor(code: string): Promise<void>
```

**Endpoint** : `POST /auth/2fa/disable`

**Description** : Désactive la 2FA en validant le code TOTP courant.

---

### `regenerateRecoveryCodes(code)`

```ts
async function regenerateRecoveryCodes(code: string): Promise<{
  recoveryCodes: string[];
}>
```

**Endpoint** : `POST /auth/2fa/regenerate-codes`

**Description** : Régénère les codes de récupération (invalide les anciens). Nécessite le code TOTP courant.

---

### `verifyTwoFactorLogin(sessionToken, code, mode)`

```ts
async function verifyTwoFactorLogin(
  sessionToken: string,
  code:         string,
  mode:         'totp' | 'recovery'
): Promise<{
  authToken: string;
}>
```

**Endpoint** : `POST /auth/2fa/verify-login`

**Description** : Valide le code 2FA lors de la connexion. Retourne un `authToken` intermédiaire à passer à `completeLoginAfter2FA()`.

---

### `completeLoginAfter2FA(authToken)` ⭐ Critique

```ts
async function completeLoginAfter2FA(authToken: string): Promise<void>
```

**Endpoint** : `POST /auth/2fa/complete-login`

**Description** : Finalise la session après vérification 2FA. **Réinitialise intégralement l'état de session côté client** :

```ts
async function completeLoginAfter2FA(authToken: string): Promise<void> {
  await apiFetch('/auth/2fa/complete-login', {
    method: 'POST',
    body: JSON.stringify({ authToken })
  });

  // Réinitialisation de l'état client
  invalidateAuthCache();     // Efface le cache checkAuth()
  regenerateCSRFToken();     // Nouveau token CSRF
  resetRefreshAttempts();    // Remet le compteur à 0
  startAutoRefreshTimer();   // Démarre le timer JWT
}
```

---

## Flux de connexion 2FA complet

```
1. login(email, password, turnstile)
      → { requires2FA: true, sessionToken: 'sess_...' }

2. verifyTwoFactorLogin(sessionToken, code, 'totp')
      → { authToken: 'auth_...' }

3. completeLoginAfter2FA(authToken)
      ├─ POST /auth/2fa/complete-login
      ├─ invalidateAuthCache()
      ├─ regenerateCSRFToken()
      ├─ resetRefreshAttempts()
      └─ startAutoRefreshTimer()

4. router.push('/dashboard')
```
