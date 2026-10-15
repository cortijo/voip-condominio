const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db, UPLOADS_DIR, DEFAULT_COLORS } = require('../db');
const media = require('../media');
const { panelAuth, need, condoAccess, killSessions } = require('../auth');
const { wrap, bad, clean, cleanColors, hashPw, now, isConstraint } = require('../util');
const visits = require('./visits');

const r = express.Router();
r.use(panelAuth);

const ADMINS = ['master', 'condo_admin'];
const ALL = ['master', 'condo_admin', 'operator'];

const condoPublic = (c) => ({
  id: c.id, code: c.code, name: c.name, info: c.info, phone: c.phone, active: c.active,
  colors: JSON.parse(c.colors),
  logoUrl: c.logo ? `/media/${c.logo}` : null,
  sip_host: c.sip_host, sip_port: c.sip_port, sip_transport: c.sip_transport, wss_url: c.wss_url,
});

const isUnique = isConstraint;
function dbError(res, e, msg = 'Registro duplicado.') {
  if (isUnique(e)) return bad(res, msg, 409);
  throw e;
}

// ---------------------------------------------------------------- condomínios
const CONDO_CODE = /^[a-zA-Z0-9-]{3,32}$/;

r.get('/condos', need('master'), (req, res) => {
  const rows = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM residents WHERE condo_id=c.id) AS residents,
      (SELECT COUNT(*) FROM cameras WHERE condo_id=c.id) AS cameras,
      (SELECT COUNT(*) FROM extensions WHERE condo_id=c.id) AS extensions
    FROM condos c ORDER BY c.name`).all();
  res.json(rows.map((c) => ({ ...condoPublic(c), residents: c.residents, cameras: c.cameras, extensions: c.extensions })));
});

// ID do condomínio gerado automaticamente (sem caracteres ambíguos: 0/O, 1/I)
const CODE_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function genCode() {
  for (let t = 0; t < 100; t++) {
    let c = '';
    for (const x of crypto.randomBytes(6)) c += CODE_ALPHA[x % CODE_ALPHA.length];
    if (!db.prepare('SELECT 1 FROM condos WHERE code=?').get(c)) return c;
  }
  throw new Error('Não foi possível gerar um ID único.');
}

r.post('/condos', need('master'), (req, res) => {
  const v = clean(req.body, {
    name: { t: 'str', req: 1, max: 100, label: 'Nome' },
    code: { t: 'str', max: 32, re: /^([a-zA-Z0-9-]{3,32})?$/, label: 'Código' },
  });
  if (v.error) return bad(res, v.error);
  if (!v.data.code) v.data.code = genCode();
  try {
    const info = db.prepare('INSERT INTO condos(code, name, colors, created_at) VALUES (?,?,?,?)')
      .run(v.data.code, v.data.name, JSON.stringify(DEFAULT_COLORS), now());
    res.json(condoPublic(db.prepare('SELECT * FROM condos WHERE id=?').get(info.lastInsertRowid)));
  } catch (e) { dbError(res, e, 'Já existe um condomínio com esse código.'); }
});

r.get('/condos/:cid', condoAccess, (req, res) => res.json(condoPublic(req.condo)));

r.put('/condos/:cid', need('master'), condoAccess, (req, res) => {
  const c = req.condo;
  const v = clean({ ...c, ...req.body }, {
    name: { t: 'str', req: 1, max: 100, label: 'Nome' },
    code: { t: 'str', req: 1, max: 32, re: CONDO_CODE, label: 'Código' },
    info: { t: 'str', max: 1000, label: 'Informações' },
    phone: { t: 'str', max: 40, label: 'Telefone' },
    sip_host: { t: 'str', max: 200, re: /^[A-Za-z0-9.-]*$/, label: 'Servidor VoIP' },
    sip_port: { t: 'int', min: 1, max: 65535, req: 1, label: 'Porta' },
    sip_transport: { t: 'enum', vals: ['UDP', 'TCP'], label: 'Transporte' },
    wss_url: { t: 'str', max: 300, re: /^(wss?:\/\/\S+)?$/, label: 'URL WebSocket (wss://…)' },
    active: { t: 'bool' },
  });
  if (v.error) return bad(res, v.error);
  const colors = cleanColors(req.body.colors, JSON.parse(c.colors));
  if (colors.error) return bad(res, colors.error);
  try {
    db.prepare(`UPDATE condos SET name=?, code=?, info=?, phone=?, sip_host=?, sip_port=?, sip_transport=?, wss_url=?, active=?, colors=? WHERE id=?`)
      .run(v.data.name, v.data.code, v.data.info, v.data.phone, v.data.sip_host, v.data.sip_port,
        v.data.sip_transport, v.data.wss_url, v.data.active, JSON.stringify(colors.data), c.id);
  } catch (e) { return dbError(res, e, 'Já existe um condomínio com esse código.'); }
  res.json(condoPublic(db.prepare('SELECT * FROM condos WHERE id=?').get(c.id)));
});

r.delete('/condos/:cid', need('master'), condoAccess, (req, res) => {
  media.purge(db.prepare('SELECT media FROM messages WHERE condo_id=? AND media IS NOT NULL').all(req.condo.id));
  media.purge(db.prepare('SELECT photo AS media FROM visitors WHERE condo_id=? AND photo IS NOT NULL').all(req.condo.id));
  if (req.condo.logo) fs.rmSync(path.join(UPLOADS_DIR, req.condo.logo), { force: true });
  db.prepare('DELETE FROM condos WHERE id=?').run(req.condo.id);
  res.json({ ok: true });
});

const IMG = {
  png: { mime: 'image/png', ok: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  jpeg: { mime: 'image/jpeg', ok: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  webp: { mime: 'image/webp', ok: (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' },
};

r.post('/condos/:cid/logo', need('master'), condoAccess, express.json({ limit: '4mb' }), (req, res) => {
  const data = String(req.body.data || '');
  const comma = data.indexOf(',');
  const head = data.slice(0, comma);
  const m = /^data:image\/(png|jpeg|webp);base64$/.exec(head);
  if (!m) return bad(res, 'Envie uma imagem PNG, JPEG ou WEBP.');
  const buf = Buffer.from(data.slice(comma + 1), 'base64');
  if (buf.length < 100 || buf.length > 1.5 * 1024 * 1024) return bad(res, 'A imagem deve ter até 1,5 MB.');
  if (!IMG[m[1]].ok(buf)) return bad(res, 'Arquivo de imagem inválido.');
  const file = `condo-${req.condo.id}-${Date.now()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, file), buf);
  if (req.condo.logo) fs.rmSync(path.join(UPLOADS_DIR, req.condo.logo), { force: true });
  db.prepare('UPDATE condos SET logo=? WHERE id=?').run(file, req.condo.id);
  res.json({ logoUrl: `/media/${file}` });
});

