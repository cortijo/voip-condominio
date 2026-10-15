'use strict';
/* Painel do Interfone Virtual — administrador primário, administrador do condomínio e operador.
   Todo conteúdo dinâmico é inserido via textContent (h()), nunca como HTML. */

// ------------------------------------------------------------------ utilitários
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  const props = {};
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (['value', 'checked', 'disabled', 'selected'].includes(k)) props[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  Object.assign(el, props);
  return el;
}

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
};

const S = { token: store.get('tk'), user: null, condoId: null, condo: null, page: null, timers: [] };
const ROLE = { master: 'Administrador primário', condo_admin: 'Administrador do condomínio', operator: 'Operador' };
const KIND = { portaria: 'Portaria', morador: 'Morador', outro: 'Outro' };
const NKIND = { aviso: 'Aviso', encomenda: 'Encomenda', comunicado: 'Comunicado', urgente: 'Urgente' };

const fmt = (ts) => new Date(ts * 1000).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const root = document.getElementById('root');

function toast(msg, bad) {
  const t = h('div', { class: 'toast' + (bad ? ' bad' : '') }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), 3800);
}

async function api(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && S.token) { signOut(true); throw new Error(j.error || 'Sessão expirada'); }
  if (!r.ok) throw new Error(j.error || `Erro ${r.status}`);
  return j;
}

const cid = () => S.condoId;
const base = () => `/api/admin/condos/${cid()}`;
const isMaster = () => S.user.role === 'master';
const canManage = () => S.user.role !== 'operator';

// ------------------------------------------------------------------ componentes
function formModal({ title, fields, values = {}, submitLabel = 'Salvar', onSubmit, note }) {
  const inputs = [];
  const err = h('div', { class: 'err', hidden: true });

  const rows = fields.map((f) => {
    const v = values[f.k];
    let input;
    if (f.type === 'select') {
      input = h('select', { value: v ?? '' }, f.options.map((o) => h('option', { value: o.v }, o.l)));
    } else if (f.type === 'textarea') {
      input = h('textarea', { rows: 3, value: v ?? '', maxlength: f.max });
    } else if (f.type === 'checkbox') {
      input = h('input', { type: 'checkbox', checked: !!v });
    } else if (f.type === 'checks') {
      input = h('div', { class: 'checks' },
        f.options.length
          ? f.options.map((o) => h('label', { class: 'chk' },
            h('input', { type: 'checkbox', value: o.v, checked: (v || []).includes(o.v) }), ' ', o.l))
          : h('em', {}, f.empty || 'Nada cadastrado ainda.'));
    } else {
      input = h('input', {
        type: f.type || 'text', value: v ?? '', placeholder: f.placeholder, maxlength: f.max,
        autocomplete: f.type === 'password' ? 'new-password' : 'off',
      });
    }
    inputs.push({ f, input });
    const cls = 'field' + (f.type === 'checkbox' ? ' inline' : '');
    const kids = [h('span', {}, f.label), input, f.help && h('small', {}, f.help)];
    return f.type === 'checks' ? h('div', { class: cls }, ...kids) : h('label', { class: cls }, ...kids);
  });

  function collect() {
    const out = {};
    for (const { f, input } of inputs) {
      if (f.type === 'checkbox') out[f.k] = input.checked;
      else if (f.type === 'checks') out[f.k] = [...input.querySelectorAll('input:checked')].map((i) => Number(i.value));
      else if (f.num || f.type === 'number') out[f.k] = input.value === '' ? null : Number(input.value);
      else out[f.k] = input.value;
    }
    return out;
  }

  const bg = h('div', { class: 'modal-bg' });
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const save = h('button', { class: 'btn primary', type: 'submit' }, submitLabel);
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      save.disabled = true; err.hidden = true;
      try { await onSubmit(collect()); close(); } catch (ex) { err.textContent = ex.message; err.hidden = false; save.disabled = false; }
    },
  }, err, note && h('p', { class: 'sub' }, note), rows,
  h('div', { class: 'row end' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancelar'), save));
  bg.append(h('div', { class: 'modal' }, h('h3', {}, title), form));
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(bg);
  const first = bg.querySelector('input:not([type=checkbox]),select,textarea');
  if (first) first.focus();
}

function confirmBox(msg) { return window.confirm(msg); }

function table(cols, rows, emptyMsg = 'Nenhum registro.') {
  if (!rows.length) return h('div', { class: 'empty' }, emptyMsg);
  return h('div', { class: 'tbl-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, cols.map((c) => h('th', {}, c.h)))),
    h('tbody', {}, rows.map((r) => h('tr', {}, cols.map((c) => h('td', { class: c.act ? 'act' : '' }, c.f(r))))))));
}

const head = (title, sub, ...actions) => h('div', { class: 'head' },
  h('div', {}, h('h1', {}, title), sub && h('div', { class: 'sub' }, sub)),
  h('div', { class: 'row' }, actions));

const badge = (text, cls) => h('span', { class: 'badge ' + (cls || '') }, text);
const status = (active) => badge(active ? 'Ativo' : 'Inativo', active ? 'ok' : 'off');

// ------------------------------------------------------------------ sessão e layout
function signOut(expired) {
  if (S.token && !expired) api('POST', '/api/auth/logout').catch(() => {});
  S.token = null; S.user = null; S.condoId = null; S.condo = null;
  store.del('tk');
  clearTimers();
  Phone.stop();
  renderLogin(expired ? 'Sessão expirada. Entre novamente.' : '');
}

function clearTimers() { S.timers.forEach(clearInterval); S.timers = []; }
function every(ms, fn) { S.timers.push(setInterval(() => { fn().catch(() => {}); }, ms)); }

function renderLogin(msg) {
  const err = h('div', { class: 'err', hidden: !msg }, msg || '');
  const user = h('input', { autocomplete: 'username', placeholder: 'Usuário' });
  const pass = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Senha' });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Entrar');
  root.replaceChildren(h('div', { class: 'login-wrap' }, h('form', {
    class: 'login-card',
    onsubmit: async (e) => {
      e.preventDefault(); btn.disabled = true; err.hidden = true;
      try {
        const r = await api('POST', '/api/auth/login', { username: user.value, password: pass.value });
        S.token = r.token; store.set('tk', r.token);
        await start(r.user);
      } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
    },
  }, h('div', { class: 'brand' }, h('i', {}, 'IV'), h('h1', {}, 'Interfone Virtual')),
  err, user, pass, btn)));
  user.focus();
}

async function start(user) {
  S.user = user;
  S.condoId = user.condo_id || null;
  if (S.condoId) S.condo = await api('GET', base());
  renderShell();
  go(defaultPage());
  Phone.init();
}

