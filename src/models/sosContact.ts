import mongoose, { Document, Schema, Model } from "mongoose";

// ═══════════════════════════════════════════════════════════════════════════
// MODÈLE SOS CONTACT (CONTACTS D'URGENCE)
// ═══════════════════════════════════════════════════════════════════════════
// Contacts d'urgence personnels (NON des utilisateurs Qvarry)
// Ces contacts reçoivent des SMS via Vonage en stage 2 de l'escalade
// ═══════════════════════════════════════════════════════════════════════════

// Interface pour les contacts d'urgence SOS
export interface ISosContact extends Document {
  userId: mongoose.Types.ObjectId; // Propriétaire du contact
  sessionId?: mongoose.Types.ObjectId; // Si présent, contact spécifique à une session (override)
  name: string; // Nom du contact
  phone: string; // Numéro de téléphone (format E.164: +33...)
  relationship?: string; // Relation (ex: "Conjoint", "Parent", "Collègue")
  isDefault: boolean; // Contact par défaut (alerté en priorité)
  lastSmsSentAt?: Date; // Dernier SMS envoyé à ce contact

  // Timestamps Mongoose
  createdAt: Date;
  updatedAt: Date;
}

const sosContactSchema: Schema<ISosContact> = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    sessionId: {
      type: Schema.Types.ObjectId,
      ref: "SosSession",
      required: false,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      // Validation format E.164 (ex: +33612345678)
      validate: {
        validator: function (v: string) {
          return /^\+[1-9]\d{6,14}$/.test(v);
        },
        message:
          "Le numéro de téléphone doit être au format international (ex: +33612345678)",
      },
    },
    relationship: {
      type: String,
      trim: true,
      maxlength: 50,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    lastSmsSentAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

// Index composites
sosContactSchema.index({ userId: 1, isDefault: -1, createdAt: -1 });
// Un même numéro par utilisateur ET par session (permet le même numéro en permanent et en session)
sosContactSchema.index({ userId: 1, phone: 1, sessionId: 1 }, { unique: true });

const SosContactModel: Model<ISosContact> =
  mongoose.models.SosContact ||
  mongoose.model<ISosContact>("SosContact", sosContactSchema);

export default SosContactModel;
