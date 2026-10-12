import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  startedAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  endedAt: { type: Date, default: null }
}, { versionKey: false });

export default mongoose.model('Session', sessionSchema);
