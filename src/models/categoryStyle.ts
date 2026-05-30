import mongoose, { Schema, Document } from "mongoose";
import { FICHE_TYPES } from "../constants/fichesEnums";

/**
 * Personnalisation visuelle d'un type de cavité (FICHE_TYPES) par utilisateur.
 * Permet à chaque utilisateur de définir une couleur et une icône propres à
 * chaque type de cavité.
 *
 * S'inspire de la structure color/icon de models/lists.ts.
 */
export interface ICategoryStyle extends Document {
  userId: mongoose.Types.ObjectId;
  type: (typeof FICHE_TYPES)[number];
  color: string;
  icon: string;
  version?: number;
  createdAt: Date;
  updatedAt: Date;
}

const categoryStyleSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "L'ID utilisateur est obligatoire"],
      index: true,
    },
    type: {
      type: String,
      required: [true, "Le type de cavité est obligatoire"],
      enum: FICHE_TYPES,
    },
    color: {
      type: String,
      default: "#22c55e",
      maxlength: 20,
    },
    icon: {
      type: String,
      default: "default-icon",
      maxlength: 100,
    },
    version: {
      type: Number,
      default: 1,
    },
  },
  { timestamps: true },
);

// Un seul style par (utilisateur, type de cavité).
categoryStyleSchema.index({ userId: 1, type: 1 }, { unique: true });

const CategoryStyleModel =
  mongoose.models.CategoryStyle ||
  mongoose.model<ICategoryStyle>("CategoryStyle", categoryStyleSchema);

export default CategoryStyleModel;
