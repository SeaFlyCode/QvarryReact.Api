# Page Maintenance

## Vue d'ensemble

Page d'affichage lors d'une maintenance applicative. Sonde l'API toutes les 30 secondes et redirige automatiquement vers `/` dès la fin de la maintenance. Affiche un compte à rebours en temps réel. Accès admin masqué déclenchable par 5 clics sur le logo ou `Ctrl+Shift+A`.

---

## Route & fichier source

| Élément | Valeur |
|---------|--------|
| Route Next.js | `/maintenance` |
| Fichier | `src/app/maintenance/page.tsx` |
| Rendu | Client (`'use client'`) |

---

## États internes

| État | Type | Valeur initiale | Rôle |
|------|------|-----------------|------|
| `maintenanceInfo` | `MaintenanceInfo \| null` | `null` | Infos de maintenance (message, fin estimée) |
| `timeLeft` | `TimeLeft` | `null` | Compte à rebours calculé |
| `showAdminAccess` | `boolean` | `false` | Affiche le bouton d'accès admin |
| `logoClickCount` | `number` | `0` | Compteur de clics sur le logo |
| `isLoading` | `boolean` | `true` | Chargement initial |

### Type `TimeLeft`

```ts
{
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
} | null
```

---

## Ref critique

| Ref | Type | Rôle |
|-----|------|------|
| `hasCheckedOnce` | `boolean` | Empêche la redirection automatique lors du **premier** check (évite de boucler si on arrive directement sur `/maintenance`) |

---

## Polling de maintenance

```ts
useEffect(() => {
  // Premier check sans redirection
  checkMaintenanceStatus(/* firstCheck = true */);

  const interval = setInterval(() => {
    checkMaintenanceStatus(/* firstCheck = false */);
  }, 30_000);

  return () => clearInterval(interval);
}, []);

const checkMaintenanceStatus = async (firstCheck = false) => {
  const status = await getMaintenanceStatus();

  if (!status.maintenance) {
    if (!firstCheck || hasCheckedOnce.current) {
      router.push('/'); // Maintenance terminée → redirection
    }
    hasCheckedOnce.current = true;
    return;
  }

  setMaintenanceInfo(status);
  hasCheckedOnce.current = true;
};
```

---

## Compte à rebours

```ts
useEffect(() => {
  if (!maintenanceInfo?.estimatedEnd) return;

  const timer = setInterval(() => {
    const diff = new Date(maintenanceInfo.estimatedEnd).getTime() - Date.now();
    if (diff <= 0) {
      setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
      return;
    }
    setTimeLeft({
      days:    Math.floor(diff / 86_400_000),
      hours:   Math.floor((diff % 86_400_000) / 3_600_000),
      minutes: Math.floor((diff % 3_600_000)  / 60_000),
      seconds: Math.floor((diff % 60_000)     / 1_000),
    });
  }, 1_000);

  return () => clearInterval(timer);
}, [maintenanceInfo]);
```

---

## Accès admin masqué

### Via clics sur le logo
```ts
const handleLogoClick = () => {
  setLogoClickCount(prev => {
    const next = prev + 1;
    if (next >= 5) setShowAdminAccess(true);
    return next;
  });
};
```

### Via raccourci clavier
```ts
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'A') {
      setShowAdminAccess(true);
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, []);
```

### Bouton admin
```tsx
{showAdminAccess && (
  <button onClick={() => router.push('/?admin=true')}>
    Accès administrateur
  </button>
)}
```

---

## Appels API

| Fonction | Module | Endpoint | Description |
|----------|--------|----------|-------------|
| `getMaintenanceStatus()` | `src/api/maintenance.ts` | `GET /maintenance/status` | Statut de la maintenance |

---

## Extrait de code clé — anti-boucle `hasCheckedOnce`

```ts
// Sans ce mécanisme, arriver sur /maintenance quand la maintenance est terminée
// déclencherait immédiatement router.push('/') qui renverrait sur /maintenance
// si le middleware redirige encore.

const hasCheckedOnce = useRef(false);

if (!status.maintenance) {
  if (hasCheckedOnce.current) {
    router.push('/'); // OK — on sait qu'on était bien en maintenance
  }
  // Premier check : ne pas rediriger (cas d'accès direct à /maintenance)
}
hasCheckedOnce.current = true;
```