r.delete('/condos/:cid/logo', need('master'), condoAccess, (req, res) => {
  if (req.condo.logo) fs.rmSync(path.join(UPLOADS_DIR, req.condo.logo), { force: true });
  db.prepare('UPDATE condos SET logo=NULL WHERE id=?').run(req.condo.id);
  res.json({ ok: true });
});

// -------------------------------------------------- usuários do painel (equipe)
const USER_SELECT = `SELECT u.id, u.username, u.name, u.role, u.active, u.created_at, u.extension_id, e.number AS ext_number
  FROM users u LEFT JOIN extensions e ON e.id=u.extension_id`;

r.get('/condos/:cid/users', need(...ADMINS), condoAccess, (req, res) => {
  res.json(db.prepare(`${USER_SELECT} WHERE u.condo_id=? ORDER BY u.role, u.name`).all(req.condo.id));
});

function allowedRoles(user) {
  return user.role === 'master' ? ['condo_admin', 'operator'] : ['operator'];
}

// ramal usado pelo telefone do navegador: nunca de morador, nunca compartilhado
function checkUserExt(cid, extId, selfId) {
  if (extId === null) return null;
  const e = db.prepare('SELECT kind FROM extensions WHERE id=? AND condo_id=?').get(extId, cid);
  if (!e) return 'Ramal inválido.';
  if (e.kind === 'morador') return 'Use um ramal do tipo Portaria ou Outro (não de morador).';
  if (db.prepare('SELECT 1 FROM residents WHERE extension_id=?').get(extId)) return 'Esse ramal já está vinculado a um morador.';
  const u = db.prepare('SELECT name FROM users WHERE extension_id=? AND id<>?').get(extId, selfId || 0);
  if (u) return `Esse ramal já está com ${u.name}.`;
  return null;
}