function defaultPage() {
  if (isMaster()) return S.condoId ? 'design' : 'condos';
  return S.user.role === 'operator' ? 'notices' : 'residents';
}

function navItems() {
  if (isMaster() && !S.condoId) return [['condos', 'Condomínios']];
  const n = [];
  if (isMaster()) n.push(['design', 'Design e informações'], ['voip', 'Servidor VoIP']);
  if (canManage()) n.push(['residents', 'Moradores'], ['groups', 'Grupos de acesso'], ['portaria', 'Ramal da portaria'], ['extensions', 'Ramais VoIP'], ['cameras', 'Câmeras']);
  else n.push(['residents', 'Moradores']);
  n.push(['notices', 'Avisos e push'], ['chat', 'Chat com moradores'], ['devices', 'Aplicativos conectados']);
  if (!isMaster()) n.push(['phone', 'Telefone']);
  if (canManage()) n.push(['team', 'Equipe do painel']);
  return n;
}

function buildSide() {
  const nav = navItems().map(([id, label]) =>
    h('button', { class: 'nav' + (S.page === id ? ' on' : ''), onclick: () => go(id) }, label));
  return h('aside', { class: 'side' },
    h('div', { class: 'brand' }, 'Interfone Virtual'),
    h('div', { class: 'who' }, `${S.user.name || S.user.username}`, h('br'), ROLE[S.user.role],
      S.condo && !isMaster() ? [h('br'), S.condo.name] : null),
    nav, h('div', { class: 'grow' }), h('div', { class: 'sep' }),
    h('button', { class: 'nav' + (S.page === 'account' ? ' on' : ''), onclick: () => go('account') }, 'Minha conta'),
    h('button', { class: 'nav', onclick: () => signOut() }, 'Sair'));
}

function renderShell() {
  root.replaceChildren(h('div', { class: 'app' }, buildSide(), h('main', { class: 'main', id: 'view' })));
}

const PAGES = {};

async function go(page) {
  clearTimers();
  S.page = page;
  if (!document.getElementById('view')) renderShell();
  else document.querySelector('.side').replaceWith(buildSide());
  const view = document.getElementById('view');
  view.replaceChildren(h('div', { class: 'empty' }, 'Carregando…'));
  try {
    const parts = [];
    if (isMaster() && S.condoId && page !== 'condos') parts.push(condoBar());
    parts.push(await PAGES[page]());
    if (S.page === page) view.replaceChildren(...parts); // ignora respostas de páginas já abandonadas
  } catch (ex) {
    if (S.page === page) view.replaceChildren(h('div', { class: 'err' }, ex.message));
  }
}

function condoBar() {
  return h('div', { class: 'crumb' },
    h('button', { class: 'btn sm', onclick: () => { S.condoId = null; S.condo = null; renderShell(); go('condos'); } }, '← Condomínios'),
    h('span', {}, 'Gerenciando: ', h('b', {}, S.condo ? S.condo.name : '')));
}

async function refreshCondo() { S.condo = await api('GET', base()); return S.condo; }

// ------------------------------------------------------------------ condomínios (primário)
PAGES.condos = async () => {
  const list = await api('GET', '/api/admin/condos');
  const open = async (c) => { S.condoId = c.id; S.condo = c; renderShell(); go('design'); };
  return h('div', {},
    head('Condomínios', 'Cadastre e administre os condomínios atendidos.',
      h('button', {
        class: 'btn primary',
        onclick: () => formModal({
          title: 'Novo condomínio',
          fields: [
            { k: 'name', label: 'Nome do condomínio', max: 100 },
            { k: 'code', label: 'Código do condomínio (opcional)', max: 32, help: 'Deixe em branco para gerar automaticamente. Os moradores digitam esse código no app.' },
          ],
          submitLabel: 'Criar',
          onSubmit: async (v) => { const c = await api('POST', '/api/admin/condos', v); toast('Condomínio criado — código: ' + c.code); open(c); },
        }),
      }, '+ Novo condomínio')),
    h('div', { class: 'card' }, table([
      { h: 'Nome', f: (c) => h('b', {}, c.name) },
      { h: 'Código', f: (c) => c.code },
      { h: 'Moradores', f: (c) => c.residents },
      { h: 'Câmeras', f: (c) => c.cameras },
      { h: 'Ramais', f: (c) => c.extensions },
      { h: 'Status', f: (c) => status(c.active) },
      { h: '', act: true, f: (c) => h('div', { class: 'row', style: 'justify-content:flex-end' },
        h('button', { class: 'btn sm primary', onclick: () => open(c) }, 'Gerenciar'),
        h('button', {
          class: 'btn sm danger',
          onclick: async () => {
            if (!confirmBox(`Excluir "${c.name}" e TODOS os seus dados (moradores, ramais, câmeras, avisos, chat)? Não pode ser desfeito.`)) return;
            await api('DELETE', `/api/admin/condos/${c.id}`); toast('Condomínio excluído'); go('condos');
          },
        }, 'Excluir')) },
    ], list, 'Nenhum condomínio cadastrado. Clique em "Novo condomínio".')));
};

// ------------------------------------------------------------------ design (primário)
const COLOR_LABELS = [
  ['primary', 'Cor principal'], ['onPrimary', 'Texto sobre a cor principal'],
  ['background', 'Fundo'], ['surface', 'Cartões e barras'],
  ['surfaceAlt', 'Cartões secundários'], ['text', 'Texto'],
];

