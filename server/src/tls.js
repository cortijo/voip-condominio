// HTTPS opcional (necessário para o telefone/microfone do navegador no painel do operador).
// Usa TLS_CERT/TLS_KEY (certificado real) ou gera um certificado autoassinado em /data/tls.
const fs = require('fs');
const path = require('path');
const net = require('net');
const { DATA_DIR } = require('./db');

async function loadOrCreateCert() {
  if (process.env.TLS_CERT && process.env.TLS_KEY) {
    return { cert: fs.readFileSync(process.env.TLS_CERT), key: fs.readFileSync(process.env.TLS_KEY) };
  }
  const dir = path.join(DATA_DIR, 'tls');
  fs.mkdirSync(dir, { recursive: true });
  const certFile = path.join(dir, 'cert.pem');
  const keyFile = path.join(dir, 'key.pem');
  const hostsFile = path.join(dir, 'hosts.txt');

  const hosts = [...new Set(['localhost', '127.0.0.1',
    ...String(process.env.PUBLIC_HOST || '').split(',').map((h) => h.trim()).filter(Boolean)])];
  const wanted = hosts.join(',');
  const current = fs.existsSync(hostsFile) ? fs.readFileSync(hostsFile, 'utf8') : '';
  if (fs.existsSync(certFile) && fs.existsSync(keyFile) && current === wanted) {
    return { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) };
  }

  const selfsigned = require('selfsigned');
  const altNames = hosts.map((h) => (net.isIP(h) ? { type: 7, ip: h } : { type: 2, value: h }));
  const notBeforeDate = new Date(Date.now() - 24 * 3600 * 1000);
  const notAfterDate = new Date(Date.now() + 800 * 24 * 3600 * 1000);
  const pems = await selfsigned.generate([{ name: 'commonName', value: hosts[2] || 'localhost' }], {
    keySize: 2048,
    algorithm: 'sha256',
    notBeforeDate,
    notAfterDate,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'subjectAltName', altNames },
    ],
  });
  fs.writeFileSync(certFile, pems.cert);
  fs.writeFileSync(keyFile, pems.private, { mode: 0o600 });
  fs.writeFileSync(hostsFile, wanted);
  console.log(`[tls] certificado autoassinado gerado para: ${wanted}`);
  return { cert: pems.cert, key: pems.private };
}

module.exports = { loadOrCreateCert };
