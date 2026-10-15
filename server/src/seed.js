const crypto = require('crypto');
const { db } = require('./db');
const { now, hashPw } = require('./util');

/** Cria o administrador primário na primeira execução. */
async function seedAdmin() {
  if (db.prepare("SELECT 1 FROM users WHERE role='master'").get()) return;

  const username = (process.env.ADMIN_USER || 'admin').trim();
  let password = process.env.ADMIN_PASSWORD || '';
  let generated = false;
  if (password.length < 8) {
    if (password) console.warn('[seed] ADMIN_PASSWORD tem menos de 8 caracteres; gerando uma senha aleatória.');
    password = crypto.randomBytes(9).toString('base64url');
    generated = true;
  }
  db.prepare("INSERT INTO users(username, name, password_hash, role, created_at) VALUES (?,?,?,'master',?)")
    .run(username, 'Administrador', await hashPw(password), now());

  console.log('==================================================');
  console.log(' Administrador primário criado');
  console.log(`   usuário: ${username}`);
  if (generated) console.log(`   senha:   ${password}   (exibida só agora — troque no painel)`);
  else console.log('   senha:   definida por ADMIN_PASSWORD');
  console.log('==================================================');
}

module.exports = { seedAdmin };
