'use strict';
/* Telefone VoIP no navegador (cliente SIP via WebSocket, JsSIP) para o painel do operador.
   Depende de h(), api(), base(), S, toast() e go() definidos em app.js (usados só em tempo de execução). */

const Phone = (() => {
  const P = {
    state: 'idle', // idle | unconfigured | insecure | connecting | registered | failed
    detail: '',
    cfg: null,
    ua: null,
    session: null,
    incoming: false,
    muted: false,
    startedAt: 0,
    phase: '', // '' | 'Chamando…' | 'Tocando' | 'Em chamada'
    names: new Map(), // número do ramal -> nome do morador
  };
  const subs = [];
  let dock = null;
  let audio = null;
  let ac = null;
  let ringTimer = null;
  let tickTimer = null;
  const baseTitle = document.title;

  const notify = () => { render(); subs.forEach((f) => { try { f(); } catch (e) { /* ignore */ } }); };

  // ------------------------------------------------------------ toque
  function beep() {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.frequency.value = 480;
      g.gain.value = 0.12;
      o.connect(g); g.connect(ac.destination);
      o.start(); o.stop(ac.currentTime + 0.5);
    } catch (e) { /* sem áudio */ }
  }
  function ringStart() {
    ringStop();
    beep();
    let on = false;
    ringTimer = setInterval(() => { beep(); document.title = (on = !on) ? '📞 Chamada recebida' : baseTitle; }, 1500);
  }
  function ringStop() {
    if (ringTimer) clearInterval(ringTimer);
    ringTimer = null;
    document.title = baseTitle;
  }

  // ------------------------------------------------------------ sessão SIP
  function remoteName(s) {
    const id = s.remote_identity;
    const num = id && id.uri ? id.uri.user : '';
    return P.names.get(num) || (id && id.display_name) || num || 'Desconhecido';
  }

  function attachRemote(ev) {
    if (!audio) {
      audio = document.createElement('audio');
      audio.autoplay = true;
      document.body.append(audio);
    }
    audio.srcObject = (ev && ev.streams && ev.streams[0]) || new MediaStream([ev.track]);
    audio.play().catch(() => {});
  }

  function bind(s) {
    P.session = s;
    P.incoming = s.direction === 'incoming';
    P.muted = false;
    P.startedAt = 0;
    P.phase = P.incoming ? 'Tocando' : 'Chamando…';
    s.on('peerconnection', (e) => e.peerconnection.addEventListener('track', attachRemote));
    s.on('progress', () => { if (!P.incoming) { P.phase = 'Tocando'; notify(); } });
    s.on('confirmed', () => {
      ringStop();
      P.startedAt = Date.now();
      P.phase = 'Em chamada';
      try {
        const rs = s.connection.getReceivers().map((r) => r.track).filter(Boolean);
        if (rs.length && (!audio || !audio.srcObject)) attachRemote({ streams: [new MediaStream(rs)] });
      } catch (e) { /* ignore */ }
      notify();
    });
    const end = (e) => {
      ringStop();
      if (P.session === s) {
        P.session = null; P.phase = '';
        if (e && e.cause && s.direction === 'outgoing' && !P.startedAt && e.cause !== 'Canceled') toast('Chamada não completada: ' + e.cause, true);
      }
      if (audio) audio.srcObject = null;
      notify();
    };
    s.on('ended', end);
    s.on('failed', end);
    notify();
  }

  const callOpts = () => ({
    mediaConstraints: { audio: true, video: false },
    pcConfig: { iceServers: P.cfg && P.cfg.stun ? [{ urls: P.cfg.stun }] : [] },
    rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false },
  });

  // ------------------------------------------------------------ API pública
  async function init() {
    stop();
    if (!S.condoId || S.user.role === 'master') return;
    let cfg;
    try { cfg = await api('GET', `${base()}/softphone`); } catch (e) { return; }
    // nomes dos moradores por ramal (para exibir quem está ligando)
    api('GET', `${base()}/residents`).then((rs) => rs.forEach((r) => { if (r.ext_number) P.names.set(r.ext_number, r.name); })).catch(() => {});
    if (!cfg.configured) { P.state = 'unconfigured'; P.detail = cfg.reason; notify(); return; }
    P.cfg = cfg;
    if (!window.isSecureContext) {
      P.state = 'insecure';
      P.detail = 'O navegador só libera o microfone em conexão segura (HTTPS).';
      notify(); return;
    }
    if (!window.JsSIP) { P.state = 'failed'; P.detail = 'Biblioteca de telefone não carregada.'; notify(); return; }
    try {
      JsSIP.debug.disable('JsSIP:*');
      const socket = new JsSIP.WebSocketInterface(cfg.wss);
      const ua = new JsSIP.UA({
        sockets: [socket], uri: `sip:${cfg.user}@${cfg.domain}`, password: cfg.password,
        display_name: cfg.displayName, register: true, session_timers: false, register_expires: 300,
      });
      ua.on('connecting', () => { if (P.state !== 'registered') { P.state = 'connecting'; notify(); } });
      ua.on('connected', () => { P.detail = ''; });
      ua.on('disconnected', () => { P.state = 'failed'; P.detail = `Sem conexão com ${cfg.wss}. Verifique o endereço e se o certificado do Issabel foi aceito (abra https://… do Issabel uma vez no navegador).`; notify(); });
      ua.on('registered', () => { P.state = 'registered'; P.detail = ''; notify(); });
      ua.on('unregistered', () => { if (P.state === 'registered') { P.state = 'connecting'; notify(); } });
      ua.on('registrationFailed', (e) => { P.state = 'failed'; P.detail = `Registro recusado pelo Issabel (${(e && e.cause) || 'erro'}). Confira número e senha do ramal.`; notify(); });
      ua.on('newRTCSession', (e) => {
        const s = e.session;
        if (P.session) { // já em chamada: recusa a nova com "ocupado"
          if (s.direction === 'incoming') s.terminate({ status_code: 486, reason_phrase: 'Busy Here' });
          return;
        }
        bind(s);
        if (s.direction === 'incoming') ringStart();
      });
      P.ua = ua;
      P.state = 'connecting';
      ua.start();
      notify();
    } catch (e) {
      P.state = 'failed'; P.detail = e.message; notify();
    }
  }

  function stop() {
    try { if (P.session) P.session.terminate(); } catch (e) { /* ignore */ }
    try { if (P.ua) P.ua.stop(); } catch (e) { /* ignore */ }
    ringStop();
    P.ua = null; P.session = null; P.cfg = null; P.state = 'idle'; P.detail = ''; P.phase = '';
    P.names = new Map();
    if (dock) { dock.remove(); dock = null; }
  }

  function dial(number) {
    const n = String(number || '').trim().replace(/[^0-9*#+]/g, '');
    if (!n) return toast('Informe o ramal.', true);
    if (P.state !== 'registered') return toast('O telefone ainda não está registrado.', true);
    if (P.session) return toast('Já existe uma chamada em andamento.', true);
    try { P.ua.call(`sip:${n}@${P.cfg.domain}`, callOpts()); } catch (e) { toast(e.message, true); }
  }
  function answer() { if (P.session && P.incoming) { ringStop(); try { P.session.answer(callOpts()); } catch (e) { toast(e.message, true); } } }
  function hangup() { if (P.session) { try { P.session.terminate(); } catch (e) { /* ignore */ } } }
  function mute() {
    if (!P.session) return;
    P.muted = !P.muted;
    if (P.muted) P.session.mute({ audio: true }); else P.session.unmute({ audio: true });
    notify();
  }
  function dtmf(d) { if (P.session && P.startedAt) { try { P.session.sendDTMF(d); } catch (e) { /* ignore */ } } }

  // ------------------------------------------------------------ interface
  const STATE_TXT = {
    registered: ['Ramal ', 'registrado', 'ok'],
    connecting: ['Ramal ', 'conectando…', 'wait'],
    failed: ['Ramal ', 'com problema', 'off'],
    insecure: ['Telefone ', 'indisponível (HTTP)', 'off'],
    unconfigured: ['Telefone ', 'não configurado', 'off'],
  };

  const clock = () => {
    if (!P.startedAt) return '';
    const sec = Math.floor((Date.now() - P.startedAt) / 1000);
    return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  };

  function who() {
    return P.session ? remoteName(P.session) : '';
  }

  function render() {
    if (P.state === 'idle') return;
    if (!dock) { dock = h('div', { id: 'phone-dock' }); document.body.append(dock); }
    const [a, b, cls] = STATE_TXT[P.state];
    const pill = h('button', { class: 'ph-pill ' + cls, title: 'Abrir o telefone', onclick: () => go('phone') },
      '📞 ', a + (P.cfg ? P.cfg.user + ' — ' : ''), b);
    const kids = [];
    if (P.session) {
      const ringing = P.incoming && !P.startedAt;
      kids.push(h('div', { class: 'ph-call' + (ringing ? ' ring' : '') },
        h('div', { class: 'ph-who' }, h('small', {}, P.incoming ? (ringing ? 'Chamada recebida' : 'Chamada') : 'Ligando para'), h('b', {}, who())),
        h('div', { class: 'ph-time', id: 'ph-time' }, P.startedAt ? clock() : P.phase),
        h('div', { class: 'row' },
          ringing ? h('button', { class: 'btn ph-ans', onclick: answer }, 'Atender') : null,
          P.startedAt ? h('button', { class: 'btn' + (P.muted ? ' primary' : ''), onclick: mute }, P.muted ? 'Ativar mic' : 'Mudo') : null,
          h('button', { class: 'btn danger', onclick: hangup }, ringing ? 'Recusar' : 'Desligar'))));
    }
    kids.push(pill);
    dock.replaceChildren(...kids);
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = P.startedAt ? setInterval(() => { const t = document.getElementById('ph-time'); if (t) t.textContent = clock(); }, 1000) : null;
  }

  /** Página "Telefone" */
  function page(residents) {
    const num = h('input', { placeholder: 'Ramal (ex: 1001)', inputmode: 'tel', maxlength: 32 });
    const pad = h('div', { class: 'pad' }, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((d) =>
      h('button', { class: 'btn', type: 'button', onclick: () => { if (P.session) dtmf(d); else num.value += d; } }, d)));
    const status = h('div', {});
    const paint = () => {
      const [a, b, cls] = STATE_TXT[P.state] || ['Telefone ', '—', 'off'];
      status.replaceChildren(...[h('span', { class: 'badge ' + cls }, a + (P.cfg ? P.cfg.user + ' — ' : ''), b),
        P.detail ? h('div', { class: 'err', style: 'margin-top:10px' }, P.detail) : null,
        P.state === 'insecure' ? h('p', {},
          'Abra o painel pelo endereço seguro: ',
          h('a', { href: `https://${location.hostname}:9671/` }, `https://${location.hostname}:9671/`),
          ' (o navegador avisa que o certificado é autoassinado — confirme uma vez em "Avançado → Continuar").') : null].filter(Boolean));
    };
    paint();
    subs.length = 0; // só a página aberta se repinta
    subs.push(paint);
    const quick = residents.filter((r) => r.ext_number && r.active);
    return h('div', {},
      head('Telefone', 'Cliente VoIP no navegador, usando o ramal vinculado ao seu usuário.'),
      h('div', { class: 'grid2' },
        h('div', { class: 'card' }, h('h2', {}, 'Discar'), status,
          h('form', {
            class: 'dial', onsubmit: (e) => { e.preventDefault(); dial(num.value); },
          }, num, h('button', { class: 'btn primary', type: 'submit', disabled: P.state !== 'registered' }, 'Ligar')),
          pad,
          h('small', { class: 'sub' }, 'Durante a chamada, o teclado envia tons DTMF.')),
        h('div', { class: 'card' }, h('h2', {}, 'Moradores com ramal'),
          quick.length ? h('div', { class: 'quick' }, quick.map((r) => h('div', { class: 'qrow' },
            h('div', {}, h('b', {}, r.name), h('small', {}, ' ' + [r.block, r.unit].filter(Boolean).join(' · ') + ' — ramal ' + r.ext_number)),
            h('button', { class: 'btn sm', disabled: P.state !== 'registered', onclick: () => dial(r.ext_number) }, 'Ligar'))))
            : h('div', { class: 'empty' }, 'Nenhum morador com ramal.'))));
  }

  return { init, stop, dial, page, get state() { return P.state; }, get ready() { return P.state === 'registered'; } };
})();
