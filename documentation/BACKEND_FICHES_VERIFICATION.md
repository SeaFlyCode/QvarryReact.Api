# Vérification Backend — Fiches Sync

## Contexte

L'app mobile envoie des fiches via `POST /api/mobile/sync` et les récupère via `GET /api/mobile/sync`.
Le serveur répond `200` avec `synced: 1, errors: 0`, **mais certaines données semblent ne pas être persistées ou restituées correctement**.

Ce document liste **tous les champs** qu'une fiche peut contenir. Le backend doit vérifier que **chaque champ est stocké en base ET restitué tel quel** lors du pull.

---

## Endpoint concerné

| Méthode | URL | Rôle |
|---------|-----|------|
| `POST` | `/api/mobile/sync` | Push des modifications locales |
| `GET` | `/api/mobile/sync?since=<ISO date>` | Pull des changements depuis une date |

---

## Format d'une fiche envoyée par l'app (push)

Le payload `POST /api/mobile/sync` contient :

```json
{
  "changes": [
    {
      "type": "fiche",
      "action": "create | update | delete",
      "id": "mongoDB ObjectId (pour update/delete)",
      "localId": "local-uuid (pour create)",
      "data": {
        // <-- les champs de la fiche ci-dessous
      },
      "timestamp": "2026-02-23T21:05:23.441Z"
    }
  ]
}
```

---

## Tous les champs d'une fiche

### Champs obligatoires

| Champ | Type | Exemple | Description |
|-------|------|---------|-------------|
| `name` | `string` | `"Four à chaux"` | Nom de la cavité |

### Champs optionnels — Texte

| Champ | Type | Exemple | Description |
|-------|------|---------|-------------|
| `ville` | `string` | `"Méry-sur-Oise"` | Ville/commune |
| `commentaire` | `string` | `"Beau réseau bien conservé"` | Commentaire libre |
| `interets` | `string` | `"Formations géologiques remarquables"` | Points d'intérêt |

### Champs optionnels — Choix unique (string)

| Champ | Type | Valeurs possibles |
|-------|------|-------------------|
| `type` | `string` | `"Carrière"`, `"Mine"`, `"Grotte"`, `"Tunnel"`, `"Catacombe"`, `"Bunker"`, `"Cave"`, `"Autre"` |
| `etat` | `string` | `"Ouvert"`, `"Partiellement accessible"`, `"Fermé"`, `"Inconnu"` |
| `accessibilite` | `string` | `"Accès libre"`, `"Accès réglementé"`, `"Propriété privée"`, `"Interdit"`, `"Inconnu"` |
| `surface` | `string` | `"< 500 m²"`, `"500 m² - 1 ha"`, `"1 - 5 ha"`, `"5 - 20 ha"`, `"> 20 ha"`, `"Inconnue"` |

### Champs optionnels — Valeur numérique envoyée en string (1-5)

| Champ | Type | Valeurs | Description |
|-------|------|---------|-------------|
| `difficulte_acces` | `string` | `"1"` à `"5"` | Difficulté d'accès |
| `risque_oxygene` | `string` | `"1"` à `"5"` | Risque O2 |
| `etat_general` | `string` | `"1"` à `"5"` | État général |

> **IMPORTANT** : Ces valeurs sont envoyées en **string** (`"4"`, pas `4`). Le backend doit les stocker et les restituer en **string**.

### Champs optionnels — Sélection multiple (string[])

| Champ | Type | Valeurs possibles |
|-------|------|-------------------|
| `equipement_conseille` | `string[]` | `["Casque", "Éclairage (frontale)", "Bottes", "Baudrier", ...]` |
| `type_galeries` | `string[]` | `["Galeries hautes (> 2m)", "Galeries basses (< 1.5m)", "Boyaux", ...]` |

Valeurs complètes pour `equipement_conseille` :
- `"Chaussures de marche"`, `"Bottes"`, `"Cuissardes"`, `"Combinaison néoprène"`, `"Bateau/Canot"`, `"Casque"`, `"Éclairage (frontale)"`, `"Éclairage de secours"`, `"Baudrier"`, `"Corde"`, `"Descendeur/Bloqueur"`, `"Détecteur O2/CO2"`, `"Gants"`, `"Genouillères"`, `"Autre (à préciser)"`

Valeurs complètes pour `type_galeries` :
- `"Galeries hautes (> 2m)"`, `"Galeries basses (< 1.5m)"`, `"Galeries étroites"`, `"Galeries larges"`, `"Salles/Chambres"`, `"Puits verticaux"`, `"Boyaux"`, `"Inconnue"`

### Champ spécial — praticite_souterrain

| Champ | Type | Exemple |
|-------|------|---------|
| `praticite_souterrain` | `string` | `"[\"Sol accidenté\",\"Zones inondées\",\"Labyrinthique\"]"` |

> **ATTENTION** : Ce champ est un **JSON string** (string contenant un tableau JSON sérialisé), **PAS** un tableau natif. Le backend doit le stocker et le restituer **tel quel** comme un string.

Valeurs possibles dans le tableau JSON :
- `"Sol dégagé"`, `"Sol accidenté"`, `"Zones inondées"`, `"Passages étroits"`, `"Ramping nécessaire"`, `"Labyrinthique"`, `"Verticale (échelles/puits)"`, `"Autre"`

### Champs optionnels — Références

| Champ | Type | Exemple | Description |
|-------|------|---------|-------------|
| `points_ids` | `string[]` | `["6978b94d3e50fbac61b37d24"]` | IDs des points liés à cette fiche |

### Champs optionnels — Géolocalisation

| Champ | Type | Exemple |
|-------|------|---------|
| `center_cavite` | `object` | `{"type": "Point", "coordinates": [2.1834, 49.0712]}` |

