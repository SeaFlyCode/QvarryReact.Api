# Composant `LoginForm`

## Localisation

```
src/components/auth/LoginForm.tsx
```

---

## Vue d'ensemble

Formulaire de connexion avec support Cloudflare Turnstile et authentification à deux facteurs (2FA). En cas de succès 2FA requis, déclenche `TwoFactorVerifyModal`.

---

## Interface / Props

```ts
interface LoginFormProps {
  onSwitchToRegister: () => void;
  onSwitchToForgot:   () => void;
}
```

---

## États internes

| État | Type | Valeur initiale | Rôle |
|------|------|-----------------|------|
| `email` | `string` | `''` | Champ email |
| `password` | `string` | `''` | Champ mot de passe |
| `isLoading` | `boolean` | `false` | Soumission en cours |
| `error` | `string \| null` | `null` | Message d'erreur affiché |
| `loginTurnstileToken` | `string` | `''` | Token Cloudflare Turnstile |
| `show2FAModal` | `boolean` | `false` | Visibilité de `TwoFactorVerifyModal` |
| `twoFactorSessionToken` | `string \| null` | `null` | Token de session intermédiaire 2FA |

---

## Fonctions internes

### `handleSubmit(e)`
```ts
async (e: FormEvent) => {
  e.preventDefault();
  // Validation : email requis, password requis, loginTurnstileToken requis
  // Appel login(email, password, loginTurnstileToken)
  // Succès sans 2FA → router.push('/dashboard')
  // Succès avec 2FA → setTwoFactorSessionToken(token), setShow2FAModal(true)
  // Erreur → setError(message)
}
```

---

## Appels API

| Fonction | Module | Moment |
|----------|--------|--------|
| `login(email, password, turnstileToken)` | `src/api/auth.ts` | À la soumission |

---

## Gestion des erreurs serveur

| Code erreur | Message affiché |
|-------------|-----------------|
| `INVALID_CREDENTIALS` | "Email ou mot de passe incorrect" |
| `EMAIL_NOT_VERIFIED` | "Veuillez vérifier votre email avant de vous connecter" |
| `TOO_MANY_ATTEMPTS` | "Trop de tentatives. Réessayez dans X minutes" (avec `waitTime`) |
| `MAINTENANCE_MODE` | "Application en maintenance" |
| Autres | Message générique du serveur |

---

## Intégration Turnstile

```tsx
<Turnstile
  onVerify={(token) => setLoginTurnstileToken(token)}
  onExpire={() => setLoginTurnstileToken('')}
/>
```

Le bouton de soumission est `disabled` tant que `loginTurnstileToken === ''`.

---

## Flux 2FA

```
login() → { requires2FA: true, sessionToken: '...' }
  └─ setTwoFactorSessionToken(sessionToken)
  └─ setShow2FAModal(true)
       → <TwoFactorVerifyModal
            sessionToken={twoFactorSessionToken}
            onSuccess={() => router.push('/dashboard')}
            onClose={() => setShow2FAModal(false)}
          />
```

---

## Composants enfants

| Composant | Rôle |
|-----------|------|
| `<Turnstile>` | Widget Cloudflare anti-bot |
| `<TwoFactorVerifyModal>` | Modal de vérification 2FA |
| `<PasswordInput>` | Champ mot de passe avec toggle visibilité |

---

## Utilisation typique

```tsx
<LoginForm
  onSwitchToRegister={() => setCurrentView('register')}
  onSwitchToForgot={() => setCurrentView('forgot')}
/>
```
