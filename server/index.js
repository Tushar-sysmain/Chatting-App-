import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Server } from 'socket.io';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from './db.js';
import {
  authenticateCredentials, authenticateSocket, createSession, findUser, publicUser,
  requireAuth, revokeSession, sessionCookieName, sessionCookieOptions,
} from './auth.js';
import { conversationSchema, loginSchema, paginationSchema, parseBody, receiverSchema, registerSchema } from './validation.js';

const PORT = Number(process.env.PORT || 4000);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, '../dist');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CLIENT_ORIGIN, credentials: true } });

app.use(helmet());
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());

app.use((error, _req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({ ok: false, error: 'Request body must contain valid JSON' });
  }
  return next(error);
});

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
const messageLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
const invalid = (res, result) => res.status(400).json({ ok: false, error: result.error.issues[0].message });

const getConversation = (conversationId, userId) => db.prepare(`
  SELECT c.* FROM conversations c
  JOIN conversation_participants cp ON cp.conversation_id = c.id
  WHERE c.id = ? AND cp.user_id = ?
`).get(conversationId, userId);
const participantIds = (conversationId) => db.prepare('SELECT user_id FROM conversation_participants WHERE conversation_id = ?').all(conversationId).map((row) => row.user_id);
const conversationIdFor = (firstId, secondId) => {
  const [participant1, participant2] = [firstId, secondId].sort();
  return db.prepare('SELECT id FROM conversations WHERE participant1_id = ? AND participant2_id = ?').get(participant1, participant2)?.id;
};
const createOrFindConversation = (firstId, secondId) => {
  const [participant1, participant2] = [firstId, secondId].sort();
  const existing = conversationIdFor(firstId, secondId);
  if (existing) return existing;
  const id = crypto.randomUUID();
  const transaction = () => {
    db.exec('BEGIN');
    db.prepare('INSERT INTO conversations (id, participant1_id, participant2_id) VALUES (?, ?, ?)').run(id, participant1, participant2);
    db.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?), (?, ?)').run(id, participant1, id, participant2);
    db.exec('COMMIT');
  };
  try { transaction(); } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    if (!String(error.message).includes('UNIQUE')) throw error;
  }
  return conversationIdFor(firstId, secondId);
};
const messageResponse = (message) => ({
  messageId: message.id,
  id: message.id,
  conversationId: message.conversation_id,
  senderId: message.sender_id,
  receiverId: message.receiver_id,
  messageContent: message.message_content,
  text: message.message_content,
  createdAt: message.created_at,
  updatedAt: message.updated_at,
  deletedAt: message.deleted_at,
});
const persistMessage = (senderId, receiverId, content) => {
  if (!receiverId || !content || !findUser(receiverId) || receiverId === senderId) return null;
  const conversationId = createOrFindConversation(senderId, receiverId);
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO messages (id, conversation_id, sender_id, receiver_id, message_content) VALUES (?, ?, ?, ?, ?)').run(id, conversationId, senderId, receiverId, content);
  db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(conversationId);
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
};

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/auth/register', authLimiter, async (req, res) => {
  const result = parseBody(registerSchema, req.body);
  if (!result.success) return invalid(res, result);
  const { userId, password, name, color } = result.data;
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    db.prepare('INSERT INTO users (id, username, password_hash, name, color) VALUES (?, ?, ?, ?, ?)').run(userId, userId, passwordHash, name, color || '#ff7aa2');
    const user = findUser(userId);
    const session = createSession(userId);
    res.cookie(sessionCookieName, session.token, sessionCookieOptions).status(201).json({ ok: true, user: publicUser(user) });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ ok: false, error: 'userId is already registered' });
    res.status(500).json({ ok: false, error: 'Registration failed' });
  }
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  const result = parseBody(loginSchema, req.body);
  if (!result.success) return invalid(res, result);
  const user = authenticateCredentials(result.data);
  if (!user) return res.status(401).json({ ok: false, error: 'Invalid credentials' });
  const session = createSession(user.id);
  res.cookie(sessionCookieName, session.token, sessionCookieOptions).json({ ok: true, user: publicUser(user) });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ ok: true, user: publicUser(req.auth.user) });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  revokeSession(req.auth.payload.sid);
  const { maxAge, ...clearCookieOptions } = sessionCookieOptions;
  res.clearCookie(sessionCookieName, clearCookieOptions).json({ ok: true });
});

app.get('/api/users/:userId', requireAuth, (req, res) => {
  const user = findUser(req.params.userId);
  if (!user) return res.status(404).json({ ok: false, error: 'User not found' });
  res.json({ ok: true, user: publicUser(user) });
});