r.post('/condos/:cid/users', need(...ADMINS), condoAccess, wrap(async (req, res) => {
  const v = clean(req.body, {
    username: { t: 'str', req: 1, max: 40, re: /^[A-Za-z0-9._-]{3,40}$/, label: 'Usuário' },
    name: { t: 'str', req: 1, max: 100, label: 'Nome' },
    role: { t: 'enum', vals: allowedRoles(req.user), label: 'Perfil' },
    extension_id: { t: 'int', label: 'Ramal' },
  });
  if (v.error) return bad(res, v.error);
  const password = String(req.body.password || '');
  if (password.length < 8) return bad(res, 'A senha deve ter ao menos 8 caracteres.');
  const extErr = checkUserExt(req.condo.id, v.data.extension_id, 0);
  if (extErr) return bad(res, extErr);
  try {
    const info = db.prepare('INSERT INTO users(condo_id, username, name, password_hash, role, extension_id, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(req.condo.id, v.data.username, v.data.name, await hashPw(password), v.data.role, v.data.extension_id, now());
    res.json(db.prepare(`${USER_SELECT} WHERE u.id=?`).get(info.lastInsertRowid));
  } catch (e) { dbError(res, e, 'Esse nome de usuário já está em uso.'); }
}));

function targetUser(req, res) {
  const u = db.prepare('SELECT * FROM users WHERE id=? AND condo_id=?').get(Number(req.params.id), req.condo.id);
  if (!u) { bad(res, 'Usuário não encontrado.', 404); return null; }
  if (req.user.role !== 'master' && u.role !== 'operator') { bad(res, 'Sem permissão sobre este usuário.', 403); return null; }
  return u;
}

r.put('/condos/:cid/users/:id', need(...ADMINS), condoAccess, wrap(async (req, res) => {
  const u = targetUser(req, res);
  if (!u) return;
  const v = clean({ ...u, ...req.body }, {
    name: { t: 'str', req: 1, max: 100, label: 'Nome' },
    role: { t: 'enum', vals: allowedRoles(req.user), label: 'Perfil' },
    active: { t: 'bool' },
    extension_id: { t: 'int', label: 'Ramal' },
  });
  if (v.error) return bad(res, v.error);
  if (u.id === req.user.id && !v.data.active) return bad(res, 'Você não pode desativar a si mesmo.');
  const password = req.body.password ? String(req.body.password) : '';
  if (password && password.length < 8) return bad(res, 'A senha deve ter ao menos 8 caracteres.');
  const extErr = checkUserExt(req.condo.id, v.data.extension_id, u.id);
  if (extErr) return bad(res, extErr);
  db.prepare('UPDATE users SET name=?, role=?, active=?, extension_id=? WHERE id=?')
    .run(v.data.name, v.data.role, v.data.active, v.data.extension_id, u.id);
  if (password) db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(await hashPw(password), u.id);
  if (password || !v.data.active) killSessions('panel', u.id);
  res.json(db.prepare(`${USER_SELECT} WHERE u.id=?`).get(u.id));
}));

r.delete('/condos/:cid/users/:id', need(...ADMINS), condoAccess, (req, res) => {
  const u = targetUser(req, res);
  if (!u) return;
  if (u.id === req.user.id) return bad(res, 'Você não pode excluir a si mesmo.');
  killSessions('panel', u.id);
  db.prepare('DELETE FROM users WHERE id=?').run(u.id);
  res.json({ ok: true });
});

// ------------------------------------------------------ CRUD simples por condomínio
function crud(name, table, spec, { read = ADMINS, write = ADMINS, order = 'id', afterWrite } = {}) {
  const base = `/condos/:cid/${name}`;
  const cols = Object.keys(spec);
  r.get(base, need(...read), condoAccess, (req, res) => {
    res.json(db.prepare(`SELECT * FROM ${table} WHERE condo_id=? ORDER BY ${order}`).all(req.condo.id));
  });
  r.post(base, need(...write), condoAccess, (req, res) => {
    const v = clean(req.body, spec);
    if (v.error) return bad(res, v.error);
    try {
      const info = db.prepare(`INSERT INTO ${table}(condo_id, ${cols.join(',')}) VALUES (?, ${cols.map(() => '?').join(',')})`)
        .run(req.condo.id, ...cols.map((c) => v.data[c]));
      res.json(db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(info.lastInsertRowid));
    } catch (e) { dbError(res, e, 'Já existe um registro igual.'); }
  });
  r.put(`${base}/:id`, need(...write), condoAccess, (req, res) => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id=? AND condo_id=?`).get(Number(req.params.id), req.condo.id);
    if (!row) return bad(res, 'Registro não encontrado.', 404);
    const v = clean({ ...row, ...req.body }, spec);
    if (v.error) return bad(res, v.error);
    try {
      db.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c}=?`).join(',')} WHERE id=?`).run(...cols.map((c) => v.data[c]), row.id);
      res.json(db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(row.id));
    } catch (e) { dbError(res, e, 'Já existe um registro igual.'); }
  });
  r.delete(`${base}/:id`, need(...write), condoAccess, (req, res) => {
    db.prepare(`DELETE FROM ${table} WHERE id=? AND condo_id=?`).run(Number(req.params.id), req.condo.id);
    res.json({ ok: true });
  });
}

crud('extensions', 'extensions', {
  number: { t: 'str', req: 1, max: 32, re: /^[A-Za-z0-9_.-]+$/, label: 'Ramal' },
  secret: { t: 'str', max: 128, label: 'Senha (secret)' },
  label: { t: 'str', max: 100, label: 'Descrição' },
  block: { t: 'str', max: 50, label: 'Bloco' },
  kind: { t: 'enum', vals: ['portaria', 'morador', 'outro'], def: 'morador', label: 'Tipo' },
}, { order: 'kind, block, number' });

crud('cameras', 'cameras', {
  name: { t: 'str', req: 1, max: 100, label: 'Nome' },
  url: { t: 'str', req: 1, max: 500, re: /^(rtsp|rtsps|http|https):\/\/\S+$/i, label: 'URL (rtsp:// ou http://)' },
  username: { t: 'str', max: 100, label: 'Usuário' },
  password: { t: 'str', max: 200, label: 'Senha' },
}, { order: 'name' });

// ------------------------------------------------------------------- grupos
function ownedIds(table, cid, ids) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger))];
  if (!list.length) return [];
  return db.prepare(`SELECT id FROM ${table} WHERE condo_id=? AND id IN (${list.map(() => '?').join(',')})`)
    .all(cid, ...list).map((x) => x.id);
}

function loadGroups(cid, onlyId) {
  const groups = db.prepare(`SELECT id, name FROM groups WHERE condo_id=? ${onlyId ? 'AND id=?' : ''} ORDER BY name`)
    .all(...(onlyId ? [cid, onlyId] : [cid]));
  const cams = db.prepare('SELECT group_id, camera_id FROM group_cameras').all();
  const exts = db.prepare('SELECT group_id, extension_id FROM group_extensions').all();
  return groups.map((g) => ({
    ...g,
    camera_ids: cams.filter((x) => x.group_id === g.id).map((x) => x.camera_id),
    extension_ids: exts.filter((x) => x.group_id === g.id).map((x) => x.extension_id),
    members: db.prepare('SELECT COUNT(*) n FROM residents WHERE group_id=?').get(g.id).n,
  }));
}

const setGroupLinks = db.transaction((gid, cams, exts) => {
  db.prepare('DELETE FROM group_cameras WHERE group_id=?').run(gid);
  db.prepare('DELETE FROM group_extensions WHERE group_id=?').run(gid);
  for (const c of cams) db.prepare('INSERT INTO group_cameras VALUES (?,?)').run(gid, c);
  for (const e of exts) db.prepare('INSERT INTO group_extensions VALUES (?,?)').run(gid, e);
});

r.get('/condos/:cid/groups', need(...ADMINS), condoAccess, (req, res) => res.json(loadGroups(req.condo.id)));

r.post('/condos/:cid/groups', need(...ADMINS), condoAccess, (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name || name.length > 80) return bad(res, 'Nome do grupo é obrigatório.');
  try {
    const gid = db.prepare('INSERT INTO groups(condo_id, name) VALUES (?,?)').run(req.condo.id, name).lastInsertRowid;
    setGroupLinks(gid, ownedIds('cameras', req.condo.id, req.body.camera_ids), ownedIds('extensions', req.condo.id, req.body.extension_ids));
    res.json(loadGroups(req.condo.id, gid)[0]);
  } catch (e) { dbError(res, e, 'Já existe um grupo com esse nome.'); }
});

r.put('/condos/:cid/groups/:id', need(...ADMINS), condoAccess, (req, res) => {
  const g = db.prepare('SELECT * FROM groups WHERE id=? AND condo_id=?').get(Number(req.params.id), req.condo.id);
  if (!g) return bad(res, 'Grupo não encontrado.', 404);
  const name = String(req.body.name ?? g.name).trim();
  if (!name || name.length > 80) return bad(res, 'Nome do grupo é obrigatório.');
  try {
    db.prepare('UPDATE groups SET name=? WHERE id=?').run(name, g.id);
    setGroupLinks(g.id, ownedIds('cameras', req.condo.id, req.body.camera_ids), ownedIds('extensions', req.condo.id, req.body.extension_ids));
    res.json(loadGroups(req.condo.id, g.id)[0]);
  } catch (e) { dbError(res, e, 'Já existe um grupo com esse nome.'); }
});

r.delete('/condos/:cid/groups/:id', need(...ADMINS), condoAccess, (req, res) => {
  db.prepare('DELETE FROM groups WHERE id=? AND condo_id=?').run(Number(req.params.id), req.condo.id);
  res.json({ ok: true });
});

// ----------------------------------------------------------------- moradores
const RES_SPEC = {
  name: { t: 'str', req: 1, max: 100, label: 'Nome' },
  block: { t: 'str', max: 50, label: 'Bloco' },
  unit: { t: 'str', max: 30, label: 'Apartamento/Casa' },
  username: { t: 'str', req: 1, max: 40, re: /^[A-Za-z0-9._-]{3,40}$/, label: 'Usuário' },
  group_id: { t: 'int', label: 'Grupo' },
  extension_id: { t: 'int', label: 'Ramal' },
  active: { t: 'bool' },
};
const RES_LIST = `SELECT r.id, r.name, r.block, r.unit, r.username, r.group_id, r.extension_id, r.active,
  g.name AS group_name, e.number AS ext_number
  FROM residents r LEFT JOIN groups g ON g.id=r.group_id LEFT JOIN extensions e ON e.id=r.extension_id`;

r.get('/condos/:cid/residents', need(...ALL), condoAccess, (req, res) => {
  res.json(db.prepare(`${RES_LIST} WHERE r.condo_id=? ORDER BY r.block, r.name`).all(req.condo.id));
});

function checkResidentRefs(cid, d, selfId) {
  if (d.group_id !== null && !db.prepare('SELECT 1 FROM groups WHERE id=? AND condo_id=?').get(d.group_id, cid)) return 'Grupo inválido.';
  if (d.extension_id !== null) {
    const ext = db.prepare('SELECT kind FROM extensions WHERE id=? AND condo_id=?').get(d.extension_id, cid);
    if (!ext) return 'Ramal inválido.';
    if (ext.kind === 'portaria') return 'Ramal de portaria não pode ser vinculado a um morador.';
    if (db.prepare('SELECT 1 FROM users WHERE extension_id=?').get(d.extension_id)) return 'Esse ramal já está em uso por um usuário do painel.';
    const used = db.prepare('SELECT name FROM residents WHERE extension_id=? AND id<>?').get(d.extension_id, selfId || 0);
    if (used) return `Esse ramal já está vinculado a ${used.name}.`;
  }
  return null;
}

r.post('/condos/:cid/residents', need(...ADMINS), condoAccess, wrap(async (req, res) => {
  const v = clean(req.body, RES_SPEC);
  if (v.error) return bad(res, v.error);
  const password = String(req.body.password || '');
  if (password.length < 6) return bad(res, 'A senha do morador deve ter ao menos 6 caracteres.');
  const refErr = checkResidentRefs(req.condo.id, v.data);
  if (refErr) return bad(res, refErr);
  const d = v.data;
  try {
    const info = db.prepare(`INSERT INTO residents(condo_id, name, block, unit, username, password_hash, group_id, extension_id, active, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(req.condo.id, d.name, d.block, d.unit, d.username, await hashPw(password), d.group_id, d.extension_id, d.active, now());
    res.json(db.prepare(`${RES_LIST} WHERE r.id=?`).get(info.lastInsertRowid));
  } catch (e) { dbError(res, e, 'Esse usuário já existe neste condomínio.'); }
}));

