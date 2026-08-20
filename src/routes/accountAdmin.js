const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { requireAdmin } = require('./auth');

router.get('/minha-conta', async (req, res) => {
  const profile = await db.one('SELECT id,email,name,phone,city,occupation,role,approval_status,access_until,created_at FROM users WHERE id=$1', [req.session.userId]);
  res.render('account', { profile, saved: req.query.saved === '1' });
});

router.post('/minha-conta', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const phone = String(req.body.phone || '').trim() || null;
  const city = String(req.body.city || '').trim() || null;
  const occupation = String(req.body.occupation || '').trim() || null;
  if (name.length < 3) return res.status(400).render('error', { message: 'Informe um nome válido.' });
  await db.query('UPDATE users SET name=$1,phone=$2,city=$3,occupation=$4,updated_at=CURRENT_TIMESTAMP WHERE id=$5', [name, phone, city, occupation, req.session.userId]);
  res.redirect('/minha-conta?saved=1');
});

router.get('/admin/usuarios', requireAdmin, async (req, res) => {
  const users = await db.query(`SELECT id,email,name,phone,city,occupation,role,approval_status,access_until,created_at,
    CASE WHEN role='admin' THEN 'admin' WHEN approval_status='pending' THEN 'pending' WHEN approval_status<>'approved' THEN 'blocked' WHEN access_until IS NOT NULL AND access_until<CURRENT_DATE THEN 'expired' ELSE 'active' END AS access_state
    FROM users ORDER BY CASE WHEN approval_status='pending' THEN 0 ELSE 1 END,created_at DESC`);
  res.render('admin_users', { users, message: req.query.message || null });
});

router.post('/admin/usuarios/:id/aprovar', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const accessUntil = String(req.body.access_until || '').trim();
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(accessUntil)) return res.status(400).render('error', { message: 'Informe uma data final de acesso válida.' });
  const target = await db.one(`UPDATE users SET approval_status='approved',access_until=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND role<>'admin' RETURNING id`, [accessUntil, id]);
  if (!target) return res.status(404).render('error', { message: 'Aluno não encontrado.' });
  res.redirect('/admin/usuarios?message=' + encodeURIComponent('Acesso aprovado/renovado com sucesso.'));
});

router.post('/admin/usuarios/:id/bloquear', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  await db.query(`UPDATE users SET approval_status='blocked',updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND role<>'admin'`, [id]);
  res.redirect('/admin/usuarios?message=' + encodeURIComponent('Acesso bloqueado.'));
});

router.post('/admin/usuarios/:id/pendente', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  await db.query(`UPDATE users SET approval_status='pending',access_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND role<>'admin'`, [id]);
  res.redirect('/admin/usuarios?message=' + encodeURIComponent('Cadastro devolvido para pendente.'));
});

module.exports = router;
