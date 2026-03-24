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
  version?: number;
  photo?: {
    url: string;
    size: number;
    mimeType: string;
    uploadedAt: Date;
    originalName: string;
    checksum: string;
  };
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
    version: {
      type: Number,
      default: 1,
    },
    photo: {
      type: {
        url: { type: String, required: true },
        size: { type: Number, required: true },
        mimeType: { type: String, required: true },
        uploadedAt: { type: Date, default: Date.now },
        originalName: { type: String, required: true },
        checksum: { type: String, required: true },
      },
      required: false,
      default: undefined,
    },
  },
  { timestamps: true },
);

// Index pour accélérer les requêtes géospatiales
pointSchema.index({ location: "2dsphere" });

// Index pour accélérer les requêtes de soft-delete
pointSchema.index({ deletedAt: 1 });
pointSchema.index({ userId: 1, deletedAt: 1 }); // Compound pour user queries excluding deleted
pointSchema.index({ userId: 1, ficheId: 1 }); // Pour fiche-point relationships

export default mongoose.model<IPoint>("Point", pointSchema);
