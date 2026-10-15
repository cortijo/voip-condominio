'use strict';
/* Página pública do visitante: cadastro (com foto pela câmera frontal) a partir do link enviado pelo morador. */
(function () {
  const token = location.pathname.split('/').pop();
  const m = document.getElementById('m');
  const API = '/api/public/visit/' + encodeURIComponent(token);

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }

  function downscale(file, max = 1024) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível ler a foto.')); };
      img.onload = () => {
        URL.revokeObjectURL(url);
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.82).split(',')[1]);
      };
      img.src = url;
    });
  }

  function theme(c) {
    const col = (c && c.colors) || {};
    if (col.primary) document.documentElement.style.setProperty('--p', col.primary);
    if (col.onPrimary) document.documentElement.style.setProperty('--on', col.onPrimary);
  }

  function top(info, sub) {
    return h('div', { class: 'top' },
      info.condo.logoUrl ? h('img', { src: info.condo.logoUrl, alt: '' }) : null,
      h('h1', {}, info.condo.name || 'Condomínio'), h('p', {}, sub));
  }

  function message(info, text, cls) {
    m.replaceChildren(top(info, 'Cadastro de visita'), h('div', { class: cls || 'box' }, text));
  }

  function render(info) {
    theme(info.condo);
    const who = info.resident ? `${info.resident.name}${info.resident.block || info.resident.unit ? ' — ' + [info.resident.block, info.resident.unit].filter(Boolean).join(' ') : ''}` : '';
    if (!info.editable) {
      const t = { liberado: 'Sua entrada foi liberada pela portaria.', recusado: 'Esta visita não foi autorizada.', cancelado: 'Esta visita foi cancelada.', saiu: 'Visita encerrada.' }[info.status];
      return message(info, t || 'Este link expirou. Peça um novo link ao morador.');
    }
    const d = info.data || {};
    const v = {
      name: h('input', { value: d.name, autocomplete: 'name', required: true, maxlength: 100 }),
      type: h('select', {}, h('option', { value: 'CPF' }, 'CPF'), h('option', { value: 'RG' }, 'RG')),
      doc: h('input', { value: d.document, inputmode: 'text', required: true, maxlength: 20, autocomplete: 'off' }),
      phone: h('input', { value: d.phone, type: 'tel', autocomplete: 'tel', required: true, maxlength: 20, placeholder: '(79) 99999-9999' }),
      vehicle: h('input', { value: d.vehicle, maxlength: 60, placeholder: 'Ex.: Fiat Uno branco (deixe vazio se não vier de carro)' }),
      plate: h('input', { value: d.plate, maxlength: 8, placeholder: 'ABC1D23', autocapitalize: 'characters' }),
    };
    v.type.value = d.doc_type || 'CPF';
    let photo = null;
    const prev = h('div', { class: 'photo' });
    const paintPhoto = (url) => prev.replaceChildren(
      url ? h('img', { src: url, alt: 'Sua foto' }) : h('div', { class: 'ph' }, d.has_photo ? 'Foto já enviada' : 'Sem foto ainda'));
    paintPhoto(null);
    // capture="user": abre a câmera frontal do celular
    const cam = h('input', {
      type: 'file', accept: 'image/*', capture: 'user', hidden: true,
      onchange: async (e) => {
        const f = e.target.files[0]; if (!f) return;
        try { photo = await downscale(f); paintPhoto('data:image/jpeg;base64,' + photo); } catch (ex) { err.textContent = ex.message; err.hidden = false; }
      },
    });
    const err = h('div', { class: 'err', hidden: true });
    const send = h('button', { type: 'submit' }, d.name ? 'Atualizar meus dados' : 'Enviar cadastro');
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault(); err.hidden = true; send.disabled = true;
        try {
          const r = await fetch(API, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: v.name.value, doc_type: v.type.value, document: v.doc.value, phone: v.phone.value, vehicle: v.vehicle.value, plate: v.plate.value, photo }),
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || 'Erro ' + r.status);
          message(info, h('div', {}, '✓ Cadastro enviado! ', photo || d.has_photo ? 'A portaria validará seus dados quando você chegar.' : 'Apresente um documento com foto na portaria — sua foto será conferida na chegada.'), 'ok');
        } catch (ex) { err.textContent = ex.message; err.hidden = false; send.disabled = false; }
      },
    },
    err,
    h('label', {}, 'Nome completo', v.name),
    h('label', {}, 'Documento', h('div', { class: 'row' }, v.type, v.doc), h('small', {}, 'Informe o CPF ou o RG.')),
    h('label', {}, 'Telefone para contato', v.phone),
    h('label', {}, 'Veículo (opcional)', v.vehicle),
    h('label', {}, 'Placa do veículo (opcional)', v.plate),
    h('div', {}, h('div', { style: 'font-weight:600;font-size:14px;margin-bottom:8px' }, 'Foto do rosto (recomendado)'), prev,
      h('div', { style: 'display:grid;margin-top:10px' }, h('button', { type: 'button', class: 'sec', onclick: () => cam.click() }, '📷 Tirar foto com a câmera frontal'), cam),
      h('div', { class: 'hint', style: 'margin-top:8px' }, 'Se preferir, envie sem foto: ela será conferida na portaria.')),
    send,
    h('div', { class: 'hint' }, 'Seus dados são usados só para o controle de acesso do condomínio.'));
    m.replaceChildren(top(info, who ? `Visita para ${who}` : 'Cadastro de visita'),
      info.visit_date ? h('p', { class: 'hint' }, 'Data prevista: ' + info.visit_date.split('-').reverse().join('/')) : null, form);
  }

  fetch(API).then(async (r) => {
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Link inválido.');
    render(j);
  }).catch((e) => m.replaceChildren(h('div', { class: 'box' }, e.message)));
})();
