import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import User from '../models/User.js';
import Session from '../models/Session.js';
import { authenticate, authCookieName, csrfCookieName, cookieOptions } from '../middleware.js';
import { rateLimit } from '../rate-limit.js';

const router = Router();
const publicUser = (u) => ({ id: u._id, name: u.name, email: u.email, role: u.role });
const issueToken = (u, session) => jwt.sign({ sub: u._id.toString(), sid: session._id.toString() }, process.env.JWT_SECRET, { expiresIn: '12h', issuer: 'stillroom-api', audience: 'stillroom-client' });
const setAuthCookie = (res, user, session) => res.cookie(authCookieName, issueToken(user, session), cookieOptions);
const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 12, message: 'Too many sign-in attempts. Wait 15 minutes, then try again.' });
const registerLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 6, message: 'Too many account attempts. Please try again in an hour.' });

router.get('/csrf', (_req, res) => {
  const token = randomBytes(32).toString('hex');
  res.cookie(csrfCookieName, token, { ...cookieOptions, httpOnly: false, maxAge: 12 * 60 * 60 * 1000 });
  res.json({ csrfToken: token });
});

router.post('/register', registerLimiter, async (req, res, next) => {
  try {
    const { name, email, password } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 80 || typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email) || typeof password !== 'string' || password.length < 12 || password.length > 128) {
      return res.status(400).json({ message: 'Enter your name, a valid email, and a password between 12 and 128 characters.' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (await User.exists({ email: normalizedEmail })) return res.status(409).json({ message: 'An account with that email already exists.' });
    const user = await User.create({ name: name.trim(), email: normalizedEmail, passwordHash: await bcrypt.hash(password, 12) });
    const session = await Session.create({ user: user._id });
    setAuthCookie(res, user, session);
    res.status(201).json({ user: publicUser(user), sessionId: session._id });
  } catch (err) { next(err); }
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (typeof password !== 'string' || password.length > 128) return res.status(400).json({ message: 'Enter a valid email and password.' });
    const user = await User.findOne({ email: String(email || '').trim().toLowerCase() }).select('+passwordHash');
    if (!user || !(await bcrypt.compare(password || '', user.passwordHash))) return res.status(401).json({ message: 'Email or password is incorrect.' });
    const session = await Session.create({ user: user._id });
    setAuthCookie(res, user, session);
    res.json({ user: publicUser(user), sessionId: session._id });
  } catch (err) { next(err); }
});

router.get('/me', authenticate, (req, res) => res.json({ user: publicUser(req.user) }));

router.post('/session/ping', authenticate, async (req, res, next) => {
  try {
    await Session.findOneAndUpdate({ _id: req.authSessionId, user: req.user._id, endedAt: null }, { lastSeenAt: new Date() });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/session/end', authenticate, async (req, res, next) => {
  try {
    await Session.findOneAndUpdate({ _id: req.authSessionId, user: req.user._id, endedAt: null }, { endedAt: new Date(), lastSeenAt: new Date() });
    const { maxAge: _maxAge, ...clearOptions } = cookieOptions;
    res.clearCookie(authCookieName, clearOptions);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
