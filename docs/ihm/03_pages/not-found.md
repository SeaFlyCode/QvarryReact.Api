# Page 404 (Not Found)

## Vue d'ensemble

Page d'erreur 404. Thème sombre avec animation du nombre "404", particules flottantes en CSS, et bouton de retour via `window.history.back()`.

---

## Route & fichier source

| Élément | Valeur |
|---------|--------|
| Route Next.js | Automatique pour les routes inexistantes |
| Fichier | `src/app/not-found.tsx` |
| Rendu | Client (`'use client'`) |

---

## Caractéristiques visuelles

- **Thème** : dark (fond sombre)
- **Animation** : le "404" est animé (CSS keyframes)
- **Particules flottantes** : éléments CSS positionnés aléatoirement, animés via `@keyframes float`
- **Pas de Navbar** : layout minimaliste

---

## Comportement du bouton retour

```tsx
<button onClick={() => window.history.back()}>
  Retour
</button>
```

Utilise `window.history.back()` (pas `router.back()`) — fonctionne même si le hook `useRouter` n'est pas disponible dans ce contexte.

---

## Aucun appel API

Cette page ne fait aucun appel réseau.

---

## Lien vers l'accueil

En complément du bouton retour, un lien `<Link href="/">` permet de retourner à l'accueil.
