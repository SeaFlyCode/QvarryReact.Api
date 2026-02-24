// server/src/models/maintenance.ts
import mongoose, { Schema, Document } from "mongoose";

export interface IMaintenance extends Document {
  isActive: boolean;
  message?: string;
  activatedBy?: mongoose.Types.ObjectId;
  activatedAt?: Date;
  deactivatedAt?: Date;
  estimatedEndTime?: Date;
  updatedAt: Date;
}

const MaintenanceSchema: Schema = new Schema(
  {
    isActive: {
      type: Boolean,
      default: false,
      required: true,
    },
    message: {
      type: String,
      default:
        "Le site est actuellement en maintenance. Nous serons bientôt de retour.",
      maxlength: 1000,
    },
    activatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    activatedAt: {
      type: Date,
    },
    deactivatedAt: {
      type: Date,
    },
    estimatedEndTime: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

// On utilise un singleton pattern - une seule entrée dans la collection
const MaintenanceModel = mongoose.model<IMaintenance>(
  "Maintenance",
  MaintenanceSchema,
);

export default MaintenanceModel;
