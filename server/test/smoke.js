// Teste de ponta a ponta: sobe o servidor com banco temporário e percorre os fluxos principais.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const PORT = 19670;
const BASE = `http://127.0.0.1:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interfone-test-'));
const srv = spawn('node', [path.join(__dirname, '..', 'src', 'index.js')], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, ADMIN_USER: 'root', ADMIN_PASSWORD: 'SenhaMaster123' },
  stdio: ['ignore', 'pipe', 'inherit'],
});

async function call(method, url, body, token) {
  const r = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j };
}
const ok = (r, msg) => assert.ok(r.status >= 200 && r.status < 300, `${msg}: ${r.status} ${JSON.stringify(r.body)}`);
const code = (r, c, msg) => assert.strictEqual(r.status, c, `${msg}: esperado ${c}, veio ${r.status} ${JSON.stringify(r.body)}`);

async function waitUp() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + '/health')).ok) return; } catch (e) { /* ainda subindo */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('servidor não subiu');
}

(async () => {
  await waitUp();
  let t = 0;
  const step = (m) => console.log(`ok ${++t} - ${m}`);

  // login master
  code(await call('POST', '/api/auth/login', { username: 'root', password: 'errada' }), 401, 'senha errada');
  const lm = await call('POST', '/api/auth/login', { username: 'root', password: 'SenhaMaster123' });
  ok(lm, 'login master'); const M = lm.body.token; step('login do administrador primário');
  code(await call('GET', '/api/admin/condos'), 401, 'sem token'); step('rotas exigem autenticação');

  // condomínio
  const c = await call('POST', '/api/admin/condos', { name: 'Condomínio Teste', code: 'teste' }, M);
  ok(c, 'criar condo'); const cid = c.body.id; step('cria condomínio');
  code(await call('POST', '/api/admin/condos', { name: 'Outro', code: 'TESTE' }, M), 409, 'código duplicado'); step('código de condomínio é único');
  const up = await call('PUT', `/api/admin/condos/${cid}`, {
    name: 'Condomínio Teste', info: 'Rua A, 100', phone: '1199999', sip_host: '10.0.0.5', sip_port: 5060, sip_transport: 'UDP',
    colors: { primary: '#00AAFF', background: '#101010' },
  }, M);
  ok(up, 'editar condo'); assert.strictEqual(up.body.colors.primary, '#00AAFF'); step('edita design e VoIP');
  code(await call('PUT', `/api/admin/condos/${cid}`, { colors: { primary: 'azul' } }, M), 400, 'cor inválida'); step('rejeita cor inválida');

  // logo
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 1)]);
  const lg = await call('POST', `/api/admin/condos/${cid}/logo`, { data: 'data:image/png;base64,' + png.toString('base64') }, M);
  ok(lg, 'logo'); const media = await fetch(BASE + lg.body.logoUrl); assert.strictEqual(media.status, 200); step('envia e serve o logotipo');
  code(await call('POST', `/api/admin/condos/${cid}/logo`, { data: 'data:image/svg+xml;base64,PHN2Zz4=' }, M), 400, 'svg'); step('rejeita SVG/arquivos que não são imagem');

  // equipe
  const adm = await call('POST', `/api/admin/condos/${cid}/users`, { username: 'adm1', name: 'Adm', password: 'AdminCondo1', role: 'condo_admin' }, M);
  ok(adm, 'criar admin condo'); step('cria administrador do condomínio');
  const A = (await call('POST', '/api/auth/login', { username: 'adm1', password: 'AdminCondo1' })).body.token;
  const op = await call('POST', `/api/admin/condos/${cid}/users`, { username: 'op1', name: 'Operador', password: 'Operador123', role: 'operator' }, A);
  ok(op, 'admin cria operador');
  code(await call('POST', `/api/admin/condos/${cid}/users`, { username: 'adm2', name: 'X', password: 'Admin12345', role: 'condo_admin' }, A), 400, 'admin não cria admin');
  step('admin do condomínio cria operadores (mas não outros admins)');
  const O = (await call('POST', '/api/auth/login', { username: 'op1', password: 'Operador123' })).body.token;

  // isolamento / permissões
  const c2 = await call('POST', '/api/admin/condos', { name: 'Outro Condo', code: 'outro' }, M);
  code(await call('GET', `/api/admin/condos/${c2.body.id}/residents`, null, A), 403, 'outro condo'); step('admin não acessa outro condomínio');
  code(await call('PUT', `/api/admin/condos/${cid}`, { name: 'Hack' }, A), 403, 'admin altera design'); step('só o primário altera design/VoIP');
  code(await call('GET', `/api/admin/condos/${cid}/cameras`, null, O), 403, 'operador cameras'); step('operador não acessa câmeras');
  code(await call('GET', '/api/admin/condos', null, A), 403, 'listar condos'); step('só o primário lista condomínios');

  // ramais, câmeras, grupos, moradores
  const eP = (await call('POST', `/api/admin/condos/${cid}/extensions`, { number: '1000', secret: 'p0rt', label: 'Portaria', kind: 'portaria' }, A)).body;
  const e1 = (await call('POST', `/api/admin/condos/${cid}/extensions`, { number: '1001', secret: 's1', label: 'Maria', block: 'BLOCO A', kind: 'morador' }, A)).body;
  const e2 = (await call('POST', `/api/admin/condos/${cid}/extensions`, { number: '1002', secret: 's2', label: 'João', block: 'BLOCO A', kind: 'morador' }, A)).body;
  assert.ok(eP.id && e1.id && e2.id); step('cadastra ramais');
  code(await call('POST', `/api/admin/condos/${cid}/extensions`, { number: '1001' }, A), 409, 'ramal duplicado'); step('ramal duplicado é recusado');
  const cam = await call('POST', `/api/admin/condos/${cid}/cameras`, { name: 'Portaria', url: 'rtsp://192.168.0.9/live', username: 'u', password: 'p' }, A);
  ok(cam, 'camera');
  code(await call('POST', `/api/admin/condos/${cid}/cameras`, { name: 'x', url: 'javascript:alert(1)' }, A), 400, 'url ruim'); step('cadastra câmera e valida a URL');
  const g = await call('POST', `/api/admin/condos/${cid}/groups`, { name: 'Moradores', camera_ids: [cam.body.id], extension_ids: [eP.id, e2.id] }, A);
  ok(g, 'grupo'); assert.deepStrictEqual(g.body.camera_ids, [cam.body.id]); step('cria grupo com câmeras e ramais permitidos');
  const rs = await call('POST', `/api/admin/condos/${cid}/residents`, {
    name: 'Maria Silva', block: 'BLOCO A', unit: '101', username: 'maria', password: 'maria123', group_id: g.body.id, extension_id: e1.id, active: 1,
  }, A);
  ok(rs, 'morador'); step('cadastra morador');
  code(await call('POST', `/api/admin/condos/${cid}/residents`, { name: 'Outra', username: 'outra', password: 'senha123', extension_id: e1.id, active: 1 }, A), 400, 'ramal já usado');
  step('mesmo ramal não pode ir para dois moradores');

  // app
  code(await call('POST', '/api/app/login', { code: 'teste', username: 'maria', password: 'errada' }), 401, 'app senha errada');
  const al = await call('POST', '/api/app/login', { code: 'TESTE', username: 'maria', password: 'maria123' });
  ok(al, 'login app'); const T = al.body.token; const cfg = al.body.config;
  assert.strictEqual(cfg.condo.name, 'Condomínio Teste');
  assert.strictEqual(cfg.condo.colors.primary, '#00AAFF');
  assert.deepStrictEqual(cfg.sip, { host: '10.0.0.5', port: 5060, transport: 'UDP', user: '1001', password: 's1', displayName: 'Maria Silva' });
  assert.deepStrictEqual(cfg.cameras.map((x) => x.name), ['Portaria']);
  assert.deepStrictEqual(cfg.extensions.map((x) => x.number).sort(), ['1000', '1002']);
  assert.ok(!cfg.extensions.some((x) => x.number === '1001'), 'não lista o próprio ramal');
  step('app recebe ramal, câmeras, ramais permitidos, nome e cores');

  // avisos e push
  const before = (await call('GET', '/api/app/poll?n=0&m=0', null, T)).body;
  const n1 = await call('POST', `/api/admin/condos/${cid}/notices`, { kind: 'aviso', title: 'Reunião', body: 'Sábado 10h' }, O);
  ok(n1, 'aviso geral');
  const n2 = await call('POST', `/api/admin/condos/${cid}/notices`, { kind: 'encomenda', title: 'Encomenda', body: 'Na portaria', resident_id: rs.body.id }, O);
  ok(n2, 'aviso direcionado');
  const other = (await call('POST', `/api/admin/condos/${cid}/residents`, { name: 'João', username: 'joao', password: 'joao1234', group_id: g.body.id, active: 1 }, A)).body;
  const TJ = (await call('POST', '/api/app/login', { code: 'teste', username: 'joao', password: 'joao1234' })).body.token;
  const pj = (await call('GET', '/api/app/poll?n=0&m=0', null, TJ)).body;
  const pm = (await call('GET', `/api/app/poll?n=${before.notices.length ? before.notices.at(-1).id : 0}&m=0`, null, T)).body;
  assert.deepStrictEqual(pj.notices.map((x) => x.title), ['Reunião'], 'João só vê o aviso geral');
  assert.deepStrictEqual((await call('GET', '/api/app/notices', null, T)).body.map((x) => x.title).sort(), ['Encomenda', 'Reunião']);
  assert.ok(pm.version);
  step('avisos chegam ao app; aviso direcionado só ao morador certo');

  // chat
  ok(await call('POST', '/api/app/chat', { body: 'Olá, tem encomenda?' }, T), 'msg morador');
  const chats = await call('GET', `/api/admin/condos/${cid}/chats`, null, O);
  assert.strictEqual(chats.body.find((x) => x.name === 'Maria Silva').unread, 1);
  ok(await call('POST', `/api/admin/condos/${cid}/chats/${rs.body.id}`, { body: 'Sim, na portaria.' }, O), 'msg operador');
  const thread = await call('GET', `/api/admin/condos/${cid}/chats/${rs.body.id}`, null, O);
  assert.deepStrictEqual(thread.body.map((x) => x.sender), ['resident', 'operator']);
  assert.strictEqual((await call('GET', `/api/admin/condos/${cid}/chats`, null, O)).body.find((x) => x.name === 'Maria Silva').unread, 0);
  const appChat = await call('GET', '/api/app/chat', null, T);
  assert.deepStrictEqual(appChat.body.map((x) => x.body), ['Olá, tem encomenda?', 'Sim, na portaria.']);
  assert.deepStrictEqual((await call('GET', '/api/app/chat', null, TJ)).body, [], 'João não vê a conversa da Maria');
  step('chat morador ⇄ operador (com não lidas e isolamento)');

  // mudança de config muda a versão
  const v1 = (await call('GET', '/api/app/poll?n=0&m=0', null, T)).body.version;
  await call('PUT', `/api/admin/condos/${cid}`, { colors: { primary: '#FF0000' } }, M);
  const v2 = (await call('GET', '/api/app/poll?n=0&m=0', null, T)).body.version;
  assert.notStrictEqual(v1, v2); step('mudança de design altera a versão da configuração (app re-sincroniza)');

  // desativar morador derruba sessão
  await call('PUT', `/api/admin/condos/${cid}/residents/${rs.body.id}`, { active: 0 }, A);
  code(await call('GET', '/api/app/config', null, T), 401, 'sessão derrubada'); step('desativar morador encerra a sessão do app');

  // senha do painel
  code(await call('POST', '/api/auth/password', { current: 'x', password: 'NovaSenha123' }, M), 403, 'senha atual errada');
  ok(await call('POST', '/api/auth/password', { current: 'SenhaMaster123', password: 'NovaSenha123' }, M), 'trocar senha');
  code(await call('GET', '/api/auth/me', null, M), 401, 'sessão antiga');
  ok(await call('POST', '/api/auth/login', { username: 'root', password: 'NovaSenha123' }), 'novo login'); step('troca de senha encerra sessões antigas');

  // painel web
  const html = await fetch(BASE + '/'); assert.strictEqual(html.status, 200); step('painel web é servido');

  console.log(`\n${t} verificações passaram`);
})().then(() => { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); })
  .catch((e) => { console.error('\nFALHOU:', e.stack); srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(1); });
