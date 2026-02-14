import { Schema, model, Document, Types } from 'mongoose';

export interface IContact extends Document {
    userId: Types.ObjectId;
    contactId: Types.ObjectId;
    contactCode?: string;
    isBlocked: boolean;
    status: 'pending' | 'accepted';
    createdAt: Date;
}

const ContactSchema = new Schema<IContact>({
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    contactId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    contactCode: { type: String, trim: true },
    isBlocked: { type: Boolean, default: false },
    status: { type: String, enum: ['pending', 'accepted'], required: true },
    createdAt: { type: Date, default: Date.now }
});

export default model<IContact>('Contact', ContactSchema);
