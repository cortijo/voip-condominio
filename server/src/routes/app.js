const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const media = require('../media');
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
  // A portaria fica sempre disponível (é o botão "Falar com a portaria"); os demais ramais dependem do grupo.
  const exts = new Map();
  for (const e of db.prepare("SELECT id, number, label, block, kind FROM extensions WHERE condo_id=? AND kind='portaria'").all(condo.id)) exts.set(e.id, e);
  if (resident.group_id) {
    cameras = db.prepare(`SELECT c.id, c.name, c.url, c.username AS user, c.password
      FROM cameras c JOIN group_cameras gc ON gc.camera_id=c.id WHERE gc.group_id=? ORDER BY c.name`).all(resident.group_id);
    for (const e of db.prepare(`SELECT e.id, e.number, e.label, e.block, e.kind
      FROM extensions e JOIN group_extensions ge ON ge.extension_id=e.id WHERE ge.group_id=?`).all(resident.group_id)) exts.set(e.id, e);
  }
  exts.delete(resident.extension_id || 0); // não lista o próprio ramal
  const extensions = [...exts.values()].map((e) => ({ ...e }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.block.localeCompare(b.block) || (a.label || a.number).localeCompare(b.label || b.number));

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
  SELECT n.id, n.kind, n.title, n.body, n.created_at, nr.read_at AS seen_at
  FROM notices n LEFT JOIN notice_reads nr ON nr.notice_id=n.id AND nr.resident_id=?
  WHERE n.condo_id=? AND n.id>? AND (n.resident_id IS NULL OR n.resident_id=?)
  ORDER BY n.id DESC LIMIT ?`).all(resident.id, resident.condo_id, after, resident.id, limit);

const chatRows = (resident, after, limit) => db.prepare(`
  SELECT id, sender, operator_name, kind, body, created_at FROM (
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

// o morador marca um aviso como visto (aparece no painel do operador)
r.post('/notices/:id/seen', (req, res) => {
  const id = Number(req.params.id);
  const n = db.prepare('SELECT 1 FROM notices WHERE id=? AND condo_id=? AND (resident_id IS NULL OR resident_id=?)')
    .get(id, req.condo.id, req.resident.id);
  if (!n) return bad(res, 'Aviso não encontrado.', 404);
  db.prepare('INSERT OR IGNORE INTO notice_reads(notice_id, resident_id, read_at) VALUES (?,?,?)').run(id, req.resident.id, now());
  res.json({ ok: true, seen_at: db.prepare('SELECT read_at FROM notice_reads WHERE notice_id=? AND resident_id=?').get(id, req.resident.id).read_at });
});

r.get('/chat', (req, res) => res.json(chatRows(req.resident, 0, 200)));

r.post('/chat', (req, res) => {
  const body = String(req.body.body || '').trim();
  if (!body || body.length > 2000) return bad(res, 'Mensagem vazia ou muito longa.');
  const info = db.prepare("INSERT INTO messages(condo_id, resident_id, sender, body, created_at) VALUES (?,?,'resident',?,?)")
    .run(req.condo.id, req.resident.id, body, now());
  res.json({ id: info.lastInsertRowid });
});

// foto / áudio enviados pelo morador (base64 em JSON; o parser maior roda depois da autenticação)
r.post('/chat/media', express.json({ limit: '8mb' }), (req, res) => {
  const kind = String(req.body.kind || '');
  const m = media.save(kind, req.body.data);
  if (m.error) return bad(res, m.error);
  const info = db.prepare("INSERT INTO messages(condo_id, resident_id, sender, kind, media, mime, body, created_at) VALUES (?,?,'resident',?,?,?,'',?)")
    .run(req.condo.id, req.resident.id, kind, m.file, m.mime, now());
  res.json({ id: info.lastInsertRowid });
});

r.get('/chat/file/:id', (req, res) => {
  const row = db.prepare('SELECT media, mime FROM messages WHERE id=? AND resident_id=? AND media IS NOT NULL')
    .get(Number(req.params.id), req.resident.id);
  if (!row) return bad(res, 'Arquivo não encontrado.', 404);
  media.send(res, row);
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
