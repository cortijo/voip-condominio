// Liberação de visitas: link para o visitante se cadastrar (com foto da câmera frontal),
// consulta pelo morador (app) e validação pelo porteiro (painel).
const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const media = require('../media');
const { bad, now } = require('../util');

const STATUS = ['aguardando', 'cadastrado', 'liberado', 'recusado', 'saiu', 'cancelado'];
const LINK_DAYS = 7;

// ------------------------------------------------------------------ validação
function cpfOk(d) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  for (const n of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Number(d[i]) * (n + 1 - i);
    if (((sum * 10) % 11) % 10 !== Number(d[n])) return false;
  }
  return true;
}

/** Valida/normaliza os dados do visitante. partial=true aceita campos ausentes (ainda sem cadastro). */
function cleanData(b, { required = true } = {}) {
  const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  const name = str(b.name, 100).replace(/\s+/g, ' ');
  const docType = String(b.doc_type || 'CPF').toUpperCase() === 'RG' ? 'RG' : 'CPF';
  let document = str(b.document, 30);
  const phone = str(b.phone, 30).replace(/[^\d+]/g, '');
  const vehicle = str(b.vehicle, 60);
  const plate = str(b.plate, 12).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (required) {
    if (name.length < 3) return { error: 'Informe o nome completo.' };
    if (!document) return { error: 'Informe o CPF ou RG.' };
    if (phone.replace(/\D/g, '').length < 10) return { error: 'Informe um telefone com DDD.' };
  }
  if (document) {
    if (docType === 'CPF') {
      const d = document.replace(/\D/g, '');
      if (!cpfOk(d)) return { error: 'CPF inválido.' };
      document = d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    } else if (!/^[0-9A-Za-z.\-/ ]{4,20}$/.test(document)) {
      return { error: 'RG inválido.' };
    }
  }
  if (plate && !/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate)) return { error: 'Placa inválida (ex.: ABC1D23 ou ABC-1234).' };
  return { data: { name, doc_type: docType, document, phone, vehicle, plate } };
}

function cleanDate(v) {
  const d = String(v || '').trim();
  if (!d) return { data: '' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) return { error: 'Data da visita inválida.' };
  return { data: d };
}

const expiryFor = (visitDate) => {
  const base = visitDate ? Date.parse(visitDate + 'T23:59:59-03:00') / 1000 + 86400 : 0;
  return Math.max(now() + 24 * 3600, base || now() + LINK_DAYS * 86400);
};

const linkFor = (req, token) => `${(process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')}/v/${token}`;

const COLS = `v.id, v.status, v.source, v.name, v.doc_type, v.document, v.phone, v.vehicle, v.plate, v.visit_date, v.note,
  v.decided_by, v.created_at, v.registered_at, v.decided_at, v.left_at, v.expires_at, v.token, v.resident_id,
  (v.photo IS NOT NULL) AS has_photo, r.name AS resident_name, r.block AS resident_block, r.unit AS resident_unit`;
const SELECT = `SELECT ${COLS} FROM visitors v LEFT JOIN residents r ON r.id=v.resident_id`;

const out = (req, v) => ({ ...v, has_photo: !!v.has_photo, expired: v.expires_at < now() && ['aguardando', 'cadastrado'].includes(v.status), link: linkFor(req, v.token) });

function tell(condoId, residentId, title, body) {
  if (!residentId) return;
  db.prepare("INSERT INTO notices(condo_id, resident_id, kind, title, body, created_at) VALUES (?,?,'aviso',?,?,?)")
    .run(condoId, residentId, title, body, now());
}

const saveInto = (res, kind, data) => {
  const m = media.save(kind, data);
  if (m.error) { bad(res, m.error); return null; }
  return m;
};

function purgeOld() {
  const days = Number(process.env.VISIT_RETENTION_DAYS) || 90;
  const rows = db.prepare('SELECT id, photo AS media FROM visitors WHERE created_at<?').all(now() - days * 86400);
  media.purge(rows);
  db.prepare('DELETE FROM visitors WHERE created_at<?').run(now() - days * 86400);
}
setInterval(() => { try { purgeOld(); } catch (e) { console.error(e); } }, 6 * 3600 * 1000).unref();

