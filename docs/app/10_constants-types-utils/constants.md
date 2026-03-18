# Constantes — Application Mobile Qvarry

## Vue d'ensemble

Toutes les constantes sont dans `src/constants/`. Elles centralisent la configuration, les valeurs métier, les styles visuels et les données de référence utilisées dans toute l'application.

---

## `app.ts` — Configuration générale

Exporte l'objet `AppConstants` (déclaré `as const` pour garantir l'inférence des types littéraux).

### Structure

```typescript
export const AppConstants = {
  app: {
    name: 'Qvarry',
    tagline: 'Map your adventure !',
    version: '1.0.0',
  },
  api: {
    baseUrl: process.env.EXPO_PUBLIC_API_URL || 'https://qvarry.fr/api',
    wsUrl:   process.env.EXPO_PUBLIC_WS_URL  || 'wss://qvarry.fr/ws',
    timeout: 30_000, // ms
  },
  map: { ... },
  limits: { ... },
  timeouts: { ... },
  auth: { ... },
  pagination: { ... },
  storage: { ... },
} as const;
```

### `map`

| Clé | Valeur | Description |
|---|---|---|
| `defaultCenter` | `{ lat: 46.227638, lng: 2.213749 }` | Centre de la France |
| `defaultZoom` | `6` | Zoom initial |
| `minZoom` | `3` | Zoom minimum autorisé |
| `maxZoom` | `18` | Zoom maximum autorisé |
| `clusterRadius` | `50` | Rayon de regroupement des marqueurs (px) |
| `tiles.openStreetMap` | URL template OSM | Fond de carte par défaut |
| `tiles.satellite` | URL template satellite | Fond satellite |
| `tiles.topographic` | URL template topo | Fond topographique |

### `limits`

| Clé | Valeur | Description |
|---|---|---|
| `maxFileSize` | `10 * 1024 * 1024` | 10 Mo — taille max upload |
| `maxPointsPerList` | `1 000` | Points par liste |
| `maxListsPerUser` | `100` | Listes par utilisateur |
| `maxFichesPerUser` | `500` | Fiches par utilisateur |
| `maxMessageLength` | `5 000` | Caractères par message |
| `maxConversationNameLength` | `100` | Nom de groupe |
| `maxGroupMembers` | `50` | Membres par groupe |

### `timeouts`

| Clé | Valeur | Description |
|---|---|---|
| `sessionDuration` | `30 * 60 * 1000` | 30 min — durée de session |
| `tokenRefreshInterval` | `5 * 60 * 1000` | 5 min — intervalle refresh token |
| `shareExpiration` | `20 * 24 * 60 * 60 * 1000` | 20 jours — expiration partage |
| `notificationDisplay` | `5 000` | 5 s — durée affichage notif |
| `debounceSearch` | `300` | 300 ms — debounce barre de recherche |
| `longPressDelay` | `500` | 500 ms — délai appui long |

### `auth`

| Clé | Valeur |
|---|---|
| `maxLoginAttempts` | `5` |
| `lockoutDuration` | `30 * 60 * 1000` (30 min) |
| `passwordMinLength` | `8` |
| `codeContactLength` | `8` |

### `pagination`

| Clé | Valeur |
|---|---|
| `defaultPageSize` | `20` |
| `maxPageSize` | `100` |

### `storage` — Clés AsyncStorage

| Clé | Valeur |
|---|---|
| `token` | `@qvarry/token` |
| `refreshToken` | `@qvarry/refreshToken` |
| `userId` | `@qvarry/userId` |
| `userEmail` | `@qvarry/userEmail` |
| `theme` | `@qvarry/theme` |
| `language` | `@qvarry/language` |
| `mapSettings` | `@qvarry/mapSettings` |
| `lastSync` | `@qvarry/lastSync` |

---

## `colors.ts` — Palette de couleurs

Exporte l'objet `Colors` contenant toutes les couleurs de l'application.

### Palette primaire

| Clé | Valeur hex | Rôle |
|---|---|---|
| `primary.forest` | `#005100` | Couleur primaire principale (foncé) |
| `primary.emerald` | `#059669` | Couleur d'accentuation |
| `primary.mint` | `#10b981` | Variante claire |
| `primary.sage` | `#047857` | Variante intermédiaire |
| `primary.moss` | `#E8F5E9` | Fond très léger |
| `primary.pale` | `#f0fdf4` | Fond ultra-léger |

