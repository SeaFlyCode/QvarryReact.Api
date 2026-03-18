# Page Admin — Dashboard

## Vue d'ensemble

Vue d'ensemble de l'espace d'administration. Affiche des statistiques globales (utilisateurs, fiches, activité) et des raccourcis vers les sous-sections admin. Protégée : redirige vers `/dashboard` si l'utilisateur n'est pas admin.

---

## Route & fichier source

| Élément | Valeur |
|---------|--------|
| Route Next.js | `/admin` |
| Fichier | `src/app/admin/page.tsx` |
| Layout | `src/app/admin/layout.tsx` |
| Rendu | Client (`'use client'`) |

---

## Layout Admin (`admin/layout.tsx`)

### Rôle
Le layout admin est responsable de :
1. **Vérification des droits** : appelle `checkAuth()` + vérifie `isAdmin` au montage → redirige vers `/dashboard` si non-admin
2. **Sidebar collapsible** : état `sidebarCollapsed` (boolean) persisté localement
3. **Badge "En attente"** : charge `getPendingUsersCount()` pour afficher le nombre de demandes en attente sur le lien nav

### État interne (layout)

| État | Type | Rôle |
|------|------|------|
| `sidebarCollapsed` | `boolean` | Sidebar réduite ou étendue |
| `pendingUsersCount` | `number` | Nombre d'utilisateurs en attente d'approbation |
| `currentUser` | `User \| null` | Utilisateur courant (pour vérifier `is_admin`) |

### Navigation (layout)

| Libellé | Route | Options |
|---------|-------|---------|
| Dashboard | `/admin` | `exact: true` |
| Utilisateurs | `/admin/users` | — |
| En attente | `/admin/users/pending` | Badge avec `pendingUsersCount` |
| Audit | `/admin/audit` | — |
| Sécurité | `/admin/security` | — |
| SOS | `/admin/sos` | `excludePaths: ['/admin/sos/sessions', '/admin/sos/history', '/admin/sos/stats']` |

### Fonction `isActive()`
Calcule si un lien de nav est actif selon :
- `exact: true` → correspondance exacte du pathname
- `excludePaths` → désactive l'état actif si le pathname commence par un des chemins exclus

---

## Appels API (layout)

| Fonction | Module | Moment |
|----------|--------|--------|
| `checkAuth()` | `src/api/auth.ts` | Au montage |
| `getPendingUsersCount()` | `src/api/admin.ts` | Au montage, après vérification admin |

---

## États internes (page `/admin`)

| État | Type | Rôle |
|------|------|------|
| `stats` | `AdminStats \| null` | Statistiques globales |
| `isLoading` | `boolean` | Chargement des stats |

---

## Appels API (page)

| Fonction | Module | Endpoint | Moment |
|----------|--------|----------|--------|
| `getAdminStats()` | `src/api/admin.ts` | `GET /admin/stats` | Au montage |

---

## Composants enfants (page)

| Composant | Rôle |
|-----------|------|
| `<StatCard>` | Carte de statistique individuelle (utilisateurs totaux, actifs, fiches, etc.) |
| `<QuickAccessGrid>` | Grille de raccourcis vers les sous-sections admin |

---

## Comportements spéciaux

### Vérification admin (layout)
```ts
useEffect(() => {
  const check = async () => {
    const auth = await checkAuth();
    if (!auth.authenticated || !auth.user?.is_admin) {
      router.push('/dashboard');
    }
    setCurrentUser(auth.user);
  };
  check();
}, []);
```

### Sidebar collapsible
- Le bouton de collapse est dans le header de la sidebar
- En mode collapsed : seules les icônes sont visibles (pas de libellés)
- L'état n'est pas persisté en `localStorage` (reset au rechargement)
