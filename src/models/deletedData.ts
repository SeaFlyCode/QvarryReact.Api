/**
 * DeletedData Model
 *
 * Archive des données supprimées (soft delete)
 * Les données sont physiquement supprimées de leur table d'origine
 * mais conservées ici pour audit et récupération potentielle.
 *
 * WORKFLOW:
 * 1. Utilisateur demande suppression
 * 2. Données copiées dans DeletedData
 * 3. Données supprimées de la table d'origine
 * 4. Les données archivées ne sont JAMAIS utilisées par l'application
 */

import mongoose, { Schema, Document } from "mongoose";

export type DeletedEntityType =
  | "fiche"
  | "point"
  | "list"
  | "user"
  | "message"
  | "conversation"
  | "contact"
  | "notification"
  | "dataShare"
  | "maintenance";

export interface IDeletedData extends Document {
  // Identification de l'entité supprimée
  entityType: DeletedEntityType;
  entityId: mongoose.Types.ObjectId;

  // Données complètes de l'entité au moment de la suppression
  data: Record<string, unknown>;

  // Métadonnées de suppression
  deletedBy: mongoose.Types.ObjectId; // Utilisateur qui a effectué la suppression
  deletedAt: Date;
  deletionReason?: string; // Raison optionnelle de la suppression
  deletionContext?: {
    ipAddress?: string;
    userAgent?: string;
    requestId?: string;
  };

  // Pour les cascades (ex: suppression d'une fiche supprime aussi ses points)
  parentEntityType?: DeletedEntityType;
  parentEntityId?: mongoose.Types.ObjectId;

  // Restauration
  isRestored: boolean;
  restoredAt?: Date;
  restoredBy?: mongoose.Types.ObjectId;
}

const deletedDataSchema = new Schema<IDeletedData>({
  entityType: {
    type: String,
    required: true,
    enum: [
      "fiche",
      "point",
      "list",
      "user",
      "message",
      "conversation",
      "contact",
      "notification",
      "dataShare",
      "maintenance",
    ],
    index: true,
  },
  entityId: {
    type: Schema.Types.ObjectId,
    required: true,
    index: true,
  },
  data: {
    type: Schema.Types.Mixed,
    required: true,
  },
  deletedBy: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  deletedAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  deletionReason: {
    type: String,
    maxlength: 500,
  },
  deletionContext: {
    ipAddress: String,
    userAgent: String,
    requestId: String,
  },
  parentEntityType: {
    type: String,
    enum: [
      "fiche",
      "point",
      "list",
      "user",
      "message",
      "conversation",
      "contact",
      "notification",
      "dataShare",
      "maintenance",
    ],
  },
  parentEntityId: {
    type: Schema.Types.ObjectId,
  },
  isRestored: {
    type: Boolean,
    default: false,
    index: true,
  },
  restoredAt: Date,
  restoredBy: {
    type: Schema.Types.ObjectId,
    ref: "User",
  },
});

// Index composés pour recherches fréquentes
deletedDataSchema.index({ entityType: 1, deletedAt: -1 });
deletedDataSchema.index({ deletedBy: 1, deletedAt: -1 });
deletedDataSchema.index({ entityType: 1, entityId: 1 });
deletedDataSchema.index({ parentEntityType: 1, parentEntityId: 1 });

// TTL index — purge automatique des données supprimées après 90 jours (conformité RGPD)
deletedDataSchema.index(
  { deletedAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 },
);

export default mongoose.model<IDeletedData>("DeletedData", deletedDataSchema);
