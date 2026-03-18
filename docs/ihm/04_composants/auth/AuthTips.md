# Composant `AuthTips`

## Localisation

```
src/components/auth/AuthTips.tsx
```

---

## Vue d'ensemble

Panneau latéral de la page d'authentification affichant des conseils spéléologiques et miniers. 100 conseils statiques, rotation automatique toutes les 12 secondes, sans répétition consécutive.

---

## Interface / Props

Aucune prop. Composant autonome.

```ts
// Pas de props
export default function AuthTips() { ... }
```

---

## États internes

| État | Type | Rôle |
|------|------|------|
| `currentTipIndex` | `number` | Index du conseil actuellement affiché |

---

## Données statiques

```ts
// 100 conseils numérotés
const TIPS: string[] = [
  "Vérifiez toujours votre équipement avant d'entrer dans une galerie.",
  "Ne jamais explorer seul — toujours en groupe d'au moins 3 personnes.",
  // ... 98 autres conseils
];
```

---

## Rotation sans répétition consécutive

```ts
useEffect(() => {
  const interval = setInterval(() => {
    setCurrentTipIndex(prev => {
      let next: number;
      do {
        next = Math.floor(Math.random() * TIPS.length);
      } while (next === prev); // Évite la répétition immédiate
      return next;
    });
  }, 12_000); // 12 secondes

  return () => clearInterval(interval);
}, []);
```

---

## Rendu

Affiche le conseil courant avec une animation CSS de transition (fade in/out). Le numéro du conseil est affiché sous forme "X / 100".

---

## Utilisation typique

```tsx
// Dans src/app/page.tsx
<div className="hidden lg:flex w-1/2">
  <AuthTips />
</div>
```

Visible uniquement sur écrans larges (≥ lg breakpoint Tailwind), masqué sur mobile.
