import mongoose, { Document, Schema, Types } from "mongoose";

export interface IParticipant {
  userId: Types.ObjectId;
  role: "admin" | "member";
  joinedAt: Date;
  leftAt?: Date | null;
}

export interface IMutedInfo {
  userId: Types.ObjectId;
  mutedAt: Date;
  mutedUntil?: Date | null; // null = permanent, Date = temporaire
  notifyOnMention?: boolean; // default: true
}

export interface IArchivedInfo {
  userId: Types.ObjectId;
  archivedAt: Date;
}

export interface IPinnedInfo {
  userId: Types.ObjectId;
  pinnedAt: Date;
  order: number;
}

export interface IBlockedInfo {
  userId: Types.ObjectId;
  blockedAt: Date;
  reason?: string;
}

export interface IConversation extends Document {
  name?: string | null;
  isGroup: boolean;
  creatorId: Types.ObjectId;
  participants: IParticipant[];
  lastMessage?: Types.ObjectId | null;
  deletedBy: Types.ObjectId[]; // Liste des utilisateurs qui ont "supprimé" cette conversation

  // Nouvelles options de gestion
  mutedBy: IMutedInfo[];
  archivedBy: IArchivedInfo[];
  pinnedBy: IPinnedInfo[];
  markedUnreadBy: Types.ObjectId[];
  blockedBy: IBlockedInfo[];

  createdAt: Date;
  updatedAt: Date;
}

const ParticipantSchema = new Schema<IParticipant>({
  userId: { type: Schema.Types.ObjectId, required: true, ref: "User" },
  role: { type: String, enum: ["admin", "member"], required: true },
  joinedAt: { type: Date, required: true },
  leftAt: { type: Date, default: null },
});

const MutedInfoSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: "User" },
    mutedAt: { type: Date, required: true },
    mutedUntil: { type: Date, default: null },
    notifyOnMention: { type: Boolean, default: true },
  },
  { _id: false },
);

const ArchivedInfoSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: "User" },
    archivedAt: { type: Date, required: true },
  },
  { _id: false },
);

const PinnedInfoSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: "User" },
    pinnedAt: { type: Date, required: true },
    order: { type: Number, required: true },
  },
  { _id: false },
);

const BlockedInfoSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: "User" },
    blockedAt: { type: Date, required: true },
    reason: { type: String, default: null, maxlength: 500 },
  },
  { _id: false },
);

const ConversationSchema = new Schema<IConversation>(
  {
    name: { type: String, default: null, trim: true },
    isGroup: { type: Boolean, required: true },
    creatorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    participants: { type: [ParticipantSchema], required: true },
    lastMessage: { type: Schema.Types.ObjectId, ref: "Message", default: null },
    deletedBy: { type: [Schema.Types.ObjectId], ref: "User", default: [] },

    // Nouvelles options de gestion
    mutedBy: { type: [MutedInfoSchema], default: [] },
    archivedBy: { type: [ArchivedInfoSchema], default: [] },
    pinnedBy: { type: [PinnedInfoSchema], default: [] },
    markedUnreadBy: { type: [Schema.Types.ObjectId], ref: "User", default: [] },
    blockedBy: { type: [BlockedInfoSchema], default: [] },
  },
  {
    timestamps: true, // createdAt et updatedAt gérés automatiquement
  },
);

ConversationSchema.index({ "participants.userId": 1, updatedAt: -1 });
ConversationSchema.index({ creatorId: 1 });
ConversationSchema.index({ "mutedBy.userId": 1 });
ConversationSchema.index({ "archivedBy.userId": 1 });
ConversationSchema.index({ "pinnedBy.userId": 1, "pinnedBy.order": 1 });
ConversationSchema.index({ markedUnreadBy: 1 });
ConversationSchema.index({ "blockedBy.userId": 1 });
ConversationSchema.index({ "participants.userId": 1, deletedBy: 1 }); // Pour soft-delete filtering

export default mongoose.model<IConversation>(
  "Conversation",
  ConversationSchema,
);
