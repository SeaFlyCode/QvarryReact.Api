# maintenanceMiddleware

Middleware qui intercepte toutes les requêtes lorsque le site est en mode maintenance. Les administrateurs authentifiés peuvent toujours accéder au site.

## Exports

| Nom                     | Type             | Description                               |
| ----------------------- | ---------------- | ----------------------------------------- |
| `maintenanceMiddleware` | `RequestHandler` | Middleware principal                      |
| `getMaintenanceStatus`  | `RequestHandler` | Route publique pour l'état de maintenance |

---

## `maintenanceMiddleware`

### Signature

```typescript
export const maintenanceMiddleware: (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<void>;
```

### Flux d'exécution

```
1. Normaliser le path (supprimer le préfixe /v1/ si rétrocompatibilité)
2. Si route exemptée → next()
3. Lire MaintenanceModel (MongoDB)
4. Si maintenance inactive → next()
5. Vérifier le token JWT (cookie ou Authorization header)
6. Si token admin valide → next()
7. Sinon → 503 maintenance
```

### Routes exemptées

Les routes suivantes passent toujours, même en mode maintenance :

| Route                      | Raison                                |
| -------------------------- | ------------------------------------- |
| `/maintenance`             | Vérification du statut de maintenance |
| `/auth/login`              | Connexion admin                       |
| `/auth/verify-2fa`         | Étape 2FA obligatoire pour les admins |
| `/auth/check`              | Vérification de session active        |
| `/auth/complete-2fa-login` | Finalisation de la connexion 2FA      |
| `/admin`                   | Interface d'administration            |

La correspondance utilise `startsWith`, ce qui couvre tous les sous-chemins (ex: `/admin/users`).

> Note : Le middleware est monté sur `/api`, donc `req.path` ne contient pas le préfixe `/api`. Les chemins de rétrocompatibilité `/v1/…` sont normalisés.

### Vérification admin

Si un token JWT est présent, le middleware :

1. Décode le token sans vérification pour lire `isAdmin` et `kv` (key version)
2. Si `isAdmin === true`, résout la clé JWT via `jwtKeyManager` (support rotation REM-003)
3. Vérifie le token avec `algorithm: HS256`
4. Si `decoded.isAdmin === true` → laisse passer

> ⚠️ Si `JWT_SECRET` n'est pas défini, la vérification est sautée et la requête passe (comportement fail-open pour ne pas bloquer les admins en cas de mauvaise configuration).

### Réponse en mode maintenance

```json
{
  "maintenance": true,
  "message": "Le site est actuellement en maintenance.",
  "estimatedEndTime": "2026-03-18T14:00:00.000Z"
}
```

→ `503`

En cas d'erreur lors de la lecture du modèle Maintenance → la requête passe (fail-open pour ne pas bloquer le site).

---

## `getMaintenanceStatus`

Route GET publique qui expose l'état de maintenance sans authentification. Utilisée par le frontend pour afficher la page de maintenance.

### Réponse

```json
{
  "isActive": true,
  "message": "Mise à jour en cours.",
  "estimatedEndTime": "2026-03-18T14:00:00.000Z"
}
```

Si la collection Maintenance est vide ou si une erreur survient :

```json
{
  "isActive": false,
  "message": null,
  "estimatedEndTime": null
}
```

## Variables d'environnement

| Variable                            | Usage                                  |
| ----------------------------------- | -------------------------------------- |
| `JWT_SECRET`                        | Clé JWT pour vérifier les tokens admin |
| `JWT_SECRET_V2`, `JWT_SECRET_V3`, … | Clés versionnées (rotation, REM-003)   |
