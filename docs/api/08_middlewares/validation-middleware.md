# validateObjectIdMiddleware

Middleware de validation des paramètres de route MongoDB ObjectId. Empêche les erreurs `CastError` Mongoose et les injections via des paramètres d'URL malformés (SEC-AUDIT).

## Signature

```typescript
export const validateObjectId: (...paramNames: string[]) => RequestHandler;
```

La fonction est une **factory variadique** : elle accepte un nombre arbitraire de noms de paramètres à valider et retourne un middleware Express.

## Comportement

Pour chaque paramètre listé, si `req.params[paramName]` est présent et n'est pas un ObjectId MongoDB valide (`mongoose.Types.ObjectId.isValid()`), la requête est immédiatement rejetée :

```json
{ "error": "Identifiant invalide" }
```

→ `400`

Si tous les paramètres sont absents ou valides, `next()` est appelé.

## Exemples d'utilisation

### Valider un seul paramètre

```typescript
router.get("/fiches/:id", validateObjectId("id"), fichesController.getById);
```

### Valider plusieurs paramètres en même temps

```typescript
router.get(
  "/conversations/:conversationId/messages/:messageId",
  validateObjectId("conversationId", "messageId"),
  messagesController.getMessage,
);
```

### Valider des paramètres optionnels

Si le paramètre est absent de `req.params` (route non appariée), la validation est ignorée pour ce paramètre — seules les valeurs **présentes** sont vérifiées.

## Cas rejetés

Valeurs rejetées par `mongoose.Types.ObjectId.isValid()` :

- Chaînes trop courtes ou trop longues (format attendu : 24 caractères hexadécimaux)
- Injections type `$where`, `{ $gt: "" }` passées comme paramètre d'URL
- Valeurs arbitraires comme `"undefined"`, `"null"`, `"../../../etc"`

## Valeurs acceptées

- ObjectId 24 chars hex valide : `"507f1f77bcf86cd799439011"`
- Chaîne de 12 bytes encodée de manière compatible
