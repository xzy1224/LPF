const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../database');
const { generateToken, authMiddleware } = require('../middlewares/auth');

const router = express.Router();

// 登录
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = generateToken(user);
  res.json({ token, user: { id: user.id, username: user.username } });
});

// 修改密码
router.put('/password', authMiddleware, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: 'Old and new password required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(oldPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect old password' });
  }

  const passwordHash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, req.user.id);
  res.json({ message: 'Password updated successfully' });
});

// 获取当前用户信息
router.get('/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// 注册
router.post('/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  // 检查用户名是否已存在
  const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existingUser) {
    return res.status(400).json({ error: 'Username already exists' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)').run(username, passwordHash);

  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(result.lastInsertRowid);
  const token = generateToken(user);
  res.json({ token, user });
});

module.exports = router;
