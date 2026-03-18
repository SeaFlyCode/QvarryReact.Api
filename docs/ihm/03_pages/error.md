# Pages d'erreur (Error Boundary)

## Vue d'ensemble

Deux composants d'erreur React distincts : `error.tsx` (erreurs dans les layouts/pages) et `global-error.tsx` (erreurs dans le root layout). Les deux intègrent Sentry.

---

## `error.tsx` — Erreur de page/layout

### Route & fichier source

| Élément | Valeur |
|---------|--------|
| Convention Next.js | `error.tsx` dans `src/app/` |
| Fichier | `src/app/error.tsx` |
| Rendu | Client (`'use client'`) obligatoire pour les error boundaries |

### Props

```ts
// Interface Next.js standard pour error.tsx
{
  error: Error & { digest?: string };
  reset: () => void;
}
```

### Comportements

**Sentry** :
```ts
useEffect(() => {
  Sentry.captureException(error);
}, [error]);
```

**Message d'erreur conditionnel** :
```tsx
{process.env.NODE_ENV === 'development' && (
  <pre className="text-xs text-red-400 mt-2">{error.message}</pre>
)}
```

En **production** : message générique uniquement, pas de stack trace visible.

**Bouton reset** :
```tsx
<button onClick={reset}>
  Réessayer
</button>
```

---

## `global-error.tsx` — Erreur globale (root layout)

### Route & fichier source

| Élément | Valeur |
|---------|--------|
| Convention Next.js | `global-error.tsx` dans `src/app/` |
| Fichier | `src/app/global-error.tsx` |
| Rendu | Client (`'use client'`) |

### Contrainte critique

Ce composant doit rendre ses propres `<html>` et `<body>` car il remplace le root layout en cas d'erreur :

```tsx
export default function GlobalError({ error, reset }: GlobalErrorProps) {
  return (
    <html>
      <body>
        {/* Contenu d'erreur */}
      </body>
    </html>
  );
}
```

### Styles inline

**Pas de classes Tailwind** — le CSS de Tailwind peut ne pas être chargé si le root layout a échoué. Les styles sont donc **tous en inline** :

```tsx
<div style={{ minHeight: '100vh', background: '#0f172a', color: '#f1f5f9', display: 'flex' }}>
```

### Navigation

Utilise `<a href="/">` (pas `<Link>`) car Next.js router peut ne pas être disponible.

### Sentry

```ts
useEffect(() => {
  Sentry.captureException(error);
}, [error]);
```

---

## Comparatif

| Caractéristique | `error.tsx` | `global-error.tsx` |
|-----------------|-------------|-------------------|
| Portée | Erreurs dans layouts/pages | Erreurs dans le root layout |
| Rendu HTML/body | Non (hérite du layout) | **Oui** (obligatoire) |
| Styles | Tailwind | Inline uniquement |
| Navigation | `<Link>` | `<a href="/">` |
| Sentry | ✅ | ✅ |
| Message en dev | `error.message` visible | `error.message` visible |
