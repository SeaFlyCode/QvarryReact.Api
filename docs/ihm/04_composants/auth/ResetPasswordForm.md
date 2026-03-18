# Composant `ResetPasswordForm`

## Localisation

```
src/components/auth/ResetPasswordForm.tsx
```

---

## Vue d'ensemble

Formulaire de réinitialisation de mot de passe. Saisie du nouveau mot de passe et d'un code OTP à 6 chiffres. L'OTP est saisi chiffre par chiffre dans des inputs individuels avec navigation automatique au clavier.

---

## Interface / Props

```ts
interface ResetPasswordFormProps {
  token:           string;  // Token extrait de l'URL ?token=
  onSwitchToLogin: () => void;
}
```

---

## États internes

| État | Type | Valeur initiale | Rôle |
|------|------|-----------------|------|
| `otpDigits` | `string[6]` | `['','','','','','']` | 6 chiffres OTP |
| `newPassword` | `string` | `''` | Nouveau mot de passe |
| `confirmPassword` | `string` | `''` | Confirmation |
| `isLoading` | `boolean` | `false` | Envoi en cours |
| `error` | `string \| null` | `null` | Erreur |
| `success` | `boolean` | `false` | Succès |

---

## Refs OTP

```ts
const digitRefs = useRef<Array<HTMLInputElement | null>>(Array(6).fill(null));
```

Un ref par champ digit, permettant la navigation programmatique.

---

## Navigation OTP — comportements clavier

### Saisie d'un chiffre
```ts
const handleDigitChange = (index: number, value: string) => {
  if (!/^\d$/.test(value)) return; // Chiffre uniquement
  const newDigits = [...otpDigits];
  newDigits[index] = value;
  setOtpDigits(newDigits);
  // Avancer automatiquement au champ suivant
  if (index < 5) digitRefs.current[index + 1]?.focus();
};
```

### Backspace
```ts
const handleKeyDown = (index: number, e: KeyboardEvent) => {
  if (e.key === 'Backspace') {
    if (otpDigits[index]) {
      // Effacer le chiffre courant
      const newDigits = [...otpDigits];
      newDigits[index] = '';
      setOtpDigits(newDigits);
    } else if (index > 0) {
      // Reculer au champ précédent
      digitRefs.current[index - 1]?.focus();
    }
  } else if (e.key === 'Enter') {
    handleSubmit();
  }
};
```

### Coller (paste)
```ts
const handlePaste = (e: ClipboardEvent) => {
  e.preventDefault();
  const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
  const digits = pasted.split('');
  setOtpDigits([...digits, ...Array(6 - digits.length).fill('')]);
  // Focus sur le dernier champ rempli ou le suivant
  digitRefs.current[Math.min(digits.length, 5)]?.focus();
};
```

---

## Appels API

| Fonction | Module | Paramètres |
|----------|--------|-----------|
| `resetPassword(token, otp, newPassword)` | `src/api/auth.ts` | `token` de l'URL, code OTP concaténé, nouveau mot de passe |

---

## Validation côté client

- Les 6 digits doivent être remplis
- `newPassword` et `confirmPassword` doivent correspondre
- `newPassword` doit respecter les contraintes de sécurité (longueur min, etc.)

---

## Utilisation typique

```tsx
<ResetPasswordForm
  token={resetToken}
  onSwitchToLogin={() => setCurrentView('login')}
/>
```

---

## Note — Pattern partagé avec `VerifyEmailForm`

`VerifyEmailForm` utilise **exactement le même pattern** de saisie OTP (6 digits, refs, paste, backspace). La seule différence est l'appel API de destination.
