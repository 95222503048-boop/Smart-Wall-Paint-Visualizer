import jwt from 'jsonwebtoken';
import { timingSafeEqual } from 'node:crypto';
import User from './models/User.js';
import Session from './models/Session.js';

export const authCookieName = 'swv_access';
export const csrfCookieName = 'swv_csrf';
export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production' || process.env.COOKIE_SAME_SITE === 'None',
  sameSite: process.env.COOKIE_SAME_SITE || 'Strict',
  path: '/api',
  maxAge: 12 * 60 * 60 * 1000
};

export function readCookie(req, name) {
  const item = (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (!item) return '';
  try { return decodeURIComponent(item.slice(name.length + 1)); } catch { return ''; }
}

export function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const cookie = readCookie(req, csrfCookieName), header = req.get('x-csrf-token') || '';
  const cookieBytes = Buffer.from(cookie), headerBytes = Buffer.from(header);
  if (!cookie || !header || cookieBytes.length !== headerBytes.length || !timingSafeEqual(cookieBytes, headerBytes)) {
    return res.status(403).json({ message: 'Security check failed. Refresh the page and try again.' });
  }
  next();
}

export async function authenticate(req, res, next) {
  const token = readCookie(req, authCookieName);
  if (!token) return res.status(401).json({ message: 'Sign in to continue.' });
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, { issuer: 'stillroom-api', audience: 'stillroom-client', algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({ message: 'Your session has expired. Please sign in again.' });
  }
  if (!payload.sid) return res.status(401).json({ message: 'Your session is no longer valid. Please sign in again.' });
  try {
    const [user, session] = await Promise.all([
      User.findById(payload.sub).select('name email role'),
      Session.findOne({ _id: payload.sid, user: payload.sub, endedAt: null }).select('_id')
    ]);
    if (!user) return res.status(401).json({ message: 'Your account is no longer available.' });
    if (!session) return res.status(401).json({ message: 'Your session has ended. Please sign in again.' });
    req.user = user;
    req.authSessionId = payload.sid;
    next();
  } catch (err) { next(err); }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ message: 'Administrator access required.' });
  next();
}
