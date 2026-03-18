# CORS & Headers de sécurité (Helmet)

## CORS — Cross-Origin Resource Sharing

### Origines autorisées

La configuration CORS varie selon l'environnement.

#### Production

```
Origines autorisées :
  - CLIENT_URL (variable d'environnement, ex: https://app.qvarry.fr)

Requêtes sans Origin (mobile) :
  - Autorisées (les clients mobiles natifs n'envoient pas d'header Origin)
  - Validées ensuite par mobileSecurityMiddleware
```

#### Développement

```
Origines autorisées :
  - http://localhost:3000
  - http://localhost:3001
  - https://dev.qvarry.fr
  - CLIENT_URL (variable d'environnement)
```

### Configuration complète

```typescript
cors({
  origin: (origin, callback) => {
    // Autoriser les requêtes sans Origin (clients mobiles natifs)
    if (!origin) return callback(null, true);

    const allowedOrigins =
      process.env.NODE_ENV === "production"
        ? [process.env.CLIENT_URL]
        : [
            "http://localhost:3000",
            "http://localhost:3001",
            "https://dev.qvarry.fr",
            process.env.CLIENT_URL,
          ];

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Origine non autorisée par la politique CORS"));
    }
  },
  credentials: true, // Autorise l'envoi de cookies cross-origin
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  exposedHeaders: ["RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset"],
});
```

### `credentials: true`

Le paramètre `credentials: true` est indispensable pour le fonctionnement des cookies HTTP-only côté web. Sans ce paramètre, le navigateur refuse d'envoyer les cookies dans les requêtes cross-origin.

⚠️ Avec `credentials: true`, l'origine ne peut pas être `*` (wildcard). Une liste explicite d'origines est obligatoire.

---

## Cache-Control pour l'API

Les réponses de l'API sont configurées en `no-store` pour empêcher la mise en cache des données sensibles par les proxies intermédiaires et les navigateurs.

```
Cache-Control: no-store, no-cache, must-revalidate
Pragma: no-cache
```

---

## Helmet — Headers de sécurité

[Helmet](https://helmetjs.github.io/) configure automatiquement les headers de sécurité HTTP sur toutes les réponses.

### Content Security Policy (CSP)

```
Content-Security-Policy:
  default-src 'self';
  script-src  'self';
  style-src   'self' 'unsafe-inline';
  img-src     'self'
              data:
              blob:
              https://*.tile.openstreetmap.org
              https://*.basemaps.cartocdn.com
              https://server.arcgisonline.com
              https://*.googleapis.com
              https://*.gstatic.com
              https://wxs.ign.fr;
  font-src    'self' data:;
  connect-src 'self' https://api.qvarry.fr wss://api.qvarry.fr;
  frame-src   'none';
  object-src  'none';
  base-uri    'self';
  form-action 'self';
```

| Directive     | Valeur                                  | Justification                                          |
| ------------- | --------------------------------------- | ------------------------------------------------------ |
| `default-src` | `'self'`                                | Bloque tout ce qui n'est pas explicitement autorisé    |
| `script-src`  | `'self'`                                | Aucun script externe ni inline                         |
| `img-src`     | `'self'` + fournisseurs cartographiques | OSM, CartoDB, ArcGIS, Google Maps, IGN pour les cartes |
| `frame-src`   | `'none'`                                | Empêche l'inclusion dans des iframes                   |
| `object-src`  | `'none'`                                | Désactive les plugins (Flash, etc.)                    |
| `form-action` | `'self'`                                | Empêche l'exfiltration via `<form action="...">`       |

⚠️ `'unsafe-inline'` sur `style-src` est un compromis pour le rendu CSS. Éviter d'ajouter `'unsafe-inline'` sur `script-src`.

### HSTS — HTTP Strict Transport Security

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
```

| Paramètre           | Valeur     | Signification                                    |
| ------------------- | ---------- | ------------------------------------------------ |
| `max-age`           | `63072000` | 2 ans en secondes                                |
| `includeSubDomains` | Présent    | Appliqué à tous les sous-domaines                |
| `preload`           | Présent    | Éligible à la liste HSTS preload des navigateurs |

⚠️ Une fois un domaine soumis à la liste HSTS preload, il est très difficile de l'en retirer. S'assurer que HTTPS sera maintenu indéfiniment sur ce domaine et tous ses sous-domaines.

### X-Frame-Options

```
X-Frame-Options: DENY
```

Empêche l'inclusion de l'application dans une `<iframe>`, `<frame>` ou `<object>` de n'importe quelle origine. Protège contre les attaques de type clickjacking.

### X-Content-Type-Options

```
X-Content-Type-Options: nosniff
```

Empêche le navigateur de deviner (sniff) le type MIME d'une ressource. Prévient les attaques par confusion de type MIME.

### Referrer-Policy

```
Referrer-Policy: strict-origin-when-cross-origin
```

| Comportement               | Condition                                    |
| -------------------------- | -------------------------------------------- |
| URL complète envoyée       | Requête same-origin                          |
| Origine uniquement envoyée | Requête cross-origin vers HTTPS              |
| Aucun referrer envoyé      | Requête cross-origin vers HTTP (dégradation) |

### Permissions-Policy

```
Permissions-Policy:
  geolocation=(self),
  camera=(),
  microphone=(),
  payment=(),
  usb=(),
  magnetometer=(),
  gyroscope=(),
  accelerometer=()
```

| Permission    | Valeur   | Signification                              |
| ------------- | -------- | ------------------------------------------ |
| `geolocation` | `(self)` | Autorisée uniquement pour l'origine propre |
| `camera`      | `()`     | Désactivée complètement                    |
| `microphone`  | `()`     | Désactivée complètement                    |
| `payment`     | `()`     | Désactivée complètement                    |
| `usb`         | `()`     | Désactivée complètement                    |

### X-DNS-Prefetch-Control

```
X-DNS-Prefetch-Control: off
```

Désactive la pré-résolution DNS des liens par le navigateur, limitant les fuites d'information.

### X-Download-Options

```
X-Download-Options: noopen
```

Empêche Internet Explorer d'exécuter directement les téléchargements (spécifique IE).

### Cross-Origin-Opener-Policy

```
Cross-Origin-Opener-Policy: same-origin
```

Isole le contexte de navigation, protégeant contre les attaques Spectre et les fuites cross-origin.

---

## Récapitulatif des headers sur chaque réponse

```
HTTP/1.1 200 OK
Content-Security-Policy: default-src 'self'; script-src 'self'; ...
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(self), camera=(), microphone=(), ...
X-DNS-Prefetch-Control: off
Cross-Origin-Opener-Policy: same-origin
Cache-Control: no-store
```

---

## Variables d'environnement associées

| Variable     | Description                                  | Exemple                 |
| ------------ | -------------------------------------------- | ----------------------- |
| `CLIENT_URL` | URL du client web autorisé                   | `https://app.qvarry.fr` |
| `NODE_ENV`   | Environnement (`production` / `development`) | `production`            |
