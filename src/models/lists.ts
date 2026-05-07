import mongoose, { Schema, Document } from "mongoose";
import { softDeletePlugin } from "../utils/softDeletePlugin";

export interface IList extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  description: string;
  points: mongoose.Types.ObjectId[]; // Référence vers les points
  color: string; // Couleur de la liste
  icon: string; // Icône de la liste
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null; // Soft-delete : date de suppression
  version?: number;
}

const listSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "L'ID utilisateur est obligatoire"],
      index: true, // Ajout d'un index pour accélérer les requêtes
    },
    name: {
      type: String,
      required: [true, "Le nom de la liste est obligatoire"],
      maxlength: 200,
      trim: true,
    },
    description: {
      type: String,
      default: "",
      maxlength: 2000,
    },
    points: [
      {
        type: Schema.Types.ObjectId,
        ref: "Point",
        default: [],
      },
    ],
    color: {
      type: String,
      default: "#000000", // Couleur par défaut
      maxlength: 20,
    },
    icon: {
      type: String,
      default: "default-icon", // Icône par défaut
      maxlength: 100,
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
  { timestamps: true },
);

// REFONTE §4.2.2: soft-delete par défaut (exclut deletedAt !== null des find).
listSchema.plugin(softDeletePlugin);

// Index pour accélérer les requêtes de soft-delete
listSchema.index({ deletedAt: 1 });

const ListModel =
  mongoose.models.List || mongoose.model<IList>("List", listSchema);
export default ListModel;
