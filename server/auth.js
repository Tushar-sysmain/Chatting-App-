import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { db } from './db.js';

const SESSION_COOKIE = 'whisper_session';
const SESSION_DAYS = 7;
const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? null : 'local-development-secret-change-me');

if (!JWT_SECRET) throw new Error('JWT_SECRET must be set in production');

export const sessionCookieName = SESSION_COOKIE;
export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  path: '/',
};

export const publicUser = (user) => ({
  userId: user.id,
  username: user.username,
  name: user.name,
  color: user.color,
});

export const findUser = (userId) => db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

export const authenticateCredentials = ({ userId, password }) => {
  const user = findUser(userId);
  return user && bcrypt.compareSync(password, user.password_hash) ? user : null;
};

export const createSession = (userId) => {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + sessionCookieOptions.maxAge).toISOString();
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(sessionId, userId, expiresAt);
  const token = jwt.sign({ sub: userId, sid: sessionId }, JWT_SECRET, { expiresIn: `${SESSION_DAYS}d` });
  return { token, expiresAt };
};

export const revokeSession = (sessionId) => {
  if (sessionId) db.prepare('UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?').run(sessionId);
};

export const getTokenFromRequest = (req) => {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return req.cookies?.[SESSION_COOKIE] || null;
};

export const verifyToken = (token) => {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const session = db.prepare(`
      SELECT s.*, u.id, u.username, u.name, u.color
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.revoked_at IS NULL AND s.expires_at > CURRENT_TIMESTAMP
    `).get(payload.sid);
    return session && session.user_id === payload.sub ? { payload, user: session } : null;
  } catch {
    return null;
  }
};

export const authenticateSocket = (socket) => {
  const cookieHeader = socket.handshake.headers.cookie || '';
  const cookie = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  const token = socket.handshake.auth?.token || cookie?.slice(`${SESSION_COOKIE}=`.length);
  return verifyToken(token);
};

export const requireAuth = (req, res, next) => {
  const auth = verifyToken(getTokenFromRequest(req));
  if (!auth) return res.status(401).json({ ok: false, error: 'Authentication required' });
  req.auth = auth;
  next();
};
