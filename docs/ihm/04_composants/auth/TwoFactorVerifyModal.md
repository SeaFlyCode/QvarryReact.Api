# Composant `TwoFactorVerifyModal`

## Localisation

```
src/components/auth/TwoFactorVerifyModal.tsx
```

---

## Vue d'ensemble

Modal de vérification à deux facteurs lors de la connexion. Supporte deux modes : code TOTP (6 chiffres) et code de récupération (format alphanumérique). Processus en deux étapes : `verifyTwoFactorLogin()` puis `completeLoginAfter2FA()`.

---

## Interface / Props

```ts
interface TwoFactorVerifyModalProps {
  sessionToken: string;
  onSuccess:    () => void;
  onClose:      () => void;
}
```

---

## États internes

| État | Type | Valeur initiale | Rôle |
|------|------|-----------------|------|
| `code` | `string` | `''` | Code saisi (TOTP ou récupération) |
| `isLoading` | `boolean` | `false` | Vérification en cours |
| `error` | `string \| null` | `null` | Message d'erreur |
| `mode` | `'totp' \| 'recovery'` | `'totp'` | Mode de vérification actif |

---

## Processus de vérification (deux étapes)

```
1. verifyTwoFactorLogin(sessionToken, code, mode)
      → { verified: true, authToken: '...' }

2. completeLoginAfter2FA(authToken)
      ├─ invalidateAuthCache()
      ├─ regenerateCSRFToken()
      ├─ resetRefreshAttempts()
      └─ startAutoRefreshTimer()

3. onSuccess() → router.push('/dashboard')
```

---

## Appels API

| Fonction | Module | Description |
|----------|--------|-------------|
| `verifyTwoFactorLogin(sessionToken, code, mode)` | `src/api/twoFactor.ts` | Valide le code 2FA |
| `completeLoginAfter2FA(authToken)` | `src/api/twoFactor.ts` | Finalise la session (cache, CSRF, timer) |

---

## Basculement de mode

```tsx
<button onClick={() => { setMode('recovery'); setCode(''); setError(null); }}>
  Utiliser un code de récupération
</button>
```

En mode `recovery` :
- Le placeholder du champ change : "XXXX-XXXX-XXXX"
- Le format de validation change (alphanumérique, tirets)
- Le bouton de retour vers le mode TOTP est affiché

---

## Gestion des erreurs

| Code | Message |
|------|---------|
| `INVALID_CODE` | "Code incorrect" |
| `EXPIRED_SESSION` | "Session expirée, veuillez vous reconnecter" |
| `TOO_MANY_ATTEMPTS` | "Trop de tentatives" |
| Autres | Message serveur |

---

## Extrait de code clé

```tsx
const handleVerify = async () => {
  if (!code.trim()) return;
  setIsLoading(true);
  setError(null);

  try {
    const { authToken } = await verifyTwoFactorLogin(sessionToken, code, mode);
    await completeLoginAfter2FA(authToken);
    onSuccess();
  } catch (err: unknown) {
    const apiError = err as ApiError;
    setError(apiError.message || 'Code incorrect');
  } finally {
    setIsLoading(false);
  }
};
```

---

## Utilisation typique

```tsx
{show2FAModal && (
  <TwoFactorVerifyModal
    sessionToken={twoFactorSessionToken!}
    onSuccess={() => router.push('/dashboard')}
    onClose={() => setShow2FAModal(false)}
  />
)}
```
