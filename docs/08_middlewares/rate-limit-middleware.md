# rateLimitMiddleware

Ce fichier contient deux éléments distincts : le middleware de vérification des IPs bloquées (`ipBlockCheckMiddleware`) et un utilitaire de reset manuel du rate limit (`resetRateLimit`).

> Note : Les rate limiters `express-rate-limit` globaux (quotas par endpoint) sont définis dans `src/config/rateLimitConfig.ts` et appliqués directement dans `server.ts`. Ce fichier gère uniquement la vérification des IPs bloquées en BDD.

## `ipBlockCheckMiddleware`

Vérifie si l'IP de la requête est bloquée avant tout autre traitement. Doit être placé en première position dans la chaîne des middlewares.

### Signature

```typescript
export const ipBlockCheckMiddleware: (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<void>;
```

### Comportement

1. Récupère l'IP depuis `req.ip` ou `req.connection.remoteAddress`
2. Appelle `securityAlertService.isIpBlocked(ip)` (import dynamique pour éviter les dépendances circulaires)
3. Si l'IP est bloquée :
   - Log un warning avec IP anonymisée
   - Enregistre un audit `BLOCKED_IP_ACCESS_ATTEMPT` (niveau `warning`)
   - Retourne `403 IP_BLOCKED`
4. Si `isIpBlocked` lève une exception → la requête passe (fail-open pour ne pas bloquer le service)

### Réponse en cas de blocage

```json
{
  "error": "Accès refusé. Votre adresse IP a été bloquée.",
  "reason": "<raison du blocage>",
  "blockedUntil": "<ISO date ou null>",
  "remainingMinutes": 42,
  "code": "IP_BLOCKED"
}
```

→ `403`

Si le blocage est permanent, `remainingMinutes` vaut `"permanent"`.

---

## `resetRateLimit`

Utilitaire pour réinitialiser manuellement le compteur de rate limit d'un identifiant (par exemple après un login réussi).

### Signature

```typescript
export const resetRateLimit: (identifier: string) => void;
```

### Usage

```typescript
// Après login réussi
resetRateLimit(`${req.ip}_${req.body.email}`);
```

La fonction supprime l'entrée correspondante dans `rateLimitStore` (Map en mémoire). Le store est utilisé par les contrôleurs d'authentification qui gèrent leur propre compteur de tentatives.
