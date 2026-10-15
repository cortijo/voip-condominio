// Uso: node src/reset-admin.js <nova-senha> [usuario]
// Docker: docker exec -it interfone-server node src/reset-admin.js "NovaSenhaForte123"
const { db } = require('./db');
const { hashPw } = require('./util');

(async () => {
  const pw = process.argv[2];
  const username = process.argv[3];
  if (!pw || pw.length < 8) {
    console.error('Informe a nova senha (mínimo 8 caracteres).');
    process.exit(1);
  }
  const u = username
    ? db.prepare("SELECT id, username FROM users WHERE role='master' AND username=?").get(username)
    : db.prepare("SELECT id, username FROM users WHERE role='master' ORDER BY id LIMIT 1").get();
  if (!u) {
    console.error('Administrador primário não encontrado.');
    process.exit(1);
  }
  db.prepare('UPDATE users SET password_hash=?, active=1 WHERE id=?').run(await hashPw(pw), u.id);
  db.prepare("DELETE FROM sessions WHERE kind='panel' AND subject_id=?").run(u.id);
  console.log(`Senha de "${u.username}" redefinida.`);
})();
