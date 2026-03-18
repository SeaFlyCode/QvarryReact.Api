# Page Import

## Vue d'ensemble

Page d'import de données géographiques depuis plusieurs formats (CSV, JSON, GeoJSON, Google My Maps). Dispose d'une zone drag-and-drop, d'une conversion DMS↔Décimal, et d'un flux d'import en deux phases (création de liste → création de points → association).

---

## Route & fichier source

| Élément | Valeur |
|---------|--------|
| Route Next.js | `/import` |
| Fichier | `src/app/import/page.tsx` |
| Rendu | Client (`'use client'`) |

---

## Types de fichiers supportés

| Type | Extension | Notes |
|------|-----------|-------|
| `csv` | `.csv` | Encodage corrigé pour Google My Maps |
| `json` | `.json` | Format Qvarry natif |
| `geojson` | `.geojson` | Standard GeoJSON |
| `google` | `.csv`, `.kml` | Export Google Maps — 6 formats d'URL reconnus |

---

## États internes

| État | Type | Rôle |
|------|------|------|
| `importType` | `'csv' \| 'json' \| 'geojson' \| 'google'` | Format sélectionné |
| `file` | `File \| null` | Fichier déposé ou sélectionné |
| `isDragging` | `boolean` | Drag en cours sur la zone de dépôt |
| `parsedData` | `ParsedPoint[]` | Données parsées prêtes pour prévisualisation |
| `isImporting` | `boolean` | Import en cours |
| `importProgress` | `number` | Progression (0-100) |
| `showPreview` | `boolean` | Affichage de `ImportPreviewModal` |
| `importError` | `string \| null` | Erreur d'import |
| `importResult` | `ImportResult \| null` | Résultat final |

---

## Constantes

```ts
const BATCH_SIZE     = 1;   // Points créés un par un
const ADD_BATCH_SIZE = 20;  // Association points→liste par lot de 20
```

---

## Parsing des URLs Google Maps

6 formats d'URL reconnus par regex :

```ts
const GOOGLE_MAPS_URL_PATTERNS = [
  /maps\.google\.com\/maps\?.*ll=([\d.-]+),([\d.-]+)/,
  /google\.com\/maps\/place\/.*\/@([\d.-]+),([\d.-]+)/,
  /google\.com\/maps\/search\/.*\/([\d.-]+),([\d.-]+)/,
  /maps\.app\.goo\.gl\/.*/,   // URL courte → expansion nécessaire
  /goo\.gl\/maps\/.*/,        // URL courte
  /google\.com\/maps\?q=([\d.-]+),([\d.-]+)/
];
```

---

## Conversion DMS → Décimal

5 formats de coordonnées DMS supportés :

```ts
// Format 1 : 48°51'24"N
// Format 2 : 48° 51' 24" N
// Format 3 : 48d 51m 24s N
// Format 4 : N48.51.24
// Format 5 : 48:51:24N
function parseDMS(dms: string): number { ... }
```

---

## Correction d'encodage Google My Maps

Les CSV exportés depuis Google My Maps utilisent parfois Windows-1252. Correction :

```ts
function fixGoogleMapsEncoding(text: string): string {
  // Remplace les séquences d'échappement mal encodées
  return text
    .replace(/\xc3\xa9/g, 'é')
    .replace(/\xc3\xa8/g, 'è')
    // ... autres caractères français
}
```

---

## Flux d'import

```
1. Sélection/dépôt du fichier
      ↓
2. Parsing côté client (CSV/JSON/GeoJSON/Google)
      ↓
3. Affichage ImportPreviewModal (aperçu des points)
      ↓
4. Confirmation → démarrage import
      ├─ createList({ name: filename })
      │     → listId
      │
      ├─ Pour chaque point (BATCH_SIZE = 1) :
      │     createPoint(pointData)
      │     setImportProgress(...)
      │
      └─ Association par lots (ADD_BATCH_SIZE = 20) :
            addPointToList(listId, [pointIds])
```

---

## Appels API

| Fonction | Module | Endpoint | Description |
|----------|--------|----------|-------------|
| `createList(data)` | `src/api/lists.ts` | `POST /lists` | Crée la liste d'import |
| `createPoint(data)` | `src/api/points.ts` | `POST /points` | Crée un point |
| `addPointToList(listId, ids)` | `src/api/lists.ts` | `POST /lists/:id/points` | Associe les points à la liste |

---

## Composants enfants

| Composant | Rôle |
|-----------|------|
| `<ImportPreviewModal>` | Tableau d'aperçu des points parsés avant import |
| `<NotificationModal>` | Résultat de l'import (succès/erreurs) |

---

## Drag-and-drop

```tsx
<div
  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
  onDragLeave={() => setIsDragging(false)}
  onDrop={(e) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) setFile(droppedFile);
  }}
  className={isDragging ? 'border-green-500 bg-green-50' : 'border-gray-300'}
>
```

---

## Extrait de code clé — Flux d'import

```ts
const handleImport = async (points: ParsedPoint[]) => {
  setIsImporting(true);
  try {
    const list = await createList({ name: file!.name });
    const createdIds: string[] = [];

    for (let i = 0; i < points.length; i += BATCH_SIZE) {
      const batch = points.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map(p => createPoint(p)));
      createdIds.push(...results.map(r => r.id));
      setImportProgress(Math.round((i / points.length) * 80));
    }

    for (let i = 0; i < createdIds.length; i += ADD_BATCH_SIZE) {
      const batch = createdIds.slice(i, i + ADD_BATCH_SIZE);
      await addPointToList(list.id, batch);
      setImportProgress(80 + Math.round((i / createdIds.length) * 20));
    }

    setImportResult({ success: true, count: createdIds.length, listId: list.id });
  } catch (err) {
    setImportError(String(err));
  } finally {
    setIsImporting(false);
  }
};
```
