import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from './models/User.js';
import Color from './models/Color.js';

if (!process.env.MONGODB_URI || !process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD || !process.env.JWT_SECRET) {
  throw new Error('Set MONGODB_URI, JWT_SECRET, ADMIN_EMAIL, and ADMIN_PASSWORD in server/.env before seeding.');
}
if (process.env.ADMIN_PASSWORD.length < 12 || process.env.ADMIN_PASSWORD === 'change-this-before-seeding') throw new Error('Set a unique ADMIN_PASSWORD of at least 12 characters before seeding.');
await mongoose.connect(process.env.MONGODB_URI);
const email = process.env.ADMIN_EMAIL.trim().toLowerCase();
const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
await User.findOneAndUpdate({ email }, { $set: { name: process.env.ADMIN_NAME || 'Visualizer Admin', role: 'admin' }, $setOnInsert: { passwordHash: hash } }, { upsert: true, new: true });
const samples = [
  ['Soft Linen', '#E7DED0', 'Warm neutral', ['Living room', 'Bedroom']],
  ['Sage Retreat', '#A9B7A1', 'Nature inspired', ['Living room', 'Bedroom']],
  ['Coastal Haze', '#9ABCC4', 'Cool calm', ['Bedroom', 'Bathroom']],
  ['Terracotta Clay', '#C7836A', 'Earthy accent', ['Dining room', 'Accent']],
  ['Midnight Garden', '#425650', 'Deep green', ['Accent', 'Study']],
  ['Cloud White', '#F4F1E9', 'Classic neutral', ['Any room']]
];
for (const [name, hex, category, categories] of samples) await Color.updateOne({ name }, { $setOnInsert: { name, hex, brand: 'Studio palette', categories: [category, ...categories], finishes: ['Matte', 'Eggshell', 'Satin'] } }, { upsert: true });
console.log(`Admin ready: ${email}. Added starter palette where missing.`);
await mongoose.disconnect();
