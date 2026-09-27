import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(process.env.DATABASE_PATH || path.join(dataDir, 'chat.sqlite'));
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#ff7aa2',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    participant1_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    participant2_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (participant1_id < participant2_id),
    UNIQUE (participant1_id, participant2_id)
  );
  CREATE INDEX IF NOT EXISTS conversations_participant1_idx ON conversations(participant1_id);
  CREATE INDEX IF NOT EXISTS conversations_participant2_idx ON conversations(participant2_id);

  CREATE TABLE IF NOT EXISTS conversation_participants (
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (conversation_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS conversation_participants_user_id_idx ON conversation_participants(user_id);

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    receiver_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    message_content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT,
    CHECK (sender_id <> receiver_id)
  );
  CREATE INDEX IF NOT EXISTS messages_sender_id_idx ON messages(sender_id);
  CREATE INDEX IF NOT EXISTS messages_receiver_id_idx ON messages(receiver_id);
  CREATE INDEX IF NOT EXISTS messages_conversation_id_idx ON messages(conversation_id);
  CREATE INDEX IF NOT EXISTS messages_created_at_idx ON messages(created_at);
`);

const seedLegacyUsers = () => {
  const legacyPath = path.join(dataDir, 'users.json');
  if (!fs.existsSync(legacyPath) || db.prepare('SELECT COUNT(*) AS count FROM users').get().count > 0) return;

  const legacyUsers = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
  const insert = db.prepare(`
    INSERT OR IGNORE INTO users (id, username, password_hash, name, color)
    VALUES (@id, @username, @passwordHash, @name, @color)
  `);
  db.exec('BEGIN');
  try {
    for (const user of legacyUsers) {
      insert.run({
        id: user.id,
        username: user.id,
        passwordHash: bcrypt.hashSync(user.password, 12),
        name: user.name,
        color: user.color || '#ff7aa2',
      });
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
};

seedLegacyUsers();

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  console.log('Database schema is ready.');
  db.close();
}
