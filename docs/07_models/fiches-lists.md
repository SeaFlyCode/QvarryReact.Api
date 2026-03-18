# Modèles Fiche et List

Fichiers sources : `src/models/fiches.ts`, `src/models/lists.ts`

Ces deux modèles représentent le contenu principal créé par les utilisateurs. Une `Fiche` documente un site souterrain, une `List` regroupe des `Points` GPS. Les deux implémentent le **soft-delete** via `deletedAt` et le **versioning** pour la synchronisation mobile.

---

## Modèle Fiche

Une fiche documente un site souterrain (carrière, grotte, tunnel, etc.) avec ses caractéristiques techniques, ses niveaux de risque, et une localisation GeoJSON.

### Interface TypeScript

```typescript
export interface IFiche extends Document {
  name: string;
  ville: string;
  type: string;
  etat: string;
  accessibilite?: string;
  userId: mongoose.Types.ObjectId; // ref: "User"
  difficulte_acces: string;
  risque_oxygene: string;
  acces_souterrain: string;
  praticite_souterrain: string;
  etat_general: string;
  commentaire?: string;
  points_ids: mongoose.Types.ObjectId[]; // ref: "Point"
  date_creation: Date;
  date_modification: Date;
  equipement_conseille?: string[];
  surface?: string[];
  type_galeries?: string[];
  interets?: string;
  center_cavite?: {
    type: "Point";
    coordinates: number[]; // [lng, lat]
  };
  deletedAt?: Date | null;
  version?: number;
}
```

### Schéma

#### Identification et localisation

| Champ           | Type          | Contraintes                    | Description                                                                |
| --------------- | ------------- | ------------------------------ | -------------------------------------------------------------------------- |
| `name`          | String        | required, maxlength 1000, trim | Nom du site                                                                |
| `ville`         | String        | required, trim                 | Commune du site                                                            |
| `userId`        | ObjectId      | ref User, required, index      | Créateur de la fiche                                                       |
| `center_cavite` | GeoJSON Point | optional                       | Coordonnées du centre du site `{ type: "Point", coordinates: [lng, lat] }` |

#### Caractéristiques techniques

| Champ                  | Type   | Contraintes  | Description                                   |
| ---------------------- | ------ | ------------ | --------------------------------------------- |
| `type`                 | String | required     | Type de cavité (ex: carrière, grotte)         |
| `etat`                 | String | required     | État général déclaré                          |
| `accessibilite`        | String | default `""` | Description de l'accessibilité                |
| `difficulte_acces`     | String | required     | Niveau de difficulté d'accès                  |
| `risque_oxygene`       | String | required     | Niveau de risque d'appauvrissement en oxygène |
| `acces_souterrain`     | String | required     | Type d'accès au souterrain                    |
| `praticite_souterrain` | String | required     | Praticité à l'intérieur                       |
| `etat_general`         | String | required     | Bilan général de l'état                       |

#### Contenus riches

| Champ                  | Type     | Description                       |
| ---------------------- | -------- | --------------------------------- |
| `commentaire`          | String   | Commentaire libre                 |
| `equipement_conseille` | [String] | Liste des équipements recommandés |
| `surface`              | [String] | Types de surface présents         |
| `type_galeries`        | [String] | Types de galeries identifiées     |
| `interets`             | String   | Points d'intérêt notables         |

#### Points associés

| Champ        | Type       | Description                                        |
| ------------ | ---------- | -------------------------------------------------- |
| `points_ids` | [ObjectId] | Références vers les `Point` GPS liés à cette fiche |

#### Cycle de vie

| Champ               | Type         | Description                                                 |
| ------------------- | ------------ | ----------------------------------------------------------- |
| `date_creation`     | Date         | Alias de `createdAt` (timestamp Mongoose)                   |
| `date_modification` | Date         | Alias de `updatedAt` (timestamp Mongoose)                   |
| `deletedAt`         | Date \| null | `null` = actif, `Date` = supprimé (soft-delete)             |
| `version`           | Number       | Version pour gestion des conflits de synchronisation mobile |

> Le schéma utilise `timestamps: { createdAt: "date_creation", updatedAt: "date_modification" }` pour mapper les timestamps Mongoose sur les noms de champs historiques.

### Index

| Champs                      | Type       | Usage                                    |
| --------------------------- | ---------- | ---------------------------------------- |
| `userId: 1`                 | Standard   | Récupération des fiches d'un utilisateur |
| `deletedAt: 1`              | Standard   | Filtrage soft-delete                     |
| `center_cavite: "2dsphere"` | Géospatial | Requêtes de proximité géographique       |

---

## Modèle List

Une liste regroupe des points GPS sélectionnés par l'utilisateur, avec une personnalisation visuelle (couleur, icône).

### Interface TypeScript

```typescript
export interface IList extends Document {
  userId: mongoose.Types.ObjectId; // ref: "User"
  name: string;
  description: string;
  points: mongoose.Types.ObjectId[]; // ref: "Point"
  color: string;
  icon: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
  version?: number;
}
```

### Schéma

| Champ         | Type         | Contraintes                             | Description                     |
| ------------- | ------------ | --------------------------------------- | ------------------------------- |
| `userId`      | ObjectId     | ref User, required, index               | Propriétaire de la liste        |
| `name`        | String       | required, maxlength 200, trim           | Nom de la liste                 |
| `description` | String       | default `""`, maxlength 2000            | Description libre               |
| `points`      | [ObjectId]   | ref Point, default `[]`                 | Points GPS inclus dans la liste |
| `color`       | String       | default `"#000000"`, maxlength 20       | Couleur d'affichage (hex)       |
| `icon`        | String       | default `"default-icon"`, maxlength 100 | Icône d'affichage               |
| `createdAt`   | Date         | auto (timestamps)                       | Date de création                |
| `updatedAt`   | Date         | auto (timestamps)                       | Date de modification            |
| `deletedAt`   | Date \| null | default `null`                          | Soft-delete                     |
| `version`     | Number       | default `1`                             | Version pour synchronisation    |

### Index

| Champs               | Usage                                    |
| -------------------- | ---------------------------------------- |
| `userId: 1` (inline) | Récupération des listes d'un utilisateur |
| `deletedAt: 1`       | Filtrage soft-delete                     |

---

## Modèle Point

Le modèle `Point` (`src/models/points.ts`) est étroitement lié aux Fiches et aux Lists.

| Champ                | Type          | Description                                                          |
| -------------------- | ------------- | -------------------------------------------------------------------- |
| `userId`             | ObjectId      | Propriétaire                                                         |
| `name`               | String        | Nom du point                                                         |
| `description`        | String        | Description                                                          |
| `location_encrypted` | String        | Coordonnées GPS chiffrées AES-256-GCM                                |
| `ficheId`            | ObjectId      | Fiche parente (optionnel)                                            |
| `location`           | GeoJSON Point | Coordonnées déchiffrées `{ type: "Point", coordinates: [lng, lat] }` |
| `accessType`         | String        | Type d'accès                                                         |
| `deletedAt`          | Date \| null  | Soft-delete                                                          |
| `version`            | Number        | Versioning                                                           |

> ⚠️ `location_encrypted` contient les coordonnées GPS chiffrées en AES-256-GCM. Le champ `location` (GeoJSON) est rempli au moment de la lecture et ne doit pas être utilisé comme source de vérité.