r.put('/condos/:cid/residents/:id', need(...ADMINS), condoAccess, wrap(async (req, res) => {
  const row = db.prepare('SELECT * FROM residents WHERE id=? AND condo_id=?').get(Number(req.params.id), req.condo.id);
  if (!row) return bad(res, 'Morador não encontrado.', 404);
  const v = clean({ ...row, ...req.body }, RES_SPEC);
  if (v.error) return bad(res, v.error);
  const password = req.body.password ? String(req.body.password) : '';
  if (password && password.length < 6) return bad(res, 'A senha do morador deve ter ao menos 6 caracteres.');
  const refErr = checkResidentRefs(req.condo.id, v.data, row.id);
  if (refErr) return bad(res, refErr);
  const d = v.data;
  try {
    db.prepare(`UPDATE residents SET name=?, block=?, unit=?, username=?, group_id=?, extension_id=?, active=? WHERE id=?`)
      .run(d.name, d.block, d.unit, d.username, d.group_id, d.extension_id, d.active, row.id);
  } catch (e) { return dbError(res, e, 'Esse usuário já existe neste condomínio.'); }
  if (password) db.prepare('UPDATE residents SET password_hash=? WHERE id=?').run(await hashPw(password), row.id);
  if (password || !d.active) killSessions('app', row.id);
  res.json(db.prepare(`${RES_LIST} WHERE r.id=?`).get(row.id));
}));

