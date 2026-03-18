# Tests — IHM Qvarry

## Framework de test

L'IHM utilise **Vitest** comme framework de tests, avec **@testing-library/react** pour les tests de composants React.

| Outil | Version | Rôle |
|-------|---------|------|
| Vitest | ^4.0.18 | Framework de test (runner, assertions) |
| @testing-library/react | ^16.3.2 | Tests de composants React |
| @testing-library/user-event | ^14.6.1 | Simulation d'interactions utilisateur |
| @testing-library/jest-dom | ^6.9.1 | Matchers DOM additionnels |
| jsdom | ^28.1.0 | Environnement DOM simulé (navigateur) |
| MSW | ^2.12.10 | Mock des requêtes API (Service Worker) |
| @vitest/coverage-v8 | ^4.0.18 | Couverture de code (V8) |

---

## Configuration

**Fichier** : `vitest.config.ts`

```typescript
// Configuration Vitest
export default defineConfig({
  test: {
    environment: 'jsdom',   // Simule un navigateur
    globals: true,           // API globale (describe, it, expect…)
    setupFiles: ['./src/__tests__/setup.ts'],
  },
});
```

---

## Commandes

| Commande | Description |
|----------|-------------|
| `npm run test` | Exécution de tous les tests (une fois) |
| `npm run test:watch` | Mode watch (relance à chaque modification) |
| `npm run test:coverage` | Tests + rapport de couverture |
| `npm run test:ui` | Interface graphique Vitest dans le navigateur |

---

## Structure des tests

Les tests sont colocalisés avec les fichiers sources (convention Next.js) :

```
src/
├── api/
│   ├── auth.ts
│   ├── auth.test.ts            ← Tests unitaires du client API auth
│   ├── client.ts
│   ├── client.test.ts          ← Tests du client HTTP
│   ├── fiches.ts
│   ├── fiches.test.ts
│   └── ...
│
├── components/
│   ├── auth/
│   │   ├── LoginForm.tsx
│   │   ├── LoginForm.test.tsx  ← Tests du composant LoginForm
│   │   ├── AuthGuard.tsx
│   │   ├── AuthGuard.test.tsx
│   │   └── ...
│   ├── layout/
│   │   ├── MobileBlocker.tsx
│   │   └── MobileBlocker.test.tsx
│   ├── ui/
│   │   ├── Button.tsx
│   │   ├── Button.test.tsx
│   │   └── ...
│   └── ...
│
├── config/
│   ├── navigation.ts
│   ├── navigation.test.ts
│   ├── mapLayers.ts
│   └── mapLayers.test.ts
│
├── hooks/
│   ├── useDashboardSearch.ts
│   ├── useDashboardSearch.test.ts
│   ├── useMaintenanceCheck.ts
│   └── useMaintenanceCheck.test.ts
│
└── __tests__/                  ← Tests transversaux
    └── setup.ts                ← Configuration globale (jest-dom, MSW)
```

---

## Types de tests

### Tests unitaires — Composants React

Vérifient qu'un composant React s'affiche et se comporte correctement.

```typescript
// Exemple : LoginForm.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginForm from './LoginForm';

it('affiche le formulaire de connexion', () => {
  render(<LoginForm onLogin={vi.fn()} ... />);
  expect(screen.getByLabelText('Email')).toBeInTheDocument();
  expect(screen.getByLabelText('Mot de passe')).toBeInTheDocument();
});

it('appelle onLogin avec les bonnes valeurs', async () => {
  const mockLogin = vi.fn();
  render(<LoginForm onLogin={mockLogin} ... />);
  
  await userEvent.type(screen.getByLabelText('Email'), 'test@qvarry.fr');
  await userEvent.type(screen.getByLabelText('Mot de passe'), 'Password123!');
  await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
  
  expect(mockLogin).toHaveBeenCalledWith('test@qvarry.fr', 'Password123!', null);
});
```

### Tests unitaires — Hooks

```typescript
// Exemple : useDashboardSearch.test.ts
import { renderHook, act } from '@testing-library/react';
import { useDashboardSearch } from './useDashboardSearch';

it('filtre les points par nom', () => {
  const { result } = renderHook(() => useDashboardSearch(mockPoints));
  
  act(() => {
    result.current.setSearchQuery('Grotte');
  });
  
  expect(result.current.filteredPoints).toHaveLength(2);
});
```

### Tests unitaires — Client API

Vérifient que les fonctions d'API envoient les bonnes requêtes.

```typescript
// Exemple : auth.test.ts
import { vi } from 'vitest';
import { login } from './auth';

beforeEach(() => {
  global.fetch = vi.fn();
});

it('envoie les credentials au bon endpoint', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ token: 'xxx' })));
  
  await login('test@qvarry.fr', 'Password123!');
  
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining('/auth/login'),
    expect.objectContaining({ method: 'POST' })
  );
});
```

### Tests de configuration

```typescript
// Exemple : navigation.test.ts
import { getPageTitle, getNavIcon } from './navigation';

it('retourne le bon titre pour le dashboard', () => {
  expect(getPageTitle('/dashboard')).toBe('Tableau de bord | QVARRY');
});
```

---

## Mocking avec MSW

MSW (Mock Service Worker) intercepte les requêtes `fetch` dans les tests sans modifier le code source. Il est configuré dans `src/__tests__/setup.ts`.

```typescript
// Exemple de handler MSW
import { http, HttpResponse } from 'msw';

export const handlers = [
  http.get('/api/v1/auth/check', () => {
    return HttpResponse.json({ authenticated: true, user: mockUser });
  }),
  
  http.post('/api/v1/auth/login', async ({ request }) => {
    const body = await request.json();
    if (body.email === 'test@qvarry.fr') {
      return HttpResponse.json({ success: true });
    }
    return new HttpResponse(null, { status: 401 });
  }),
];
```

---

## Couverture de code

```bash
npm run test:coverage
```

Génère un rapport de couverture dans `coverage/` (HTML, LCOV). La couverture cible les modules `src/api/`, `src/components/`, `src/hooks/` et `src/config/`.

---

## Tests de sécurité

**Dossier** : `security-tests/`

Tests spécifiques à la sécurité (XSS, injection, CSP). Séparés des tests unitaires car ils nécessitent un environnement différent.
