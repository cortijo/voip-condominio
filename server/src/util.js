const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const now = () => Math.floor(Date.now() / 1000);
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('hex');
const hashPw = (pw) => bcrypt.hash(pw, 10);
const checkPw = (pw, hash) => bcrypt.compare(pw, hash);
// hash fixo para gastar o mesmo tempo quando o usuário não existe
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

/**
 * Valida e normaliza um objeto segundo um "spec".
 * spec: { campo: { t:'str'|'int'|'bool'|'enum', req, max, min, re, vals, label, def } }
 */
function clean(src, spec) {
  const out = {};
  for (const [k, s] of Object.entries(spec)) {
    const label = s.label || k;
    let v = src[k];
    if (v === undefined || v === null) v = s.def !== undefined ? s.def : s.t === 'int' ? null : s.t === 'bool' ? 0 : '';
    if (s.t === 'str' || s.t === 'enum') {
      v = String(v).trim();
      if (s.t === 'enum' && !s.vals.includes(v)) return { error: `${label} inválido` };
      if (s.req && !v) return { error: `${label} é obrigatório` };
      if (v.length > (s.max || 200)) return { error: `${label} muito longo` };
      if (s.re && v && !s.re.test(v)) return { error: `${label} inválido` };
    } else if (s.t === 'int') {
      if (v === '' || v === null) {
        if (s.req) return { error: `${label} é obrigatório` };
        v = null;
      } else {
        v = Number(v);
        if (!Number.isInteger(v) || (s.min !== undefined && v < s.min) || (s.max !== undefined && v > s.max))
          return { error: `${label} inválido` };
      }
    } else if (s.t === 'bool') {
      v = v === true || v === 1 || v === '1' ? 1 : 0;
    }
    out[k] = v;
  }
  return { data: out };
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const COLOR_KEYS = ['primary', 'onPrimary', 'background', 'surface', 'surfaceAlt', 'text'];

function cleanColors(input, base) {
  const out = { ...base };
  for (const k of COLOR_KEYS) {
    if (input && input[k] !== undefined) {
      if (!HEX.test(String(input[k]))) return { error: `Cor "${k}" inválida (use #RRGGBB)` };
      out[k] = String(input[k]).toUpperCase();
    }
  }
  return { data: out };
}

// limitador simples de tentativas de login (em memória)
const attempts = new Map();
const MAX_ATTEMPTS = 10;
const WINDOW = 10 * 60 * 1000;
function loginLimited(key) {
  const a = attempts.get(key);
  if (!a) return false;
  if (Date.now() - a.first > WINDOW) { attempts.delete(key); return false; }
  return a.n >= MAX_ATTEMPTS;
}
function loginFailed(key) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > WINDOW) attempts.set(key, { n: 1, first: Date.now() });
  else a.n++;
}
function loginOk(key) { attempts.delete(key); }
setInterval(() => {
  for (const [k, a] of attempts) if (Date.now() - a.first > WINDOW) attempts.delete(k);
}, 60 * 1000).unref();

module.exports = {
  now, sha256, newToken, hashPw, checkPw, DUMMY_HASH, wrap, bad, clean, cleanColors,
  COLOR_KEYS, loginLimited, loginFailed, loginOk,
};
