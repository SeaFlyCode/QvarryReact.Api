import mongoose, { Document, Schema, Types } from "mongoose";

export interface IParticipant {
  userId: Types.ObjectId;
  role: 'admin' | 'member';
  joinedAt: Date;
  leftAt?: Date | null;
}

export interface IConversation extends Document {
  name?: string | null;
  isGroup: boolean;
  creatorId: Types.ObjectId;
  participants: IParticipant[];
  lastMessage?: Types.ObjectId | null;
  deletedBy: Types.ObjectId[]; // Liste des utilisateurs qui ont "supprimé" cette conversation
  createdAt: Date;
  updatedAt: Date;
}

const ParticipantSchema = new Schema<IParticipant>({
  userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
  role: { type: String, enum: ['admin', 'member'], required: true },
  joinedAt: { type: Date, required: true },
  leftAt: { type: Date, default: null },
});

const ConversationSchema = new Schema<IConversation>({
  name: { type: String, default: null, trim: true },
  isGroup: { type: Boolean, required: true },
  creatorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  participants: { type: [ParticipantSchema], required: true },
  lastMessage: { type: Schema.Types.ObjectId, ref: 'Message', default: null },
  deletedBy: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },
}, {
  timestamps: true, // createdAt et updatedAt gérés automatiquement
});

export default mongoose.model<IConversation>('Conversation', ConversationSchema);