r.delete('/condos/:cid/residents/:id', need(...ADMINS), condoAccess, (req, res) => {
  const id = Number(req.params.id);
  media.purge(db.prepare('SELECT media FROM messages WHERE resident_id=? AND media IS NOT NULL').all(id));
  media.purge(db.prepare('SELECT photo AS media FROM visitors WHERE resident_id=? AND photo IS NOT NULL').all(id));
  killSessions('app', id);
  db.prepare('DELETE FROM residents WHERE id=? AND condo_id=?').run(id, req.condo.id);
  res.json({ ok: true });
});

// -------------------------------------------------------------------- avisos
const NOTICE_KINDS = ['aviso', 'encomenda', 'comunicado', 'urgente'];

r.get('/condos/:cid/notices', need(...ALL), condoAccess, (req, res) => {
  res.json(db.prepare(`
    SELECT n.id, n.kind, n.title, n.body, n.resident_id, n.created_at, r.name AS resident_name, u.name AS author,
      (SELECT COUNT(*) FROM notice_reads nr WHERE nr.notice_id=n.id) AS seen_count,
      CASE WHEN n.resident_id IS NULL
        THEN (SELECT COUNT(*) FROM residents x WHERE x.condo_id=n.condo_id AND x.active=1) ELSE 1 END AS target_count
    FROM notices n LEFT JOIN residents r ON r.id=n.resident_id LEFT JOIN users u ON u.id=n.created_by
    WHERE n.condo_id=? ORDER BY n.id DESC LIMIT 200`).all(req.condo.id));
});

