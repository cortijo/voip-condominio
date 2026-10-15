const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const { createSession, destroyToken, appAuth } = require('../auth');
const { wrap, bad, now, checkPw, DUMMY_HASH, loginLimited, loginFailed, loginOk } = require('../util');

const r = express.Router();

/** Tudo que o app precisa para se configurar (ramal, câmeras, ramais, aparência). */
function buildConfig(resident, condo) {
  const own = resident.extension_id
    ? db.prepare('SELECT * FROM extensions WHERE id=? AND condo_id=?').get(resident.extension_id, condo.id)
    : null;

  const sip = own && condo.sip_host
    ? {
      host: condo.sip_host, port: condo.sip_port, transport: condo.sip_transport,
      user: own.number, password: own.secret, displayName: resident.name,
    }
    : null;

  let cameras = [];
  let extensions = [];
  if (resident.group_id) {
    cameras = db.prepare(`SELECT c.id, c.name, c.url, c.username AS user, c.password
      FROM cameras c JOIN group_cameras gc ON gc.camera_id=c.id WHERE gc.group_id=? ORDER BY c.name`).all(resident.group_id);
    extensions = db.prepare(`SELECT e.id, e.number, e.label, e.block, e.kind
      FROM extensions e JOIN group_extensions ge ON ge.extension_id=e.id
      WHERE ge.group_id=? AND e.id<>? ORDER BY e.kind, e.block, e.label, e.number`).all(resident.group_id, resident.extension_id || 0);
  }

  const config = {
    condo: {
      name: condo.name,
      info: condo.info,
      phone: condo.phone,
      logoUrl: condo.logo ? `/media/${condo.logo}` : null,
      colors: JSON.parse(condo.colors),
    },
    resident: { id: resident.id, name: resident.name, block: resident.block, unit: resident.unit },
    sip, cameras, extensions,
  };
  config.version = crypto.createHash('sha1').update(JSON.stringify(config)).digest('hex').slice(0, 12);
  return config;
}

const noticeRows = (resident, after, limit) => db.prepare(`
  SELECT id, kind, title, body, created_at FROM notices
  WHERE condo_id=? AND id>? AND (resident_id IS NULL OR resident_id=?)
  ORDER BY id DESC LIMIT ?`).all(resident.condo_id, after, resident.id, limit);

const chatRows = (resident, after, limit) => db.prepare(`
  SELECT id, sender, operator_name, body, created_at FROM (
    SELECT * FROM messages WHERE resident_id=? AND id>? ORDER BY id DESC LIMIT ?
  ) ORDER BY id`).all(resident.id, after, limit);

r.post('/login', wrap(async (req, res) => {
  const code = String(req.body.code || '').trim();
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const key = `app:${req.ip}:${code.toLowerCase()}:${username.toLowerCase()}`;
  if (loginLimited(key)) return bad(res, 'Muitas tentativas. Aguarde alguns minutos.', 429);

  const condo = db.prepare('SELECT * FROM condos WHERE code=?').get(code);
  const resident = condo ? db.prepare('SELECT * FROM residents WHERE condo_id=? AND username=?').get(condo.id, username) : null;
  const ok = await checkPw(password, resident ? resident.password_hash : DUMMY_HASH);
  if (!(condo && condo.active && resident && resident.active && ok)) {
    loginFailed(key);
    return bad(res, 'Código do condomínio, usuário ou senha inválidos.', 401);
  }
  loginOk(key);
  res.json({ token: createSession('app', resident.id), config: buildConfig(resident, condo) });
}));

r.use(appAuth);

r.post('/logout', (req, res) => {
  destroyToken(req.token);
  res.json({ ok: true });
});

r.get('/config', (req, res) => res.json(buildConfig(req.resident, req.condo)));

r.get('/notices', (req, res) => res.json(noticeRows(req.resident, 0, 50)));

r.get('/chat', (req, res) => res.json(chatRows(req.resident, 0, 200)));

r.post('/chat', (req, res) => {
  const body = String(req.body.body || '').trim();
  if (!body || body.length > 2000) return bad(res, 'Mensagem vazia ou muito longa.');
  const info = db.prepare("INSERT INTO messages(condo_id, resident_id, sender, body, created_at) VALUES (?,?,'resident',?,?)")
    .run(req.condo.id, req.resident.id, body, now());
  res.json({ id: info.lastInsertRowid });
});

/**
 * Consulta leve feita pelo app (~a cada 10s): devolve a versão da configuração
 * e o que chegou de novo (avisos e mensagens) desde os cursores informados.
 */
r.get('/poll', (req, res) => {
  const n = Number(req.query.n) || 0;
  const m = Number(req.query.m) || 0;
  res.json({
    version: buildConfig(req.resident, req.condo).version,
    notices: noticeRows(req.resident, n, 50).reverse(),
    messages: chatRows(req.resident, m, 100),
  });
});

module.exports = r;
