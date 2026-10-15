const { db } = require('./db');
const { now, sha256, newToken, bad } = require('./util');

const PANEL_TTL = 12 * 3600;
const APP_TTL = 180 * 24 * 3600;

function createSession(kind, subjectId) {
  const token = newToken();
  const ttl = kind === 'panel' ? PANEL_TTL : APP_TTL;
  db.prepare('INSERT INTO sessions(token_hash, kind, subject_id, expires_at, created_at, last_seen) VALUES (?,?,?,?,?,?)')
    .run(sha256(token), kind, subjectId, now() + ttl, now(), now());
  return token;
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

function findSession(token, kind) {
  if (!token) return null;
  return db.prepare('SELECT * FROM sessions WHERE token_hash=? AND kind=? AND expires_at>?')
    .get(sha256(token), kind, now());
}

function destroyToken(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha256(token));
}

function killSessions(kind, subjectId) {
  db.prepare('DELETE FROM sessions WHERE kind=? AND subject_id=?').run(kind, subjectId);
}

const clip = (v, n) => String(v || '').replace(/[^\x20-\x7E]/g, '').slice(0, n);

/** Registra atividade do aparelho (usado no painel "Aplicativos conectados"). */
function touchSession(req, s) {
  const t = now();
  const device = clip(req.headers['x-device'], 80);
  const version = clip(req.headers['x-app-version'], 20);
  const sip = clip(req.headers['x-sip'], 12);
  if (s.last_seen && t - s.last_seen < 3 && s.sip_state === sip) return;
  db.prepare('UPDATE sessions SET last_seen=?, device=?, app_version=?, ip=?, sip_state=? WHERE token_hash=?')
    .run(t, device || s.device || '', version || s.app_version || '', clip(req.ip, 64), sip || s.sip_state || '', s.token_hash);
}

/** Exige sessão de painel válida; define req.user. */
function panelAuth(req, res, next) {
  const s = findSession(bearer(req), 'panel');
  if (!s) return bad(res, 'Sessão expirada. Entre novamente.', 401);
  const u = db.prepare('SELECT id, condo_id, username, name, role, active FROM users WHERE id=?').get(s.subject_id);
  if (!u || !u.active) return bad(res, 'Usuário inativo.', 401);
  if (u.condo_id) {
    const c = db.prepare('SELECT active FROM condos WHERE id=?').get(u.condo_id);
    if (!c || !c.active) return bad(res, 'Condomínio inativo.', 401);
  }
  req.user = u;
  req.token = bearer(req);
  next();
}

/** Exige sessão do app (morador); define req.resident e req.condo. */
function appAuth(req, res, next) {
  const s = findSession(bearer(req), 'app');
  if (!s) return bad(res, 'Sessão expirada.', 401);
  const r = db.prepare('SELECT * FROM residents WHERE id=?').get(s.subject_id);
  if (!r || !r.active) return bad(res, 'Usuário inativo.', 401);
  const c = db.prepare('SELECT * FROM condos WHERE id=?').get(r.condo_id);
  if (!c || !c.active) return bad(res, 'Condomínio inativo.', 401);
  req.resident = r;
  req.condo = c;
  req.token = bearer(req);
  touchSession(req, s);
  next();
}

const need = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : bad(res, 'Sem permissão para esta ação.', 403);

/** Carrega o condomínio da rota e garante que o usuário pode acessá-lo. */
function condoAccess(req, res, next) {
  const cid = Number(req.params.cid);
  if (!Number.isInteger(cid)) return bad(res, 'Condomínio inválido', 400);
  if (req.user.role !== 'master' && req.user.condo_id !== cid) return bad(res, 'Acesso negado.', 403);
  const condo = db.prepare('SELECT * FROM condos WHERE id=?').get(cid);
  if (!condo) return bad(res, 'Condomínio não encontrado.', 404);
  req.condo = condo;
  next();
}

setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at<?').run(now()), 3600 * 1000).unref();

module.exports = {
  createSession, findSession, destroyToken, killSessions, panelAuth, appAuth, need, condoAccess, bearer,
};
