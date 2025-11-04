// models/user.js
import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'name is required'] },
    email: {
      type: String,
      required: [true, 'email is required'],
      unique: true,
      trim: true,
      lowercase: true
    },
    pendingTasks: {
      type: [mongoose.Schema.Types.ObjectId], // task _ids
      default: []
    },
    dateCreated: { type: Date, default: Date.now }
  },
  { versionKey: false }
);

UserSchema.index({ email: 1 }, { unique: true });

export const User = mongoose.model('User', UserSchema);