function downscaleToPng(file, max = 1024) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Arquivo de imagem inválido.'));
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * k));
        c.height = Math.max(1, Math.round(img.height * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/png'));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

PAGES.design = async () => {
  const c = await refreshCondo();
  const colors = { ...c.colors };
  let stamp = Date.now();
  const f = {
    name: h('input', { value: c.name, maxlength: 100 }),
    code: h('input', { value: c.code, maxlength: 32 }),
    phone: h('input', { value: c.phone, maxlength: 40 }),
    info: h('textarea', { rows: 3, value: c.info, maxlength: 1000 }),
    active: h('input', { type: 'checkbox', checked: !!c.active }),
  };

  const phone = h('div', { class: 'phone' });
  const ava = h('div', { class: 'logo-big' });
  const nameEl = h('div', { class: 'cname' }, h('b', {}));
  function paint() {
    phone.style.setProperty('--p-bg', colors.background);
    phone.style.setProperty('--p-surface', colors.surface);
    phone.style.setProperty('--p-alt', colors.surfaceAlt);
    phone.style.setProperty('--p-text', colors.text);
    phone.style.setProperty('--p-primary', colors.primary);
    phone.style.setProperty('--p-on', colors.onPrimary);
    nameEl.firstChild.textContent = f.name.value || 'Condomínio';
    ava.replaceChildren(c.logoUrl ? h('img', { src: c.logoUrl + '?t=' + stamp, alt: '' }) : h('span', { class: 'ini' }, (f.name.value || 'C').slice(0, 1).toUpperCase()));
  }
  phone.append(
    h('div', { class: 'bar' }, 'Interfone Virtual'),
    h('div', { class: 'who' }, ava, nameEl, h('div', { class: 'uname' }, 'Nome do morador'), h('small', {}, 'BLOCO A · 101')),
    h('div', { class: 'it' }, 'FALAR COM MORADOR'),
    h('div', { class: 'it' }, 'FALAR COM A PORTARIA'),
    h('div', { class: 'cta' }, 'VER CÂMERAS'),
    h('div', { class: 'tabs' }, h('b', {}, 'Início'), h('span', {}, 'Conversas'), h('span', {}, 'Avisos'), h('span', {}, 'Câmeras')));

  const colorInputs = COLOR_LABELS.map(([k, label]) => h('label', {},
    h('input', { type: 'color', value: colors[k], oninput: (e) => { colors[k] = e.target.value.toUpperCase(); paint(); } }), label));
  f.name.addEventListener('input', paint);

  const thumb = h('div', { class: 'thumb' });
  function paintLogo() { thumb.replaceChildren(c.logoUrl ? h('img', { src: c.logoUrl + '?t=' + stamp, alt: 'Logotipo' }) : 'Sem logo'); paint(); }
  const fileIn = h('input', {
    type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true,
    onchange: async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try {
        const data = await downscaleToPng(file);
        const r = await api('POST', `${base()}/logo`, { data });
        c.logoUrl = r.logoUrl; stamp = Date.now(); paintLogo(); toast('Logotipo atualizado');
      } catch (ex) { toast(ex.message, true); }
      fileIn.value = '';
    },
  });
  paintLogo();

  const err = h('div', { class: 'err', hidden: true });
  const save = h('button', {
    class: 'btn primary',
    onclick: async () => {
      err.hidden = true; save.disabled = true;
      try {
        await api('PUT', base(), {
          name: f.name.value, code: f.code.value, phone: f.phone.value, info: f.info.value, active: f.active.checked, colors,
        });
        await refreshCondo(); toast('Design e informações salvos — os apps sincronizam em instantes.');
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
      save.disabled = false;
    },
  }, 'Salvar');

  return h('div', {},
    head('Design e informações', 'Identidade do condomínio exibida no aplicativo dos moradores.'),
    h('div', { class: 'grid2' },
      h('div', {},
        h('div', { class: 'card' }, h('h2', {}, 'Condomínio'), err,
          h('div', { class: 'cols2' },
            h('label', { class: 'field' }, h('span', {}, 'Nome (aparece no app)'), f.name),
            h('label', { class: 'field' }, h('span', {}, 'Código de acesso'), f.code, h('small', {}, 'Moradores digitam no app.'))),
          h('div', { class: 'cols2' },
            h('label', { class: 'field' }, h('span', {}, 'Telefone'), f.phone),
            h('label', { class: 'field inline' }, h('span', {}, 'Condomínio ativo'), f.active)),
          h('label', { class: 'field' }, h('span', {}, 'Endereço / informações'), f.info)),
        h('div', { class: 'card' }, h('h2', {}, 'Logotipo'),
          h('div', { class: 'logo-box' }, thumb, h('div', { class: 'row' },
            h('button', { class: 'btn', onclick: () => fileIn.click() }, 'Enviar imagem'),
            h('button', {
              class: 'btn danger',
              onclick: async () => { await api('DELETE', `${base()}/logo`); c.logoUrl = null; paintLogo(); toast('Logotipo removido'); },
            }, 'Remover'), fileIn)),
          h('small', { class: 'sub' }, 'PNG, JPEG ou WEBP. Use o logotipo sem fundo (PNG transparente). Ele aparece grande na tela inicial do app, sem moldura. Reduzido para no máximo 1024 px.')),
        h('div', { class: 'card' }, h('h2', {}, 'Cores do aplicativo'), h('div', { class: 'colors' }, colorInputs)),
        h('div', { class: 'row' }, save),
        h('div', { class: 'card', style: 'margin-top:18px' }, h('h2', {}, 'Dados para configurar o app'),
          h('p', { class: 'sub' }, 'No aplicativo, o morador informa:'),
          h('div', {}, 'Servidor: ', h('b', {}, location.origin)),
          h('div', {}, 'Código do condomínio: ', h('b', {}, c.code)),
          h('div', {}, 'Usuário e senha: os cadastrados em "Moradores".'))),
      h('div', {}, h('div', { class: 'card' }, h('h2', {}, 'Pré-visualização'), phone))));
};

// ------------------------------------------------------------------ servidor VoIP (primário)
PAGES.voip = async () => {
  const c = await refreshCondo();
  const host = h('input', { value: c.sip_host, placeholder: 'ex: 192.168.1.10 ou pbx.exemplo.com.br', maxlength: 200 });
  const port = h('input', { type: 'number', value: c.sip_port, min: 1, max: 65535 });
  const tr = h('select', { value: c.sip_transport }, ['UDP', 'TCP'].map((t) => h('option', { value: t }, t)));
  const wss = h('input', { value: c.wss_url || '', placeholder: 'wss://pbx.exemplo.com.br:8089/ws', maxlength: 200 });
  const err = h('div', { class: 'err', hidden: true });
  return h('div', {},
    head('Servidor VoIP (Issabel/Asterisk)', 'Para onde os apps deste condomínio se registram.'),
    h('div', { class: 'card', style: 'max-width:560px' }, err,
      h('label', { class: 'field' }, h('span', {}, 'Servidor (IP ou domínio)'), host),
      h('div', { class: 'cols2' },
        h('label', { class: 'field' }, h('span', {}, 'Porta SIP'), port),
        h('label', { class: 'field' }, h('span', {}, 'Transporte'), tr)),
      h('label', { class: 'field' }, h('span', {}, 'URL WebSocket para o telefone do navegador (opcional)'), wss,
        h('small', {}, 'Necessária só para o telefone do painel do operador. No Issabel/Asterisk 16+: transporte WSS (porta 8089, caminho /ws) e ramais PJSIP com WebRTC habilitado.')),
      h('p', { class: 'sub' }, 'Os ramais (número e senha) são cadastrados em "Ramais VoIP" e vinculados a cada morador. O app recebe tudo automaticamente.'),
      h('button', {
        class: 'btn primary',
        onclick: async () => {
          err.hidden = true;
          try {
            await api('PUT', base(), { sip_host: host.value.trim(), sip_port: Number(port.value), sip_transport: tr.value, wss_url: wss.value.trim() });
            toast('Servidor VoIP salvo');
          } catch (ex) { err.textContent = ex.message; err.hidden = false; }
        },
      }, 'Salvar')));
};

// ------------------------------------------------------------------ equipe do painel
PAGES.team = async () => {
  const [users, allExts] = await Promise.all([api('GET', `${base()}/users`), api('GET', `${base()}/extensions`)]);
  const roles = isMaster() ? [['condo_admin', 'Administrador do condomínio'], ['operator', 'Operador']] : [['operator', 'Operador']];
  const roleOpts = roles.map(([v, l]) => ({ v, l }));
  const editable = (u) => isMaster() || u.role === 'operator';
  const reload = () => go('team');
  const fields = (isNew) => [
    { k: 'name', label: 'Nome', max: 100 },
    ...(isNew ? [{ k: 'username', label: 'Usuário de acesso', max: 40, help: 'Letras, números, ponto, hífen ou sublinhado.' }] : []),
    { k: 'role', label: 'Perfil', type: 'select', options: roleOpts },
    { k: 'extension_id', num: true, label: 'Ramal no navegador (telefone do painel)', type: 'select',
      options: [{ v: '', l: '— sem ramal —' }, ...allExts.filter((e) => e.kind !== 'morador').map((e) => ({ v: e.id, l: `${e.number} — ${e.label || KIND[e.kind]}` }))],
      help: 'Cadastre antes um ramal do tipo Portaria ou Outro em "Ramal da portaria". Cada ramal serve a um único usuário.' },
    { k: 'password', label: isNew ? 'Senha (mín. 8 caracteres)' : 'Nova senha (deixe em branco para manter)', type: 'password', max: 100 },
    ...(isNew ? [] : [{ k: 'active', label: 'Ativo', type: 'checkbox' }]),
  ];
  return h('div', {},
    head('Equipe do painel', 'Administradores e operadores que acessam este painel.',
      h('button', {
        class: 'btn primary',
        onclick: () => formModal({
          title: 'Novo usuário do painel', fields: fields(true), values: { role: roles[0][0] }, submitLabel: 'Criar',
          onSubmit: async (v) => { await api('POST', `${base()}/users`, v); toast('Usuário criado'); reload(); },
        }),
      }, '+ Novo usuário')),
    h('div', { class: 'card' }, table([
      { h: 'Nome', f: (u) => h('b', {}, u.name) },
      { h: 'Usuário', f: (u) => u.username },
      { h: 'Perfil', f: (u) => ROLE[u.role] },
      { h: 'Ramal', f: (u) => u.ext_number || h('em', {}, '—') },
      { h: 'Status', f: (u) => status(u.active) },
      { h: '', act: true, f: (u) => !editable(u) || u.id === S.user.id ? '' : h('div', { class: 'row', style: 'justify-content:flex-end' },
        h('button', {
          class: 'btn sm',
          onclick: () => formModal({
            title: `Editar ${u.name}`, fields: fields(false), values: { ...u, password: '' },
            onSubmit: async (v) => { await api('PUT', `${base()}/users/${u.id}`, v); toast('Salvo'); reload(); },
          }),
        }, 'Editar'),
        h('button', {
          class: 'btn sm danger',
          onclick: async () => { if (!confirmBox(`Excluir o usuário "${u.name}"?`)) return; await api('DELETE', `${base()}/users/${u.id}`); reload(); },
        }, 'Excluir')) },
    ], users)));
};

// ------------------------------------------------------------------ ramais
PAGES.extensions = async () => {
  const list = await api('GET', `${base()}/extensions`);
  const reload = () => go('extensions');
  const fields = [
    { k: 'number', label: 'Número do ramal', max: 32, help: 'Exatamente como no Issabel (ex: 1001).' },
    { k: 'secret', label: 'Senha do ramal (secret)', type: 'text', max: 128, help: 'Necessária se este ramal for usado por um morador no app.' },
    { k: 'label', label: 'Descrição (nome exibido)', max: 100, placeholder: 'ex: Apto 101 — Maria' },
    { k: 'block', label: 'Bloco / grupo (para agrupar na lista do app)', max: 50, placeholder: 'ex: BLOCO A' },
    { k: 'kind', label: 'Tipo', type: 'select', options: Object.entries(KIND).map(([v, l]) => ({ v, l })) },
  ];
  return h('div', {},
    head('Ramais VoIP', 'Ramais do Issabel disponíveis neste condomínio.',
      h('button', {
        class: 'btn primary',
        onclick: () => formModal({
          title: 'Novo ramal', fields, values: { kind: 'morador' }, submitLabel: 'Criar',
          onSubmit: async (v) => { await api('POST', `${base()}/extensions`, v); toast('Ramal criado'); reload(); },
        }),
      }, '+ Novo ramal')),
    h('div', { class: 'card' }, table([
      { h: 'Ramal', f: (e) => h('b', {}, e.number) },
      { h: 'Descrição', f: (e) => e.label },
      { h: 'Bloco', f: (e) => e.block },
      { h: 'Tipo', f: (e) => badge(KIND[e.kind]) },
      { h: 'Senha', f: (e) => (e.secret ? '••••••' : h('em', {}, 'não definida')) },
      { h: '', act: true, f: (e) => h('div', { class: 'row', style: 'justify-content:flex-end' },
        h('button', {
          class: 'btn sm',
          onclick: () => formModal({
            title: `Editar ramal ${e.number}`, fields, values: e,
            onSubmit: async (v) => { await api('PUT', `${base()}/extensions/${e.id}`, v); toast('Salvo'); reload(); },
          }),
        }, 'Editar'),
        h('button', {
          class: 'btn sm danger',
          onclick: async () => { if (!confirmBox(`Excluir o ramal ${e.number}?`)) return; await api('DELETE', `${base()}/extensions/${e.id}`); reload(); },
        }, 'Excluir')) },
    ], list, 'Nenhum ramal cadastrado.')));
};

// ------------------------------------------------------------------ câmeras
PAGES.cameras = async () => {
  const list = await api('GET', `${base()}/cameras`);
  const reload = () => go('cameras');
  const fields = [
    { k: 'name', label: 'Nome da câmera', max: 100, placeholder: 'ex: Portaria principal' },
    { k: 'url', label: 'URL do vídeo', max: 500, placeholder: 'rtsp://192.168.1.50:554/stream1', help: 'RTSP, HLS (.m3u8) ou HTTP. A câmera precisa ser alcançável pelo celular do morador.' },
    { k: 'username', label: 'Usuário (opcional)', max: 100 },
    { k: 'password', label: 'Senha (opcional)', type: 'text', max: 200 },
  ];
  return h('div', {},
    head('Câmeras', 'Câmeras disponíveis para visualização no app (conforme o grupo de cada morador).',
      h('button', {
        class: 'btn primary',
        onclick: () => formModal({
          title: 'Nova câmera', fields, submitLabel: 'Criar',
          onSubmit: async (v) => { await api('POST', `${base()}/cameras`, v); toast('Câmera criada'); reload(); },
        }),
      }, '+ Nova câmera')),
    h('div', { class: 'card' }, table([
      { h: 'Nome', f: (c) => h('b', {}, c.name) },
      { h: 'URL', f: (c) => c.url },
      { h: 'Acesso', f: (c) => (c.username ? c.username : h('em', {}, 'sem login')) },
      { h: '', act: true, f: (c) => h('div', { class: 'row', style: 'justify-content:flex-end' },
        h('button', {
          class: 'btn sm',
          onclick: () => formModal({
            title: `Editar ${c.name}`, fields, values: c,
            onSubmit: async (v) => { await api('PUT', `${base()}/cameras/${c.id}`, v); toast('Salvo'); reload(); },
          }),
        }, 'Editar'),
        h('button', {
          class: 'btn sm danger',
          onclick: async () => { if (!confirmBox(`Excluir a câmera "${c.name}"?`)) return; await api('DELETE', `${base()}/cameras/${c.id}`); reload(); },
        }, 'Excluir')) },
    ], list, 'Nenhuma câmera cadastrada.')));
};

// ------------------------------------------------------------------ grupos de acesso
PAGES.groups = async () => {
  const [groups, cams, exts] = await Promise.all([
    api('GET', `${base()}/groups`), api('GET', `${base()}/cameras`), api('GET', `${base()}/extensions`)]);
  const reload = () => go('groups');
  const fields = [
    { k: 'name', label: 'Nome do grupo', max: 80, placeholder: 'ex: Moradores, Síndico, Funcionários' },
    { k: 'camera_ids', label: 'Câmeras que o grupo pode ver', type: 'checks', options: cams.map((c) => ({ v: c.id, l: c.name })), empty: 'Cadastre câmeras primeiro.' },
    { k: 'extension_ids', label: 'Ramais que o grupo pode chamar', type: 'checks', options: exts.map((e) => ({ v: e.id, l: `${e.number} — ${e.label || KIND[e.kind]}${e.block ? ' (' + e.block + ')' : ''}` })), empty: 'Cadastre ramais primeiro.' },
  ];
  return h('div', {},
    head('Grupos de acesso', 'Cada morador pertence a um grupo, que define quais câmeras vê e quais ramais pode chamar.',
      h('button', {
        class: 'btn primary',
        onclick: () => formModal({
          title: 'Novo grupo', fields, submitLabel: 'Criar',
          onSubmit: async (v) => { await api('POST', `${base()}/groups`, v); toast('Grupo criado'); reload(); },
        }),
      }, '+ Novo grupo')),
    h('div', { class: 'card' }, table([
      { h: 'Grupo', f: (g) => h('b', {}, g.name) },
      { h: 'Câmeras', f: (g) => g.camera_ids.length },
      { h: 'Ramais', f: (g) => g.extension_ids.length },
      { h: 'Moradores', f: (g) => g.members },
      { h: '', act: true, f: (g) => h('div', { class: 'row', style: 'justify-content:flex-end' },
        h('button', {
          class: 'btn sm',
          onclick: () => formModal({
            title: `Editar grupo ${g.name}`, fields, values: g,
            onSubmit: async (v) => { await api('PUT', `${base()}/groups/${g.id}`, v); toast('Salvo'); reload(); },
          }),
        }, 'Editar'),
        h('button', {
          class: 'btn sm danger',
          onclick: async () => {
            if (!confirmBox(`Excluir o grupo "${g.name}"? Os moradores dele ficarão sem câmeras e sem ramais.`)) return;
            await api('DELETE', `${base()}/groups/${g.id}`); reload();
          },
        }, 'Excluir')) },
    ], groups, 'Nenhum grupo criado.')));
};

// ------------------------------------------------------------------ moradores
PAGES.residents = async () => {
  const manage = canManage();
  const [list, groups, exts] = await Promise.all([
    api('GET', `${base()}/residents`),
    manage ? api('GET', `${base()}/groups`) : [],
    manage ? api('GET', `${base()}/extensions`) : [],
  ]);
  const reload = () => go('residents');
  const fields = (isNew) => [
    { k: 'name', label: 'Nome', max: 100 },
    { k: 'block', label: 'Bloco', max: 50, placeholder: 'ex: BLOCO A' },
    { k: 'unit', label: 'Apartamento / casa', max: 30 },
    { k: 'username', label: 'Usuário de acesso ao app', max: 40, help: 'Letras, números, ponto, hífen ou sublinhado.' },
    { k: 'password', label: isNew ? 'Senha (mín. 6 caracteres)' : 'Nova senha (deixe em branco para manter)', type: 'password', max: 100 },
    { k: 'group_id', num: true, label: 'Grupo de acesso', type: 'select',
      options: [{ v: '', l: '— sem grupo (sem câmeras e sem ramais) —' }, ...groups.map((g) => ({ v: g.id, l: g.name }))] },
    { k: 'extension_id', num: true, label: 'Ramal deste morador (para ligar/receber)', type: 'select',
      options: [{ v: '', l: '— sem ramal —' }, ...exts.filter((e) => e.kind !== 'portaria').map((e) => ({ v: e.id, l: `${e.number} — ${e.label || KIND[e.kind]}` }))] },
    { k: 'active', label: 'Ativo', type: 'checkbox' },
  ];
  const actions = manage ? [h('button', {
    class: 'btn primary',
    onclick: () => formModal({
      title: 'Novo morador', fields: fields(true), values: { active: true }, submitLabel: 'Criar',
      onSubmit: async (v) => { await api('POST', `${base()}/residents`, v); toast('Morador criado'); reload(); },
    }),
  }, '+ Novo morador')] : [];
  const cols = [
    { h: 'Nome', f: (r) => h('b', {}, r.name) },
    { h: 'Bloco / Apto', f: (r) => [r.block, r.unit].filter(Boolean).join(' · ') },
    { h: 'Usuário', f: (r) => r.username },
    { h: 'Grupo', f: (r) => r.group_name || h('em', {}, '—') },
    { h: 'Ramal', f: (r) => r.ext_number || h('em', {}, '—') },
    { h: 'Status', f: (r) => status(r.active) },
  ];
  if (manage) cols.push({ h: '', act: true, f: (r) => h('div', { class: 'row', style: 'justify-content:flex-end' },
    h('button', {
      class: 'btn sm',
      onclick: () => formModal({
        title: `Editar ${r.name}`, fields: fields(false), values: { ...r, password: '', active: !!r.active },
        onSubmit: async (v) => { await api('PUT', `${base()}/residents/${r.id}`, v); toast('Salvo'); reload(); },
      }),
    }, 'Editar'),
    h('button', {
      class: 'btn sm danger',
      onclick: async () => { if (!confirmBox(`Excluir o morador "${r.name}"?`)) return; await api('DELETE', `${base()}/residents/${r.id}`); reload(); },
    }, 'Excluir')) });
  return h('div', {},
    head('Moradores', 'Usuários do aplicativo.', ...actions),
    h('div', { class: 'card' }, table(cols, list, 'Nenhum morador cadastrado.')));
};

// ------------------------------------------------------------------ avisos e push
async function showReads(n) {
  const r = await api('GET', `${base()}/notices/${n.id}/reads`).catch((e) => { toast(e.message, true); return null; });
  if (!r) return;
  const who = (x) => [h('b', {}, x.name), h('small', { class: 'sub' }, ' ' + [x.block, x.unit].filter(Boolean).join(' · '))];
  const bg = h('div', { class: 'modal-bg' });
  const close = () => bg.remove();
  bg.append(h('div', { class: 'modal' },
    h('h3', {}, n.title),
    h('h2', {}, `Já viram (${r.seen.length})`),
    r.seen.length ? h('ul', { class: 'plain' }, r.seen.map((x) => h('li', {}, who(x), h('span', { class: 'badge ok' }, '✓ ' + fmt(x.read_at))))) : h('div', { class: 'empty' }, 'Ninguém viu ainda.'),
    h('h2', { style: 'margin-top:14px' }, `Ainda não viram (${r.pending.length})`),
    r.pending.length ? h('ul', { class: 'plain' }, r.pending.map((x) => h('li', {}, who(x), h('span', { class: 'badge' }, 'pendente')))) : h('div', { class: 'empty' }, 'Todos já viram.'),
    h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: close }, 'Fechar'))));
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  document.body.append(bg);
}

