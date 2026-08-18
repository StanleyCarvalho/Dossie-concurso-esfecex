const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const db = require('../db/db');

router.get('/login', (req, res) => {
  res.render('login', { error: null, mode: 'login' });
});

router.post('/login', async (req, res, next) => {
  try {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = await db.one('SELECT * FROM users WHERE email = $1', [email]);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).render('login', { error: 'E-mail ou senha invalidos.', mode: 'login' });
  }

  req.session.userId = user.id;
  res.redirect('/');
  } catch (error) {
    next(error);
  }
});

router.get('/cadastro', (req, res) => {
  res.render('login', { error: null, mode: 'register' });
});

router.post('/cadastro', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const name = String(req.body.name || '').trim();

  if (!email.includes('@') || password.length < 6) {
    return res.status(400).render('login', {
      error: 'Informe um e-mail valido e uma senha com pelo menos 6 caracteres.',
      mode: 'register'
    });
  }

  try {
    const passwordHash = bcrypt.hashSync(password, 12);
    const user = await db.one(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id',
      [email, passwordHash, name || null]
    );
    req.session.userId = user.id;
    res.redirect('/');
  } catch (e) {
    res.status(400).render('login', { error: 'Este e-mail ja esta cadastrado.', mode: 'register' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

module.exports = { router, requireAuth };
