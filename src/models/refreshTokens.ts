// server/src/models/refreshTokens.ts
import mongoose, { Schema, Document } from "mongoose";

export interface IRefreshToken extends Document {
  tokenId: string; // jti du JWT
  userId: mongoose.Types.ObjectId;
  token: string; // Hash du refresh token
  ipAddress?: string;
  userAgent?: string;
  deviceFingerprint?: string;
  expiresAt: Date;
  createdAt: Date;
  lastUsedAt: Date;
  revoked: boolean;
  revokedAt?: Date;
  revokedReason?: string;
  tokenFamily?: string; // Pour détecter le vol de token
}

const refreshTokenSchema = new Schema<IRefreshToken>({
  tokenId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  userId: {
    type: Schema.Types.ObjectId,
    required: true,
    index: true,
  },
  token: {
    type: String,
    required: true,
    unique: true,
  },
  ipAddress: String,
  userAgent: String,
  deviceFingerprint: String,
  expiresAt: {
    type: Date,
    required: true,
    // Note: index géré par le TTL index ci-dessous
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  lastUsedAt: {
    type: Date,
    default: Date.now,
  },
  revoked: {
    type: Boolean,
    default: false,
    index: true,
  },
  revokedAt: Date,
  revokedReason: String,
  tokenFamily: String,
});

// Index composé pour optimiser les requêtes
refreshTokenSchema.index({ userId: 1, revoked: 1 });
refreshTokenSchema.index({ expiresAt: 1, revoked: 1 });

// Cleanup automatique des tokens expirés (TTL index)
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<IRefreshToken>(
  "RefreshToken",
  refreshTokenSchema,
);