// ================================================================== público (visitante)
const pub = express.Router();
const hits = new Map();
pub.use((req, res, next) => {
  const t = Date.now();
  const k = req.ip;
  const h = (hits.get(k) || []).filter((x) => t - x < 600000);
  if (h.length >= 80) return bad(res, 'Muitas tentativas. Aguarde alguns minutos.', 429);
  h.push(t); hits.set(k, h);
  next();
});
setInterval(() => hits.clear(), 3600 * 1000).unref();

function byToken(req, res) {
  const t = String(req.params.token || '');
  const v = /^[0-9a-f]{32}$/.test(t) ? db.prepare('SELECT * FROM visitors WHERE token=?').get(t) : null;
  if (!v) { bad(res, 'Link inválido ou removido.', 404); return null; }
  return v;
}

pub.get('/visit/:token', (req, res) => {
  const v = byToken(req, res);
  if (!v) return;
  const c = db.prepare('SELECT name, colors, logo, active FROM condos WHERE id=?').get(v.condo_id);
  const r = v.resident_id ? db.prepare('SELECT name, block, unit FROM residents WHERE id=?').get(v.resident_id) : null;
  const editable = ['aguardando', 'cadastrado'].includes(v.status) && v.expires_at >= now() && c && c.active;
  res.json({
    condo: { name: c ? c.name : '', colors: c ? JSON.parse(c.colors) : {}, logoUrl: c && c.logo ? `/media/${c.logo}` : null },
    resident: r ? { name: r.name, block: r.block, unit: r.unit } : null,
    status: v.status, editable: !!editable, expired: v.expires_at < now(), visit_date: v.visit_date,
    data: { name: v.name, doc_type: v.doc_type, document: v.document, phone: v.phone, vehicle: v.vehicle, plate: v.plate, has_photo: !!v.photo },
  });
});

pub.post('/visit/:token', express.json({ limit: '6mb' }), (req, res) => {
  const v = byToken(req, res);
  if (!v) return;
  const c = db.prepare('SELECT active FROM condos WHERE id=?').get(v.condo_id);
  if (!c || !c.active || !['aguardando', 'cadastrado'].includes(v.status) || v.expires_at < now())
    return bad(res, 'Este link não aceita mais cadastro. Peça um novo link ao morador.', 410);
  const d = cleanData(req.body || {});
  if (d.error) return bad(res, d.error);
  let photo = v.photo;
  if (req.body.photo) {
    const m = saveInto(res, 'image', req.body.photo);
    if (!m) return;
    if (v.photo) media.purge([{ media: v.photo }]);
    photo = m.file;
  }
  const first = v.status === 'aguardando';
  db.prepare(`UPDATE visitors SET name=?, doc_type=?, document=?, phone=?, vehicle=?, plate=?, photo=?, status='cadastrado', registered_at=? WHERE id=?`)
    .run(d.data.name, d.data.doc_type, d.data.document, d.data.phone, d.data.vehicle, d.data.plate, photo, now(), v.id);
  if (first) tell(v.condo_id, v.resident_id, 'Visitante cadastrado', `${d.data.name} enviou os dados para a visita${photo ? '' : ' (sem foto)'}. O porteiro validará na chegada.`);
  res.json({ ok: true });
});

// ================================================================== app do morador
const app = express.Router();

function mine(req, res) {
  const v = db.prepare(`${SELECT} WHERE v.id=? AND v.resident_id=?`).get(Number(req.params.id), req.resident.id);
  if (!v) { bad(res, 'Visita não encontrada.', 404); return null; }
  return v;
}

app.get('/', (req, res) => {
  res.json(db.prepare(`${SELECT} WHERE v.resident_id=? ORDER BY v.id DESC LIMIT 100`).all(req.resident.id).map((v) => out(req, v)));
});

