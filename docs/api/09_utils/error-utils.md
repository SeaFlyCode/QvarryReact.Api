# errorUtils

Utilitaires de gestion des erreurs type-safe dans TypeScript. Résout le problème des blocs `catch (error: unknown)` où le type de l'erreur est inconnu.

## `getErrorMessage`

```typescript
export function getErrorMessage(
  error: unknown,
  defaultMessage?: string, // défaut: "Une erreur est survenue"
): string;
```

Extrait un message d'erreur depuis une valeur `unknown`. Comportement différent selon l'environnement :

### En production (`NODE_ENV === "production"`)

1. L'erreur complète (message + stack) est **loggée** via `logger.error`
2. Un message générique est **retourné** au client : `"Une erreur interne est survenue"`

Ce comportement évite de leaker des informations internes (stack traces, noms de variables, chemins de fichiers) vers les clients en production.

### En développement

Retourne le message d'erreur réel selon le type :

| Type de `error`       | Valeur retournée        |
| --------------------- | ----------------------- |
| `instanceof Error`    | `error.message`         |
| `string`              | La chaîne elle-même     |
| Objet avec `.message` | `String(error.message)` |
| Autre                 | `defaultMessage`        |

### Usage

```typescript
try {
  await someOperation();
} catch (error: unknown) {
  return res.status(500).json({
    error: getErrorMessage(error, "Erreur lors de l'opération"),
  });
}
```

---

## `isErrorWithName`

```typescript
export function isErrorWithName(error: unknown, name: string): boolean;
```

Vérifie si une erreur possède un nom spécifique. Utile pour distinguer les types d'erreurs JWT sans importer leurs classes.

### Usage

```typescript
import { isErrorWithName } from "../utils/errorUtils";

// Dans authMiddleware
if (isErrorWithName(error, "TokenExpiredError")) {
  // token expiré
} else if (isErrorWithName(error, "JsonWebTokenError")) {
  // token invalide
}
```

Équivalent à `error instanceof Error && error.name === name` avec la sécurité du type guard TypeScript.