r.post('/condos/:cid/notices', need(...ALL), condoAccess, (req, res) => {
  const v = clean(req.body, {
    kind: { t: 'enum', vals: NOTICE_KINDS, def: 'aviso', label: 'Tipo' },
    title: { t: 'str', req: 1, max: 120, label: 'Título' },
    body: { t: 'str', max: 2000, label: 'Mensagem' },
    resident_id: { t: 'int', label: 'Morador' },
  });
  if (v.error) return bad(res, v.error);
  if (v.data.resident_id !== null &&
    !db.prepare('SELECT 1 FROM residents WHERE id=? AND condo_id=?').get(v.data.resident_id, req.condo.id))
    return bad(res, 'Morador inválido.');
  const info = db.prepare('INSERT INTO notices(condo_id, resident_id, kind, title, body, created_by, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(req.condo.id, v.data.resident_id, v.data.kind, v.data.title, v.data.body, req.user.id, now());
  res.json({ id: info.lastInsertRowid });
});

// quem já viu e quem ainda não viu um aviso
r.get('/condos/:cid/notices/:id/reads', need(...ALL), condoAccess, (req, res) => {
  const n = db.prepare('SELECT id, resident_id FROM notices WHERE id=? AND condo_id=?').get(Number(req.params.id), req.condo.id);
  if (!n) return bad(res, 'Aviso não encontrado.', 404);
  const targets = n.resident_id
    ? db.prepare('SELECT id, name, block, unit FROM residents WHERE id=?').all(n.resident_id)
    : db.prepare('SELECT id, name, block, unit FROM residents WHERE condo_id=? AND active=1 ORDER BY block, name').all(req.condo.id);
  const reads = new Map(db.prepare('SELECT resident_id, read_at FROM notice_reads WHERE notice_id=?').all(n.id)
    .map((x) => [x.resident_id, x.read_at]));
  const seen = [];
  const pending = [];
  for (const t of targets) (reads.has(t.id) ? seen : pending).push({ ...t, read_at: reads.get(t.id) || null });
  seen.sort((a, b) => a.read_at - b.read_at);
  res.json({ seen, pending });
});

r.delete('/condos/:cid/notices/:id', need(...ALL), condoAccess, (req, res) => {
  db.prepare('DELETE FROM notices WHERE id=? AND condo_id=?').run(Number(req.params.id), req.condo.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------- chat
r.get('/condos/:cid/chats', need(...ALL), condoAccess, (req, res) => {
  res.json(db.prepare(`
    SELECT r.id, r.name, r.block, r.unit,
      (SELECT CASE m.kind WHEN 'image' THEN '[Foto]' WHEN 'audio' THEN '[Áudio]' ELSE m.body END
         FROM messages m WHERE m.resident_id=r.id ORDER BY m.id DESC LIMIT 1) AS last_body,
      (SELECT created_at FROM messages m WHERE m.resident_id=r.id ORDER BY m.id DESC LIMIT 1) AS last_at,
      (SELECT COUNT(*) FROM messages m WHERE m.resident_id=r.id AND m.sender='resident' AND m.read_by_operator=0) AS unread
    FROM residents r WHERE r.condo_id=? AND r.active=1
    ORDER BY (last_at IS NULL), last_at DESC, r.name`).all(req.condo.id));
});

function chatResident(req, res) {
  const rr = db.prepare('SELECT id, name FROM residents WHERE id=? AND condo_id=?').get(Number(req.params.rid), req.condo.id);
  if (!rr) bad(res, 'Morador não encontrado.', 404);
  return rr;
}

r.get('/condos/:cid/chats/:rid', need(...ALL), condoAccess, (req, res) => {
  const rr = chatResident(req, res);
  if (!rr) return;
  const after = Number(req.query.after) || 0;
  const items = db.prepare('SELECT id, sender, operator_name, kind, body, created_at FROM messages WHERE resident_id=? AND id>? ORDER BY id LIMIT 300')
    .all(rr.id, after);
  db.prepare("UPDATE messages SET read_by_operator=1 WHERE resident_id=? AND sender='resident' AND read_by_operator=0").run(rr.id);
  res.json(items);
});

r.post('/condos/:cid/chats/:rid', need(...ALL), condoAccess, (req, res) => {
  const rr = chatResident(req, res);
  if (!rr) return;
  const body = String(req.body.body || '').trim();
  if (!body || body.length > 2000) return bad(res, 'Mensagem vazia ou muito longa.');
  const info = db.prepare(`INSERT INTO messages(condo_id, resident_id, sender, operator_id, operator_name, body, read_by_operator, created_at)
    VALUES (?,?,?,?,?,?,1,?)`).run(req.condo.id, rr.id, 'operator', req.user.id, req.user.name || req.user.username, body, now());
  res.json({ id: info.lastInsertRowid });
});

// foto / áudio enviados pelo operador
r.post('/condos/:cid/chats/:rid/media', need(...ALL), condoAccess, express.json({ limit: '8mb' }), (req, res) => {
  const rr = chatResident(req, res);
  if (!rr) return;
  const kind = String(req.body.kind || '');
  const m = media.save(kind, req.body.data);
  if (m.error) return bad(res, m.error);
  const info = db.prepare(`INSERT INTO messages(condo_id, resident_id, sender, operator_id, operator_name, kind, media, mime, body, read_by_operator, created_at)
    VALUES (?,?,?,?,?,?,?,?,'',1,?)`)
    .run(req.condo.id, rr.id, 'operator', req.user.id, req.user.name || req.user.username, kind, m.file, m.mime, now());
  res.json({ id: info.lastInsertRowid });
});

r.get('/condos/:cid/chats/:rid/file/:mid', need(...ALL), condoAccess, (req, res) => {
  const rr = chatResident(req, res);
  if (!rr) return;
  const row = db.prepare('SELECT media, mime FROM messages WHERE id=? AND resident_id=? AND media IS NOT NULL')
    .get(Number(req.params.mid), rr.id);
  if (!row) return bad(res, 'Arquivo não encontrado.', 404);
  media.send(res, row);
});

// ------------------------------------------------------------------- visitas
r.use('/condos/:cid/visitors', need(...ALL), condoAccess, visits.admin);

// ------------------------------------------------- aplicativos conectados (logados)
r.get('/condos/:cid/devices', need(...ALL), condoAccess, (req, res) => {
  const t = now();
  const rows = db.prepare(`
    SELECT r.id AS resident_id, r.name, r.block, r.unit, s.created_at, s.last_seen, s.device, s.app_version, s.ip, s.sip_state
    FROM sessions s JOIN residents r ON r.id=s.subject_id
    WHERE s.kind='app' AND r.condo_id=? AND s.expires_at>? ORDER BY s.last_seen DESC`).all(req.condo.id, t);
  res.json(rows.map((x) => ({ ...x, online: (x.last_seen || 0) >= t - 40 })));
});

// ----------------------------------------- telefone do navegador (cliente VoIP do operador)
r.get('/condos/:cid/softphone', need(...ALL), condoAccess, (req, res) => {
  const c = req.condo;
  if (!c.sip_host) return res.json({ configured: false, reason: 'O servidor VoIP (Issabel) ainda não foi informado. O administrador primário preenche em "Servidor VoIP".' });
  if (!c.wss_url) return res.json({ configured: false, reason: 'A URL WebSocket (wss://…) do Issabel ainda não foi informada. O administrador primário preenche em "Servidor VoIP".' });
  const u = db.prepare('SELECT extension_id FROM users WHERE id=?').get(req.user.id);
  const ext = u && u.extension_id ? db.prepare('SELECT * FROM extensions WHERE id=? AND condo_id=?').get(u.extension_id, c.id) : null;
  if (!ext) return res.json({ configured: false, reason: 'Nenhum ramal está vinculado ao seu usuário. O administrador do condomínio vincula em "Equipe do painel".' });
  res.json({
    configured: true,
    wss: c.wss_url,
    domain: c.sip_host,
    user: ext.number,
    password: ext.secret,
    displayName: req.user.name || ext.label || ext.number,
    stun: 'stun:stun.l.google.com:19302',
  });
});

module.exports = r;