### Couleurs d'action

| Clé | Description |
|---|---|
| `action.success` / `action.successPressed` | Vert succès / état pressé |
| `action.info` / `action.infoPressed` | Bleu info / état pressé |
| `action.warning` / `action.warningPressed` | Orange avertissement / état pressé |
| `action.danger` / `action.dangerPressed` | Rouge danger / état pressé |

### Couleurs de statut

Chaque statut dispose de 4 variantes :

| Statut | `bg` | `text` | `border` | `icon` |
|---|---|---|---|---|
| `status.success` | vert clair | vert foncé | vert moyen | vert |
| `status.pending` | jaune clair | jaune foncé | jaune moyen | jaune |
| `status.info` | bleu clair | bleu foncé | bleu moyen | bleu |
| `status.error` | rouge clair | rouge foncé | rouge moyen | rouge |
| `status.neutral` | gris clair | gris foncé | gris moyen | gris |

### Échelle de gris (`grey`)

Basée sur la palette Tailwind Slate : `50`, `100`, `200`, `300`, `400`, `500`, `600`, `700`, `800`, `900`, `950`.

### Texte (`text`)

| Clé | Usage |
|---|---|
| `text.primary` | Texte principal |
| `text.secondary` | Texte secondaire |
| `text.tertiary` | Texte tertiaire / aide |
| `text.disabled` | Texte désactivé |
| `text.inverse` | Texte sur fond sombre |
| `text.link` | Liens |

### Fonds (`background`)

| Clé | Usage |
|---|---|
| `background.primary` | Fond principal |
| `background.secondary` | Fond secondaire |
| `background.tertiary` | Fond tertiaire |
| `background.card` | Fond de carte/carte |
| `background.elevated` | Fond surélevé (modal, sheet) |
| `background.overlay` | Overlay semi-transparent |
| `background.overlayLight` | Overlay léger |

### Bordures (`border`)

| Clé | Usage |
|---|---|
| `border.light` | Bordure subtile |
| `border.medium` | Bordure standard |
| `border.dark` | Bordure marquée |
| `border.focus` | Bordure focus (inputs) |

### Carte (`map`)

| Clé | Valeur | Usage |
|---|---|---|
| `map.userLocation` | `#4285F4` | Point de position de l'utilisateur |
| `map.markerDefault` | `#059669` | Marqueur par défaut |
| `map.markerSelected` | `#005100` | Marqueur sélectionné |

### Marqueurs (`markers`) — 17 couleurs nommées

`red`, `orange`, `amber`, `yellow`, `lime`, `green`, `teal`, `cyan`, `sky`, `blue`, `indigo`, `violet`, `purple`, `fuchsia`, `pink`, `rose`, `white`

### Barre d'onglets (`tabBar`)

| Clé | Usage |
|---|---|
| `tabBar.background` | Fond de la tab bar |
| `tabBar.active` | Icône / texte onglet actif |
| `tabBar.inactive` | Icône / texte onglet inactif |
| `tabBar.border` | Bordure supérieure |

### Overlays (`overlay`)

`overlay.light`, `overlay.medium`, `overlay.dark`, `overlay.white`

### Dégradés (`gradient`)

| Clé | Usage |
|---|---|
| `gradient.primary` | Dégradé primaire (vert) |
| `gradient.primaryLight` | Dégradé primaire clair |
| `gradient.gold` | Dégradé doré |
| `gradient.dark` | Dégradé sombre |

---

## `theme.ts` — Thème global

Exporte les objets de thème et les types associés.

### Types exportés

```typescript
// Thème complet avec mode
export type ThemeType = typeof LightTheme | typeof DarkTheme;

// Mode de thème sélectionnable
export type ThemeMode = 'light' | 'dark' | 'system';
```

### `Theme`

Objet de base combinant toutes les sous-sections :

```typescript
export const Theme = {
  colors:       Colors,        // depuis colors.ts
  typography:   Typography,    // depuis typography.ts
  textStyles:   TextStyles,    // depuis typography.ts
  spacing:      Spacing,       // depuis layout.ts
  layout:       Layout,        // depuis layout.ts
  borderRadius: BorderRadius,  // depuis layout.ts
  borderWidth:  BorderWidth,   // depuis layout.ts
  shadows:      Shadows,       // depuis layout.ts
};
```

