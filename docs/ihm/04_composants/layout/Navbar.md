# Composant `Navbar`

## Localisation

```
src/components/layout/Navbar.tsx
```

---

## Vue d'ensemble

Barre de navigation supérieure. Invisible sur la page d'authentification (`/`). Détecte le scroll pour basculer entre style transparent et style "frosted glass". Affiche un lien admin si l'utilisateur est administrateur.

---

## Interface / Props

Aucune prop. Composant autonome qui charge ses données lui-même.

```ts
// Pas de props
export default function Navbar() { ... }
```

---

## États internes

| État | Type | Valeur initiale | Rôle |
|------|------|-----------------|------|
| `currentUser` | `User \| null` | `null` | Utilisateur connecté |
| `isScrolled` | `boolean` | `false` | Scroll détecté (> 10px) |
| `isMobileMenuOpen` | `boolean` | `false` | Menu hamburger mobile ouvert |

---

## Rendu conditionnel — routes exclues

```ts
const pathname = usePathname();

// Pas de Navbar sur la page d'auth
if (pathname === '/' || pathname === '/login') return null;
```

---

## Chargement de l'utilisateur

```ts
useEffect(() => {
  // Ne charge pas sur '/' (inutile + évite un appel API sur la page de login)
  if (pathname === '/') return;

  getCurrentUser()
    .then(setCurrentUser)
    .catch(() => {}); // Silencieux — l'AuthGuard gère les erreurs d'auth
}, [pathname]);
```

---

## Détection du scroll

```ts
useEffect(() => {
  const handleScroll = () => setIsScrolled(window.scrollY > 10);
  window.addEventListener('scroll', handleScroll, { passive: true });
  return () => window.removeEventListener('scroll', handleScroll);
}, []);
```

### Styles selon le scroll

| État | Classe CSS / Style |
|------|--------------------|
| `!isScrolled` | Fond transparent, texte vert clair |
| `isScrolled` | `backdrop-blur`, fond semi-transparent (frosted glass) |

---

## Lien Admin

```tsx
{currentUser?.is_admin && (
  <Link href="/admin" className="admin-link">
    Administration
  </Link>
)}
```

---

## Appels API

| Fonction | Module | Moment |
|----------|--------|--------|
| `getCurrentUser()` | `src/api/user.ts` | Au montage (si pas sur `/`) |

---

## Navigation principale

| Lien | Route |
|------|-------|
| Dashboard | `/dashboard` |
| Fiches | `/fiches` |
| Conversations | `/conversations` |
| Partages | `/partage` |
| Import | `/import` |
| Profil | `/profil` |
| Administration | `/admin` (si admin) |

---

## Utilisation typique

```tsx
// Dans dashboard/layout.tsx
export default function DashboardLayout({ children }) {
  return (
    <>
      <Navbar />
      <main>{children}</main>
    </>
  );
}
```
