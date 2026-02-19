import mongoose, { Schema, Document } from "mongoose";

export interface IPoint extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  description: string;
  location_encrypted: string;
  ficheId?: mongoose.Types.ObjectId; // Référence optionnelle vers une fiche
  location?: {
    type: "Point";
    coordinates: [number, number]; // [lng, lat]
  };
  createdAt: Date;
  updatedAt: Date;
  accessType?: string; // Ajout du champ pour le type d'accès
  deletedAt?: Date | null; // Soft-delete : date de suppression
}

const pointSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "L'ID utilisateur est obligatoire"],
      index: true, // Ajout d'un index pour accélérer les requêtes
    },
    name: {
      type: String,
      required: [true, "Le nom du point est obligatoire"],
    },
    description: {
      type: String,
      default: "",
    },
    location_encrypted: {
      type: String,
      required: [true, "Les coordonnées sont obligatoires"],
    },
    ficheId: {
      type: Schema.Types.ObjectId,
      ref: "Fiche",
      default: null,
    },
    location: {
      type: {
        type: String, // 'Point' pour GeoJSON
        enum: ["Point"], // Limite les valeurs possibles à 'Point'
        required: false, // Rendre optionnel
      },
      coordinates: {
        type: [Number],
        required: false, // Rendre optionnel
      },
    },
    accessType: {
      type: String,
      default: "",
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

// Index pour accélérer les requêtes géospatiales
pointSchema.index({ location: "2dsphere" });

// Index pour accélérer les requêtes de soft-delete
pointSchema.index({ deletedAt: 1 });

export default mongoose.model<IPoint>("Point", pointSchema);
