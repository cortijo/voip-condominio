const express = require('express');
const { db } = require('../db');
const { createSession, destroyToken, killSessions, panelAuth } = require('../auth');
const { wrap, bad, checkPw, hashPw, DUMMY_HASH, loginLimited, loginFailed, loginOk } = require('../util');

const r = express.Router();

const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role, condo_id: u.condo_id });

r.post('/login', wrap(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const key = `panel:${req.ip}:${username.toLowerCase()}`;
  if (loginLimited(key)) return bad(res, 'Muitas tentativas. Aguarde alguns minutos.', 429);

  const u = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  const ok = await checkPw(password, u ? u.password_hash : DUMMY_HASH);
  let allowed = !!(u && ok && u.active);
  if (allowed && u.condo_id) {
    const c = db.prepare('SELECT active FROM condos WHERE id=?').get(u.condo_id);
    allowed = !!(c && c.active);
  }
  if (!allowed) {
    loginFailed(key);
    return bad(res, 'Usuário ou senha inválidos.', 401);
  }
  loginOk(key);
  res.json({ token: createSession('panel', u.id), user: publicUser(u) });
}));

r.get('/me', panelAuth, (req, res) => res.json({ user: publicUser(req.user) }));

r.post('/logout', panelAuth, (req, res) => {
  destroyToken(req.token);
  res.json({ ok: true });
});

r.post('/password', panelAuth, wrap(async (req, res) => {
  const current = String(req.body.current || '');
  const password = String(req.body.password || '');
  if (password.length < 8) return bad(res, 'A nova senha deve ter ao menos 8 caracteres.');
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!(await checkPw(current, u.password_hash))) return bad(res, 'Senha atual incorreta.', 403);
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(await hashPw(password), u.id);
  killSessions('panel', u.id);
  res.json({ ok: true, relogin: true });
}));

module.exports = r;
