import mongoose, { Schema, Document } from "mongoose";

/**
 * Plan : image (plan de cavage/galerie) calée sur la carte par l'utilisateur.
 * Calque strictement privé. Le fichier est chiffré sur disque (AES-256-GCM,
 * clé utilisateur) ; le nom et le placement sont chiffrés en base.
 */
export interface IPlan extends Document {
  userId: mongoose.Types.ObjectId;
  nameEncrypted: string;
  mime: string;
  /** Taille en octets du fichier CLAIR (celle comptée dans le quota) */
  size: number;
  /** Chemin relatif du blob chiffré relatif à PLANS_STORAGE_PATH (<userId>/<planId>.bin) */
  filePath: string;
  /** JSON du placement chiffré (iv:authTag:data) ; absent si non placé */
  placementEncrypted?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const planSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "L'ID utilisateur est obligatoire"],
      index: true,
    },
    nameEncrypted: { type: String, required: true },
    mime: {
      type: String,
      required: true,
      enum: ["image/png", "image/jpeg", "image/webp"],
    },
    size: { type: Number, required: true, min: 0 },
    filePath: { type: String, required: true },
    placementEncrypted: { type: String, default: null },
  },
  { timestamps: true },
);

const PlanModel =
  (mongoose.models.Plan as mongoose.Model<IPlan>) ||
  mongoose.model<IPlan>("Plan", planSchema);

export default PlanModel;
