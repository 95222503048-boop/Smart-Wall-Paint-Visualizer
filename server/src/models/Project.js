import mongoose from 'mongoose';

const trialSchema = new mongoose.Schema({
  _id: { type: String },
  name: { type: String, default: 'Paint trial' },
  colorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Color', default: null },
  colorHex: { type: String, default: '#C7836A' },
  opacity: { type: Number, min: 0, max: 1, default: 0.7 },
  appearance: { type: mongoose.Schema.Types.Mixed, default: {} },
  mask: { type: mongoose.Schema.Types.Mixed, default: { brush: [], polygons: [] } },
  layers: { type: [mongoose.Schema.Types.Mixed], default: [] },
  activeLayerId: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  satisfaction: { type: Number, min: 1, max: 5, default: null }
}, { _id: false });

const projectSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  originalUrl: { type: String, required: true },
  mimeType: { type: String, enum: ['image/jpeg', 'image/png'], required: true },
  width: Number,
  height: Number,
  trials: { type: [trialSchema], default: [] },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { versionKey: false });

export default mongoose.model('Project', projectSchema);
