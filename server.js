require('dotenv').config({ override: true });
const express = require('express');
const path = require('path');
const { marked } = require('marked');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const db = require('./src/db/db');
const { router: authRouter, requireAuth } = require('./src/routes/auth');
const { fixMojibake } = require('./src/services/textService');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  store: new SQLiteStore({
    db: 'sessions.sqlite',
    dir: process.env.VERCEL ? '/tmp' : path.join(__dirname, 'data')
  }),
  secret: process.env.SESSION_SECRET || 'troque-este-segredo-no-env',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
}));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// helper de markdown disponível em todas as views + define `active`/`title` default
app.use((req, res, next) => {
  res.locals.markdownToHtml = (md) => marked.parse(md || '');
  res.locals.title = res.locals.title || '';
  res.locals.active = res.locals.active || '';
  res.locals.t = fixMojibake;
  res.locals.user = req.session.userId
    ? db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(req.session.userId)
    : null;
  next();
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