PAGES.notices = async () => {
  const [list, residents] = await Promise.all([api('GET', `${base()}/notices`), api('GET', `${base()}/residents`)]);
  const kind = h('select', {}, Object.entries(NKIND).map(([v, l]) => h('option', { value: v }, l)));
  const to = h('select', {}, h('option', { value: '' }, 'Todos os moradores'),
    residents.filter((r) => r.active).map((r) => h('option', { value: r.id }, `${r.name}${r.block || r.unit ? ' — ' + [r.block, r.unit].filter(Boolean).join(' ') : ''}`)));
  const title = h('input', { maxlength: 120, placeholder: 'Título' });
  const body = h('textarea', { rows: 3, maxlength: 2000, placeholder: 'Mensagem' });
  const err = h('div', { class: 'err', hidden: true });
  const send = h('button', {
    class: 'btn primary',
    onclick: async () => {
      err.hidden = true; send.disabled = true;
      try {
        await api('POST', `${base()}/notices`, { kind: kind.value, title: title.value, body: body.value, resident_id: to.value === '' ? null : Number(to.value) });
        toast('Aviso enviado — chega ao aparelho em instantes.'); go('notices');
      } catch (ex) { err.textContent = ex.message; err.hidden = false; send.disabled = false; }
    },
  }, 'Enviar aviso');
  const tpl = (k, t, b) => h('button', {
    class: 'btn sm', type: 'button',
    onclick: () => { kind.value = k; title.value = t; body.value = b; },
  }, t);

  return h('div', {},
    head('Avisos e notificações push', 'Aparecem no mural do app e geram uma notificação no celular do morador.'),
    h('div', { class: 'card' }, h('h2', {}, 'Novo aviso'), err,
      h('div', { class: 'row', style: 'margin-bottom:12px' }, h('span', { class: 'sub' }, 'Modelos:'),
        tpl('encomenda', 'Você tem uma encomenda', 'Sua encomenda chegou na portaria. Retire quando possível.'),
        tpl('aviso', 'Visitante na portaria', 'Há um visitante aguardando na portaria.'),
        tpl('urgente', 'Aviso urgente', ''),
        tpl('comunicado', 'Comunicado do condomínio', '')),
      h('div', { class: 'cols2' },
        h('label', { class: 'field' }, h('span', {}, 'Tipo'), kind),
        h('label', { class: 'field' }, h('span', {}, 'Destinatário'), to)),
      h('label', { class: 'field' }, h('span', {}, 'Título'), title),
      h('label', { class: 'field' }, h('span', {}, 'Mensagem'), body), send),
    h('div', { class: 'card' }, h('h2', {}, 'Enviados recentemente'), table([
      { h: 'Data', f: (n) => fmt(n.created_at) },
      { h: 'Tipo', f: (n) => badge(NKIND[n.kind] || n.kind, n.kind) },
      { h: 'Para', f: (n) => n.resident_name || 'Todos' },
      { h: 'Aviso', f: (n) => [h('b', {}, n.title), n.body ? h('div', { class: 'sub' }, n.body) : null] },
      { h: 'Visto', f: (n) => h('button', {
        class: 'btn sm' + (n.seen_count >= n.target_count && n.target_count ? ' seen-all' : ''), title: 'Ver quem já viu',
        onclick: () => showReads(n),
      }, `✓ ${n.seen_count}/${n.target_count}`) },
      { h: 'Por', f: (n) => n.author || '' },
      { h: '', act: true, f: (n) => h('button', {
        class: 'btn sm danger',
        onclick: async () => { if (!confirmBox('Excluir este aviso?')) return; await api('DELETE', `${base()}/notices/${n.id}`); go('notices'); },
      }, 'Excluir') },
    ], list, 'Nenhum aviso enviado.')));
};

