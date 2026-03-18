# Page Admin — SOS Dashboard

## Vue d'ensemble

Tableau de bord de supervision des situations SOS actives. Affiche les sessions d'urgence avec leurs niveaux de criticité, leurs statuts, et des statistiques agrégées. Auto-refresh toutes les 30 secondes.

---

## Route & fichier source

| Élément | Valeur |
|---------|--------|
| Route Next.js | `/admin/sos` |
| Fichier | `src/app/admin/sos/page.tsx` |
| Rendu | Client (`'use client'`) |

---

## Composants inline

### `UrgencyBadge`
Badge de niveau d'urgence avec **dot animé** pour les niveaux élevés.

```tsx
// Props
{ level: 'low' | 'medium' | 'high' | 'critical' }
```

| Niveau | Couleur | Animation |
|--------|---------|-----------|
| `low` | Vert | Aucune |
| `medium` | Jaune | Aucune |
| `high` | Orange | Dot pulsant |
| `critical` | Rouge | Dot pulsant rapide |

### `StatusBadge`
Badge de statut de session.

```tsx
// Props
{ status: 'ACTIVE' | 'ESCALATING' | 'EXPIRED' | 'RESOLVED' | 'CANCELLED' }
```

### `SessionCard`
Carte cliquable de session SOS. Lien vers `/admin/sos/sessions/[id]`.

---

## États internes

| État | Type | Rôle |
|------|------|------|
| `dashboardData` | `SosDashboard \| null` | Données complètes du dashboard |
| `isLoading` | `boolean` | Chargement initial |

---

## Structure `SosDashboard`

```ts
{
  stats: {
    activeSessions: number;
    escalatingSessions: number;
    groupSessions: number;
    totalParticipantsAtRisk: number;
    resolvedToday: number;
    totalSessions24h: number;
  };
  sessions: SosSession[];
}
```

### Structure `SosSession`

```ts
{
  id: string;
  urgencyLevel: 'low' | 'medium' | 'high' | 'critical';
  status: 'ACTIVE' | 'ESCALATING' | 'EXPIRED' | 'RESOLVED' | 'CANCELLED';
  participants: SosParticipant[];
  stages: SosStage[];
  heartbeats: SosHeartbeat[];
  createdAt: string;
  updatedAt: string;
}
```

---

## Tri des sessions

Les sessions sont triées par urgence décroissante :

```ts
const urgencyOrder = { critical: 4, high: 3, medium: 2, low: 1 };
sessions.sort((a, b) => urgencyOrder[b.urgencyLevel] - urgencyOrder[a.urgencyLevel]);
```

---

## Auto-refresh

```ts
useEffect(() => {
  fetchDashboard();
  const interval = setInterval(fetchDashboard, 30_000);
  return () => clearInterval(interval);
}, []);
```

---

## Appels API

| Fonction | Module | Endpoint | Description |
|----------|--------|----------|-------------|
| `getSosDashboard()` | `src/api/adminSos.ts` | `GET /admin/sos/dashboard` | Données complètes |

---

## Statistiques affichées

| Stat | Description |
|------|-------------|
| `activeSessions` | Sessions SOS en cours |
| `escalatingSessions` | Sessions en escalade |
| `groupSessions` | Sessions avec plusieurs participants |
| `totalParticipantsAtRisk` | Total de personnes en danger |
| `resolvedToday` | Résolutions du jour |
| `totalSessions24h` | Total sur 24h |

---

## Navigation

Chaque `SessionCard` est un lien `<Link href={/admin/sos/sessions/${session.id}}>`.

Les sous-pages SOS disponibles :
- `/admin/sos/sessions` — Liste complète des sessions
- `/admin/sos/sessions/[sessionId]` — Détail d'une session
- `/admin/sos/history` — Historique
- `/admin/sos/stats` — Statistiques détaillées

---

## Extrait de code clé

```tsx
function UrgencyBadge({ level }: { level: UrgencyLevel }) {
  const config = {
    low:      { color: 'bg-green-100 text-green-800',   dot: 'bg-green-500',  pulse: false },
    medium:   { color: 'bg-yellow-100 text-yellow-800', dot: 'bg-yellow-500', pulse: false },
    high:     { color: 'bg-orange-100 text-orange-800', dot: 'bg-orange-500', pulse: true  },
    critical: { color: 'bg-red-100 text-red-800',       dot: 'bg-red-500',    pulse: true  },
  }[level];

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs ${config.color}`}>
      <span className={`w-2 h-2 rounded-full ${config.dot} ${config.pulse ? 'animate-pulse' : ''}`} />
      {level}
    </span>
  );
}
```
