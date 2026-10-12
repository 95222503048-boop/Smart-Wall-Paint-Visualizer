import { Router } from 'express';
import User from '../models/User.js';
import Project from '../models/Project.js';
import Session from '../models/Session.js';
import { authenticate, requireAdmin } from '../middleware.js';

const router = Router();
router.use(authenticate, requireAdmin);
router.get('/users', async (_req, res, next) => {
  try {
    const users = await User.find().select('name email role createdAt').sort({ createdAt: -1 }).lean();
    const ids = users.map((u) => u._id);
    const counts = await Project.aggregate([{ $match: { owner: { $in: ids } } }, { $group: { _id: '$owner', count: { $sum: 1 } } }]);
    const byId = new Map(counts.map((c) => [String(c._id), c.count]));
    res.json(users.map((u) => ({ ...u, id: String(u._id), projectCount: byId.get(String(u._id)) || 0 })));
  } catch (err) { next(err); }
});
router.patch('/users/:id/role', async (req, res, next) => {
  try {
    if (!['user', 'admin'].includes(req.body?.role)) return res.status(400).json({ message: 'Role must be user or admin.' });
    if (String(req.user._id) === req.params.id && req.body.role !== 'admin') return res.status(400).json({ message: 'You cannot remove your own admin access.' });
    const user = await User.findByIdAndUpdate(req.params.id, { role: req.body.role }, { new: true }).select('name email role createdAt');
    if (!user) return res.status(404).json({ message: 'User not found.' });
    res.json(user);
  } catch (err) { next(err); }
});
router.get('/projects', async (_req, res, next) => {
  try { res.json(await Project.find().populate('owner', 'name email').sort({ updatedAt: -1 }).limit(100).lean()); } catch (err) { next(err); }
});
router.get('/analytics', async (_req, res, next) => {
  try {
    const now = new Date();
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const [users, uploads, projectRows, sessionRows, activeSessions] = await Promise.all([
      User.countDocuments(),
      Project.countDocuments({ createdAt: { $gte: since } }),
      Project.aggregate([{ $project: { count: { $size: '$trials' }, ratings: '$trials.satisfaction' } }, { $group: { _id: null, saved: { $sum: '$count' }, ratings: { $push: '$ratings' } } }]),
      Session.aggregate([{ $match: { endedAt: { $ne: null } } }, { $project: { duration: { $subtract: ['$endedAt', '$startedAt'] } } }, { $group: { _id: null, averageMs: { $avg: '$duration' } } }]),
      Session.countDocuments({ endedAt: null, lastSeenAt: { $gte: new Date(now.getTime() - 5 * 60 * 1000) } })
    ]);
    const flatRatings = (projectRows[0]?.ratings || []).flat().filter((n) => Number.isFinite(n));
    const averageRating = flatRatings.length ? flatRatings.reduce((sum, n) => sum + n, 0) / flatRatings.length : null;
    res.json({ totalUsers: users, uploadsLast24h: uploads, savedTrials: projectRows[0]?.saved || 0, averageSessionMinutes: sessionRows[0]?.averageMs ? Math.round(sessionRows[0].averageMs / 60000 * 10) / 10 : 0, activeSessions, averageSatisfaction: averageRating ? Math.round(averageRating * 10) / 10 : null, refreshedAt: now });
  } catch (err) { next(err); }
});
export default router;
