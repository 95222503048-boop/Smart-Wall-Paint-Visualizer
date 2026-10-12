import mongoose from 'mongoose';

const colorSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  hex: { type: String, required: true, match: /^#[0-9A-Fa-f]{6}$/ },
  brand: { type: String, default: 'Studio palette', trim: true, maxlength: 80 },
  finishes: { type: [String], default: ['Matte'] },
  categories: { type: [String], default: [] },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

export default mongoose.model('Color', colorSchema);
