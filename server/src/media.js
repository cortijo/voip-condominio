// Anexos do chat (foto e áudio). Os arquivos NÃO são públicos: só saem por rotas autenticadas.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./db');

const CHAT_DIR = path.join(DATA_DIR, 'chat');
fs.mkdirSync(CHAT_DIR, { recursive: true });

const LIMITS = { image: 4 * 1024 * 1024, audio: 3 * 1024 * 1024 };

/** Identifica o formato pelos primeiros bytes (não confia no tipo informado pelo cliente). */
function sniff(kind, b) {
  const s = (a, z) => b.subarray(a, z).toString('latin1');
  if (kind === 'image') {
    if (b[0] === 0x89 && s(1, 4) === 'PNG') return { ext: 'png', mime: 'image/png' };
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
    if (s(0, 4) === 'RIFF' && s(8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  } else if (kind === 'audio') {
    if (s(4, 8) === 'ftyp') return { ext: 'm4a', mime: 'audio/mp4' };
    if (s(0, 4) === 'OggS') return { ext: 'ogg', mime: 'audio/ogg' };
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { ext: 'webm', mime: 'audio/webm' };
    if (s(0, 4) === 'RIFF' && s(8, 12) === 'WAVE') return { ext: 'wav', mime: 'audio/wav' };
    if (s(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { ext: 'mp3', mime: 'audio/mpeg' };
  }
  return null;
}

/** Valida e grava o anexo (base64). Retorna { file, mime } ou { error }. */
function save(kind, data) {
  if (kind !== 'image' && kind !== 'audio') return { error: 'Tipo de anexo inválido.' };
  let b64 = String(data || '');
  if (b64.startsWith('data:')) b64 = b64.slice(b64.indexOf(',') + 1);
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 12) return { error: 'Arquivo vazio.' };
  if (buf.length > LIMITS[kind]) {
    return { error: kind === 'image' ? 'Imagem muito grande (máx. 4 MB).' : 'Áudio muito longo (máx. 3 MB).' };
  }
  const t = sniff(kind, buf);
  if (!t) return { error: kind === 'image' ? 'Use uma imagem PNG, JPEG ou WEBP.' : 'Formato de áudio não suportado.' };
  const file = `${crypto.randomBytes(16).toString('hex')}.${t.ext}`;
  fs.writeFileSync(path.join(CHAT_DIR, file), buf);
  return { file, mime: t.mime };
}

/** Envia o arquivo de uma mensagem (linha com { media, mime }). */
function send(res, row) {
  res.set({
    'Content-Type': row.mime,
    'Cache-Control': 'private, max-age=3600',
    'Content-Security-Policy': "default-src 'none'",
    'Content-Disposition': 'inline',
  });
  res.sendFile(path.join(CHAT_DIR, row.media), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Arquivo não encontrado.' });
  });
}

/** Apaga do disco os anexos das linhas informadas. */
function purge(rows) {
  for (const r of rows) if (r.media) fs.rmSync(path.join(CHAT_DIR, r.media), { force: true });
}

module.exports = { save, send, purge };
