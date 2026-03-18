# Patterns de tests

## Localisation des tests

```
src/api/*.test.ts               — Tests unitaires des modules API
src/components/**/*.test.tsx    — Tests des composants React
src/__tests__/integration/      — Tests d'intégration (MSW)
src/__tests__/utils/            — Tests des utilitaires
src/__tests__/hooks/            — Tests des hooks
```

---

## Framework et outils

| Outil | Rôle |
|-------|------|
| **Vitest** | Framework de test (describe/it/expect/vi) |
| **@testing-library/react** | Rendu et interactions composants |
| **MSW (Mock Service Worker)** | Mock des appels réseau en intégration |
| **@testing-library/user-event** | Simulation d'interactions utilisateur réalistes |
| **jsdom** | Environnement DOM pour les tests node |

---

## Pattern de base — Tests unitaires API

```ts
// src/api/auth.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { login, checkAuth, logout, invalidateAuthCache } from './auth';
import { apiFetch } from './client';

vi.mock('./client', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  invalidateAuthCache();  // Nettoyage du cache entre chaque test
});
```

---

## Pattern — Mock d'`apiFetch`

```ts
// Succès
vi.mocked(apiFetch).mockResolvedValueOnce({ authenticated: true, user: mockUser });

// Erreur HTTP
vi.mocked(apiFetch).mockRejectedValueOnce({
  status:  401,
  message: 'Non autorisé',
  code:    'UNAUTHORIZED'
});

// Erreur réseau
vi.mocked(apiFetch).mockRejectedValueOnce({
  status:  0,
  message: 'Erreur réseau',
  code:    'NETWORK_ERROR'
});
```

---

## Pattern — Timers fake (tokenRefresh)

```ts
// src/api/tokenRefresh.test.ts
import { vi } from 'vitest';

beforeEach(() => {
  vi.useFakeTimers();
  resetRefreshAttempts();
});

afterEach(() => {
  vi.useRealTimers();
  stopAutoRefreshTimer();
});

it('fires 1 minute before JWT expiry', async () => {
  startAutoRefreshTimer();
  
  // Avancer le temps de 13 minutes (14min JWT - 1min refresh)
  await vi.advanceTimersByTimeAsync(13 * 60 * 1000);
  
  expect(vi.mocked(apiFetch)).toHaveBeenCalledWith('/auth/refresh', expect.any(Object));
});
```

---

## Pattern — Tests d'intégration avec MSW

```ts
// src/__tests__/integration/auth-flow.test.ts
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server'; // Serveur MSW partagé

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  invalidateAuthCache();
  resetRefreshAttempts();
});
afterAll(() => server.close());

it('401 triggers token refresh then retries', async () => {
  let callCount = 0;
  
  server.use(
    http.get('/api/points', () => {
      callCount++;
      if (callCount === 1) return HttpResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
      return HttpResponse.json({ points: [] });
    }),
    http.post('/auth/refresh', () => HttpResponse.json({ success: true }))
  );
  
  const result = await getPoints();
  expect(callCount).toBe(2); // Retry après refresh
  expect(result).toEqual({ points: [] });
});
```

---

## Pattern — Tests de composants

```tsx
// src/components/auth/LoginForm.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginForm from './LoginForm';

vi.mock('../../api/auth', () => ({
  login: vi.fn(),
}));

it('disables submit button when Turnstile token is empty', () => {
  render(
    <LoginForm onSwitchToRegister={vi.fn()} onSwitchToForgot={vi.fn()} />
  );
  
  const submitButton = screen.getByRole('button', { name: /connexion/i });
  expect(submitButton).toBeDisabled();
});

it('shows 2FA modal when login requires 2FA', async () => {
  vi.mocked(login).mockResolvedValueOnce({
    success: true,
    requires2FA: true,
    sessionToken: 'sess_123'
  });
  
  // Simuler la validation Turnstile
  // ...
  
  await waitFor(() => {
    expect(screen.getByText(/vérification en deux étapes/i)).toBeInTheDocument();
  });
});
```

