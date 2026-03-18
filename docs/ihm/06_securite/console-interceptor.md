# Console Interceptor

## Localisation

```
src/middleware/console-interceptor.ts
```

---

## Vue d'ensemble

Module qui intercepte les méthodes de `console` pour les désactiver en production. `console.error` reste toujours actif. La variable d'environnement `NEXT_PUBLIC_DEBUG_MODE` contrôle le comportement.

---

## Comportement

| Environnement | `NEXT_PUBLIC_DEBUG_MODE` | `console.log` | `console.warn` | `console.info` | `console.debug` | `console.error` |
|---------------|--------------------------|---------------|----------------|----------------|-----------------|-----------------|
| Production | non défini ou `'false'` | ❌ Désactivé | ❌ Désactivé | ❌ Désactivé | ❌ Désactivé | ✅ Actif |
| Développement | `'true'` | ✅ Actif | ✅ Actif | ✅ Actif | ✅ Actif | ✅ Actif |

---

## Implémentation

```ts
const isDebugMode = process.env.NEXT_PUBLIC_DEBUG_MODE === 'true';

if (!isDebugMode) {
  console.log   = () => {};
  console.warn  = () => {};
  console.info  = () => {};
  console.debug = () => {};
  // console.error reste intact
}
```

---

## Export `restoreConsole()`

```ts
// Sauvegarde des méthodes originales
const originalLog   = console.log;
const originalWarn  = console.warn;
const originalInfo  = console.info;
const originalDebug = console.debug;

export function restoreConsole(): void {
  console.log   = originalLog;
  console.warn  = originalWarn;
  console.info  = originalInfo;
  console.debug = originalDebug;
}
```

`restoreConsole()` est utilisé dans les tests pour rétablir les méthodes originales après l'import du module.

---

## Chargement

Ce module est importé dans `src/app/layout.tsx` (ou un point d'entrée équivalent) pour s'exécuter au démarrage de l'application :

```ts
// src/app/layout.tsx
import '@/middleware/console-interceptor';
```

---

## Impact sur les tests

Les tests qui importent des modules utilisant `console.log` doivent appeler `restoreConsole()` dans `beforeEach` ou `afterEach` pour éviter les faux positifs :

```ts
import { restoreConsole } from '@/middleware/console-interceptor';

afterEach(() => {
  restoreConsole();
  vi.restoreAllMocks();
});
```
