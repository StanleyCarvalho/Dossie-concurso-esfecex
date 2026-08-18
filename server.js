require('dotenv').config({ override: true });
require('express-async-errors');
const express = require('express');
const path = require('path');
const { marked } = require('marked');
const session = require('express-session');
const PgStore = require('connect-pg-simple')(session);
const db = require('./src/db/db');
const { router: authRouter, requireAuth } = require('./src/routes/auth');
const { fixMojibake } = require('./src/services/textService');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET não configurada.');
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  store: new PgStore({
    pool: db.pool,
    tableName: 'user_sessions',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
}));

app.get('/api/health', async (req, res) => {
  try {
    await db.ping();
    res.json({ status: 'ok', database: 'postgresql' });
  } catch (error) {
    res.status(503).json({ status: 'error', database: 'unavailable' });
  }
});

// helper de markdown disponível em todas as views + define `active`/`title` default
app.use(async (req, res, next) => {
  try {
  res.locals.markdownToHtml = (md) => marked.parse(md || '');
  res.locals.title = res.locals.title || '';
  res.locals.active = res.locals.active || '';
  res.locals.t = fixMojibake;
    res.locals.user = req.session.userId
      ? await db.one('SELECT id, email, name FROM users WHERE id = $1', [req.session.userId])
      : null;
    next();
  } catch (error) {
    next(error);
  }
});

app.use(authRouter);
app.use(requireAuth);

// injeta `active` correto por rota (para destacar o item do menu)
app.use((req, res, next) => {
  const map = {
    '/': 'dashboard',
    '/proxima-prova': 'proxima',
    '/analise': 'analise',
    '/plano-estudos': 'plano',
    '/questoes': 'questoes',
    '/simulados': 'simulados',
    '/import': 'import'
  };
  const base = '/' + req.path.split('/')[1];
  res.locals.active = map[req.path] || map[base] || '';
  next();
});

app.use('/', require('./src/routes/main'));
app.use('/import', require('./src/routes/import'));
app.use('/simulados', require('./src/routes/simulados'));

app.use((req, res) => {
  res.status(404).render('error', { message: 'Página não encontrada.' });
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(500).render('error', { message: 'Não foi possível concluir a operação.' });
});

if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`ESFCEx Informática Prep rodando em http://localhost:${PORT}`);
  });

  server.on('error', error => {
    if (error.code === 'EADDRINUSE') {
      console.error(`A porta ${PORT} ja esta em uso. Feche o servidor antigo ou altere PORT no arquivo .env.`);
      process.exit(1);
    }
    throw error;
  });
}

module.exports = app;
