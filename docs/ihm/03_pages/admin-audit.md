# Page Admin — Audit

## Vue d'ensemble

Tableau de bord d'audit des logs applicatifs. Affiche les événements système avec filtres multicritères, statistiques agrégées, et lignes expandables. Pagination à 30 entrées par page.

---

## Route & fichier source

| Élément | Valeur |
|---------|--------|
| Route Next.js | `/admin/audit` |
| Fichier | `src/app/admin/audit/page.tsx` |
| Rendu | Client (`'use client'`) |

---

## Composants inline

Ce fichier définit deux composants internes non exportés :

### `AuditStatCard`
Carte de statistique simple : icône + valeur + libellé.

```tsx
// Props implicites
{ icon: ReactNode; value: number; label: string; color: string }
```

### `LogRow`
Ligne de log expandable dans le tableau.

```tsx
// Props implicites
{ log: AuditLog; isExpanded: boolean; onToggle: () => void }
```

En état expanded, affiche :
- Adresse IP
- User-agent
- Détails JSON (formatés)

---

## États internes

| État | Type | Valeur initiale | Rôle |
|------|------|-----------------|------|
| `logs` | `AuditLog[]` | `[]` | Entrées de log affichées |
| `stats` | `AuditStats \| null` | `null` | Statistiques agrégées |
| `isLoading` | `boolean` | `true` | Chargement en cours |
| `filters` | `AuditFilters` | voir ci-dessous | Critères de filtrage actifs |
| `page` | `number` | `1` | Page courante |
| `totalPages` | `number` | `1` | Nombre total de pages |
| `expandedLogId` | `string \| null` | `null` | ID de la ligne expandée |

### Structure `AuditFilters`

```ts
{
  level: 'all' | 'info' | 'warning' | 'error' | 'critical';
  action: string;   // recherche texte libre
  startDate: string;
  endDate: string;
}
```

---

## Debounce

La fonction `fetchData` est déclenchée avec un **debounce de 300ms** sur les changements de filtres :

```ts
useEffect(() => {
  const timer = setTimeout(() => fetchData(), 300);
  return () => clearTimeout(timer);
}, [filters, page]);
```

---

## Chargement parallèle

```ts
const [logsResult, statsResult] = await Promise.all([
  getAuditLogs({ ...filters, page }),
  getAuditStats()
]);
```

---

## Appels API

| Fonction | Module | Endpoint | Paramètres |
|----------|--------|----------|-----------|
| `getAuditLogs()` | `src/api/admin.ts` | `GET /admin/audit/logs` | `level`, `action`, `startDate`, `endDate`, `page` |
| `getAuditStats()` | `src/api/admin.ts` | `GET /admin/audit/stats` | — |

---

## Pagination

- **30 entrées par page** (constante côté serveur)
- Contrôles Précédent / Suivant + indicateur "Page X sur Y"
- Retour à la page 1 lors d'un changement de filtre

---

## Lignes expandables

Clic sur une ligne → `setExpandedLogId(id)` (toggle)

Contenu expanded :
- **IP** : `log.ipAddress`
- **User-agent** : `log.userAgent`
- **Détails** : `JSON.stringify(log.details, null, 2)` dans un `<pre>`

---

## Niveaux de log

| Niveau | Couleur indicative |
|--------|--------------------|
| `info` | Bleu |
| `warning` | Jaune |
| `error` | Rouge |
| `critical` | Rouge foncé / pulsant |

---

## Extrait de code clé

```tsx
// Chargement avec debounce et Promise.all
useEffect(() => {
  const timer = setTimeout(async () => {
    setIsLoading(true);
    try {
      const [logsData, statsData] = await Promise.all([
        getAuditLogs({ level: filters.level, action: filters.action,
                        startDate: filters.startDate, endDate: filters.endDate, page }),
        getAuditStats()
      ]);
      setLogs(logsData.logs);
      setTotalPages(logsData.totalPages);
      setStats(statsData);
    } finally {
      setIsLoading(false);
    }
  }, 300);
  return () => clearTimeout(timer);
}, [filters, page]);
```