// ------------------------------------------------------------------ chat
function blobToB64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('Falha ao ler o arquivo.'));
    fr.onload = () => resolve(String(fr.result).split(',')[1]);
    fr.readAsDataURL(blob);
  });
}

function downscaleToJpeg(file, max = 1280) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Arquivo de imagem inválido.')); };
    img.onload = () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k));
      c.height = Math.max(1, Math.round(img.height * k));
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.82).split(',')[1]);
    };
    img.src = url;
  });
}

PAGES.chat = async () => {
  let cur = null;
  let lastId = 0;
  const list = h('div', { class: 'chat-list' });
  const title = h('div', { class: 'chat-title' }, 'Selecione um morador');
  const msgs = h('div', { class: 'chat-msgs' });
  const input = h('input', { placeholder: 'Escreva uma mensagem…', maxlength: 2000, disabled: true });
  const sendBtn = h('button', { class: 'btn primary', type: 'submit', disabled: true }, 'Enviar');

  function bubble(m) {
    const content = m.kind === 'image' || m.kind === 'audio' ? mediaNode(m) : m.body;
    return h('div', { class: 'bubble' + (m.sender === 'operator' ? ' op' : '') }, content,
      h('small', {}, `${m.sender === 'operator' ? (m.operator_name || 'Operador') : cur.name} · ${fmt(m.created_at)}`));
  }

  async function loadList() {
    const rows = await api('GET', `${base()}/chats`);
    list.replaceChildren(...rows.map((r) => h('button', {
      class: 'chat-item' + (cur && cur.id === r.id ? ' on' : ''),
      onclick: () => open(r),
    }, h('b', {}, r.name, r.unread ? h('span', { class: 'dot' }, r.unread) : null),
    h('small', {}, [r.block, r.unit].filter(Boolean).join(' · ') || ' '),
    h('small', {}, r.last_body || 'Sem mensagens'))));
    if (!rows.length) list.replaceChildren(h('div', { class: 'empty' }, 'Nenhum morador cadastrado.'));
  }

  // anexos só saem por rota autenticada: baixa com o token e mostra via blob
  function mediaNode(m) {
    const rid = cur.id;
    const holder = h('div', { class: 'media' }, h('em', {}, m.kind === 'image' ? 'Carregando imagem…' : 'Carregando áudio…'));
    fetch(`${base()}/chats/${rid}/file/${m.id}`, { headers: { Authorization: 'Bearer ' + S.token } })
      .then((r) => { if (!r.ok) throw new Error(); return r.blob(); })
      .then((b) => {
        const url = URL.createObjectURL(b);
        holder.replaceChildren(m.kind === 'image'
          ? h('img', { src: url, alt: 'Foto', onclick: () => window.open(url, '_blank', 'noopener') })
          : h('audio', { src: url, controls: true, preload: 'metadata' }));
      })
      .catch(() => holder.replaceChildren(h('em', {}, 'Anexo indisponível')));
    return holder;
  }

  async function sendMedia(kind, data) {
    if (!cur) return;
    try { await api('POST', `${base()}/chats/${cur.id}/media`, { kind, data }); await pull(); await loadList(); } catch (ex) { toast(ex.message, true); }
  }

  const fileIn = h('input', {
    type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true,
    onchange: async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try { await sendMedia('image', await downscaleToJpeg(f)); } catch (ex) { toast(ex.message, true); }
    },
  });
  const photoBtn = h('button', { class: 'btn', type: 'button', title: 'Enviar foto', disabled: true, onclick: () => fileIn.click() }, '📷');

  // gravação de áudio (MediaRecorder; exige HTTPS por causa do microfone)
  let rec = null;
  const micBtn = h('button', { class: 'btn', type: 'button', title: 'Gravar áudio', disabled: true, onclick: () => toggleRec() }, '🎤');
  async function toggleRec() {
    if (rec) { rec.stop(); return; }
    if (!navigator.mediaDevices || !window.MediaRecorder || !window.isSecureContext) {
      return toast('Gravar áudio exige HTTPS (porta 9671) e um navegador compatível.', true);
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 });
      const parts = [];
      const started = Date.now();
      const target = cur;
      mr.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        clearTimeout(limit);
        rec = null; micBtn.classList.remove('rec'); micBtn.textContent = '🎤';
        if (Date.now() - started < 700 || cur !== target) return;
        const blob = new Blob(parts, { type: mr.mimeType });
        if (blob.size > 2.8 * 1024 * 1024) return toast('Áudio muito longo.', true);
        await sendMedia('audio', await blobToB64(blob));
      };
      const limit = setTimeout(() => { if (rec) rec.stop(); }, 120000);
      mr.start();
      rec = mr; micBtn.classList.add('rec'); micBtn.textContent = '⏹ Enviar';
    } catch (ex) { toast('Não foi possível usar o microfone: ' + ex.message, true); }
  }

  async function pull() {
    if (!cur) return;
    const items = await api('GET', `${base()}/chats/${cur.id}?after=${lastId}`);
    if (!items.length) return;
    const nearBottom = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 80 || lastId === 0;
    items.forEach((m) => { msgs.append(bubble(m)); lastId = Math.max(lastId, m.id); });
    if (nearBottom) msgs.scrollTop = msgs.scrollHeight;
  }

  async function open(r) {
    cur = r; lastId = 0;
    title.textContent = `${r.name}${r.block || r.unit ? ' — ' + [r.block, r.unit].filter(Boolean).join(' ') : ''}`;
    msgs.replaceChildren();
    input.disabled = false; sendBtn.disabled = false; photoBtn.disabled = false; micBtn.disabled = false; input.focus();
    await pull(); await loadList();
  }

  const form = h('form', {
    class: 'chat-send',
    onsubmit: async (e) => {
      e.preventDefault();
      const body = input.value.trim();
      if (!body || !cur) return;
      input.value = '';
      try { await api('POST', `${base()}/chats/${cur.id}`, { body }); await pull(); await loadList(); } catch (ex) { toast(ex.message, true); input.value = body; }
    },
  }, photoBtn, micBtn, fileIn, input, sendBtn);

  await loadList();
  every(3500, async () => { await pull(); await loadList(); });
  return h('div', {}, head('Chat com moradores', 'Conversas internas entre moradores e a portaria. Atualiza automaticamente.'),
    h('div', { class: 'chat' }, list, h('div', { class: 'chat-pane' }, title, msgs, form)));
};