app.post('/', (req, res) => {
  const date = cleanDate(req.body.visit_date);
  if (date.error) return bad(res, date.error);
  const name = String(req.body.name || '').trim().slice(0, 100);
  const note = String(req.body.note || '').trim().slice(0, 300);
  const token = crypto.randomBytes(16).toString('hex');
  const info = db.prepare(`INSERT INTO visitors(condo_id, resident_id, token, status, source, name, visit_date, note, created_at, expires_at)
    VALUES (?,?,?,'aguardando','morador',?,?,?,?,?)`).run(req.condo.id, req.resident.id, token, name, date.data, note, now(), expiryFor(date.data));
  res.json(out(req, db.prepare(`${SELECT} WHERE v.id=?`).get(info.lastInsertRowid)));
});

app.post('/:id/cancel', (req, res) => {
  const v = mine(req, res);
  if (!v) return;
  if (!['aguardando', 'cadastrado'].includes(v.status)) return bad(res, 'Esta visita não pode mais ser cancelada.');
  db.prepare("UPDATE visitors SET status='cancelado', decided_at=? WHERE id=?").run(now(), v.id);
  res.json({ ok: true });
});

app.get('/:id/photo', (req, res) => {
  const v = mine(req, res);
  if (!v) return;
  const row = db.prepare('SELECT photo AS media FROM visitors WHERE id=?').get(v.id);
  if (!row.media) return bad(res, 'Sem foto.', 404);
  media.send(res, { media: row.media, mime: row.media.endsWith('.png') ? 'image/png' : row.media.endsWith('.webp') ? 'image/webp' : 'image/jpeg' });
});

// ================================================================== painel (porteiro/administração)
const admin = express.Router();

function target(req, res) {
  const v = db.prepare(`${SELECT} WHERE v.id=? AND v.condo_id=?`).get(Number(req.params.id), req.condo.id);
  if (!v) { bad(res, 'Visita não encontrada.', 404); return null; }
  return v;
}

admin.get('/', (req, res) => {
  const st = String(req.query.status || '');
  const rows = STATUS.includes(st)
    ? db.prepare(`${SELECT} WHERE v.condo_id=? AND v.status=? ORDER BY v.id DESC LIMIT 300`).all(req.condo.id, st)
    : db.prepare(`${SELECT} WHERE v.condo_id=? ORDER BY v.id DESC LIMIT 300`).all(req.condo.id);
  res.json(rows.map((v) => out(req, v)));
});

admin.post('/', (req, res) => {
  const b = req.body || {};
  let residentId = null;
  if (b.resident_id !== undefined && b.resident_id !== null && b.resident_id !== '') {
    residentId = Number(b.resident_id);
    if (!db.prepare('SELECT 1 FROM residents WHERE id=? AND condo_id=?').get(residentId, req.condo.id)) return bad(res, 'Morador inválido.');
  }
  const date = cleanDate(b.visit_date);
  if (date.error) return bad(res, date.error);
  const hasData = !!(b.name || b.document || b.phone);
  let d = { data: { name: '', doc_type: 'CPF', document: '', phone: '', vehicle: '', plate: '' } };
  if (hasData) { d = cleanData(b); if (d.error) return bad(res, d.error); }
  let photo = null;
  if (b.photo) { const m = saveInto(res, 'image', b.photo); if (!m) return; photo = m.file; }
  const info = db.prepare(`INSERT INTO visitors(condo_id, resident_id, token, status, source, name, doc_type, document, phone, vehicle, plate, photo,
      visit_date, note, created_at, registered_at, expires_at) VALUES (?,?,?,?, 'portaria', ?,?,?,?,?,?,?, ?,?,?,?,?)`)
    .run(req.condo.id, residentId, crypto.randomBytes(16).toString('hex'), hasData ? 'cadastrado' : 'aguardando',
      d.data.name, d.data.doc_type, d.data.document, d.data.phone, d.data.vehicle, d.data.plate, photo,
      date.data, String(b.note || '').trim().slice(0, 300), now(), hasData ? now() : null, expiryFor(date.data));
  res.json(out(req, db.prepare(`${SELECT} WHERE v.id=?`).get(info.lastInsertRowid)));
});

