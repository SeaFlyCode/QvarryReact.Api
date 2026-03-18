# Composant `VerifyEmailForm`

## Localisation

```
src/components/auth/VerifyEmailForm.tsx
```

---

## Vue d'ensemble

Formulaire de vérification d'adresse email par code OTP à 6 chiffres. Utilise le même pattern de saisie digit-par-digit que `ResetPasswordForm` (refs, paste, navigation clavier).

---

## Interface / Props

```ts
interface VerifyEmailFormProps {
  token:           string;  // Token extrait de l'URL ?token=
  onSwitchToLogin: () => void;
}
```

---

## États internes

| État | Type | Valeur initiale | Rôle |
|------|------|-----------------|------|
| `otpDigits` | `string[6]` | `['','','','','','']` | 6 chiffres OTP |
| `isLoading` | `boolean` | `false` | Vérification en cours |
| `error` | `string \| null` | `null` | Erreur |
| `success` | `boolean` | `false` | Email vérifié avec succès |

---

## Pattern OTP — identique à `ResetPasswordForm`

Voir [ResetPasswordForm.md](./ResetPasswordForm.md) pour le détail complet de :
- `digitRefs` (6 refs)
- `handleDigitChange` (avance auto)
- `handleKeyDown` (backspace + Enter)
- `handlePaste` (coller 6 chiffres)

---

## Appels API

| Fonction | Module | Paramètres |
|----------|--------|-----------|
| `verifyEmail(token, otp)` | `src/api/auth.ts` | `token` de l'URL + OTP concaténé |

---

## Différence avec `ResetPasswordForm`

| Aspect | `ResetPasswordForm` | `VerifyEmailForm` |
|--------|--------------------|--------------------|
| Champs supplémentaires | `newPassword`, `confirmPassword` | Aucun |
| API | `resetPassword()` | `verifyEmail()` |
| Message succès | "Mot de passe réinitialisé" | "Email vérifié" |

---

## Utilisation typique

```tsx
<VerifyEmailForm
  token={verifyToken}
  onSwitchToLogin={() => setCurrentView('login')}
/>
```
