# CSP Nonce — Propagation

## Vue d'ensemble

Le nonce CSP (Content Security Policy) est généré dans le middleware Edge Runtime et propagé jusqu'aux composants React clients via un contexte. Il permet d'autoriser les scripts et styles inline légitimes tout en bloquant les injections XSS.

---

## Flux de propagation

```
1. src/middleware.ts (Edge Runtime)
      └─ nonce = btoa(crypto.randomUUID())
      └─ request.headers.set('x-nonce', nonce)

2. src/app/layout.tsx (Server Component)
      └─ const nonce = headers().get('x-nonce') ?? ''
      └─ <NonceProvider nonce={nonce}>
              <html nonce={nonce}>
                ...
              </html>
         </NonceProvider>

3. src/contexts/NonceContext.tsx (Context)
      └─ export const NonceContext = createContext<string>('')
      └─ export const useNonce = () => useContext(NonceContext)

4. Composants clients (ex: Turnstile.tsx)
      └─ const nonce = useNonce()
      └─ script.nonce = nonce
```

---

## `NonceContext.tsx`

**Localisation** : `src/contexts/NonceContext.tsx`

```ts
import { createContext, useContext } from 'react';

export const NonceContext = createContext<string>('');

export function NonceProvider({
  nonce,
  children
}: {
  nonce:    string;
  children: React.ReactNode;
}) {
  return (
    <NonceContext.Provider value={nonce}>
      {children}
    </NonceContext.Provider>
  );
}

export const useNonce = () => useContext(NonceContext);
```

---

## Régénération par requête

Le nonce est **différent à chaque requête HTTP** (`crypto.randomUUID()` dans le middleware). Un attaquant ne peut pas réutiliser un nonce capturé dans une requête précédente.

---

## Utilisation dans les composants

### Turnstile (script Cloudflare)

```ts
// src/components/auth/Turnstile.tsx
const nonce = useNonce();

const script = document.createElement('script');
script.nonce = nonce;
script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad';
document.head.appendChild(script);
```

### Scripts inline (layout)

```tsx
// Dans src/app/layout.tsx
<script
  nonce={nonce}
  dangerouslySetInnerHTML={{ __html: 'window.__NONCE__ = "' + nonce + '"' }}
/>
```

---

## Sécurité

| Propriété | Valeur |
|-----------|--------|
| Algorithme | `crypto.randomUUID()` (128 bits aléatoires) |
| Encodage | Base64 (`btoa()`) |
| Durée de vie | Une requête |
| Runtime | Edge (middleware Next.js) |
| Transport | Header HTTP `x-nonce` (interne Next.js) |