// ------------------------------------------------------------------ ramal da portaria
PAGES.portaria = async () => {
  const [all, users] = await Promise.all([api('GET', `${base()}/extensions`), api('GET', `${base()}/users`)]);
  const list = all.filter((e) => e.kind === 'portaria');
  const reload = () => go('portaria');
  const fields = [
    { k: 'number', label: 'Número do ramal da portaria', max: 32, help: 'Exatamente como no Issabel (ex: 1000).' },
    { k: 'secret', label: 'Senha do ramal (secret)', type: 'text', max: 128, help: 'Necessária se esse ramal for usado no telefone do navegador (operador).' },
    { k: 'label', label: 'Nome exibido no app', max: 100, placeholder: 'Portaria' },
  ];
  const owner = (e) => users.filter((u) => u.extension_id === e.id).map((u) => u.name).join(', ');
  return h('div', {},
    head('Ramal da portaria', 'Ramal chamado quando o morador toca em "Falar com a portaria". Todos os moradores o recebem automaticamente.',
      h('button', {
        class: 'btn primary',
        onclick: () => formModal({
          title: 'Novo ramal da portaria', fields, values: { label: 'Portaria' }, submitLabel: 'Criar',
          onSubmit: async (v) => { await api('POST', `${base()}/extensions`, { ...v, kind: 'portaria', block: '' }); toast('Ramal da portaria cadastrado'); reload(); },
        }),
      }, '+ Cadastrar ramal da portaria')),
    h('div', { class: 'card' }, table([
      { h: 'Ramal', f: (e) => h('b', {}, e.number) },
      { h: 'Nome no app', f: (e) => e.label || 'Portaria' },
      { h: 'Senha', f: (e) => (e.secret ? '••••••' : h('em', {}, 'não definida')) },
      { h: 'Usado no navegador por', f: (e) => owner(e) || h('em', {}, '—') },
      { h: '', act: true, f: (e) => h('div', { class: 'row', style: 'justify-content:flex-end' },
        h('button', {
          class: 'btn sm',
          onclick: () => formModal({
            title: `Editar ramal ${e.number}`, fields, values: e,
            onSubmit: async (v) => { await api('PUT', `${base()}/extensions/${e.id}`, { ...v, kind: 'portaria' }); toast('Salvo'); reload(); },
          }),
        }, 'Editar'),
        h('button', {
          class: 'btn sm danger',
          onclick: async () => { if (!confirmBox(`Excluir o ramal ${e.number}?`)) return; await api('DELETE', `${base()}/extensions/${e.id}`); reload(); },
        }, 'Excluir')) },
    ], list, 'Nenhum ramal de portaria cadastrado. Clique em "Cadastrar ramal da portaria".'),
    h('p', { class: 'sub', style: 'margin-top:12px' },
      'Para atender pelo navegador, vincule o ramal a um operador em "Equipe do painel" e informe a URL WebSocket em "Servidor VoIP".')));
};

