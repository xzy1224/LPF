const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../database');
const { authMiddleware } = require('../middlewares/auth');

const router = express.Router();

// 获取Token列表 (支持分页)
router.get('/', authMiddleware, (req, res) => {
  const { page, pageSize } = req.query;

  // 获取总数
  const totalResult = db.prepare('SELECT COUNT(*) as total FROM tokens').get();
  const total = totalResult?.total || 0;

  // 分页
  const currentPage = parseInt(page) || 1;
  const size = parseInt(pageSize) || 20;
  const offset = (currentPage - 1) * size;

  const tokens = db.prepare('SELECT * FROM tokens ORDER BY created_at DESC LIMIT ? OFFSET ?').all(size, offset);

  res.json({
    list: tokens,
    total: total,
    page: currentPage,
    pageSize: size,
    totalPages: Math.ceil(total / size)
  });
});

// 创建Token
router.post('/', authMiddleware, (req, res) => {
  const { name, type, expiresAt } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Token name required' });
  }

  const token = uuidv4();
  const expiresAtValue = type === 'temporary' && expiresAt ? expiresAt : null;

  db.prepare(`
    INSERT INTO tokens (name, token, user_id, type, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, token, req.user.id, type || 'permanent', expiresAtValue, new Date().toISOString());

  const newToken = db.prepare('SELECT * FROM tokens WHERE token = ?').get(token);
  res.json(newToken);
});

// 更新Token
router.put('/:id', authMiddleware, (req, res) => {
  const { name, disabled } = req.body;
  const token = db.prepare('SELECT * FROM tokens WHERE id = ?').get(req.params.id);
  if (!token) {
    return res.status(404).json({ error: 'Token not found' });
  }

  if (name) {
    db.prepare('UPDATE tokens SET name = ? WHERE id = ?').run(name, req.params.id);
  }
  if (disabled !== undefined) {
    // 显式转换为布尔值，避免字符串 "false" 导致的问题
    const disabledValue = disabled === true || disabled === 'true' || disabled === 1 || disabled === '1' ? 1 : 0;
    db.prepare('UPDATE tokens SET disabled = ? WHERE id = ?').run(disabledValue, req.params.id);
  }

  const updatedToken = db.prepare('SELECT * FROM tokens WHERE id = ?').get(req.params.id);
  res.json(updatedToken);
});

// 删除Token
router.delete('/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM tokens WHERE id = ?').run(req.params.id);
  res.json({ message: 'Token deleted successfully' });
});

module.exports = router;
