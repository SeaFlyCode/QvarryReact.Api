# Stack Technique — IHM Qvarry

## Vue d'ensemble

| Catégorie | Technologie | Version | Rôle |
|-----------|-------------|---------|------|
| Framework | Next.js | ^15.5.6 | App Router, SSR/CSR, routing, middleware Edge |
| Langage | TypeScript | ^5.9.3 | Typage statique, maintenabilité |
| UI Library | React | ^19.0.0 | Composants, état, hooks |
| Styling | Tailwind CSS | ^3.4.17 | Utility-first CSS, responsive design |
| Cartographie | Leaflet | ^1.9.4 | Cartes interactives (rendu tuiles) |
| Cartographie React | react-leaflet | ^5.0.0 | Binding React pour Leaflet |
| Clustering | leaflet.markercluster | ^1.5.3 | Regroupement de marqueurs sur la carte |
| Marqueurs | leaflet.awesome-markers | ^2.0.5 | Marqueurs personnalisés avec icônes |
| PDF | jsPDF + autotable | ^4.0.0 / ^5.0.7 | Export PDF des fiches |
| Icônes | lucide-react | ^0.513.0 | Bibliothèque d'icônes SVG |
| Popover UI | @radix-ui/react-popover | ^1.1.15 | Composant popover accessible |
| Monitoring | @sentry/nextjs | ^10.40.0 | Suivi des erreurs en production |
| Variables env | dotenv | ^17.2.3 | Chargement .env |

---

## Dépendances de production

```json
{
  "@radix-ui/react-popover": "^1.1.15",
  "@sentry/nextjs": "^10.40.0",
  "@types/leaflet": "^1.9.16",
  "cross-env": "^7.0.3",
  "dotenv": "^17.2.3",
  "jspdf": "^4.0.0",
  "jspdf-autotable": "^5.0.7",
  "leaflet": "^1.9.4",
  "leaflet.awesome-markers": "^2.0.5",
  "leaflet.markercluster": "^1.5.3",
  "lucide-react": "^0.513.0",
  "next": "^15.5.6",
  "react": "^19.0.0",
  "react-dom": "^19.0.0",
  "react-leaflet": "^5.0.0"
}
```

---

## Dépendances de développement

```json
{
  "@eslint/eslintrc": "^3",
  "@eslint/js": "^9.39.1",
  "@next/bundle-analyzer": "^15.5.6",
  "@testing-library/jest-dom": "^6.9.1",
  "@testing-library/react": "^16.3.2",
  "@testing-library/user-event": "^14.6.1",
  "@vitejs/plugin-react": "^5.1.4",
  "@vitest/coverage-v8": "^4.0.18",
  "autoprefixer": "^10.4.20",
  "eslint": "^9.39.1",
  "eslint-config-next": "^16.1.4",
  "jsdom": "^28.1.0",
  "msw": "^2.12.10",
  "postcss": "^8.5.2",
  "tailwindcss": "^3.4.17",
  "typescript": "^5.9.3",
  "vitest": "^4.0.18"
}
```

---

## Polices

Deux polices Google Fonts sont chargées via `next/font/google` (optimisation automatique, pas de requête externe au runtime) :

| Police | Poids | Usage |
|--------|-------|-------|
| **Ubuntu** | 300, 400, 500, 700 | Corps de texte, titres principaux — variable CSS `--font-ubuntu` |
| **Outfit** | 400, 500, 600, 700 | Textes secondaires — variable CSS `--font-outfit` |

---

## Justification des choix techniques

### Next.js 15 App Router
Le App Router de Next.js permet de mixer Server Components (rendu statique, SEO, lecture des headers internes pour le nonce CSP) et Client Components (interactivité, état, hooks). Cela optimise les performances initiales tout en gardant la flexibilité React.

### Leaflet + react-leaflet
Leaflet est la bibliothèque cartographique open-source la plus mature. Elle supporte nativement les tuiles WMS (BRGM, IGN), le clustering de marqueurs et les popups. `react-leaflet` expose une API React déclarative. Ces deux bibliothèques nécessitent d'être montées côté client uniquement (pas de SSR), ce qui est géré par l'import dynamique Next.js.

### Tailwind CSS
Tailwind permet de styliser les composants directement dans le JSX sans fichiers CSS séparés, facilitant la cohérence visuelle et la maintenabilité. Combiné à PostCSS et Autoprefixer pour la compatibilité navigateurs.

### Vitest
Vitest est le framework de test utilisé (à la place de Jest) car il s'intègre nativement avec Vite/l'écosystème ESM moderne et offre des performances supérieures. Les tests utilisent `@testing-library/react` pour les tests de composants React.

### MSW (Mock Service Worker)
MSW permet de mocker les appels API dans les tests sans modifier le code de production. Il intercepte les requêtes au niveau du Service Worker ou de Node.js selon l'environnement.

### Sentry
Monitoring d'erreurs en production via `@sentry/nextjs`. Il capture les erreurs côté client et serveur, avec tracing des performances. Configuré dans `sentry.client.config.ts`, `sentry.server.config.ts` et `sentry.edge.config.ts`.

### @radix-ui/react-popover
Radix UI fournit des composants headless accessibles (WCAG) avec gestion du focus, du clavier et des attributs ARIA. Utilisé pour le popover de création de point sur la carte.

### jsPDF + autotable
Génération de PDF côté client (dans le navigateur) des fiches géologiques. Évite une dépendance au serveur pour l'export.
