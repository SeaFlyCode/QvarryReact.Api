# correlationMiddleware

Middleware de traçage distribué basé sur `AsyncLocalStorage`. Génère un identifiant de corrélation unique par requête HTTP et le propage à travers toute la chaîne asynchrone (middlewares, services, logs).

## Exports

| Nom                          | Type                                | Description                             |
| ---------------------------- | ----------------------------------- | --------------------------------------- |
| `correlationMiddleware`      | `RequestHandler`                    | Middleware Express principal            |
| `correlationStore`           | `AsyncLocalStorage<RequestContext>` | Store ALS — ne pas utiliser directement |
| `getCorrelationId()`         | `() => string \| undefined`         | Récupère le correlation ID actuel       |
| `getRequestContext()`        | `() => RequestContext \| undefined` | Récupère le contexte complet            |
| `setRequestContext(updates)` | `(Partial<RequestContext>) => void` | Enrichit le contexte (après auth)       |

---

## Interface `RequestContext`

```typescript
export interface RequestContext {
  correlationId: string;
  userId?: string; // injecté par authMiddleware
  sessionId?: string; // JTI du token JWT
  clientType?: "web" | "mobile";
}
```

---

## `correlationMiddleware`

### Signature

```typescript
export function correlationMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void;
```

### Comportement

1. Lit le header `X-Correlation-ID` de la requête entrante (propagation de corrélation depuis un client ou un proxy)
2. Si absent → génère un UUID v4 via `crypto.randomUUID()`
3. Attache le correlation ID à `req.correlationId`
4. Ajoute `X-Correlation-ID` au header de réponse
5. Crée un `RequestContext` initial `{ correlationId }` et exécute `next()` dans le contexte `AsyncLocalStorage`

Tout le code exécuté dans le contexte de la requête (middlewares suivants, services, logs) peut lire le contexte sans passer l'objet `req` explicitement.

---

## `getCorrelationId()`

```typescript
export function getCorrelationId(): string | undefined;
```

Utilisé par `loggerService` pour injecter automatiquement le correlation ID dans chaque entrée de log.

```typescript
// Dans un service quelconque
import { getCorrelationId } from "../middlewares/correlationMiddleware";

logger.info("Opération effectuée", {
  correlationId: getCorrelationId(),
});
```

---

## `setRequestContext(updates)`

```typescript
export function setRequestContext(updates: Partial<RequestContext>): void;
```

Enrichit le contexte existant avec de nouvelles propriétés. Appelé par `authMiddleware` après validation du token pour injecter `userId`, `sessionId` et `clientType`.

```typescript
// Dans authMiddleware (étape 10)
setRequestContext({
  userId: decoded.id,
  sessionId: decoded.jti,
  clientType: isMobileToken ? "mobile" : "web",
});
```

Si appelé en dehors d'un contexte de requête (pas dans l'ALS), un warning est loggé et la fonction retourne sans effet.

---

## Ordre d'application recommandé

`correlationMiddleware` doit être le **premier** middleware de la chaîne pour que le correlation ID soit disponible dans tous les logs suivants.

```typescript
app.use(correlationMiddleware);
app.use(maintenanceMiddleware);
app.use(ipBlockCheckMiddleware);
app.use(authMiddleware);
// ...routes
```
