# Page Admin — Utilisateurs en attente

## Vue d'ensemble

Liste des utilisateurs dont l'inscription est en attente d'approbation manuelle. Permet d'approuver ou rejeter chaque demande. La rejection nécessite une raison saisie via `prompt()` natif.

---

## Route & fichier source

| Élément | Valeur |
|---------|--------|
| Route Next.js | `/admin/users/pending` |
| Fichier | `src/app/admin/users/pending/page.tsx` |
| Rendu | Client (`'use client'`) |

---

## États internes

| État | Type | Valeur initiale | Rôle |
|------|------|-----------------|------|
| `pendingUsers` | `PendingUser[]` | `[]` | Utilisateurs en attente |
| `isLoading` | `boolean` | `true` | Chargement initial |
| `processingId` | `string \| null` | `null` | ID de l'utilisateur en cours de traitement (désactive les boutons) |

---

## Structure `PendingUser`

```ts
{
  id: string;
  username: string;
  email: string;
  createdAt: string;
  emailVerified: boolean;  // badge affiché si true
}
```

---

## Appels API

| Fonction | Module | Endpoint | Description |
|----------|--------|----------|-------------|
| `listPendingUsers()` | `src/api/admin.ts` | `GET /admin/users/pending` | Charge la liste |
| `approveUser(id)` | `src/api/admin.ts` | `POST /admin/users/:id/approve` | Approuve l'inscription |
| `rejectUser(id, reason)` | `src/api/admin.ts` | `POST /admin/users/:id/reject` | Rejette avec raison |

---

## Flux d'approbation

```
Clic "Approuver"
  └─ showConfirm({ title: 'Approuver ?', confirmText: 'Approuver' })
        ├─ Annulé → rien
        └─ Confirmé
              ├─ setProcessingId(user.id)
              ├─ approveUser(user.id)
              ├─ Retirer l'utilisateur de la liste locale
              └─ setProcessingId(null)
```

---

## Flux de rejet

```
Clic "Rejeter"
  └─ reason = prompt('Raison du rejet ?')
        ├─ null (annulé) → rien
        └─ string (même vide)
              ├─ showConfirm({ title: 'Rejeter ?', variant: 'danger' })
              │     ├─ Annulé → rien
              │     └─ Confirmé
              │           ├─ setProcessingId(user.id)
              │           ├─ rejectUser(user.id, reason)
              │           ├─ Retirer de la liste locale
              │           └─ setProcessingId(null)
```

**Note** : utilise `window.prompt()` natif pour la raison de rejet (pas un champ de formulaire).

---

## Badge email vérifié

Si `user.emailVerified === true`, un badge vert "Email vérifié" est affiché à côté du nom.

---

## Comportements spéciaux

### Désactivation pendant traitement
Pendant qu'une action est en cours (`processingId !== null`), tous les boutons de la ligne concernée sont `disabled` pour éviter les doubles appels.

### Mise à jour optimiste
Après `approveUser()` ou `rejectUser()`, l'utilisateur est **immédiatement retiré** de la liste locale sans rechargement :

```ts
setPendingUsers(prev => prev.filter(u => u.id !== userId));
```

---

## Extrait de code clé

```tsx
const handleReject = async (user: PendingUser) => {
  const reason = window.prompt('Raison du rejet (optionnelle) :');
  if (reason === null) return; // Annulé

  const confirmed = await showConfirm({
    title: 'Rejeter cet utilisateur ?',
    message: `Voulez-vous rejeter la demande de ${user.username} ?`,
    confirmText: 'Rejeter',
    variant: 'danger'
  });
  if (!confirmed) return;

  setProcessingId(user.id);
  try {
    await rejectUser(user.id, reason);
    setPendingUsers(prev => prev.filter(u => u.id !== user.id));
  } finally {
    setProcessingId(null);
  }
};
```
