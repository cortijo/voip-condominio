const express = require('express');
const path = require('path');
const { UPLOADS_DIR } = require('./db');
const { seedAdmin } = require('./seed');

const PORT = Number(process.env.PORT) || 9670;
const app = express();

app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'",
  });
  next();
});

app.use(express.json({ limit: '3mb' }));

app.use('/media', express.static(UPLOADS_DIR, {
  maxAge: '1h',
  index: false,
  setHeaders: (res) => res.set('Content-Security-Policy', "default-src 'none'"),
}));

app.get('/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/app', require('./routes/app'));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Conteúdo muito grande.' });
  if (String(err.code || '').startsWith('SQLITE_CONSTRAINT')) return res.status(409).json({ error: 'Registro duplicado ou em uso.' });
  console.error(err);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

seedAdmin().then(() => {
  app.listen(PORT, '0.0.0.0', () => console.log(`Interfone server ouvindo na porta ${PORT}`));
});
