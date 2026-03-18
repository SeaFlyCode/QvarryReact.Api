# Composant `RegisterForm`

## Localisation

```
src/components/auth/RegisterForm.tsx
```

---

## Vue d'ensemble

Formulaire d'inscription avec validation côté client, Cloudflare Turnstile, et gestion des erreurs serveur détaillées (email déjà utilisé, pseudo pris, etc.).

---

## Interface / Props

```ts
interface RegisterFormProps {
  onSwitchToLogin: () => void;
}
```

---

## États internes

| État | Type | Valeur initiale | Rôle |
|------|------|-----------------|------|
| `username` | `string` | `''` | Pseudo |
| `email` | `string` | `''` | Email |
| `password` | `string` | `''` | Mot de passe |
| `confirmPassword` | `string` | `''` | Confirmation mot de passe |
| `isLoading` | `boolean` | `false` | Envoi en cours |
| `error` | `string \| null` | `null` | Erreur générale |
| `fieldErrors` | `Record<string, string>` | `{}` | Erreurs par champ |
| `success` | `boolean` | `false` | Inscription réussie |
| `registerTurnstileToken` | `string` | `''` | Token Cloudflare Turnstile |

---

## Validation côté client

- `username` : requis, 3-30 caractères, alphanumériques + underscore
- `email` : requis, format email valide
- `password` : requis, longueur minimum (8 chars), complexité
- `confirmPassword` : doit correspondre à `password`
- `registerTurnstileToken` : requis (Turnstile doit être validé)

---

## Appels API

| Fonction | Module | Paramètres |
|----------|--------|-----------|
| `register(username, email, password, turnstileToken)` | `src/api/auth.ts` | Données du formulaire |

---

## Gestion des erreurs serveur

| Code | Champ concerné | Message |
|------|---------------|---------|
| `EMAIL_ALREADY_EXISTS` | `email` | "Cet email est déjà utilisé" |
| `USERNAME_ALREADY_EXISTS` | `username` | "Ce pseudo est déjà pris" |
| `INVALID_EMAIL` | `email` | "Format d'email invalide" |
| `WEAK_PASSWORD` | `password` | "Mot de passe trop faible" |
| `TURNSTILE_FAILED` | général | "Vérification anti-bot échouée" |
| Autres | général | Message serveur |

---

## Après succès

Affiche un message de confirmation invitant l'utilisateur à vérifier son email. Ne redirige pas automatiquement.

```tsx
{success && (
  <div className="success-message">
    <p>Inscription réussie ! Vérifiez votre email pour activer votre compte.</p>
    <button onClick={onSwitchToLogin}>Retour à la connexion</button>
  </div>
)}
```

---

## Intégration Turnstile

```tsx
<Turnstile
  onVerify={(token) => setRegisterTurnstileToken(token)}
  onExpire={() => setRegisterTurnstileToken('')}
/>
```

---

## Utilisation typique

```tsx
<RegisterForm
  onSwitchToLogin={() => setCurrentView('login')}
/>
```
