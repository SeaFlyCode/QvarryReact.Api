# Module API `admin.ts`

## Localisation

```
src/api/admin.ts
```

---

## Vue d'ensemble

Module d'administration. Expose toutes les fonctions d'administration des utilisateurs, de l'audit, de la sécurité et des IP. `exportAuditLogs()` utilise `fetch()` natif (pas `apiFetch`) pour gérer le Blob binaire.

---

## Gestion des utilisateurs

### `getUsers(params?)`
```ts
async function getUsers(params?: {
  search?: string;
  filter?: 'all' | 'blocked' | 'admins' | 'unverified';
  page?:   number;
}): Promise<{ users: User[]; totalPages: number }>
```
**Endpoint** : `GET /admin/users`

---

### `getUserDetails(id)`
```ts
async function getUserDetails(id: string): Promise<UserDetails>
```
**Endpoint** : `GET /admin/users/:id`

**Retourne** :
```ts
interface UserDetails extends User {
  stats: {
    points:         number;
    fiches:         number;
    lists:          number;
    activeSessions: number;
  };
}
```

---

### `blockUser(id, reason)`
```ts
async function blockUser(id: string, reason: string): Promise<void>
```
**Endpoint** : `POST /admin/users/:id/block`

---

### `unblockUser(id)`
```ts
async function unblockUser(id: string): Promise<void>
```
**Endpoint** : `POST /admin/users/:id/unblock`

---

### `promoteToAdmin(id)`
```ts
async function promoteToAdmin(id: string): Promise<void>
```
**Endpoint** : `POST /admin/users/:id/promote`

---

### `demoteFromAdmin(id)`
```ts
async function demoteFromAdmin(id: string): Promise<void>
```
**Endpoint** : `POST /admin/users/:id/demote`

---

### `resetUserPassword(id)`
```ts
async function resetUserPassword(id: string): Promise<void>
```
**Endpoint** : `POST /admin/users/:id/reset-password`

---

### `forceLogoutUser(id)`
```ts
async function forceLogoutUser(id: string): Promise<void>
```
**Endpoint** : `POST /admin/users/:id/force-logout`

---

## Utilisateurs en attente

### `listPendingUsers()`
```ts
async function listPendingUsers(): Promise<PendingUser[]>
```
**Endpoint** : `GET /admin/users/pending`

---

### `approveUser(id)`
```ts
async function approveUser(id: string): Promise<void>
```
**Endpoint** : `POST /admin/users/:id/approve`

---

### `rejectUser(id, reason)`
```ts
async function rejectUser(id: string, reason: string): Promise<void>
```
**Endpoint** : `POST /admin/users/:id/reject`

---

### `getPendingUsersCount()`
```ts
async function getPendingUsersCount(): Promise<number>
```
**Endpoint** : `GET /admin/users/pending/count`

---

## Audit

### `getAuditLogs(params?)`
```ts
async function getAuditLogs(params?: {
  level?:     'all' | 'info' | 'warning' | 'error' | 'critical';
  action?:    string;
  startDate?: string;
  endDate?:   string;
  page?:      number;
}): Promise<{ logs: AuditLog[]; totalPages: number }>
```
**Endpoint** : `GET /admin/audit/logs`

---

### `getAuditStats()`
```ts
async function getAuditStats(): Promise<AuditStats>
```
**Endpoint** : `GET /admin/audit/stats`

---

### `exportAuditLogs(format)`
```ts
async function exportAuditLogs(format: 'csv' | 'json'): Promise<Blob>
```
**Endpoint** : `GET /admin/audit/export?format=csv|json`

**Particularité** : utilise `fetch()` **natif** (pas `apiFetch`) pour recevoir un `Blob` :

```ts
const response = await fetch(`${API_BASE}/admin/audit/export?format=${format}`, {
  credentials: 'include',
});
return response.blob();
```

---

## Sécurité

### `getSecurityDashboard()`
```ts
async function getSecurityDashboard(): Promise<{
  stats:      SecurityStats;
  blockedIps: BlockedIp[];
}>
```
**Endpoint** : `GET /admin/security/dashboard`

---

### `blockIp(ip, reason, duration)`
```ts
async function blockIp(
  ip:       string,
  reason:   string,
  duration: number | 'permanent'
): Promise<void>
```
**Endpoint** : `POST /admin/security/block-ip`

---

### `unblockIp(ip)`
```ts
async function unblockIp(ip: string): Promise<void>
```
**Endpoint** : `DELETE /admin/security/block-ip/:ip`

---

### `sendTestAlert()`
```ts
async function sendTestAlert(): Promise<void>
```
**Endpoint** : `POST /admin/security/test-alert`

---

## Stats générales

### `getAdminStats()`
```ts
async function getAdminStats(): Promise<AdminStats>
```
**Endpoint** : `GET /admin/stats`
