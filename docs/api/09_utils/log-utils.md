# logUtils

Utilitaires de masquage pour les logs et emails (conformité RGPD). Toutes les fonctions sont purement synchrones et ne font aucun effet de bord.

## Fonctions

### `maskEmail`

```typescript
export function maskEmail(email: string): string;
```

Masque la partie locale d'un email pour les logs.

| Entrée               | Sortie              |
| -------------------- | ------------------- |
| `matheo@example.com` | `ma***@example.com` |
| `ab@example.com`     | `a***@example.com`  |
| Invalide / sans `@`  | `"***"`             |

- Si la partie locale fait ≤ 2 chars → garde le 1er char + `***`
- Sinon → garde les 2 premiers chars + `***`

---

### `anonymizeIp`

```typescript
export function anonymizeIp(ip: string): string;
```

Anonymise une adresse IP pour les logs et emails de notification.

| Type     | Entrée                 | Sortie          |
| -------- | ---------------------- | --------------- |
| IPv4     | `192.168.1.42`         | `192.168.1.*`   |
| IPv6     | `2001:0db8:85a3::8a2e` | `2001:0db8:***` |
| Vide     | `""`                   | `"Inconnue"`    |
| Invalide | `"abc"`                | `"Anonymisée"`  |

---

### `maskDeviceId`

```typescript
export function maskDeviceId(deviceId: string): string;
```

Masque un Device ID pour les logs.

| Entrée            | Sortie                                  |
| ----------------- | --------------------------------------- |
| `ABC123XYZQWERTY` | `ABC123XY...`                           |
| `short`           | `short` (≤ 8 chars → conservé tel quel) |
| Vide              | `"unknown"`                             |

---

### `maskToken`

```typescript
export function maskToken(token: string): string;
```

Masque un token JWT ou similaire pour les logs (6 premiers + `...` + 4 derniers chars).

| Entrée                                    | Sortie          |
| ----------------------------------------- | --------------- |
| `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` | `eyJhbG...VCJ9` |
| ≤ 10 chars                                | `"***"`         |
| Vide                                      | `"***"`         |

---

### `maskConnectionString`

```typescript
export function maskConnectionString(connStr: string): string;
```

Masque le mot de passe dans une connection string MongoDB.

| Entrée                                             | Sortie                                        |
| -------------------------------------------------- | --------------------------------------------- |
| `mongodb+srv://user:password@cluster0.mongodb.net` | `mongodb+srv://user:***@cluster0.mongodb.net` |
| Vide                                               | `"***"`                                       |

Utilise le pattern `/:([^@:]+)@/` → remplace par `:***@`.

---

### `sanitizeLogData` (re-export)

```typescript
export { sanitizeLogData } from "../services/loggerService";
```

Re-export depuis `loggerService` pour centraliser les imports. Sanitise un objet de log en masquant les champs sensibles (mots de passe, tokens, etc.) avant de les écrire dans les logs.

---

## Usage recommandé

```typescript
import {
  maskEmail,
  anonymizeIp,
  maskToken,
  maskDeviceId,
} from "../utils/logUtils";

authLogger.warn("Tentative de connexion", {
  email: maskEmail(req.body.email),
  ip: anonymizeIp(req.ip),
  token: maskToken(req.headers.authorization?.split(" ")[1] || ""),
  deviceId: maskDeviceId(req.headers["x-device-id"] as string),
});
```
