# turnstileMiddleware

Middleware de vérification du challenge CAPTCHA Cloudflare Turnstile. Protège les routes web publiques (login, register, mot de passe oublié) contre les bots automatisés.

> En développement sans `TURNSTILE_SECRET_KEY`, le middleware est automatiquement bypassé. Sur mobile, utiliser `mobileSecurityMiddleware` à la place (Turnstile n'est pas compatible avec les apps natives).

## Exports

| Nom                       | Type             | Description                     |
| ------------------------- | ---------------- | ------------------------------- |
| `verifyTurnstile`         | `RequestHandler` | Middleware strict (défaut)      |
| `verifyTurnstileOptional` | `RequestHandler` | Middleware avec bypass dev/test |

---

## `verifyTurnstile`

### Signature

```typescript
export const verifyTurnstile: (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<void>;
```

### Flux d'exécution

```
1. Vérifier TURNSTILE_SECRET_KEY
   ├─ Absent + développement → bypass (next)
   └─ Absent + production → 500 CAPTCHA_CONFIG_ERROR
2. Lire le token dans req.body
   └─ Absent → 400 CAPTCHA_MISSING
3. POST https://challenges.cloudflare.com/turnstile/v0/siteverify
   ├─ Succès → next()
   ├─ Échec → 400 CAPTCHA_FAILED
   └─ Erreur réseau → 503 CAPTCHA_SERVICE_ERROR
```

### Champs acceptés dans `req.body`

Le token est lu depuis le premier champ défini parmi :

| Champ                   | Usage                              |
| ----------------------- | ---------------------------------- |
| `cf-turnstile-response` | Nom standard Cloudflare Turnstile  |
| `turnstileToken`        | Alias utilisé par certains clients |
| `captchaToken`          | Alias générique                    |

### Codes de réponse

| Code                    | Statut HTTP | Condition                                            |
| ----------------------- | ----------- | ---------------------------------------------------- |
| `CAPTCHA_MISSING`       | 400         | Aucun token dans le body                             |
| `CAPTCHA_FAILED`        | 400         | Token invalide (réponse Cloudflare `success: false`) |
| `CAPTCHA_CONFIG_ERROR`  | 500         | `TURNSTILE_SECRET_KEY` non défini en production      |
| `CAPTCHA_SERVICE_ERROR` | 503         | Erreur réseau vers Cloudflare                        |

En développement, si `CAPTCHA_FAILED` est retourné, le champ `details` contient les codes d'erreur Cloudflare bruts. En production, `details` est omis.

### Codes d'erreur Cloudflare mappés

| Code Cloudflare          | Message utilisateur                           |
| ------------------------ | --------------------------------------------- |
| `missing-input-secret`   | Erreur de configuration du serveur            |
| `invalid-input-secret`   | Erreur de configuration du serveur            |
| `missing-input-response` | Veuillez compléter la vérification anti-robot |
| `invalid-input-response` | La vérification a échoué, veuillez réessayer  |
| `bad-request`            | Requête invalide                              |
| `timeout-or-duplicate`   | La vérification a expiré, veuillez réessayer  |
| `internal-error`         | Erreur du service de vérification             |

---

## `verifyTurnstileOptional`

Version permissive du middleware, utile en environnement de test.

**Logique de bypass** :

- Pas de `TURNSTILE_SECRET_KEY` + `NODE_ENV !== "production"` → passe
- `BYPASS_CAPTCHA === "true"` + `NODE_ENV !== "production"` → passe avec warning
- Sinon → délègue à `verifyTurnstile`

> ⚠️ `BYPASS_CAPTCHA` est ignoré en production. Ce bypass n'est disponible qu'en développement et test.

## Variables d'environnement

| Variable               | Description                                     |
| ---------------------- | ----------------------------------------------- |
| `TURNSTILE_SECRET_KEY` | Clé secrète Cloudflare Turnstile (côté serveur) |
| `NODE_ENV`             | `"production"` désactive les bypasses           |
| `BYPASS_CAPTCHA`       | `"true"` pour bypasser en dev/test uniquement   |
