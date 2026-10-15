const { DatabaseSync } = require('node:sqlite'); // embutido no Node 22: sem compilação nativa
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const raw = new DatabaseSync(path.join(DATA_DIR, 'interfone.db'));
raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

const db = {
  exec: (sql) => raw.exec(sql),
  prepare: (sql) => raw.prepare(sql),
  transaction: (fn) => (...args) => {
    raw.exec('BEGIN');
    try { const r = fn(...args); raw.exec('COMMIT'); return r; } catch (e) { raw.exec('ROLLBACK'); throw e; }
  },
};

db.exec(`
CREATE TABLE IF NOT EXISTS condos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  logo TEXT,
  info TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  colors TEXT NOT NULL,
  sip_host TEXT NOT NULL DEFAULT '',
  sip_port INTEGER NOT NULL DEFAULT 5060,
  sip_transport TEXT NOT NULL DEFAULT 'UDP',
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

-- usuários do painel: master (admin primário), condo_admin, operator
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  condo_id INTEGER REFERENCES condos(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('master','condo_admin','operator')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

-- ramais VoIP cadastrados no Issabel
CREATE TABLE IF NOT EXISTS extensions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  condo_id INTEGER NOT NULL REFERENCES condos(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  secret TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT '',
  block TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'morador' CHECK (kind IN ('portaria','morador','outro')),
  UNIQUE (condo_id, number)
);

CREATE TABLE IF NOT EXISTS cameras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  condo_id INTEGER NOT NULL REFERENCES condos(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  username TEXT NOT NULL DEFAULT '',
  password TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  condo_id INTEGER NOT NULL REFERENCES condos(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  UNIQUE (condo_id, name)
);
CREATE TABLE IF NOT EXISTS group_cameras (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  camera_id INTEGER NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, camera_id)
);
CREATE TABLE IF NOT EXISTS group_extensions (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  extension_id INTEGER NOT NULL REFERENCES extensions(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, extension_id)
);

CREATE TABLE IF NOT EXISTS residents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  condo_id INTEGER NOT NULL REFERENCES condos(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  block TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  extension_id INTEGER REFERENCES extensions(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  UNIQUE (condo_id, username)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('panel','app')),
  subject_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_subject ON sessions(kind, subject_id);

-- avisos / push (resident_id NULL = todos os moradores)
CREATE TABLE IF NOT EXISTS notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  condo_id INTEGER NOT NULL REFERENCES condos(id) ON DELETE CASCADE,
  resident_id INTEGER REFERENCES residents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'aviso',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notices_condo ON notices(condo_id, id);

-- chat morador <-> operador
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  condo_id INTEGER NOT NULL REFERENCES condos(id) ON DELETE CASCADE,
  resident_id INTEGER NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  sender TEXT NOT NULL CHECK (sender IN ('resident','operator')),
  operator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  operator_name TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  read_by_operator INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(resident_id, id);

-- "visto" dos avisos
CREATE TABLE IF NOT EXISTS notice_reads (
  notice_id INTEGER NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
  resident_id INTEGER NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  read_at INTEGER NOT NULL,
  PRIMARY KEY (notice_id, resident_id)
);
`);

// migrações para bancos criados em versões anteriores
function addColumn(table, col, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
}
addColumn('condos', 'wss_url', "TEXT NOT NULL DEFAULT ''");
addColumn('users', 'extension_id', 'INTEGER REFERENCES extensions(id) ON DELETE SET NULL');
addColumn('sessions', 'created_at', 'INTEGER');
addColumn('sessions', 'last_seen', 'INTEGER');
addColumn('sessions', 'device', "TEXT NOT NULL DEFAULT ''");
addColumn('sessions', 'app_version', "TEXT NOT NULL DEFAULT ''");
addColumn('sessions', 'ip', "TEXT NOT NULL DEFAULT ''");
addColumn('sessions', 'sip_state', "TEXT NOT NULL DEFAULT ''");
addColumn('messages', 'kind', "TEXT NOT NULL DEFAULT 'text'");
addColumn('messages', 'media', 'TEXT');
addColumn('messages', 'mime', "TEXT NOT NULL DEFAULT ''");

const DEFAULT_COLORS = {
  primary: '#FF9800',
  onPrimary: '#000000',
  background: '#121212',
  surface: '#1E1E1E',
  surfaceAlt: '#2A2A2A',
  text: '#FFFFFF',
};

module.exports = { db, DATA_DIR, UPLOADS_DIR, DEFAULT_COLORS };
