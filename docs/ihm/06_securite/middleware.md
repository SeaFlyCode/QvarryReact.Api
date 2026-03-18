# Middleware Next.js

## Localisation

```
src/middleware.ts
```

---

## Vue d'ensemble

Middleware Edge Runtime de Next.js. S'exécute avant chaque requête sur les routes protégées. Responsable de :
1. Génération du nonce CSP
2. Construction des headers Content-Security-Policy
3. Vérification basique du JWT pour les routes admin (UX uniquement)
4. Redirection vers `/maintenance` si maintenance active

---

## Runtime

```ts
export const config = {
  runtime: 'edge', // Implicite pour middleware.ts Next.js
  matcher: ['/dashboard/:path*', '/admin/:path*', '/fiches/:path*',
            '/import', '/partage', '/profil/:path*', '/messaging/:path*'],
};
```

---

## Génération du Nonce CSP

```ts
// Edge Runtime — crypto.randomUUID() disponible nativement
const nonce = btoa(crypto.randomUUID());

// Propagé aux composants via header de requête
request.headers.set('x-nonce', nonce);
```

Le nonce est ensuite lu par `NonceContext` côté client pour être injecté dans les balises `<script>` et `<style>` inline.

---

## Headers CSP

Le middleware construit le header `Content-Security-Policy` avec le nonce :

```ts
const cspHeader = `
  default-src 'self';
  script-src 'self' 'nonce-${nonce}' https://challenges.cloudflare.com;
  style-src 'self' 'nonce-${nonce}' 'unsafe-inline';
  img-src 'self' data: https:;
  font-src 'self';
  connect-src 'self' https://geo.api.gouv.fr wss:;
  frame-src https://challenges.cloudflare.com;
`;

response.headers.set('Content-Security-Policy', cspHeader);
```

---

## Vérification admin (UX uniquement)

Pour les routes `/admin/*`, le middleware décode le payload JWT **sans vérification de signature** (Edge Runtime n'a pas accès au secret) :

```ts
// Décodage JWT sans vérification — UX uniquement
const token = request.cookies.get('__Host-token')?.value
           || request.cookies.get('token')?.value;

if (token) {
  const payload = JSON.parse(atob(token.split('.')[1]));
  if (!payload.isAdmin) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }
}
```

⚠️ **Cette vérification est purement cosmétique** — la vérification réelle est effectuée côté serveur dans `admin/layout.tsx` via `checkAuth()`.

---

## Routes protégées

| Route | Protection |
|-------|-----------|
| `/dashboard/*` | Auth requise |
| `/admin/*` | Auth + admin (UX) |
| `/fiches/*` | Auth requise |
| `/import` | Auth requise |
| `/partage` | Auth requise |
| `/profil/*` | Auth requise |
| `/messaging/*` | Auth requise |

---

## Redirection maintenance

```ts
// Si le flag de maintenance est actif (cookie ou header serveur)
if (isMaintenanceMode && !url.pathname.startsWith('/maintenance')) {
  return NextResponse.redirect(new URL('/maintenance', request.url));
}
```

---

## Propagation du nonce

```ts
// Dans middleware.ts
const requestHeaders = new Headers(request.headers);
requestHeaders.set('x-nonce', nonce);

return NextResponse.next({ request: { headers: requestHeaders } });
```

```ts
// Dans src/app/layout.tsx (Server Component)
import { headers } from 'next/headers';
const nonce = headers().get('x-nonce') ?? '';

// Passé via NonceContext aux composants clients
```
