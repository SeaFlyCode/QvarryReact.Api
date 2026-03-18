# Page Partage

## Vue d'ensemble

Gestion des données partagées avec l'utilisateur. Deux onglets : partages reçus et partages envoyés. Mise à jour optimiste lors de l'acceptation d'un partage, protégée contre l'écrasement via `skipNextReload`.

---

## Route & fichier source

| Élément | Valeur |
|---------|--------|
| Route Next.js | `/partage` |
| Fichier | `src/app/partage/page.tsx` |
| Rendu | Client (`'use client'`) |

---

## États internes

| État | Type | Valeur initiale | Rôle |
|------|------|-----------------|------|
| `activeTab` | `'received' \| 'sent'` | `'received'` | Onglet actif |
| `receivedShares` | `Share[]` | `[]` | Partages reçus |
| `sentShares` | `Share[]` | `[]` | Partages envoyés |
| `isLoading` | `boolean` | `true` | Chargement |
| `statusFilter` | `string` | `'all'` | Filtre par statut |
| `includeExpired` | `boolean` | `false` | Inclure les partages expirés |
| `expandedShareId` | `string \| null` | `null` | Partage envoyé dont les détails sont visibles |

---

## Ref critique

| Ref | Type | Rôle |
|-----|------|------|
| `skipNextReload` | `boolean` | Empêche l'écrasement de la mise à jour optimiste locale lors du prochain rechargement déclenché par l'event listener |

---

## Flux d'acceptation d'un partage

```
Clic "Accepter" sur un partage reçu
  ├─ skipNextReload.current = true
  ├─ acceptShare(shareId)
  ├─ Mise à jour optimiste locale : share.status = 'accepted'
  ├─ invalidatePointsCache()
  └─ window.dispatchEvent(new Event('dataSharedAccepted'))
       → Dashboard recharge ses points
```

### Pourquoi `skipNextReload` ?
L'event `dataSharedAccepted` est aussi écouté par cette page pour se resynchroniser. Sans ce flag, le rechargement écraserait la mise à jour optimiste avant que le serveur confirme le nouveau statut.

---

## Appels API

| Fonction | Module | Endpoint | Description |
|----------|--------|----------|-------------|
| `getReceivedShares()` | `src/api/share.ts` | `GET /share/received` | Partages reçus |
| `getSentShares()` | `src/api/share.ts` | `GET /share/sent` | Partages envoyés |
| `acceptShare(id)` | `src/api/share.ts` | `POST /share/:id/accept` | Accepter un partage |
| `rejectShare(id)` | `src/api/share.ts` | `POST /share/:id/reject` | Refuser un partage |
| `revokeShare(id)` | `src/api/share.ts` | `DELETE /share/:id` | Révoquer un envoi |
| `invalidatePointsCache()` | `src/api/points.ts` | — | Invalide le cache local |

---

## Filtre par statut

```ts
type ShareStatus = 'all' | 'pending' | 'accepted' | 'rejected' | 'expired' | 'revoked';
```

---

## Toggle "Inclure les expirés"

```tsx
<label>
  <input
    type="checkbox"
    checked={includeExpired}
    onChange={e => setIncludeExpired(e.target.checked)}
  />
  Inclure les partages expirés
</label>
```

---

## Partages envoyés — détails expandables

Clic sur un partage envoyé → `setExpandedShareId(id)` (toggle).

Contenu visible en expanded :
- Type de données partagées (`DataType`)
- Date d'expiration
- Statut de signature (`signatureValid`)
- Destinataire

---

## Détection de tamper

`getSharedData()` (dans `src/api/share.ts`) lève une erreur si `response.data?.tampered === true`. Cette page affiche une alerte de sécurité dans ce cas.

---

## Extrait de code clé

```tsx
const handleAccept = async (shareId: string) => {
  // Protéger la mise à jour optimiste
  skipNextReload.current = true;

  // Mise à jour optimiste immédiate
  setReceivedShares(prev =>
    prev.map(s => s.id === shareId ? { ...s, status: 'accepted' } : s)
  );

  try {
    await acceptShare(shareId);
    invalidatePointsCache();
    window.dispatchEvent(new Event('dataSharedAccepted'));
  } catch {
    // Rollback en cas d'erreur
    skipNextReload.current = false;
    setReceivedShares(prev =>
      prev.map(s => s.id === shareId ? { ...s, status: 'pending' } : s)
    );
  }
};
```
