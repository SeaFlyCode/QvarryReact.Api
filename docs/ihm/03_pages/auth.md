# Page Auth (Login / Register / Forgot / Reset / Verify)

## Vue d'ensemble

Page d'entrée unique de l'application. Gère cinq vues distinctes au sein d'un même composant SPA sans navigation de page. Sur mobile, force automatiquement le mode `register`. Inclut une protection anti-boucle infinie basée sur `sessionStorage`.

---

## Route & fichier source

| Élément | Valeur |
|---------|--------|
| Route Next.js | `/` |
| Fichier | `src/app/page.tsx` |
| Rendu | Client (`'use client'`) |

---

## Type `ViewMode`

```ts
type ViewMode = 'login' | 'register' | 'forgot' | 'reset' | 'verify';
```

---

## États internes

| État | Type | Valeur initiale | Rôle |
|------|------|-----------------|------|
| `currentView` | `ViewMode` | `'login'` | Vue actuellement affichée |
| `isCheckingSession` | `boolean` | `true` | Affiche un spinner pendant la vérification de session |
| `resetToken` | `string` | `''` | Token de réinitialisation extrait de l'URL (`?token=`) |
| `verifyToken` | `string` | `''` | Token de vérification d'email extrait de l'URL (`?token=`) |

---

## Refs

| Ref | Type | Rôle |
|-----|------|------|
| `sessionCheckDoneRef` | `boolean` | Empêche la double exécution du `useEffect` en mode StrictMode React |

---

## Props / Params URL

Aucune prop (page Next.js). Paramètres URL lus via `useSearchParams()` :

| Paramètre | Usage |
|-----------|-------|
| `?token=` | Token pour les vues `reset` et `verify` |
| `?admin=true` | Désactive la détection mobile (accès admin depuis téléphone) |

---

## Flux principal

```
Montage du composant
  └─ useEffect (une seule exécution via sessionCheckDoneRef)
        ├─ checkAuth()
        │     ├─ authenticated: true  → router.push('/dashboard')
        │     └─ authenticated: false
        │           ├─ Lecture sessionStorage: authFailureCount + authFailureTime
        │           ├─ Si count ≥ 3 dans fenêtre 10s → STOP (anti-boucle)
        │           ├─ Incrément authFailureCount
        │           ├─ Détection URL: ?token= → setCurrentView('reset' | 'verify')
        │           ├─ Détection mobile (isMobileOrTablet && !?admin=true) → setCurrentView('register')
        │           └─ setIsCheckingSession(false)
        └─ catch(error) → setIsCheckingSession(false)
```

---

## Anti-boucle infinie (sessionStorage)

Protection critique contre les redirections en boucle `/` ↔ `/dashboard` :

```ts
const authFailureCount = parseInt(sessionStorage.getItem('authFailureCount') || '0');
const authFailureTime  = parseInt(sessionStorage.getItem('authFailureTime')  || '0');
const now = Date.now();

if (authFailureCount >= 3 && (now - authFailureTime) < 10000) {
  // Arrêt silencieux — ne pas changer la vue, ne pas relancer
  setIsCheckingSession(false);
  return;
}

sessionStorage.setItem('authFailureCount', String(authFailureCount + 1));
sessionStorage.setItem('authFailureTime',  String(now));
```

- Fenêtre de détection : **10 secondes**
- Seuil : **3 échecs**

---

## Composants enfants

| Composant | Vue concernée | Fichier |
|-----------|---------------|---------|
| `<LoginForm />` | `login` | `src/components/auth/LoginForm.tsx` |
| `<RegisterForm />` | `register` | `src/components/auth/RegisterForm.tsx` |
| `<ForgotPasswordForm />` | `forgot` | `src/components/auth/ForgotPasswordForm.tsx` |
| `<ResetPasswordForm token={resetToken} />` | `reset` | `src/components/auth/ResetPasswordForm.tsx` |
| `<VerifyEmailForm token={verifyToken} />` | `verify` | `src/components/auth/VerifyEmailForm.tsx` |
| `<AuthTips />` | Toutes | `src/components/auth/AuthTips.tsx` |
| `<MobileBlocker />` | Toutes | `src/components/layout/MobileBlocker.tsx` |

Callbacks de navigation passés aux formulaires :
- `onSwitchToRegister`, `onSwitchToLogin`, `onSwitchToForgot` → `setCurrentView(...)`

---

## Appels API

| Fonction | Module | Moment |
|----------|--------|--------|
| `checkAuth()` | `src/api/auth.ts` | Au montage (une fois) |

---

## Comportements spéciaux

### Détection mobile
- Utilise le contexte `useMobile()` → `isMobileOrTablet`
- Si `isMobileOrTablet === true` ET absence de `?admin=true` → force `currentView = 'register'`
- `?admin=true` permet à un administrateur d'accéder au login depuis un téléphone

### Spinner de chargement
- Tant que `isCheckingSession === true` : affichage d'un écran spinner plein écran
- Évite un flash du formulaire avant la redirection vers `/dashboard`

### Token URL
- Si `?token=` présent ET vue non définie : détecte le contexte (reset vs verify) selon d'autres params ou logique interne
- Les tokens sont stockés dans les états `resetToken` / `verifyToken` et passés aux composants enfants

---

## Extrait de code clé

```tsx
useEffect(() => {
  if (sessionCheckDoneRef.current) return;
  sessionCheckDoneRef.current = true;

  const performCheck = async () => {
    try {
      const result = await checkAuth();
      if (result.authenticated) {
        router.push('/dashboard');
        return;
      }

      // Protection anti-boucle
      const count = parseInt(sessionStorage.getItem('authFailureCount') || '0');
      const time  = parseInt(sessionStorage.getItem('authFailureTime')  || '0');
      if (count >= 3 && Date.now() - time < 10000) {
        setIsCheckingSession(false);
        return;
      }
      sessionStorage.setItem('authFailureCount', String(count + 1));
      sessionStorage.setItem('authFailureTime',  String(Date.now()));

      // Tokens URL
      const token = searchParams.get('token');
      if (token) { /* setCurrentView('reset' | 'verify') */ }

      // Mobile
      if (isMobileOrTablet && !searchParams.get('admin')) {
        setCurrentView('register');
      }
    } finally {
      setIsCheckingSession(false);
    }
  };

  performCheck();
}, []);
```
