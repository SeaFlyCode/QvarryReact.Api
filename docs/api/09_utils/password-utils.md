# passwordUtils

Utilitaires de gestion des mots de passe : validation de robustesse et gestion de l'historique (REM-006).

## `validatePasswordStrength`

```typescript
export function validatePasswordStrength(password: string): {
  isValid: boolean;
  message: string;
};
```

Vérifie qu'un mot de passe respecte les critères de robustesse. Retourne `{ isValid: true, message: "Mot de passe valide." }` si toutes les conditions sont réunies.

### Critères

| Critère           | Règle                                                   |
| ----------------- | ------------------------------------------------------- | ------- |
| Longueur minimale | ≥ 12 caractères                                         |
| Majuscule         | Au moins une lettre `A-Z`                               |
| Minuscule         | Au moins une lettre `a-z`                               |
| Chiffre           | Au moins un chiffre `0-9`                               |
| Caractère spécial | Au moins un caractère parmi `!@#$%^&\*()\_+-=[]{};':"\\ | ,.<>/?` |

Les critères sont évalués dans l'ordre. La première condition échouée retourne immédiatement avec `isValid: false` et un message explicatif.

### Exemples

```typescript
validatePasswordStrength("abc");
// { isValid: false, message: "Le mot de passe doit contenir au moins 12 caractères." }

validatePasswordStrength("abcdefghijkl");
// { isValid: false, message: "Le mot de passe doit contenir au moins une lettre majuscule." }

validatePasswordStrength("Abcdefghij1!");
// { isValid: true, message: "Mot de passe valide." }
```

---

## `isPasswordInHistory`

```typescript
export async function isPasswordInHistory(
  newPassword: string,
  passwordHistory: string[],
): Promise<boolean>;
```

Vérifie si le nouveau mot de passe en clair correspond à l'un des 5 derniers mots de passe hashés stockés dans l'historique. Utilise `bcrypt.compare()` pour chaque entrée.

Retourne `true` si le mot de passe est dans l'historique (réutilisation interdite), `false` sinon.

Si `passwordHistory` est vide ou non défini, retourne directement `false`.

### Usage

```typescript
const inHistory = await isPasswordInHistory(newPassword, user.passwordHistory);
if (inHistory) {
  return res.status(400).json({
    message:
      "Vous ne pouvez pas réutiliser l'un de vos 5 derniers mots de passe.",
  });
}
```

---

## `addToPasswordHistory`

```typescript
export function addToPasswordHistory(
  currentPasswordHash: string,
  passwordHistory: string[] = [],
): string[];
```

Ajoute le hash du mot de passe actuel en tête de l'historique et maintient la limite à **5 entrées**.

```typescript
// Avant changement de mot de passe
const newHistory = addToPasswordHistory(user.password, user.passwordHistory);
// newHistory contient [currentHash, ...anciennesEntrées].slice(0, 5)
```

### Constante

```typescript
const PASSWORD_HISTORY_SIZE = 5;
```
