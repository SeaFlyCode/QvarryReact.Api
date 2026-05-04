import mongoose, { Document, Schema, Model } from "mongoose";

// Type des données partagées
export type DataType = "fiche" | "point" | "liste";

// Statut de lecture par destinataire
export type ShareStatus = "pending" | "read" | "accepted" | "declined";

// Interface pour les données chiffrées par destinataire
export interface IEncryptedDataPerReceiver {
  receiverId: mongoose.Types.ObjectId;
  encryptedData: string; // Données chiffrées avec la clé publique RSA du receveur
  status: ShareStatus;
}

// Interface pour l'accusé de réception
export interface IReadReceipt {
  receiverId: mongoose.Types.ObjectId;
  readAt: Date;
  ipAddress?: string;
}

// Interface principale pour le document DataShare
export interface IDataShare extends Document {
  senderId: mongoose.Types.ObjectId;
  receiverIds: mongoose.Types.ObjectId[];

  dataType: DataType;
  dataId: mongoose.Types.ObjectId; // ID de la fiche/point/liste originale

  // Données chiffrées pour chaque destinataire
  encryptedDataPerReceiver: IEncryptedDataPerReceiver[];

  // Signature et intégrité
  signature: string; // Signature RSA du hash des données par l'émetteur
  dataHash: string; // Hash SHA-256 des données originales (pour audit)

  // Pour les entités liées (fiches et listes incluent leurs points)
  relatedPointsIds?: mongoose.Types.ObjectId[]; // IDs des points liés (si applicable)

  // Message accompagnant le partage (optionnel, chiffré pour chaque receveur)
  messagePerReceiver?: {
    receiverId: mongoose.Types.ObjectId;
    encryptedMessage: string;
  }[];

  // Métadonnées temporelles
  sharedAt: Date;
  expiresAt: Date; // sharedAt + 20 jours

  // Notifications et accusés de réception
  notificationSent: boolean;
  readBy: IReadReceipt[];

  // Notifications d'expiration (pour éviter les doublons par cron)
  expiringSoonNotifiedAt?: Date;
  expiredNotifiedAt?: Date;

  // Métadonnées supplémentaires
  isActive: boolean; // false si supprimé ou expiré
}

// Schéma Mongoose
const dataShareSchema: Schema<IDataShare> = new Schema(
  {
    senderId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    receiverIds: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],

    dataType: {
      type: String,
      enum: ["fiche", "point", "liste"],
      required: true,
    },
    dataId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    encryptedDataPerReceiver: [
      {
        receiverId: {
          type: Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        encryptedData: {
          type: String,
          required: true,
        },
        status: {
          type: String,
          enum: ["pending", "read", "accepted", "declined"],
          default: "pending",
        },
      },
    ],

    signature: {
      type: String,
      required: true,
    },
    dataHash: {
      type: String,
      required: true,
    },

    relatedPointsIds: [
      {
        type: Schema.Types.ObjectId,
        ref: "Point",
      },
    ],

    messagePerReceiver: [
      {
        receiverId: {
          type: Schema.Types.ObjectId,
          ref: "User",
        },
        encryptedMessage: {
          type: String,
        },
      },
    ],

    sharedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },

    notificationSent: {
      type: Boolean,
      default: false,
    },
    readBy: [
      {
        receiverId: {
          type: Schema.Types.ObjectId,
          ref: "User",
        },
        readAt: {
          type: Date,
        },
        ipAddress: {
          type: String,
        },
      },
    ],

    expiringSoonNotifiedAt: {
      type: Date,
    },
    expiredNotifiedAt: {
      type: Date,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true, // Ajoute createdAt et updatedAt automatiquement
  },
);

// Index composites pour optimiser les requêtes fréquentes
dataShareSchema.index({ senderId: 1, sharedAt: -1 });
dataShareSchema.index({ receiverIds: 1, isActive: 1, expiresAt: 1 });
dataShareSchema.index({ expiresAt: 1, isActive: 1 }); // Pour le nettoyage automatique

// MED-05 FIX: TTL index pour suppression automatique des partages expirés
dataShareSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Middleware pre-save pour calculer expiresAt si non défini
dataShareSchema.pre("save", function (next) {
  if (!this.expiresAt && this.sharedAt) {
    // 20 jours = 20 * 24 * 60 * 60 * 1000 ms
    this.expiresAt = new Date(
      this.sharedAt.getTime() + 20 * 24 * 60 * 60 * 1000,
    );
  }
  next();
});

// Modèle Mongoose
const DataShareModel: Model<IDataShare> =
  mongoose.models.DataShare ||
  mongoose.model<IDataShare>("DataShare", dataShareSchema);

export default DataShareModel;