admin.put('/:id', (req, res) => {
  const v = target(req, res);
  if (!v) return;
  const d = cleanData(req.body || {}, { required: false });
  if (d.error) return bad(res, d.error);
  const date = cleanDate(req.body.visit_date !== undefined ? req.body.visit_date : v.visit_date);
  if (date.error) return bad(res, date.error);
  db.prepare('UPDATE visitors SET name=?, doc_type=?, document=?, phone=?, vehicle=?, plate=?, visit_date=?, note=? WHERE id=?')
    .run(d.data.name, d.data.doc_type, d.data.document, d.data.phone, d.data.vehicle, d.data.plate, date.data,
      String(req.body.note !== undefined ? req.body.note : v.note).trim().slice(0, 300), v.id);
  if (v.status === 'aguardando' && d.data.name && d.data.document) db.prepare("UPDATE visitors SET status='cadastrado', registered_at=? WHERE id=?").run(now(), v.id);
  res.json(out(req, db.prepare(`${SELECT} WHERE v.id=?`).get(v.id)));
});

admin.post('/:id/photo', express.json({ limit: '6mb' }), (req, res) => {
  const v = target(req, res);
  if (!v) return;
  const m = saveInto(res, 'image', req.body.data);
  if (!m) return;
  const old = db.prepare('SELECT photo AS media FROM visitors WHERE id=?').get(v.id);
  if (old.media) media.purge([old]);
  db.prepare('UPDATE visitors SET photo=? WHERE id=?').run(m.file, v.id);
  res.json({ ok: true });
});

admin.get('/:id/photo', (req, res) => {
  const v = target(req, res);
  if (!v) return;
  const row = db.prepare('SELECT photo AS media FROM visitors WHERE id=?').get(v.id);
  if (!row.media) return bad(res, 'Sem foto.', 404);
  media.send(res, { media: row.media, mime: row.media.endsWith('.png') ? 'image/png' : row.media.endsWith('.webp') ? 'image/webp' : 'image/jpeg' });
});

// liberar entrada / recusar / registrar saída / cancelar
const FLOW = {
  liberar: { from: ['aguardando', 'cadastrado'], to: 'liberado', title: 'Visita liberada', text: (v) => `${v.name || 'Seu visitante'} teve a entrada liberada pela portaria.` },
  recusar: { from: ['aguardando', 'cadastrado', 'liberado'], to: 'recusado', title: 'Visita recusada', text: (v) => `A portaria não liberou a entrada de ${v.name || 'seu visitante'}.` },
  saida: { from: ['liberado'], to: 'saiu', title: null },
  cancelar: { from: ['aguardando', 'cadastrado', 'liberado'], to: 'cancelado', title: null },
};

admin.post('/:id/action', (req, res) => {
  const v = target(req, res);
  if (!v) return;
  const f = FLOW[String(req.body.action || '')];
  if (!f) return bad(res, 'Ação inválida.');
  if (!f.from.includes(v.status)) return bad(res, `Não é possível aplicar essa ação a uma visita "${v.status}".`);
  if (f.to === 'liberado' && !(v.name && v.document)) return bad(res, 'Cadastre nome e documento antes de liberar.');
  db.prepare('UPDATE visitors SET status=?, decided_at=?, decided_by=?, left_at=? WHERE id=?')
    .run(f.to, now(), req.user.name || req.user.username, f.to === 'saiu' ? now() : v.left_at, v.id);
  if (f.title) tell(req.condo.id, v.resident_id, f.title, f.text(v));
  res.json(out(req, db.prepare(`${SELECT} WHERE v.id=?`).get(v.id)));
});

admin.delete('/:id', (req, res) => {
  const v = target(req, res);
  if (!v) return;
  media.purge(db.prepare('SELECT photo AS media FROM visitors WHERE id=? AND photo IS NOT NULL').all(v.id));
  db.prepare('DELETE FROM visitors WHERE id=?').run(v.id);
  res.json({ ok: true });
});

module.exports = { pub, app, admin };
