# Composant `AuthGuard`

## Localisation

```
src/components/auth/AuthGuard.tsx
```

---

## Vue d'ensemble

Garde d'authentification qui protège les routes privées. Vérifie la session au montage et redirige vers `/` si non authentifié. Intègre une protection anti-boucle infinie via `sessionStorage` et gère les états réseau avec des bandeaux d'information distincts (offline vs erreur réseau initiale).

---

## Interface / Props

```ts
interface AuthGuardProps {
  children: React.ReactNode;
}
```

---

## États internes

| État | Type | Valeur initiale | Rôle |
|------|------|-----------------|------|
| `isVerifying` | `boolean` | `true` | Vérification en cours (spinner) |
| `isAuthenticated` | `boolean` | `false` | Session validée |
| `showOfflineBanner` | `boolean` | `false` | Bandeau "mode hors ligne" (déjà authentifié auparavant) |
| `showNetworkError` | `boolean` | `false` | Écran d'erreur réseau (premier check échoue) |

---

## Refs

| Ref | Type | Rôle |
|-----|------|------|
| `verificationCountRef` | `number` | Nombre de vérifications effectuées dans la session |
| `lastPathRef` | `string` | Dernier pathname vérifié (évite les re-vérifications pour le même chemin) |
| `authFailureCountRef` | `number` | Nombre d'échecs d'auth dans la fenêtre temporelle |
| `lastAuthFailureRef` | `number` | Timestamp du dernier échec (ms) |

---

## Protection anti-boucle infinie

```ts
const FAILURE_WINDOW_MS = 10_000; // 10 secondes
const MAX_FAILURES      = 3;

// Dans le handler d'échec :
const now = Date.now();
const count = parseInt(sessionStorage.getItem('authFailureCount') || '0');
const time  = parseInt(sessionStorage.getItem('authFailureTime')  || '0');

if (count >= MAX_FAILURES && (now - time) < FAILURE_WINDOW_MS) {
  // Arrêt — ne pas rediriger, ne pas spinner indéfiniment
  setIsVerifying(false);
  return;
}

sessionStorage.setItem('authFailureCount', String(count + 1));
sessionStorage.setItem('authFailureTime',  String(now));
router.push('/');
```

---

## Distinction erreur réseau vs échec auth

```ts
if (result.error === 'network_error') {
  // Le serveur est inaccessible
  if (wasAuthenticatedBefore) {
    setShowOfflineBanner(true);  // Bandeau discret — peut continuer
    setIsAuthenticated(true);    // Optimiste : on laisse passer
  } else {
    setShowNetworkError(true);   // Écran bloquant
  }
} else {
  // Vrai échec d'auth → redirect
}
```

`wasAuthenticatedBefore` : déterminé par la présence d'un cookie de session ou d'un flag `localStorage`.

---

## Comportements spéciaux

### Écoute `auth-state-change`
```ts
window.addEventListener('auth-state-change', handleAuthChange);
```
Déclenché par `checkAuth()` et `forceSessionExpiration()`. Permet au guard de réagir immédiatement à une expiration de session.

### Déduplication
`lastPathRef` évite de re-vérifier si l'utilisateur revient sur le même chemin sans changement d'état.

### Spinner
Tant que `isVerifying === true`, le composant rend uniquement `<LoadingScreen />`.

---

## Flux principal

```
Montage
  └─ checkAuth()
        ├─ authenticated: true
        │     └─ setIsAuthenticated(true), setIsVerifying(false)
        │           → render {children}
        │
        ├─ authenticated: false (réseau OK)
        │     └─ Anti-boucle → router.push('/')
        │
        └─ network_error
              ├─ Déjà authentifié → bandeau offline + passe children
              └─ Premier check  → écran d'erreur réseau
```

---

## Rendu conditionnel

```tsx
if (isVerifying) return <LoadingScreen />;
if (showNetworkError) return <NetworkErrorScreen onRetry={retry} />;

return (
  <>
    {showOfflineBanner && <OfflineBanner />}
    {children}
  </>
);
```

---

## Utilisation typique

```tsx
// Dans dashboard/layout.tsx
export default function DashboardLayout({ children }) {
  return (
    <AuthGuard>
      <Navbar />
      {children}
    </AuthGuard>
  );
}
```
