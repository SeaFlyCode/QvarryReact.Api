# Page Admin — Sécurité

## Vue d'ensemble

Tableau de bord de sécurité. Affiche les statistiques d'attaques, les IP bloquées, et permet le blocage manuel d'adresses IP. Auto-refresh toutes les 30 secondes. Export CSV/JSON. Graphique à barres SVG intégré sans dépendance externe.

---

## Route & fichier source

| Élément | Valeur |
|---------|--------|
| Route Next.js | `/admin/security` |
| Fichier | `src/app/admin/security/page.tsx` |
| Rendu | Client (`'use client'`) |

---

## Composants inline

### `SimpleBarChart`
Graphique à barres **sans bibliothèque externe**, rendu en SVG pur.

```tsx
// Props
{ data: Array<{ label: string; value: number }>; color?: string }
```

- Calcule `maxValue` pour normaliser les hauteurs
- Barres SVG `<rect>` avec hauteurs proportionnelles
- Labels rotatifs en bas (`transform="rotate(-45)"`)

### `BlockIpModal`
Modal de blocage d'IP manuelle.

```tsx
// Champs du formulaire
{ ip: string; reason: string; duration: number | 'permanent' }
```

### `BlockedIpRow`
Ligne expandable dans la liste des IP bloquées.

En état expanded, affiche :
- `attackType` : type d'attaque détecté
- `attemptCount` : nombre de tentatives
- `metadata.reasons[]` : liste des raisons de blocage

---

## États internes

| État | Type | Rôle |
|------|------|------|
| `securityStats` | `SecurityStats \| null` | Statistiques de sécurité |
| `blockedIps` | `BlockedIp[]` | Liste des IP bloquées |
| `isLoading` | `boolean` | Chargement initial |
| `showBlockModal` | `boolean` | Visibilité de `BlockIpModal` |
| `expandedIpId` | `string \| null` | IP dont les détails sont visibles |
| `autoRefreshInterval` | `NodeJS.Timeout \| null` | Référence au timer d'auto-refresh |

---

## Auto-refresh

```ts
useEffect(() => {
  fetchData();
  const interval = setInterval(fetchData, 30_000);
  return () => clearInterval(interval);
}, []);
```

---

## Appels API

| Fonction | Module | Endpoint | Description |
|----------|--------|----------|-------------|
| `getSecurityDashboard()` | `src/api/admin.ts` | `GET /admin/security/dashboard` | Stats + IP bloquées |
| `blockIp(ip, reason, duration)` | `src/api/admin.ts` | `POST /admin/security/block-ip` | Bloque une IP |
| `unblockIp(ip)` | `src/api/admin.ts` | `DELETE /admin/security/block-ip/:ip` | Débloque une IP |
| `exportAuditLogs(format)` | `src/api/admin.ts` | `GET /admin/audit/export?format=` | Export CSV ou JSON |
| `sendTestAlert()` | `src/api/admin.ts` | `POST /admin/security/test-alert` | Envoie une alerte test |

---

## Export CSV/JSON

`exportAuditLogs()` utilise **`fetch()` natif** (pas `apiFetch`) pour obtenir un `Blob` :

```ts
const blob = await exportAuditLogs(format); // 'csv' | 'json'
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = `audit-export.${format}`;
a.click();
URL.revokeObjectURL(url);
```

---

## Alerte test

```ts
const confirmed = confirm('Envoyer une alerte de test ?');
if (confirmed) await sendTestAlert();
```

Utilise `window.confirm()` natif (pas `showConfirm()`).

---

## Structure `BlockedIp`

```ts
{
  id: string;
  ip: string;
  reason: string;
  blockedAt: string;
  expiresAt: string | null; // null = permanent
  attackType: string;
  attemptCount: number;
  metadata: {
    reasons: string[];
    [key: string]: unknown;
  };
}
```

---

## Extrait de code clé

```tsx
// SimpleBarChart — SVG pur sans dépendance
function SimpleBarChart({ data, color = '#10b981' }: SimpleBarChartProps) {
  const maxValue = Math.max(...data.map(d => d.value), 1);
  const chartHeight = 120;
  const barWidth = 30;

  return (
    <svg width={data.length * (barWidth + 10)} height={chartHeight + 30}>
      {data.map((item, i) => {
        const barHeight = (item.value / maxValue) * chartHeight;
        return (
          <g key={i} transform={`translate(${i * (barWidth + 10)}, 0)`}>
            <rect
              x={0} y={chartHeight - barHeight}
              width={barWidth} height={barHeight}
              fill={color} rx={3}
            />
            <text
              x={barWidth / 2} y={chartHeight + 15}
              textAnchor="middle"
              transform={`rotate(-45, ${barWidth / 2}, ${chartHeight + 15})`}
              fontSize={10}
            >
              {item.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
```