### `LightColors` / `DarkColors`

Variantes de couleurs adaptées à chaque mode. Chaque objet suit la même structure que `Colors` mais avec des valeurs ajustées pour la lisibilité sur fond clair ou sombre.

### `LightTheme` / `DarkTheme`

```typescript
export const LightTheme = {
  ...Theme,
  mode: 'light' as const,
  colors: LightColors,
};

export const DarkTheme = {
  ...Theme,
  mode: 'dark' as const,
  colors: DarkColors,
};
```

### Exemple d'utilisation

```typescript
import { useTheme } from '@/contexts/ThemeContext';

const MyComponent = () => {
  const { theme } = useTheme(); // ThemeType
  return (
    <View style={{ backgroundColor: theme.colors.background.primary }}>
      <Text style={[theme.textStyles.body, { color: theme.colors.text.primary }]}>
        Contenu
      </Text>
    </View>
  );
};
```

---

## `typography.ts` — Typographie

Exporte `Typography` (valeurs brutes) et `TextStyles` (styles `StyleSheet` prêts à l'emploi).

### Polices

| Variante | Nom de police | Usage |
|---|---|---|
| Regular | `Ubuntu-Regular` | Corps de texte |
| Medium | `Ubuntu-Medium` | Labels, boutons |
| Bold | `Ubuntu-Bold` | Titres, emphase |
| Light | `Ubuntu-Light` | Texte secondaire léger |

### `Typography.fontSize`

| Clé | Valeur (px) | Usage |
|---|---|---|
| `micro` | `10` | Badges, indicateurs |
| `caption` | `12` | Légendes, métadonnées |
| `small` | `14` | Texte secondaire |
| `body` | `16` | Corps de texte |
| `subtitle` | `18` | Sous-titres |
| `title` | `20` | Titres de section |
| `h3` | `22` | En-tête niveau 3 |
| `h2` | `24` | En-tête niveau 2 |
| `h1` | `28` | En-tête niveau 1 |
| `hero` | `32` | Texte héros |
| `display` | `40` | Affichage grand format |

### `Typography.lineHeight`

| Clé | Valeur | Usage |
|---|---|---|
| `tight` | `1.1` | Titres compacts |
| `snug` | `1.25` | Titres standards |
| `normal` | `1.5` | Corps de texte |
| `relaxed` | `1.625` | Texte aéré |
| `loose` | `2.0` | Espacement maximal |

### `Typography.fontWeight`

`light`, `regular`, `medium`, `semiBold`, `bold`

### `Typography.letterSpacing`

`tighter`, `tight`, `normal`, `wide`, `wider`, `widest`

### `TextStyles` — Styles prédéfinis

Définis via `StyleSheet.create()` — utilisables directement dans les composants.

| Clé | Description |
|---|---|
| `heroTitle` | Titre principal (display, bold) |
| `h1` | En-tête 1 (h1, bold) |
| `h2` | En-tête 2 (h2, bold) |
| `h3` | En-tête 3 (h3, bold) |
| `title` | Titre de section (title, medium) |
| `body` | Corps de texte (body, regular) |
| `bodyLarge` | Corps large (subtitle, regular) |
| `bodyMedium` | Corps moyen (body, medium) |
| `bodySmall` | Corps petit (small, regular) |
| `subtitle` | Sous-titre (subtitle, medium) |
| `caption` | Légende (caption, regular) |
| `micro` | Micro-texte (micro, regular) |
| `link` | Lien (body, medium, couleur primaire) |
| `buttonText` | Texte bouton (body, bold) |
| `buttonTextSmall` | Texte petit bouton (small, bold) |
| `label` | Label formulaire (small, medium) |
| `error` | Message d'erreur (small, regular, rouge) |
| `success` | Message de succès (small, regular, vert) |
| `hint` | Aide / indice (small, regular, tertiaire) |
| `strong` | Texte fort (body, bold) |

```typescript
// Usage
import { TextStyles } from '@/constants/typography';

<Text style={TextStyles.h1}>Titre principal</Text>
<Text style={TextStyles.body}>Corps de texte</Text>
<Text style={TextStyles.error}>Champ requis</Text>
```

---

## `layout.ts` — Espacement, dimensions, ombres

### Fonctions de scaling responsive

Basées sur une résolution de référence **iPhone 14 (390 × 844 px)**.

```typescript
// Scale horizontal (basé sur la largeur)
export const sw = (n: number): number => (screenWidth / 390) * n;

// Scale vertical (basé sur la hauteur)
export const sh = (n: number): number => (screenHeight / 844) * n;

// Scale uniforme (basé sur la largeur, plafonné)
export const sf = (n: number): number => Math.min(sw(n), n * 1.2);
```

### `Spacing`

| Clé | Valeur (px) |
|---|---|
| `xs` | `4` |
| `sm` | `8` |
| `md` | `12` |
| `base` | `16` |
| `lg` | `20` |
| `xl` | `24` |
| `2xl` | `32` |
| `3xl` | `40` |
| `4xl` | `48` |
| `5xl` | `64` |
| `6xl` | `80` |

### `BorderRadius`

| Clé | Valeur (px) |
|---|---|
| `none` | `0` |
| `sm` | `4` |
| `md` | `8` |
| `lg` | `12` |
| `xl` | `16` |
| `2xl` | `20` |
| `3xl` | `24` |
| `4xl` | `32` |
| `full` | `9999` |

### `BorderWidth`

| Clé | Valeur (px) |
|---|---|
| `hairline` | `0.5` |
| `thin` | `1` |
| `base` | `2` |
| `thick` | `3` |

### `Layout.dimensions`

| Clé | Valeur | Description |
|---|---|---|
| `buttonHeight.small` | `36` | Bouton petit |
| `buttonHeight.medium` | `48` | Bouton standard |
| `buttonHeight.large` | `56` | Bouton grand |
| `inputHeight` | `52` | Hauteur des champs de saisie |
| `tabBarHeight` | `max(sh(60), 56)` | Hauteur de la barre d'onglets (responsive) |
| `iconSize.micro` | `16` | Icône micro |
| `iconSize.xs` | `20` | Icône extra-petite |
| `iconSize.sm` | `24` | Icône petite (standard) |
| `iconSize.md` | `28` | Icône moyenne |
| `iconSize.lg` | `32` | Icône grande |
| `iconSize.xl` | `40` | Icône extra-grande |
| `iconSize.hero` | `48` | Icône héros |
| `touchTarget` | `44` | Taille minimale zone tactile (HIG Apple) |

### `Shadows`

| Clé | Description |
|---|---|
| `none` | Pas d'ombre |
| `xs` | Ombre ultra-légère |
| `sm` | Ombre légère |
| `md` | Ombre standard |
| `lg` | Ombre prononcée |
| `xl` | Ombre forte |
| `2xl` | Ombre maximale |
| `colored(color)` | Ombre colorée dynamique |
| `card` | Ombre prédéfinie pour cartes |
| `elevated` | Ombre pour éléments surélevés (modals) |
| `tabBar` | Ombre pour la barre d'onglets |
| `inner` | Ombre intérieure |

---

## `fiches.ts` — Système de fiches

Constantes de référence pour le système de fiches de sites souterrains.

### `FICHE_TYPES` — Types de sites

| ID | Label | Emoji |
|---|---|---|
| `1` | Carrière | ⛏️ |
| `2` | Mine | ⚒️ |
| `3` | Grotte | 🕳️ |
| `4` | Tunnel | 🚇 |
| `5` | Catacombe | 💀 |
| `6` | Bunker | 🏚️ |
| `7` | Cave | 🍷 |
| `8` | Autre | 📍 |

### `FICHE_ETATS` — États d'accessibilité

| ID | Label | Couleur |
|---|---|---|
| `1` | Ouvert | Vert |
| `2` | Partiellement accessible | Jaune |
| `3` | Fermé | Rouge |
| `4` | Inconnu | Gris |

### `FICHE_DIFFICULTES` — Niveaux de difficulté

5 niveaux : `Très facile`, `Facile`, `Modéré`, `Difficile`, `Très difficile`

### `FICHE_RISQUES_O2` — Risques d'hypoxie

5 niveaux de vert à rouge avec icônes associées.

### `FICHE_ETATS_GENERAUX` — État général du site

5 étoiles : `Excellent`, `Bon`, `Moyen`, `Mauvais`, `Très mauvais`

### `FICHE_PRATICITES` — Options de praticité (multi-select)

8 options : `Sol dégagé 🚶`, `Sol accidenté ⚠️`, et 6 autres options décrivant les conditions de progression.

### `FICHE_EQUIPEMENTS` — Équipements nécessaires (15 options)

Groupés par catégorie :

| Catégorie | Exemples |
|---|---|
| `base` | Lampe frontale, bottes |
| `eau` | Combinaison, waders |
| `securite` | Casque, cordes |
| `vertical` | Baudrier, descendeur |
| `gaz` | Détecteur CO₂, O₂ |
| `protection` | Masque, gants nitrile |
| `autre` | Divers équipements spéciaux |

### `FICHE_SURFACES` — Superficie estimée

6 options : `< 500 m²`, `500 m² – 2 ha`, `2 – 5 ha`, `5 – 20 ha`, `> 20 ha`, `Inconnue`

### `FICHE_TYPES_GALERIES`

8 options décrivant la morphologie des galeries.

### `FICHE_ACCESSIBILITES`

5 options décrivant le niveau d'accessibilité légale / physique du site.

### Helpers theme-aware

```typescript
// Retourne les couleurs bg/text/border/icon pour les badges d'état
getEtatBadgeColors(colors: Colors): Record<number, BadgeColors>

// Retourne les couleurs bg/text/border/icon pour les badges d'accessibilité
getAccessibiliteBadgeColors(colors: Colors): Record<number, BadgeColors>
```

### Helpers de conversion

```typescript
findById(list, id)              // → item ou undefined
findByLabel(list, label)        // → item ou undefined
idToLabel(list, id)             // → string label
labelToId(list, label)          // → number id
idsToLabels(list, ids)          // → string[]
labelsToIds(list, labels)       // → number[]
getTypeEmoji(typeId)            // → string emoji
getEtatColor(etatId)            // → string couleur hex
getRisqueO2Color(risqueId)      // → string couleur hex
getEtatGeneralColor(etatId)     // → string couleur hex
getEtatGeneralStars(etatId)     // → number (1–5)
```

---

## `mapLayers.ts` — Fonds de carte

### `MAP_LAYER_URLS` — 13 fonds disponibles

| Clé | Description |
|---|---|
| `standard` | OpenStreetMap standard |
| `satellite` | Ortho-photo IGN haute résolution |
| `ignPlanV2` | Plan IGN v2 |
| `etatmajor` | Carte d'état-major (XIXe s.) |
| `pci` / `cadastre` | Plan cadastral informatisé |
| `photohist1950` | Photographie aérienne 1950 |
| `photohist1980` | Photographie aérienne 1980 |
| `photohist1995` | Photographie aérienne 1995 |
| `lidarMnt` | LiDAR Modèle Numérique de Terrain |
| `lidarMnh` | LiDAR Modèle Numérique de Hauteur |
| `scan50` | Scan 50 IGN |
| `terrain` | Relief ombré |
| `dark` | Fond sombre |

### `ZOOM_LEVELS`

Par fond de carte :

| Propriété | Description |
|---|---|
| `minZoom` | Zoom minimum supporté |
| `maxZoom` | Zoom maximum affiché |
| `maxNativeZoom` | Zoom natif maximum (tuiles disponibles) |

### `MAP_LAYER_NAMES`

Noms lisibles en français par clé de fond, affichés dans le sélecteur de couches.

### `MapLayerKey`

```typescript
export type MapLayerKey =
  | 'standard'
  | 'satellite'
  | 'ignPlanV2'
  | 'etatmajor'
  | 'pci'
  | 'cadastre'
  | 'photohist1950'
  | 'photohist1980'
  | 'photohist1995'
  | 'lidarMnt'
  | 'lidarMnh'
  | 'scan50'
  | 'terrain'
  | 'dark';
```

```typescript
// Usage
import { MAP_LAYER_URLS, MAP_LAYER_NAMES, MapLayerKey } from '@/constants/mapLayers';

const currentLayer: MapLayerKey = 'satellite';
const tileUrl = MAP_LAYER_URLS[currentLayer];
const displayName = MAP_LAYER_NAMES[currentLayer]; // "Satellite IGN"
```
