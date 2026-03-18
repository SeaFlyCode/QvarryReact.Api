# Composant `Turnstile`

## Localisation

```
src/components/auth/Turnstile.tsx
```

---

## Vue d'ensemble

Widget Cloudflare Turnstile anti-bot. Gère le chargement du script Cloudflare en **singleton** (un seul script même si plusieurs instances sont montées). Supporte le mode `invisible` (widget hors écran). Propagation du nonce CSP via `useNonce()`.

---

## Interface / Props

```ts
interface TurnstileProps {
  onVerify:  (token: string) => void;
  onExpire?: () => void;
  onError?:  () => void;
  mode?:     'managed' | 'invisible';  // défaut: 'managed'
  siteKey?:  string;                   // défaut: NEXT_PUBLIC_TURNSTILE_SITE_KEY
}
```

---

## États internes

| État | Type | Rôle |
|------|------|------|
| `isReady` | `boolean` | Script Turnstile chargé et initialisé |
| `widgetId` | `string \| null` | ID retourné par `window.turnstile.render()` |

---

## Refs

| Ref | Type | Rôle |
|-----|------|------|
| `containerRef` | `HTMLDivElement \| null` | Référence au div conteneur pour le widget |

---

## Singleton de chargement du script

Le script Cloudflare ne doit être chargé **qu'une seule fois** même si plusieurs composants `<Turnstile>` sont montés simultanément.

```ts
// Flag global
declare global {
  interface Window {
    turnstileScriptLoaded: boolean;
    turnstileLoadCallbacks: Array<() => void>;
  }
}

// Dans useEffect
if (window.turnstileScriptLoaded) {
  initWidget(); // Script déjà là — init directement
  return;
}

// Enregistrement du callback
window.turnstileLoadCallbacks = window.turnstileLoadCallbacks || [];
window.turnstileLoadCallbacks.push(initWidget);

if (!document.querySelector('script[src*="turnstile"]')) {
  const script = document.createElement('script');
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad';
  script.nonce = nonce; // CSP nonce via useNonce()
  document.head.appendChild(script);
}

// Callback global appelé par Cloudflare
window.onTurnstileLoad = () => {
  window.turnstileScriptLoaded = true;
  window.turnstileLoadCallbacks.forEach(cb => cb());
  window.turnstileLoadCallbacks = [];
};
```

---

## Mode invisible

En mode `invisible`, le widget est rendu à une position hors écran :

```tsx
<div
  ref={containerRef}
  style={mode === 'invisible' ? { position: 'absolute', top: -9999, left: -9999 } : undefined}
/>
```

Le token est quand même généré et transmis via `onVerify`.

---

## Nonce CSP

```ts
const nonce = useNonce(); // Depuis NonceContext

// Appliqué au script Cloudflare
script.nonce = nonce;
```

---

## Initialisation du widget

```ts
const initWidget = () => {
  if (!containerRef.current || !window.turnstile) return;

  const id = window.turnstile.render(containerRef.current, {
    sitekey: siteKey || process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!,
    callback:        onVerify,
    'expired-callback': () => onExpire?.(),
    'error-callback':   () => onError?.(),
    appearance: mode === 'invisible' ? 'invisible' : 'always',
  });
  setWidgetId(id);
  setIsReady(true);
};
```

---

## Nettoyage

```ts
return () => {
  if (widgetId && window.turnstile) {
    window.turnstile.remove(widgetId);
  }
};
```

---

## Utilisation typique

```tsx
// Mode visible (default)
<Turnstile
  onVerify={(token) => setLoginTurnstileToken(token)}
  onExpire={() => setLoginTurnstileToken('')}
/>

// Mode invisible
<Turnstile
  mode="invisible"
  onVerify={(token) => handleAutoVerify(token)}
/>
```
