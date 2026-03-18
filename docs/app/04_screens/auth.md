# Écrans — Authentification

## `LoginScreen`

**Chemin** : `src/screens/auth/LoginScreen.tsx`

Écran de connexion principal de l'application.

### Fonctionnalités

- Formulaire email / mot de passe
- Gestion du flux 2FA : si le compte a la double authentification activée, l'API retourne `requiresTwoFactor: true` et un `tempToken`. L'utilisateur est redirigé vers la saisie du code TOTP
- Affichage des erreurs (mauvais identifiants, compte bloqué, rate limit)
- Lien vers l'écran `ForgotPassword`

### Flux de connexion

```
Utilisateur → Saisit email + mot de passe
                    │
                    ▼
            authApi.login()
                    │
     ┌──────────────┴──────────────┐
     │                             │
requiresTwoFactor: false    requiresTwoFactor: true
     │                             │
     ▼                             ▼
BottomTabNavigator        Saisie code TOTP
                                   │
                          authApi.complete2FALogin()
                                   │
                                   ▼
                          BottomTabNavigator
```

### Actions disponibles dans `AuthContext`

```typescript
// Connexion standard
const result = await login(email, password);

// Si 2FA requis
if (result.requiresTwoFactor) {
  const { tempToken } = result;
  await complete2FALogin(tempToken, totpCode);
}
```

---

## `ForgotPasswordScreen`

**Chemin** : `src/screens/auth/ForgotPasswordScreen.tsx`

Écran de réinitialisation du mot de passe.

### Fonctionnalités

- Saisie de l'adresse email
- Envoi d'un email de réinitialisation via l'API
- Confirmation visuelle de l'envoi
- Retour vers `LoginScreen`