// ------------------------------------------------------------------ aplicativos conectados
PAGES.devices = async () => {
  const [initDev, residents] = await Promise.all([api('GET', `${base()}/devices`), api('GET', `${base()}/residents`)]);
  const ext = new Map(residents.map((r) => [r.id, r.ext_number]));
  const holder = h('div', { class: 'card' });
  const SIP = { ok: ['SIP ok', 'ok'], fail: ['SIP falhou', 'off'], none: ['sem ramal', ''] };
  const notify = (r) => formModal({
    title: r ? `Notificar ${r.name}` : 'Avisar todos os moradores',
    fields: [
      { k: 'kind', label: 'Tipo', type: 'select', options: Object.entries(NKIND).map(([v, l]) => ({ v, l })) },
      { k: 'title', label: 'Título', max: 120 },
      { k: 'body', label: 'Mensagem', type: 'textarea', max: 2000 },
    ],
    values: { kind: 'aviso' }, submitLabel: 'Enviar notificação',
    onSubmit: async (v) => {
      await api('POST', `${base()}/notices`, { ...v, resident_id: r ? r.resident_id : null });
      toast('Notificação enviada — chega ao aparelho em instantes.');
    },
  });
  function paint(rows) {
    const online = rows.filter((x) => x.online).length;
    holder.replaceChildren(h('h2', {}, `${rows.length} aparelho(s) logado(s) — ${online} online agora`), table([
      { h: 'Morador', f: (x) => [h('b', {}, x.name), h('div', { class: 'sub' }, [x.block, x.unit].filter(Boolean).join(' · '))] },
      { h: 'Estado', f: (x) => badge(x.online ? 'Online' : 'Offline', x.online ? 'ok' : 'off') },
      { h: 'Aparelho', f: (x) => x.device || h('em', {}, '—') },
      { h: 'App', f: (x) => x.app_version || h('em', {}, '—') },
      { h: 'Ramal (SIP)', f: (x) => { const s = SIP[x.sip_state]; return s ? badge(s[0], s[1]) : h('em', {}, '—'); } },
      { h: 'Último contato', f: (x) => fmt(x.last_seen) },
      { h: '', act: true, f: (x) => h('div', { class: 'row', style: 'justify-content:flex-end' },
        ext.get(x.resident_id) && Phone.ready ? h('button', { class: 'btn sm', onclick: () => Phone.dial(ext.get(x.resident_id)) }, 'Ligar') : null,
        h('button', { class: 'btn sm primary', onclick: () => notify(x) }, 'Notificar')) },
    ], rows, 'Nenhum aplicativo logado ainda. Os moradores aparecem aqui depois de entrar no app.'));
  }
  paint(initDev);
  every(8000, async () => paint(await api('GET', `${base()}/devices`)));
  return h('div', {},
    head('Aplicativos conectados', 'Aparelhos de moradores com sessão aberta. Atualiza sozinho a cada poucos segundos.',
      h('button', { class: 'btn primary', onclick: () => notify(null) }, 'Avisar todos')),
    holder);
};