---

## Pattern — Nettoyage standard

```ts
// Pattern systématiquement reproduit dans les tests API
afterEach(() => {
  vi.clearAllMocks();
  invalidateAuthCache();
  resetRefreshAttempts();
});
```

---

## Cas de test couverts — `checkAuth`

| Cas | Attendu |
|-----|---------|
| Première vérification réussie | Retourne `{ authenticated: true, user }` |
| Cache 10s valide | Retourne le cache sans appel réseau |
| Cache expiré (> 10s) | Nouveau appel réseau |
| `authenticated: false` | Non mis en cache |
| Erreur réseau (status 0) | `{ authenticated: false, error: 'network_error' }` |
| Timeout | `{ authenticated: false, error: 'network_error' }` |
| Appels concurrents | Une seule requête (déduplication) |
| Après succès | `startAutoRefreshTimer()` appelé |

---

## Cas de test couverts — `refreshToken`

| Cas | Attendu |
|-----|---------|
| Succès | `resetRefreshAttempts()` appelé |
| Erreur réseau | Compteur **non** incrémenté |
| Timeout | Compteur **non** incrémenté |
| 401 | `handleRefreshFailure()` appelé |
| 403 | `handleRefreshFailure()` appelé |
| Erreur 500 | Compteur incrémenté |
| `success: false` | `handleRefreshFailure()` appelé |
| 5e tentative | `handleRefreshFailure()` appelé |
| Déjà à max (5) | Court-circuit immédiat |
| Appels concurrents | Une seule requête (déduplication) |

---

## Inventaire complet des fichiers de test (57 fichiers)

### API (18 fichiers)
`auth.test.ts`, `client.test.ts`, `tokenRefresh.test.ts`, `user.test.ts`, `useAuth.test.ts`, `fiches.test.ts`, `points.test.ts`, `lists.test.ts`, `contacts.test.ts`, `conversations.test.ts`, `notifications.test.ts`, `share.test.ts`, `sync.test.ts`, `geo.test.ts`, `websocket.test.ts`, `twoFactor.test.ts`, `admin.test.ts`, `maintenance.test.ts`

### Composants (23 fichiers)
**Auth** : `LoginForm.test.tsx`, `RegisterForm.test.tsx`, `AuthGuard.test.tsx`, `ForgotPasswordForm.test.tsx`
**Layout** : `MobileBlocker.test.tsx`
**Modals** : `NotificationProvider.test.tsx`, `ConfirmModal.test.tsx`
**UI** : `Button.test.tsx`, `Modal.test.tsx`, `PasswordInput.test.tsx`, `LoadingScreen.test.tsx`, `InlineSpinner.test.tsx`, `PageLoader.test.tsx`, `Tooltip.test.tsx`, `NotificationBell.test.tsx`, `GdprConsentBanner.test.tsx`, `SeachBar.test.tsx`
**Map** : `MapToolbar.test.tsx`, `LevelSlider.test.tsx`, `EmojiRadio.test.tsx`, `ColorRadio.test.tsx`, `ChipCheckbox.test.tsx`, `StarRating.test.tsx`

### Intégration (6 fichiers)
`auth-flow.test.ts`, `session-security.test.ts`, `points-crud.test.ts`, `api-error-handling.test.ts`, `safe-storage-map-state.test.ts`, `navigation-config.test.ts`

### Utils & Hooks (6 fichiers)
`safeStorage.test.ts`, `mapState.test.ts`, `logger.test.ts`, `markerUtils.test.tsx`, `useDashboardSearch.test.ts`, `useMaintenanceCheck.test.ts`

### Config & Setup (4 fichiers)
`mapLayers.test.ts`, `navigation.test.ts`, `fiches.test.ts` (constantes), `setup.test.ts`

### Infrastructure MSW (3 fichiers)
`example-msw-usage.test.ts`, `msw-setup.test.ts`, `react-setup.test.tsx`
