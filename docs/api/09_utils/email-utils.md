# emailUtils

Utilitaire de **validation** d'adresse email. Ne contient pas de logique d'envoi — l'envoi d'emails est géré par un service dédié.

## `validateEmail`

```typescript
export function validateEmail(email: string): {
  isValid: boolean;
  message: string;
};
```

Valide le format et le domaine d'une adresse email. Retourne `{ isValid: true, message: "Adresse email valide." }` si toutes les conditions passent.

### Règles de validation

Les contrôles sont effectués dans l'ordre :

| Ordre | Règle                                            | Message d'erreur                                          |
| ----- | ------------------------------------------------ | --------------------------------------------------------- |
| 1     | Format de base : `[^\s@]+@[^\s@]+\.[^\s@]+`      | `"Format d'adresse email invalide."`                      |
| 2     | Le domaine doit contenir au moins un `.`         | `"Le domaine de l'email est invalide."`                   |
| 3     | L'extension TLD doit faire au moins 2 caractères | `"L'extension du domaine est invalide."`                  |
| 4     | Domaine non jetable                              | `"Les adresses email temporaires ne sont pas acceptées."` |

### Domaines jetables bloqués

```
yopmail.com
tempmail.com
guerrillamail.com
mailinator.com
throwawaymail.com
```

La comparaison est insensible à la casse (`domain.toLowerCase()`).

### Exemples

```typescript
validateEmail("user@example.com");
// { isValid: true, message: "Adresse email valide." }

validateEmail("not-an-email");
// { isValid: false, message: "Format d'adresse email invalide." }

validateEmail("user@yopmail.com");
// { isValid: false, message: "Les adresses email temporaires ne sont pas acceptées." }

validateEmail("user@x.c");
// { isValid: false, message: "L'extension du domaine est invalide." }
```

### Usage

```typescript
import { validateEmail } from "../utils/emailUtils";

const result = validateEmail(req.body.email);
if (!result.isValid) {
  return res.status(400).json({ error: result.message });
}
```
