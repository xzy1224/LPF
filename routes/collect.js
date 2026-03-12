const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const config = require('../config');

const uploadDir = path.join(__dirname, '..', config.upload.dir);

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: config.upload.maxFileSize }
});

// 获取所有收取链接
router.get('/list', (req, res) => {
  const token = req.query.token;

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // 验证token获取用户
  const user = db.prepare(`SELECT id FROM users WHERE id = (SELECT user_id FROM tokens WHERE token = ? AND disabled = 0)`).get(token);

  if (!user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const userId = user.id;

  // 获取该用户创建的所有收取链接
  const links = db.prepare(`
    SELECT cl.id, cl.token, cl.used, cl.created_at, u.username as creator
    FROM collect_links cl
    JOIN users u ON cl.user_id = u.id
    WHERE cl.user_id = ?
    ORDER BY cl.created_at DESC
  `).all(userId);

  res.json(links);
});

// 生成新的收取链接
router.post('/generate', (req, res) => {
  const token = req.query.token;
  const { multi_use, max_files } = req.body;

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // 验证token获取用户
  const user = db.prepare(`SELECT id FROM users WHERE id = (SELECT user_id FROM tokens WHERE token = ? AND disabled = 0)`).get(token);

  if (!user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const userId = user.id;
  const collectToken = uuidv4().slice(0, 8);
  const multiUse = multi_use ? 1 : 0;
  const maxFiles = max_files || 10;

  try {
    db.prepare(`
      INSERT INTO collect_links (token, user_id, multi_use, max_files, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(collectToken, userId, multiUse, maxFiles, new Date().toISOString());
    res.json({
      url: `/collect/${collectToken}`,
      token: collectToken,
      multi_use: multiUse,
      max_files: maxFiles
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate link' });
  }
});

// 删除收取链接
router.delete('/:id', (req, res) => {
  const token = req.query.token;
  const id = req.params.id;

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // 验证token获取用户
  const user = db.prepare(`SELECT id FROM users WHERE id = (SELECT user_id FROM tokens WHERE token = ? AND disabled = 0)`).get(token);

  if (!user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const userId = user.id;

  try {
    db.prepare('DELETE FROM collect_links WHERE id = ? AND user_id = ?').run(id, userId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete link' });
  }
});

// 收取页面上传文件（支持多文件）
router.post('/upload/:token', (req, res) => {
  const collectToken = req.params.token;

  // 验证收取链接
  const link = db.prepare('SELECT id, user_id, used, multi_use, max_files FROM collect_links WHERE token = ?').get(collectToken);

  if (!link) {
    return res.status(404).json({ error: 'Invalid collect link' });
  }

  const linkId = link.id;
  const userId = link.user_id;
  const multiUse = link.multi_use || 0;
  const maxFiles = link.max_files || 10;

  // 检查链接是否已使用（如果是单次使用模式）
  if (!multiUse && link.used) {
    return res.status(410).json({ error: 'This collect link has been used' });
  }

  // 获取用户信息
  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);

  // 处理多文件上传
  upload.array('files', maxFiles)(req, res, (err) => {
    if (err) {
      return res.status(500).json({ error: 'Upload failed: ' + err.message });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // 检查文件数量限制
    if (req.files.length > maxFiles) {
      return res.status(400).json({ error: `Maximum ${maxFiles} files allowed` });
    }

    // 保存所有文件信息到数据库
    const uploadedFiles = [];
    let totalSize = 0;

    try {
      for (const file of req.files) {
        const fileId = uuidv4();
        const originalName = file.originalname;
        const fileSize = file.size;
        const filename = file.filename;

        db.prepare(`
          INSERT INTO files (filename, original_name, size, path, user_id, is_preview_open, created_at)
          VALUES (?, ?, ?, ?, ?, 0, ?)
        `).run(filename, originalName, fileSize, file.path, userId);

        uploadedFiles.push({
          id: fileId,
          original_name: originalName,
          size: fileSize
        });
        totalSize += fileSize;
      }

      // 如果是单次使用模式，标记链接为已使用
      if (!multiUse) {
        db.prepare('UPDATE collect_links SET used = 1 WHERE id = ?').run(linkId);
      }

      // 更新收取链接的上传信息
      db.prepare(`
        UPDATE collect_links
        SET uploaded_filename = ?, uploaded_size = ?
        WHERE id = ?
      `).run(
        uploadedFiles.map(f => f.original_name).join(', '),
        totalSize,
        linkId
      );

      res.json({
        success: true,
        files: uploadedFiles,
        count: uploadedFiles.length
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to save file' });
    }
  });
});

module.exports = router;
