import mongoose, { Schema, Document } from "mongoose";

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
    },
    description: {
      type: String,
      default: "",
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
    },
    icon: {
      type: String,
      default: "default-icon", // Icône par défaut
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

// Index pour accélérer les requêtes de soft-delete
listSchema.index({ deletedAt: 1 });

const ListModel =
  mongoose.models.List || mongoose.model<IList>("List", listSchema);
export default ListModel;