> Format GeoJSON standard. `coordinates` = `[longitude, latitude]`.

### Champs gérés par le serveur (ne pas écraser)

| Champ | Type | Description |
|-------|------|-------------|
| `_id` | `string` | ObjectId MongoDB |
| `date_creation` | `string` (ISO 8601) | Date de création |
| `date_modification` | `string` (ISO 8601) | Date de dernière modification |

---

## Ce qu'il faut vérifier

### 1. Stockage complet

Pour chaque champ listé ci-dessus, vérifier dans le handler `POST /api/mobile/sync` :
- [ ] Le champ est bien extrait du payload `change.data`
- [ ] Le champ est bien écrit en base (pas ignoré, pas filtré par un schema trop strict)
- [ ] Le type est préservé (string reste string, string[] reste string[], etc.)

### 2. Restitution complète

Dans le handler `GET /api/mobile/sync` :
- [ ] Tous les champs stockés sont bien inclus dans la réponse
- [ ] Aucun champ n'est exclu par un `select()` ou une projection MongoDB
- [ ] Les types sont préservés (pas de conversion string → number, pas de JSON.parse sur `praticite_souterrain`)

### 3. Champs à risque (les plus susceptibles d'être perdus)

| Champ | Risque | Pourquoi |
|-------|--------|----------|
| `accessibilite` | **ÉLEVÉ** | Absent des anciens logs de pull — peut-être pas dans le schema Mongoose |
| `surface` | **ÉLEVÉ** | Idem — pas vu dans les réponses pull |
| `etat_general` | **MOYEN** | Valeur numérique en string, peut être ignoré ou converti |
| `equipement_conseille` | **ÉLEVÉ** | Tableau de strings — peut être ignoré si le schema attend autre chose |
| `type_galeries` | **ÉLEVÉ** | Idem |
| `praticite_souterrain` | **ÉLEVÉ** | JSON string, le backend pourrait le parser et le re-sérialiser différemment |
| `interets` | **MOYEN** | Champ texte libre, pourrait ne pas être dans le schema |
| `commentaire` | **MOYEN** | Idem |
| `center_cavite` | **MOYEN** | Objet GeoJSON, doit être stocké tel quel |

### 4. Test de bout en bout

1. Envoyer un push avec **TOUS** les champs remplis :

```json
{
  "changes": [{
    "type": "fiche",
    "action": "create",
    "localId": "local-test-123",
    "data": {
      "name": "Test Complet",
      "ville": "Paris",
      "type": "Carrière",
      "etat": "Ouvert",
      "accessibilite": "Interdit",
      "difficulte_acces": "4",
      "risque_oxygene": "2",
      "etat_general": "3",
      "praticite_souterrain": "[\"Sol accidenté\",\"Zones inondées\"]",
      "equipement_conseille": ["Casque", "Éclairage (frontale)", "Bottes"],
      "surface": "< 500 m²",
      "type_galeries": ["Galeries hautes (> 2m)", "Boyaux"],
      "commentaire": "Ceci est un commentaire de test",
      "interets": "Formations géologiques",
      "center_cavite": {
        "type": "Point",
        "coordinates": [2.3522, 48.8566]
      },
      "points_ids": []
    },
    "timestamp": "2026-02-23T22:00:00.000Z"
  }]
}
```

2. Vérifier la réponse push :
   - `synced` contient la fiche
   - `idMapping` contient `"local-test-123" → "<objectId serveur>"`

3. Faire un pull (`GET /api/mobile/sync`) et vérifier que la fiche contient **EXACTEMENT** les mêmes champs et valeurs :

```
name             → "Test Complet"              ✓/✗
ville            → "Paris"                     ✓/✗
type             → "Carrière"                  ✓/✗
etat             → "Ouvert"                    ✓/✗
accessibilite    → "Interdit"                  ✓/✗
difficulte_acces → "4"                         ✓/✗
risque_oxygene   → "2"                         ✓/✗
etat_general     → "3"                         ✓/✗
praticite_souterrain → "[\"Sol accidenté\",\"Zones inondées\"]"  ✓/✗
equipement_conseille → ["Casque", "Éclairage (frontale)", "Bottes"]  ✓/✗
surface          → "< 500 m²"                  ✓/✗
type_galeries    → ["Galeries hautes (> 2m)", "Boyaux"]  ✓/✗
commentaire      → "Ceci est un commentaire de test"  ✓/✗
interets         → "Formations géologiques"    ✓/✗
center_cavite    → {"type":"Point","coordinates":[2.3522,48.8566]}  ✓/✗
points_ids       → []                          ✓/✗
```

---

## Schema Mongoose attendu (référence)

```javascript
const ficheSchema = new Schema({
  name:                  { type: String, required: true },
  ville:                 { type: String },
  type:                  { type: String },
  etat:                  { type: String },
  accessibilite:         { type: String },
  difficulte_acces:      { type: String },
  risque_oxygene:        { type: String },
  etat_general:          { type: String },
  praticite_souterrain:  { type: String },  // JSON string, PAS un tableau
  commentaire:           { type: String },
  interets:              { type: String },
  surface:               { type: String },
  equipement_conseille:  [{ type: String }],
  type_galeries:         [{ type: String }],
  points_ids:            [{ type: Schema.Types.ObjectId, ref: 'Point' }],
  center_cavite: {
    type:        { type: String, enum: ['Point'] },
    coordinates: [{ type: Number }],
  },
  userId:                { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });
```

> **Note** : Si le schema Mongoose a `{ strict: true }` (par défaut), tout champ absent du schema sera **silencieusement ignoré**. C'est la cause la plus probable de perte de données.
