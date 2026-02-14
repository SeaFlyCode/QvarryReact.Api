// server/src/models/blockedIps.ts
import mongoose, { Schema, Document } from "mongoose";

export interface IBlockedIp extends Document {
    ipAddress: string;
    reason: string;
    blockedAt: Date;
    blockedUntil?: Date; // null = blocage permanent
    blockedBy: 'auto' | 'admin';
    attackType: string;
    attemptCount: number;
    relatedUserId?: mongoose.Types.ObjectId;
    isActive: boolean;
    metadata?: {
        userAgents?: string[];
        targetedEndpoints?: string[];
        geoLocation?: string;
    };
}

const blockedIpSchema = new Schema<IBlockedIp>({
    ipAddress: {
        type: String,
        required: true,
        index: true
    },
    reason: {
        type: String,
        required: true
    },
    blockedAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    blockedUntil: {
        type: Date,
        default: null
    },
    blockedBy: {
        type: String,
        enum: ['auto', 'admin'],
        default: 'auto'
    },
    attackType: {
        type: String,
        required: true,
        index: true
    },
    attemptCount: {
        type: Number,
        default: 1
    },
    relatedUserId: {
        type: Schema.Types.ObjectId,
        ref: 'User'
    },
    isActive: {
        type: Boolean,
        default: true,
        index: true
    },
    metadata: {
        userAgents: [String],
        targetedEndpoints: [String],
        geoLocation: String
    }
});

// Index composé pour recherche rapide
blockedIpSchema.index({ ipAddress: 1, isActive: 1 });
blockedIpSchema.index({ blockedUntil: 1, isActive: 1 });

export default mongoose.model<IBlockedIp>("BlockedIp", blockedIpSchema);
