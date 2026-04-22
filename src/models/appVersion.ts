import mongoose, { Schema, Document } from "mongoose";

interface IPlatformVersionConfig {
  minVersion: string;
  popupMessage: string;
  forceUpdate: boolean;
}

export interface IAppVersion extends Document {
  ios: IPlatformVersionConfig;
  android: IPlatformVersionConfig;
  updatedBy?: mongoose.Types.ObjectId;
  updatedAt: Date;
}

const PlatformVersionConfigSchema = new Schema<IPlatformVersionConfig>(
  {
    minVersion: {
      type: String,
      required: true,
      default: "1.0.0",
      match: /^\d+\.\d+\.\d+$/,
    },
    popupMessage: {
      type: String,
      required: true,
      default: "Une nouvelle version est disponible, mettez à jour l'application.",
      maxlength: 500,
    },
    forceUpdate: {
      type: Boolean,
      required: true,
      default: true,
    },
  },
  { _id: false },
);

const AppVersionSchema = new Schema<IAppVersion>(
  {
    ios: {
      type: PlatformVersionConfigSchema,
      required: true,
      default: () => ({}),
    },
    android: {
      type: PlatformVersionConfigSchema,
      required: true,
      default: () => ({}),
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  },
);

const AppVersionModel = mongoose.model<IAppVersion>("AppVersion", AppVersionSchema);

export default AppVersionModel;
