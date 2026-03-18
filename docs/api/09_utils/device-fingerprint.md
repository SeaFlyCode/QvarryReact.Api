# deviceFingerprint

Génère une empreinte d'appareil côté serveur à partir des headers HTTP. Utilisée pour détecter les anomalies de session (changement d'appareil entre deux requêtes).

## `generateDeviceFingerprint`

```typescript
export function generateDeviceFingerprint(req: Request): string;
```

### Paramètre

| Paramètre | Type              | Description              |
| --------- | ----------------- | ------------------------ |
| `req`     | `express.Request` | Requête Express entrante |

### Retour

Les 32 premiers caractères hexadécimaux du hash SHA-256 des composants concatenés.

### Composants

Les headers suivants sont concatenés avec `|` comme séparateur avant le hash :

| Header               | Fallback    | Description                                          |
| -------------------- | ----------- | ---------------------------------------------------- |
| `User-Agent`         | `"unknown"` | Navigateur, OS, moteur de rendu                      |
| `Accept-Language`    | `"unknown"` | Préférences linguistiques                            |
| `Accept-Encoding`    | `"unknown"` | Algorithmes de compression acceptés                  |
| `Sec-CH-UA`          | `""`        | Client Hints : chaîne d'identification du navigateur |
| `Sec-CH-UA-Platform` | `""`        | Client Hints : système d'exploitation                |
| `Sec-CH-UA-Mobile`   | `""`        | Client Hints : indicateur mobile                     |
| `DNT`                | `""`        | Do Not Track (stable par utilisateur)                |
| `Connection`         | `""`        | Type de connexion (`keep-alive`, etc.)               |

```
SHA-256(UserAgent|AcceptLanguage|AcceptEncoding|SecChUA|SecChUAPlatform|SecChUAMobile|DNT|Connection)
→ premiers 32 chars hex
```

### Caractéristiques

- **Côté serveur** : le fingerprint est calculé depuis les headers HTTP, non manipulable par JavaScript
- **Longueur** : 32 caractères hex (128 bits d'entropie réduite)
- **Stabilité** : stable tant que les headers ne changent pas (même navigateur, même config réseau)
- **Limites** : les headers peuvent changer (mise à jour navigateur, VPN, proxy) — ne constitue pas une identification définitive

### Usage

```typescript
import { generateDeviceFingerprint } from "../utils/deviceFingerprint";

// Dans authMiddleware ou lors du login
const fingerprint = generateDeviceFingerprint(req);

// Stocké dans RefreshToken.deviceFingerprint pour détecter le vol de token
```

Le fingerprint est comparé à chaque utilisation du refresh token. Une divergence peut indiquer une utilisation depuis un autre appareil (vol potentiel).
