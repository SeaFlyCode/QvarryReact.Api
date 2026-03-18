# Module API `adminSos.ts`

## Localisation

```
src/api/adminSos.ts
```

---

## Vue d'ensemble

Module d'administration des sessions SOS. Expose les données du dashboard SOS, la liste et le détail des sessions d'urgence.

---

## Types

```ts
type UrgencyLevel = 'low' | 'medium' | 'high' | 'critical';
type SessionStatus = 'ACTIVE' | 'ESCALATING' | 'EXPIRED' | 'RESOLVED' | 'CANCELLED';

interface SosSession {
  id:           string;
  urgencyLevel: UrgencyLevel;
  status:       SessionStatus;
  participants: SosParticipant[];
  stages:       SosStage[];
  heartbeats:   SosHeartbeat[];
  createdAt:    string;
  updatedAt:    string;
}

interface SosDashboard {
  stats: {
    activeSessions:          number;
    escalatingSessions:      number;
    groupSessions:           number;
    totalParticipantsAtRisk: number;
    resolvedToday:           number;
    totalSessions24h:        number;
  };
  sessions: SosSession[];
}
```

---

## Exports

---

### `getSosDashboard()`

```ts
async function getSosDashboard(): Promise<SosDashboard>
```

**Endpoint** : `GET /admin/sos/dashboard`

**Description** : Retourne les statistiques globales et la liste des sessions actives/récentes. Utilisé par `/admin/sos/page.tsx` avec auto-refresh 30s.

---

### `getSosSessions(params?)`

```ts
async function getSosSessions(params?: {
  status?:       SessionStatus;
  urgencyLevel?: UrgencyLevel;
  page?:         number;
}): Promise<{ sessions: SosSession[]; totalPages: number }>
```

**Endpoint** : `GET /admin/sos/sessions`

---

### `getSosSession(sessionId)`

```ts
async function getSosSession(sessionId: string): Promise<SosSession>
```

**Endpoint** : `GET /admin/sos/sessions/:id`

**Description** : Détail complet d'une session : participants, étapes (stages), heartbeats.

---

### `getSosHistory(params?)`

```ts
async function getSosHistory(params?: {
  startDate?: string;
  endDate?:   string;
  page?:      number;
}): Promise<{ sessions: SosSession[]; totalPages: number }>
```

**Endpoint** : `GET /admin/sos/history`

---

### `getSosStats()`

```ts
async function getSosStats(): Promise<SosStats>
```

**Endpoint** : `GET /admin/sos/stats`

---

## Structure des sous-types

```ts
interface SosParticipant {
  userId:   string;
  username: string;
  role:     'initiator' | 'participant';
  joinedAt: string;
}

interface SosStage {
  id:          string;
  name:        string;
  completedAt: string | null;
  order:       number;
}

interface SosHeartbeat {
  timestamp: string;
  lat?:      number;
  lng?:      number;
}
```