app.get('/api/conversations', requireAuth, (req, res) => {
  const conversations = db.prepare(`
    SELECT c.id AS conversationId, c.created_at AS createdAt, c.updated_at AS updatedAt,
      u.id AS otherUserId, u.username AS otherUsername, u.name AS otherName, u.color AS otherColor
    FROM conversations c
    JOIN conversation_participants mine ON mine.conversation_id = c.id AND mine.user_id = ?
    JOIN conversation_participants other ON other.conversation_id = c.id AND other.user_id <> ?
    JOIN users u ON u.id = other.user_id
    ORDER BY c.updated_at DESC
  `).all(req.auth.user.id, req.auth.user.id);
  res.json({ ok: true, conversations });
});

app.post('/api/conversations', requireAuth, (req, res) => {
  const result = parseBody(conversationSchema, req.body);
  if (!result.success) return invalid(res, result);
  if (!findUser(result.data.userId)) return res.status(404).json({ ok: false, error: 'User not found' });
  if (result.data.userId === req.auth.user.id) return res.status(400).json({ ok: false, error: 'Cannot start a conversation with yourself' });
  const id = createOrFindConversation(req.auth.user.id, result.data.userId);
  res.status(201).json({ ok: true, conversationId: id, participantIds: participantIds(id) });
});

app.get('/api/conversations/:conversationId/messages', requireAuth, (req, res) => {
  const conversation = getConversation(req.params.conversationId, req.auth.user.id);
  if (!conversation) return res.status(404).json({ ok: false, error: 'Conversation not found' });
  const result = paginationSchema.safeParse(req.query);
  if (!result.success) return invalid(res, result);
  const { limit, before } = result.data;
  const beforeDate = before ? db.prepare('SELECT created_at FROM messages WHERE id = ? AND conversation_id = ?').get(before, conversation.id)?.created_at : null;
  const messages = before && !beforeDate ? [] : db.prepare(`
    SELECT * FROM messages WHERE conversation_id = ? AND deleted_at IS NULL
    ${beforeDate ? 'AND (created_at < ? OR (created_at = ? AND id < ?))' : ''}
    ORDER BY created_at DESC, id DESC LIMIT ?
  `).all(...(beforeDate ? [conversation.id, beforeDate, beforeDate, before, limit] : [conversation.id, limit])).reverse().map(messageResponse);
  res.json({ ok: true, messages, pagination: { limit, hasMore: messages.length === limit, before: messages[0]?.messageId || null } });
});

app.post('/api/messages', requireAuth, messageLimiter, (req, res) => {
  const result = parseBody(receiverSchema, req.body);
  if (!result.success) return invalid(res, result);
  const message = persistMessage(req.auth.user.id, result.data.receiverId, result.data.content);
  if (!message) return res.status(404).json({ ok: false, error: 'Receiver not found' });
  const response = messageResponse(message);
  io.to(`user:${result.data.receiverId}`).emit('new-message', response);
  res.status(201).json({ ok: true, message: response });
});

app.delete('/api/messages/:messageId', requireAuth, (req, res) => {
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.messageId);
  if (!message || message.sender_id !== req.auth.user.id) return res.status(404).json({ ok: false, error: 'Message not found' });
  db.prepare('UPDATE messages SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(message.id);
  res.json({ ok: true, deletedAt: new Date().toISOString() });
});

app.use('/api', (_req, res) => {
  res.status(404).json({ ok: false, error: 'API route not found' });
});

app.use(express.static(clientDist));
app.get('*', (_req, res, next) => {
  res.sendFile(path.join(clientDist, 'index.html'), (error) => {
    if (error) next();
  });
});

io.use((socket, next) => {
  const auth = authenticateSocket(socket);
  if (!auth) return next(new Error('Authentication required'));
  socket.user = auth.user;
  next();
});
io.on('connection', (socket) => {
  socket.join(`user:${socket.user.id}`);
  socket.on('join-room', ({ partnerId } = {}) => {
    if (!findUser(partnerId) || partnerId === socket.user.id) return;
    const conversationId = conversationIdFor(socket.user.id, partnerId);
    if (conversationId && getConversation(conversationId, socket.user.id)) socket.join(`conversation:${conversationId}`);
  });
  socket.on('send-message', ({ partnerId, content, text } = {}) => {
    const message = persistMessage(socket.user.id, partnerId, content || text);
    if (!message) return;
    const response = messageResponse(message);
    io.to(`user:${partnerId}`).emit('new-message', response);
    socket.emit('message-sent', response);
  });
  socket.on('typing', ({ partnerId, isTyping } = {}) => {
    if (!partnerId || partnerId === socket.user.id) return;
    const conversationId = conversationIdFor(socket.user.id, partnerId);
    if (conversationId && getConversation(conversationId, socket.user.id)) io.to(`user:${partnerId}`).emit('typing', { userId: socket.user.id, isTyping: Boolean(isTyping) });
  });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ ok: false, error: 'Internal server error' });
});

if (process.env.NODE_ENV !== 'test') server.listen(PORT, () => console.log(`Whisper Bloom server running on http://localhost:${PORT}`));
export { app, io, server };
