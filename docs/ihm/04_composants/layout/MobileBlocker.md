# Composant `MobileBlocker`

## Localisation

```
src/components/layout/MobileBlocker.tsx
```

---

## Vue d'ensemble

Composant qui bloque l'accès à certaines pages sur mobile/tablette en affichant un écran d'avertissement. Utilise le contexte `useMobile()`. Gère l'état `null` (détection en cours) avec un spinner pour éviter un flash.

---

## Interface / Props

```ts
interface MobileBlockerProps {
  children:      React.ReactNode;
  allowedPaths?: string[];  // Chemins exemptés du blocage (ex: ['/privacy'])
}
```

---

## Contexte utilisé

```ts
const { isMobileOrTablet } = useMobile();
// null = détection en cours
// true = mobile ou tablette
// false = desktop
```

---

## États / valeurs du contexte

| Valeur | Rendu |
|--------|-------|
| `null` | Spinner de chargement (détection en cours) |
| `false` | `{children}` (desktop — pas de blocage) |
| `true` + path dans `allowedPaths` | `{children}` (chemin exempté) |
| `true` + path non exempté | Écran de blocage mobile |

---

## Flux de rendu

```tsx
if (isMobileOrTablet === null) {
  return <InlineSpinner />; // Évite le flash "mobile bloqué" puis "desktop OK"
}

if (!isMobileOrTablet) {
  return <>{children}</>;
}

const isAllowed = allowedPaths?.some(p => pathname.startsWith(p));
if (isAllowed) {
  return <>{children}</>;
}

return <MobileBlockScreen />;
```

---

## Écran de blocage

L'écran de blocage affiche :
- Un message expliquant que l'application est optimisée pour desktop
- Une suggestion d'utiliser un ordinateur
- Pas de lien de contournement (volontaire)

---

## Contexte `useMobile()`

Le contexte détecte le type d'appareil en combinant :
- `window.innerWidth` (breakpoint mobile)
- `navigator.userAgent` (détection tablette/mobile)
- Event listener `resize` pour les changements de taille de fenêtre

---

## Utilisation typique

```tsx
// Dans dashboard/layout.tsx
export default function DashboardLayout({ children }) {
  return (
    <AuthGuard>
      <MobileBlocker allowedPaths={['/privacy', '/maintenance']}>
        <Navbar />
        {children}
      </MobileBlocker>
    </AuthGuard>
  );
}
```
