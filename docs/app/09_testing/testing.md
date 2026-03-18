# Tests — Application Mobile Qvarry

## Vue d'ensemble

Les tests sont écrits avec **Jest** et **@testing-library/react-native**. La configuration se trouve dans `jest.config.js` et `jest.setup.js`.

---

## Configuration Jest

**Fichier** : `jest.config.js`

```javascript
module.exports = {
  preset: 'react-native',
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',  // Alias @/ → src/
  },
  setupFilesAfterFramework: ['./jest.setup.js'],
};
```

---

## Commandes de test

```bash
# Lancer tous les tests
npm test

# Tests avec rapport de couverture
npm run test:coverage

# Tests en mode watch (re-lance à chaque modification)
npm run test:watch
```

---

## Structure des tests

Les tests sont co-localisés avec le code source dans des dossiers `__tests__/` :

```
src/
├── components/
│   └── __tests__/
│       ├── FicheCard.test.tsx
│       ├── SwipeableRow.test.tsx
│       └── ...
├── contexts/
│   └── __tests__/
│       ├── AuthContext.test.tsx
│       └── ...
├── hooks/
│   └── __tests__/
│       ├── useFiches.test.ts
│       └── ...
└── services/
    └── api/
        └── __tests__/
            ├── auth.test.ts
            ├── sync.test.ts
            └── ...
```

---

## Catégories de tests

### Tests unitaires — Services API

Les services API sont testés en isolation avec des mocks de `fetch`.

```typescript
// Exemple : src/services/api/__tests__/auth.test.ts
import { login } from '../auth';

global.fetch = jest.fn();

describe('auth service', () => {
  it('should return user on successful login', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        user: { _id: '123', name: 'Test', email: 'test@example.com' },
        accessToken: 'token-abc',
      }),
    });

    const result = await login('test@example.com', 'password');
    expect(result.user).toBeDefined();
    expect(result.accessToken).toBe('token-abc');
  });
});
```

### Tests unitaires — Hooks

Les hooks sont testés avec `renderHook` de `@testing-library/react-native`.

```typescript
import { renderHook } from '@testing-library/react-native';
import { useFiches } from '../useFiches';

describe('useFiches', () => {
  it('should return empty fiches initially', () => {
    const { result } = renderHook(() => useFiches());
    expect(result.current.fiches).toEqual([]);
    expect(result.current.isLoading).toBe(true);
  });
});
```

### Tests de composants

Les composants sont testés avec `render` et les utilitaires de `@testing-library/react-native`.

```typescript
import { render, fireEvent } from '@testing-library/react-native';
import { FicheCard } from '../FicheCard';

describe('FicheCard', () => {
  it('should display fiche title', () => {
    const { getByText } = render(
      <FicheCard fiche={{ _id: '1', title: 'Ma fiche', content: 'Contenu' }} />
    );
    expect(getByText('Ma fiche')).toBeTruthy();
  });
});
```

### Tests de contextes

Les contextes sont testés en wrappant les composants testés dans les providers appropriés.

```typescript
import { renderHook } from '@testing-library/react-native';
import { AuthProvider, useAuth } from '../AuthContext';

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

describe('AuthContext', () => {
  it('should start unauthenticated', () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.isAuthenticated).toBe(false);
  });
});
```

---

## Mocks globaux

**Fichier** : `jest.setup.js`

Configure les mocks globaux pour les modules natifs :
- `react-native-keychain`
- `@react-native-async-storage/async-storage`
- `@react-native-firebase/messaging`
- `react-native-device-info`
- `@react-native-community/netinfo`

---

## Couverture de code

```bash
npm run test:coverage
```

Le rapport de couverture est généré dans le dossier `coverage/`. Les seuils recommandés :

| Catégorie  | Seuil cible |
| ---------- | ----------- |
| Services   | > 80%       |
| Hooks      | > 70%       |
| Contextes  | > 60%       |
| Composants | > 50%       |

---

## Vérification TypeScript

La vérification de types est indépendante des tests :

```bash
npm run typecheck
# → tsc --noEmit (vérifie sans compiler)
```

À lancer avant chaque commit pour s'assurer qu'il n'y a pas d'erreurs de type.

---

## ESLint

```bash
npm run lint
# → eslint src/
```

La configuration ESLint est dans `eslint.config.js` et inclut :
- `@typescript-eslint` (règles TypeScript)
- `eslint-plugin-react` + `eslint-plugin-react-hooks`
- `eslint-plugin-react-native`
- `eslint-plugin-unused-imports`
