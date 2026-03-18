# sanitizeUtils

Utilitaire de sanitisation pour les champs `Schema.Types.Mixed` dans Mongoose. Protège contre les injections NoSQL via les opérateurs MongoDB (MED-04).

## `sanitizeMixed`

```typescript
export function sanitizeMixed(data: any, maxSize: number = 10000): any;
```

Sanitise un objet ou une valeur quelconque en :

1. Vérifiant que la taille JSON ne dépasse pas `maxSize` (défaut : 10 000 caractères)
2. Supprimant récursivement toutes les clés commençant par `$` (opérateurs MongoDB)

### Paramètres

| Paramètre | Type     | Défaut  | Description                        |
| --------- | -------- | ------- | ---------------------------------- |
| `data`    | `any`    | —       | Valeur à sanitiser                 |
| `maxSize` | `number` | `10000` | Taille maximale en caractères JSON |

### Retour

L'objet sanitisé. Les clés `$` sont supprimées (`undefined` dans le reviver JSON → omises du résultat).

### Comportement

- Si `data` est `null` ou `undefined` → retourné tel quel
- Si la taille JSON dépasse `maxSize` → lève une `Error` : `"Data too large: N > M"`
- Les clés commençant par `$` sont supprimées à tous les niveaux de l'arbre

### Exemples

```typescript
sanitizeMixed({ name: "Test", $where: "1==1" });
// → { name: "Test" }

sanitizeMixed({ nested: { $gt: 0, value: 42 } });
// → { nested: { value: 42 } }

sanitizeMixed({ data: "x".repeat(20000) }, 10000);
// → Error: "Data too large: 20002 > 10000"
```

### Usage dans les modèles

Ce utilitaire est utilisé comme setter dans les champs `Schema.Types.Mixed` des modèles où des données arbitraires peuvent être stockées (ex: `SosEvent.metadata`, `DeletedData.data`).

```typescript
// Dans le schéma Mongoose
metadata: {
  type: Schema.Types.Mixed,
  set: (v: any) => sanitizeMixed(v, 5000),
}
```

> ⚠️ Ce module protège uniquement contre l'injection NoSQL via les opérateurs `$`. Il ne fait pas de sanitisation XSS ou HTML. Pour la protection XSS, utiliser les headers HTTP et la validation des types TypeScript.
