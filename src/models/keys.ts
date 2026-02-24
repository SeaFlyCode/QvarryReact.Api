import mongoose, { Document, Schema, Model } from "mongoose";

// Interface TypeScript pour le typage
export interface IKeys extends Document {
  userId?: mongoose.Types.ObjectId; // Optionnel
  key: string;
  type?: string; // "user", "db", "system", etc.
  date: Date;
}

// Schéma Mongoose
const keysSchema: Schema<IKeys> = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: false },
  key: { type: String, required: true, maxlength: 10000 },
  type: {
    type: String,
    required: false,
    enum: [
      "master",
      "communication",
      "rsa-public",
      "rsa-private",
      "user",
      "db",
      "system",
    ],
  },
  date: { type: Date, default: Date.now },
});

keysSchema.index({ userId: 1, type: 1 });

// Modèle Mongoose
const KeysModel: Model<IKeys> =
  mongoose.models.Keys || mongoose.model<IKeys>("Keys", keysSchema);

export default KeysModel;
