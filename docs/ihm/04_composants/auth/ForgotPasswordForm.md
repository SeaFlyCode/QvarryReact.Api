# Composant `ForgotPasswordForm`

## Localisation

```
src/components/auth/ForgotPasswordForm.tsx
```

---

## Vue d'ensemble

Formulaire de demande de réinitialisation de mot de passe. Envoie un email avec un lien/code de réinitialisation. Simple formulaire à un seul champ.

---

## Interface / Props

```ts
interface ForgotPasswordFormProps {
  onSwitchToLogin: () => void;
}
```

---

## États internes

| État | Type | Valeur initiale | Rôle |
|------|------|-----------------|------|
| `email` | `string` | `''` | Adresse email |
| `isLoading` | `boolean` | `false` | Envoi en cours |
| `error` | `string \| null` | `null` | Message d'erreur |
| `success` | `boolean` | `false` | Email envoyé avec succès |

---

## Appels API

| Fonction | Module | Paramètres |
|----------|--------|-----------|
| `forgotPassword(email)` | `src/api/auth.ts` | Adresse email |

---

## Comportement post-envoi

Après succès, affiche un message générique sans confirmer si l'email existe (prévention de l'énumération d'emails) :

```
"Si cet email est associé à un compte, vous recevrez un lien de réinitialisation."
```

---

## Gestion des erreurs

| Cas | Comportement |
|-----|-------------|
| `TOO_MANY_ATTEMPTS` | "Trop de demandes. Réessayez dans X minutes" |
| Email invalide (client) | "Format d'email invalide" |
| Erreur réseau | Message générique |

---

## Utilisation typique

```tsx
<ForgotPasswordForm
  onSwitchToLogin={() => setCurrentView('login')}
/>
```
