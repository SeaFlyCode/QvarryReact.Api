import mongoose, { Schema, Document } from "mongoose";

// Interface pour les fiches avec des coordonnées chiffrées
export interface IFiche extends Document {
  name: string;
  ville: string;
  type: string;
  etat: string;
  accessibilite?: string;
  userId: mongoose.Types.ObjectId;
  difficulte_acces: string;
  risque_oxygene: string;
  acces_souterrain: string;
  praticite_souterrain: string;
  etat_general: string;
  commentaire?: string;
  points_ids: mongoose.Types.ObjectId[];
  date_creation: Date;
  date_modification: Date;
  equipement_conseille?: string[];
  surface?: string[];
  type_galeries?: string[];
  interets?: string;
  center_cavite?: {
    type: string;
    coordinates: number[];
  };
  deletedAt?: Date | null; // Soft-delete : date de suppression
  version?: number;
}

// Schéma principal pour les fiches
const ficheSchema = new Schema<IFiche>(
  {
    name: {
      type: String,
      required: [true, "Le nom de la fiche est obligatoire"],
      trim: true,
      maxlength: [1000, "Le nom ne peut pas dépasser 1000 caractères"],
    },
    ville: {
      type: String,
      required: [true, "La ville est obligatoire"],
      trim: true,
    },
    type: {
      type: String,
      required: [true, "Le type de lieu est obligatoire"],
    },
    etat: {
      type: String,
      required: [true, "L'état est obligatoire"],
    },
    accessibilite: {
      type: String,
      default: "",
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "L'ID de l'utilisateur est obligatoire"],
      index: true, // Ajout d'un index pour accélérer les requêtes
    },
    difficulte_acces: {
      type: String,
      required: [true, "La difficulté d'accès est obligatoire"],
    },
    risque_oxygene: {
      type: String,
      required: [true, "Le risque d'oxygène est obligatoire"],
    },
    acces_souterrain: {
      type: String,
      required: [true, "L'accès au souterrain est obligatoire"],
    },
    praticite_souterrain: {
      type: String,
      required: [true, "La praticité du souterrain est obligatoire"],
    },
    etat_general: {
      type: String,
      required: [true, "L'état général est obligatoire"],
    },
    commentaire: {
      type: String,
      default: "",
    },
    // Liste des points associés
    points_ids: {
      type: [Schema.Types.ObjectId],
      ref: "Point",
      default: [],
    },
    date_creation: {
      type: Date,
      default: Date.now,
    },
    date_modification: {
      type: Date,
      default: Date.now,
    },
    equipement_conseille: {
      type: [String],
      default: [],
    },
    surface: {
      type: [String],
      default: [],
    },
    type_galeries: {
      type: [String],
      default: [],
    },
    interets: {
      type: String,
      default: "",
    },
    center_cavite: {
      type: {
        type: String,
        enum: ["Point"],
      },
      coordinates: {
        type: [Number],
      },
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    version: {
      type: Number,
      default: 1,
    },
  },
  {
    timestamps: {
      createdAt: "date_creation",
      updatedAt: "date_modification",
    },
  },
);

// Index pour accélérer les requêtes de soft-delete
ficheSchema.index({ deletedAt: 1 });
ficheSchema.index({ center_cavite: "2dsphere" });
ficheSchema.index({ userId: 1, deletedAt: 1 }); // Compound pour user queries
ficheSchema.index({ userId: 1, date_modification: -1 }); // Pour sorted lists

const FicheModel = mongoose.model<IFiche>("Fiche", ficheSchema);

export default FicheModel;
