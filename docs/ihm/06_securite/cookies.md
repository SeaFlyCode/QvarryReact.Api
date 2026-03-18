# Noms des cookies

## Localisation

```
src/lib/cookieNames.ts
```

---

## Vue d'ensemble

Centralisation des noms de cookies d'authentification. Les noms diffèrent selon l'environnement (`production` vs `development`) pour utiliser le préfixe `__Host-` en production (sécurité renforcée).

---

## Définitions

```ts
export const JWT_COOKIE_NAME = process.env.NODE_ENV === 'production'
  ? '__Host-token'
  : 'token';

export const REFRESH_COOKIE_NAME = process.env.NODE_ENV === 'production'
  ? '__Host-refreshToken'
  : 'refreshToken';
```

---

## Tableau récapitulatif

| Cookie | Développement | Production |
|--------|--------------|-----------|
| JWT | `token` | `__Host-token` |
| Refresh Token | `refreshToken` | `__Host-refreshToken` |

---

## Préfixe `__Host-` (production)

Le préfixe `__Host-` impose les contraintes suivantes sur le cookie :
- `Secure` : HTTPS uniquement
- `Path=/` : accessible uniquement sur le chemin racine
- Pas de `Domain` : lie le cookie à l'hôte exact (pas de sous-domaines)
- `HttpOnly` : inaccessible en JavaScript côté client

Ces contraintes renforcent la sécurité contre le vol de session et les attaques XSS.

---

## Utilisation dans le codebase

```ts
import { JWT_COOKIE_NAME, REFRESH_COOKIE_NAME } from '@/lib/cookieNames';

// Dans middleware.ts
const token = request.cookies.get(JWT_COOKIE_NAME)?.value;

// Dans tokenRefresh.ts (lors du nettoyage après échec)
document.cookie = `${JWT_COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
document.cookie = `${REFRESH_COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
```

---

## Note sur l'effacement côté client

L'effacement des cookies côté client est **best-effort** : les cookies `HttpOnly` ne peuvent pas être effacés en JavaScript. Cette opération est un signal de nettoyage de l'interface, pas une garantie de sécurité. Le serveur est responsable de l'invalidation réelle.
