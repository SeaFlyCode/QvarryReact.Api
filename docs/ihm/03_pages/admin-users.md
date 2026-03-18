# Page Admin — Utilisateurs

## Vue d'ensemble

Gestion des utilisateurs. Liste paginée avec recherche debounce, filtres (tous / bloqués / admins / non vérifiés), et un menu contextuel par utilisateur rendu via `createPortal` pour éviter les problèmes de z-index.

---

## Route & fichier source

| Élément | Valeur |
|---------|--------|
| Route Next.js | `/admin/users` |
| Fichier | `src/app/admin/users/page.tsx` |
| Rendu | Client (`'use client'`) |

---

## Composants inline

### `UserRow`
Ligne de tableau pour un utilisateur. Utilise `createPortal` pour le menu contextuel.

**Particularité critique** : le menu est rendu via `createPortal(menu, document.body)` pour éviter qu'il soit clippé par un parent `overflow: hidden`. La position est calculée dynamiquement :

```ts
const rect = buttonRef.current.getBoundingClientRect();
setMenuPosition({ top: rect.bottom + 8, left: rect.right - 200 });
```

**Actions du menu** :
| Action | Condition d'affichage | Fonction API |
|--------|----------------------|--------------|
| Voir les détails | Toujours | `getUserDetails(id)` |
| Bloquer | `!user.is_blocked` | `blockUser(id, reason)` |
| Débloquer | `user.is_blocked` | `unblockUser(id)` |
| Promouvoir admin | `!user.is_admin` | `promoteToAdmin(id)` |
| Rétrograder | `user.is_admin` | `demoteFromAdmin(id)` |
| Reset mot de passe | Toujours | `resetUserPassword(id)` |
| Forcer déconnexion | Toujours | `forceLogoutUser(id)` |

### `UserDetailsModal`
Modal de détails utilisateur. Affiche :
- Informations de profil
- Statistiques : `points`, `fiches`, `lists`, `activeSessions`

---

## États internes

| État | Type | Valeur initiale | Rôle |
|------|------|-----------------|------|
| `users` | `User[]` | `[]` | Utilisateurs affichés |
| `isLoading` | `boolean` | `true` | Chargement |
| `searchQuery` | `string` | `''` | Texte de recherche |
| `filter` | `FilterType` | `'all'` | Filtre actif |
| `page` | `number` | `1` | Page courante |
| `totalPages` | `number` | `1` | Total des pages |
| `selectedUser` | `User \| null` | `null` | Utilisateur dans `UserDetailsModal` |
| `menuPosition` | `{top,left} \| null` | `null` | Position du menu contextuel |
| `activeMenuUserId` | `string \| null` | `null` | User dont le menu est ouvert |

### Type `FilterType`

```ts
type FilterType = 'all' | 'blocked' | 'admins' | 'unverified';
```

---

## Debounce recherche

```ts
useEffect(() => {
  const timer = setTimeout(() => fetchUsers(), 300);
  return () => clearTimeout(timer);
}, [searchQuery, filter, page]);
```

---

## Appels API

| Fonction | Module | Endpoint | Paramètres |
|----------|--------|----------|-----------|
| `getUsers()` | `src/api/admin.ts` | `GET /admin/users` | `search`, `filter`, `page` |
| `getUserDetails(id)` | `src/api/admin.ts` | `GET /admin/users/:id` | — |
| `blockUser(id, reason)` | `src/api/admin.ts` | `POST /admin/users/:id/block` | `reason` |
| `unblockUser(id)` | `src/api/admin.ts` | `POST /admin/users/:id/unblock` | — |
| `promoteToAdmin(id)` | `src/api/admin.ts` | `POST /admin/users/:id/promote` | — |
| `demoteFromAdmin(id)` | `src/api/admin.ts` | `POST /admin/users/:id/demote` | — |
| `resetUserPassword(id)` | `src/api/admin.ts` | `POST /admin/users/:id/reset-password` | — |
| `forceLogoutUser(id)` | `src/api/admin.ts` | `POST /admin/users/:id/force-logout` | — |

---

## Confirmation des actions destructives

Les actions critiques passent par `showConfirm()` (Promise-based via `ConfirmModalProvider`) :

```ts
const confirmed = await showConfirm({
  title: 'Bloquer cet utilisateur ?',
  message: `Voulez-vous bloquer ${user.username} ?`,
  confirmText: 'Bloquer',
  variant: 'danger'
});
if (confirmed) await blockUser(user.id, reason);
```

---

## Extrait de code clé — createPortal pour menu contextuel

```tsx
// Dans UserRow
const [menuPosition, setMenuPosition] = useState<{top: number; left: number} | null>(null);

const handleOpenMenu = () => {
  const rect = buttonRef.current!.getBoundingClientRect();
  setMenuPosition({
    top: rect.bottom + window.scrollY + 8,
    left: rect.right + window.scrollX - 200
  });
};

// Menu rendu en dehors du tableau pour éviter overflow:hidden
return createPortal(
  <div
    style={{ position: 'fixed', top: menuPosition.top, left: menuPosition.left }}
    className="context-menu z-50"
  >
    {/* Actions */}
  </div>,
  document.body
);
```
