# Écrans — Carte et Points

## Vue d'ensemble

Le module Explorer propose une carte interactive basée sur **Leaflet.js** embarqué dans une `react-native-webview`. Il permet de visualiser, créer et naviguer vers des points géolocalisés.

---

## `LeafletMapScreen`

**Chemin** : `src/screens/map/LeafletMapScreen.tsx`

Écran principal de la carte.

### Fonctionnalités

- Carte interactive Leaflet rendue dans une WebView
- Affichage des points de l'utilisateur sur la carte
- Géolocalisation en temps réel (position GPS de l'utilisateur)
- Support des tuiles offline (téléchargées via `OfflineDownloadWebView`)
- Navigation vers le détail d'un point en tapant sur un marqueur
- Accès rapide à la création d'un point à la position actuelle
- Navigation vers `SearchScreen`
- Accès à la navigation souterraine (`UndergroundNavScreen`)

### Communication WebView ↔ React Native

La carte communique avec le code React Native via `postMessage` :

```
React Native → WebView : commandes (centrer, ajouter marqueur, etc.)
WebView → React Native : events (tap sur marqueur, position, etc.)
```

### Tuiles offline

L'`OfflineDownloadWebView` (cachée au niveau racine de l'app) télécharge les tuiles de carte en arrière-plan. Les tuiles sont stockées dans le système de fichiers via `react-native-fs` et servies localement quand l'appareil est hors ligne.

---

## `PointDetailScreen`

**Chemin** : `src/screens/map/PointDetailScreen.tsx`

Affichage détaillé d'un point géolocalisé.

### Fonctionnalités

- Coordonnées GPS, nom, description, tags
- Affichage de la position sur une mini-carte
- Lancer la navigation vers ce point
- Modification du point (`PointFormScreen`)
- Suppression avec confirmation

---

## `PointFormScreen`

**Chemin** : `src/screens/map/PointFormScreen.tsx`

Formulaire de création ou modification d'un point.

### Fonctionnalités

- Nom, description, coordonnées (saisies ou captées par GPS)
- Tags et catégories
- Sélection de position sur la carte
- Sauvegarde avec synchronisation offline-first

---

## `SearchScreen`

**Chemin** : `src/screens/map/SearchScreen.tsx`

Recherche de points par nom, description ou tags.

### Fonctionnalités

- Recherche en temps réel dans les points en cache
- Résultats filtrés
- Navigation vers le détail d'un point ou centrage sur la carte

---

## `UndergroundNavScreen`

**Chemin** : `src/screens/map/UndergroundNavScreen.tsx`

Navigation souterraine (tunnels, caves, etc.) utilisant les capteurs de l'appareil.

### Fonctionnalités

- Utilise l'accéléromètre (`react-native-sensors`), le gyroscope et la boussole (`react-native-compass-heading`)
- Navigation en mode Dead Reckoning (sans GPS)
- Adapté aux espaces souterrains sans signal réseau
