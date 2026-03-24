import mongoose, { Document, Schema, Types } from "mongoose";

export interface IMessageReply {
  userId: Types.ObjectId;
  content: string;
  createdAt: Date;
}

export interface IMessageMetadata {
  mentions?: Types.ObjectId[];
  edited?: boolean;
  deleted?: boolean;
}

export interface IMessage extends Document {
  conversationId: Types.ObjectId;
  senderId: Types.ObjectId;
  content: string;
  type: "text" | "system";
  readBy: Types.ObjectId[];
  replies: IMessageReply[];
  metadata?: IMessageMetadata;
  createdAt: Date;
  updatedAt: Date;
}

const MessageReplySchema = new Schema<IMessageReply>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    content: { type: String, required: true, maxlength: 10000 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const MessageMetadataSchema = new Schema<IMessageMetadata>(
  {
    mentions: [{ type: Schema.Types.ObjectId, ref: "User" }],
    edited: { type: Boolean, default: false },
    deleted: { type: Boolean, default: false },
  },
  { _id: false },
);

const MessageSchema = new Schema<IMessage>({
  conversationId: {
    type: Schema.Types.ObjectId,
    ref: "Conversation",
    required: true,
  },
  senderId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  content: { type: String, required: true, maxlength: 10000 },
  type: { type: String, enum: ["text", "system"], default: "text" },
  readBy: [{ type: Schema.Types.ObjectId, ref: "User" }],
  replies: [MessageReplySchema],
  metadata: MessageMetadataSchema,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

MessageSchema.index({ conversationId: 1, createdAt: -1 });
MessageSchema.index({ conversationId: 1, readBy: 1 });
MessageSchema.index({ senderId: 1 });
MessageSchema.index({ conversationId: 1, readBy: 1, createdAt: -1 }); // Pour paginated unread messages

const MessageModel =
  mongoose.models.Message || mongoose.model<IMessage>("Message", MessageSchema);
export default MessageModel;
