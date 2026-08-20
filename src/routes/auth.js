const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db/db');

function verifyPassword(password, storedHash) {
  if (String(storedHash || '').startsWith('scrypt$')) {
    const [, salt, expected] = String(storedHash).split('$');
    if (!salt || !expected) return false;
    const actual = crypto.scryptSync(String(password), salt, 64).toString('hex');
    const a = Buffer.from(actual, 'hex');
    const b = Buffer.from(expected, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  return bcrypt.compareSync(String(password), String(storedHash || ''));
}

function brazilToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function accessState(user) {
  if (!user) return { allowed: false, reason: 'not_found' };
  if (user.role === 'admin') return { allowed: true };
  if (user.approval_status === 'pending') return { allowed: false, reason: 'pending' };
  if (user.approval_status !== 'approved') return { allowed: false, reason: 'blocked' };
  if (user.access_until && String(user.access_until).slice(0, 10) < brazilToday()) return { allowed: false, reason: 'expired' };
  return { allowed: true };
}

function accessMessage(reason) {
  if (reason === 'pending') return 'Seu cadastro foi recebido e está aguardando aprovação do administrador.';
  if (reason === 'expired') return 'Seu período de acesso expirou. Solicite a renovação ao administrador.';
  if (reason === 'blocked') return 'Seu acesso está bloqueado. Entre em contato com o administrador.';
  return 'Não foi possível liberar seu acesso.';
}

router.get('/login', (req, res) => { res.render('login', { error: null, success: req.query.cadastro === 'pendente' ? 'Cadastro solicitado com sucesso. Aguarde a aprovação do administrador para acessar a plataforma.' : null, mode: 'login' }); });

router.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = await db.one('SELECT * FROM users WHERE email = $1', [email]);
    if (!user || !verifyPassword(password, user.password_hash)) return res.status(401).render('login', { error: 'E-mail ou senha inválidos.', success: null, mode: 'login' });
    const state = accessState(user);
    if (!state.allowed) return res.status(403).render('login', { error: accessMessage(state.reason), success: null, mode: 'login' });
    req.session.userId = user.id;
    req.session.role = user.role || 'student';
    res.redirect(user.role === 'admin' ? '/admin/usuarios' : '/');
  } catch (error) { next(error); }
});

router.get('/cadastro', (req, res) => { res.render('login', { error: null, success: null, mode: 'register' }); });
router.post('/cadastro', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const name = String(req.body.name || '').trim();
  if (name.length < 3 || !email.includes('@') || password.length < 8) return res.status(400).render('login', { error: 'Informe seu nome, um e-mail válido e uma senha com pelo menos 8 caracteres.', success: null, mode: 'register' });
  try {
    const passwordHash = bcrypt.hashSync(password, 12);
    await db.one(`INSERT INTO users (email,password_hash,name,role,approval_status) VALUES ($1,$2,$3,'student','pending') RETURNING id`, [email, passwordHash, name]);
    res.redirect('/login?cadastro=pendente');
  } catch (e) { res.status(400).render('login', { error: 'Este e-mail já está cadastrado.', success: null, mode: 'register' }); }
});

router.post('/logout', (req, res) => { req.session.destroy(() => res.redirect('/login')); });

async function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  try {
    const user = await db.one('SELECT id,email,name,role,approval_status,access_until FROM users WHERE id=$1', [req.session.userId]);
    const state = accessState(user);
    if (!state.allowed) { req.session.destroy(() => {}); return res.status(403).render('login', { error: accessMessage(state.reason), success: null, mode: 'login' }); }
    req.currentUser = user;
    req.session.role = user.role || 'student';
    next();
  } catch (error) { next(error); }
}

function requireAdmin(req, res, next) {
  if (!req.currentUser || req.currentUser.role !== 'admin') return res.status(403).render('error', { message: 'Acesso restrito ao administrador.' });
  next();
}

module.exports = { router, requireAuth, requireAdmin };