// ------------------------------------------------------------------ telefone (cliente VoIP no navegador)
PAGES.phone = async () => {
  const residents = await api('GET', `${base()}/residents`);
  return Phone.page(residents);
};

// ------------------------------------------------------------------ minha conta
PAGES.account = async () => {
  const cur = h('input', { type: 'password', autocomplete: 'current-password' });
  const nw = h('input', { type: 'password', autocomplete: 'new-password' });
  const err = h('div', { class: 'err', hidden: true });
  return h('div', {}, head('Minha conta', `${S.user.name || S.user.username} — ${ROLE[S.user.role]}`),
    h('div', { class: 'card', style: 'max-width:420px' }, h('h2', {}, 'Trocar senha'), err,
      h('label', { class: 'field' }, h('span', {}, 'Senha atual'), cur),
      h('label', { class: 'field' }, h('span', {}, 'Nova senha (mín. 8 caracteres)'), nw),
      h('button', {
        class: 'btn primary',
        onclick: async () => {
          err.hidden = true;
          try {
            await api('POST', '/api/auth/password', { current: cur.value, password: nw.value });
            toast('Senha alterada. Entre novamente.'); S.token = null; signOut(true);
          } catch (ex) { err.textContent = ex.message; err.hidden = false; }
        },
      }, 'Alterar senha')));
};

// ------------------------------------------------------------------ início
(async function init() {
  if (S.token) {
    try {
      const me = await api('GET', '/api/auth/me');
      return await start(me.user);
    } catch (e) { /* cai no login */ }
  }
  renderLogin('');
})();
