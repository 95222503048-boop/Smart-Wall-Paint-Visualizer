import { Router } from 'express';
import Color from '../models/Color.js';
import { authenticate, requireAdmin } from '../middleware.js';

const router = Router();
router.get('/', authenticate, async (_req, res, next) => {
  try { res.json(await Color.find({ active: true }).sort({ name: 1 })); } catch (err) { next(err); }
});
router.get('/admin/all', authenticate, requireAdmin, async (_req, res, next) => {
  try { res.json(await Color.find().sort({ name: 1 })); } catch (err) { next(err); }
});
router.post('/', authenticate, requireAdmin, async (req, res, next) => {
  try { const { name, hex, brand, finishes, categories } = req.body || {}; res.status(201).json(await Color.create({ name, hex, brand, finishes, categories })); } catch (err) { next(err); }
});
router.patch('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { name, hex, brand, finishes, categories, active } = req.body || {};
    const color = await Color.findByIdAndUpdate(req.params.id, { name, hex, brand, finishes, categories, active }, { new: true, runValidators: true, omitUndefined: true });
    if (!color) return res.status(404).json({ message: 'Color not found.' });
    res.json(color);
  } catch (err) { next(err); }
});
router.delete('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const color = await Color.findByIdAndDelete(req.params.id);
    if (!color) return res.status(404).json({ message: 'Color not found.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});
export default router;
