const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../database');
const { apiTokenMiddleware, authMiddleware, fileShareMiddleware } = require('../middlewares/auth');
const config = require('../config');

const router = express.Router();

// 获取客户端真实IP
function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         req.headers['x-real-ip'] ||
         req.connection?.remoteAddress ||
         req.socket?.remoteAddress ||
         'unknown';
}

// 文件收取 - 生成收取链接
router.post('/collect/generate', authMiddleware, (req, res) => {
  const token = uuidv4();
  const { multi_use, max_files } = req.body;

  db.prepare(`
    INSERT INTO collect_links (token, user_id, multi_use, max_files, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(token, req.user.id, multi_use ? 1 : 0, max_files || 10);

  res.json({ token, url: `/collect/${token}`, multi_use: multi_use ? 1 : 0, max_files: max_files || 10 });
});

// 获取收取链接列表 (支持分页)
router.get('/collect/list', authMiddleware, (req, res) => {
  const { page, pageSize } = req.query;

  // 获取总数
  const totalResult = db.prepare('SELECT COUNT(*) as total FROM collect_links').get();
  const total = totalResult?.total || 0;

  // 分页
  const currentPage = parseInt(page) || 1;
  const size = parseInt(pageSize) || 20;
  const offset = (currentPage - 1) * size;

  const links = db.prepare(`
    SELECT cl.*, u.username as creator
    FROM collect_links cl
    JOIN users u ON cl.user_id = u.id
    ORDER BY cl.created_at DESC
    LIMIT ? OFFSET ?
  `).all(size, offset);

  res.json({
    list: links,
    total: total,
    page: currentPage,
    pageSize: size,
    totalPages: Math.ceil(total / size)
  });
});

// 删除收取链接
router.delete('/collect/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM collect_links WHERE id = ?').run(req.params.id);
  res.json({ message: 'Collect link deleted successfully' });
});

// 收取页面 - 上传配置
const collectStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', config.upload.dir);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = uuidv4() + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const collectUpload = multer({
  storage: collectStorage,
  limits: { fileSize: config.upload.maxFileSize }
});

// 收取页面 - 获取收取链接信息
router.get('/collect/:token', (req, res) => {
  const link = db.prepare('SELECT * FROM collect_links WHERE token = ?').get(req.params.token);
  if (!link) {
    return res.status(404).json({ error: 'Invalid collect link' });
  }

  res.json({
    valid: true,
    used: link.used === 1,
    multi_use: link.multi_use,
    max_files: link.max_files
  });
});

// 收取页面 - 上传文件（支持多文件）
router.post('/collect/:token', collectUpload.array('files'), (req, res) => {
  const link = db.prepare('SELECT * FROM collect_links WHERE token = ?').get(req.params.token);
  if (!link) {
    return res.status(404).json({ error: 'Invalid collect link' });
  }

  const multiUse = link.multi_use == 1;
  const maxFiles = link.max_files || 10;

  // 检查链接是否已使用（如果是单次使用模式）
  if (!multiUse && link.used) {
    return res.status(410).json({ error: 'This collect link has been used' });
  }

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  // 检查文件数量限制
  if (req.files.length > maxFiles) {
    return res.status(400).json({ error: `Maximum ${maxFiles} files allowed` });
  }

  // 获取客户端IP
  const clientIp = getClientIp(req);

  // 保存所有文件到数据库
  const uploadedFiles = [];
  let totalSize = 0;

  for (const file of req.files) {
    // 处理文件名编码问题
    let originalname = file.originalname;
    try {
      const buf = Buffer.from(originalname, 'latin1');
      originalname = buf.toString('utf8');
    } catch (e) {
      // 忽略错误，使用原始名称
    }

    const { filename, size } = file;
    db.prepare(`
      INSERT INTO files (filename, original_name, size, path, user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(filename, originalname, size, file.path, link.user_id);

    uploadedFiles.push({
      original_name: originalname,
      size: size
    });
    totalSize += size;
  }

  // 如果是单次使用模式，标记链接为已使用
  if (!multiUse) {
    db.prepare(`
      UPDATE collect_links
      SET used = 1, used_at = datetime('now', 'localtime'), uploader_ip = ?, uploaded_filename = ?, uploaded_size = ?
      WHERE id = ?
    `).run(clientIp, uploadedFiles.map(f => f.original_name).join(', '), totalSize, link.id);
  } else {
    // 多文件模式只更新上传信息
    db.prepare(`
      UPDATE collect_links
      SET used_at = datetime('now', 'localtime'), uploader_ip = ?, uploaded_filename = ?, uploaded_size = ?
      WHERE id = ?
    `).run(clientIp, uploadedFiles.map(f => f.original_name).join(', '), totalSize, link.id);
  }

  res.json({
    success: true,
    message: 'Files uploaded successfully',
    files: uploadedFiles,
    count: uploadedFiles.length
  });
});

// 开放API - 文件列表查询
router.get('/public/files', apiTokenMiddleware, (req, res) => {
  const { page, pageSize } = req.query;
  const userId = req.apiToken ? req.apiToken.user_id : (req.user ? req.user.id : null);

  if (!userId) {
    return res.status(401).json({ error: 'User not found' });
  }

  // 获取总数
  const totalResult = db.prepare('SELECT COUNT(*) as total FROM files WHERE user_id = ?').get(userId);
  const total = totalResult?.total || 0;

  // 分页
  const currentPage = parseInt(page) || 1;
  const size = parseInt(pageSize) || 20;
  const offset = (currentPage - 1) * size;

  const files = db.prepare(`
    SELECT f.id, f.filename, f.original_name, f.size, f.created_at, f.is_preview_open
    FROM files f
    WHERE f.user_id = ?
    ORDER BY f.created_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, size, offset);

  res.json({
    list: files,
    total: total,
    page: currentPage,
    pageSize: size,
    totalPages: Math.ceil(total / size)
  });
});

// 开放API - 文件上传
const publicUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(__dirname, '..', config.upload.dir);
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const uniqueName = uuidv4() + path.extname(file.originalname);
      cb(null, uniqueName);
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024 * 1024 }
});

router.post('/public/upload', apiTokenMiddleware, publicUpload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const userId = req.apiToken ? req.apiToken.user_id : (req.user ? req.user.id : null);
  const filePath = path.join(__dirname, '..', 'static', 'uploads', req.file.filename);

  const result = db.prepare(`
    INSERT INTO files (filename, original_name, size, path, user_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.file.filename, req.file.originalname, req.file.size, filePath, userId, new Date().toISOString());

  res.json({
    id: result.lastInsertRowid,
    filename: req.file.filename,
    original_name: req.file.originalname,
    size: req.file.size,
    message: 'File uploaded successfully'
  });
});

// 开放API - 批量文件上传
const publicMultipleUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(__dirname, '..', config.upload.dir);
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const uniqueName = uuidv4() + path.extname(file.originalname);
      cb(null, uniqueName);
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024 * 1024 }
});

router.post('/public/upload/multiple', apiTokenMiddleware, publicMultipleUpload.array('files', 50), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const userId = req.apiToken ? req.apiToken.user_id : (req.user ? req.user.id : null);
  const uploadedFiles = [];

  for (const file of req.files) {
    const filePath = path.join(__dirname, '..', 'static', 'uploads', file.filename);
    const result = db.prepare(`
      INSERT INTO files (filename, original_name, size, path, user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(file.filename, file.originalname, file.size, filePath, userId, new Date().toISOString());

    uploadedFiles.push({
      id: result.lastInsertRowid,
      filename: file.filename,
      original_name: file.originalname,
      size: file.size
    });
  }

  res.json({
    total: uploadedFiles.length,
    files: uploadedFiles,
    message: `${uploadedFiles.length} files uploaded successfully`
  });
});

// 开放API - 文件删除
router.delete('/public/files/:id', apiTokenMiddleware, (req, res) => {
  const userId = req.apiToken ? req.apiToken.user_id : (req.user ? req.user.id : null);

  const file = db.prepare('SELECT * FROM files WHERE id = ? AND user_id = ?').get(req.params.id, userId);
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  // 删除文件
  const filePath = path.join(__dirname, '..', 'static', 'uploads', file.filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  // 删除数据库记录
  db.prepare('DELETE FROM files WHERE id = ?').run(req.params.id);

  res.json({ message: 'File deleted successfully' });
});

// 开放API - 分片上传检查
router.post('/public/upload/chunk/check', apiTokenMiddleware, (req, res) => {
  const { filename, chunk, chunks } = req.body;
  const userId = req.apiToken ? req.apiToken.user_id : (req.user ? req.user.id : null);

  const chunkDir = path.join(__dirname, '..', 'static', 'uploads', 'chunks', `${filename}_${userId}`);

  // 获取已上传的分片
  let uploadedChunks = [];
  if (fs.existsSync(chunkDir)) {
    uploadedChunks = fs.readdirSync(chunkDir).map(f => parseInt(f));
  }

  res.json({
    uploadedChunks,
    needUpload: !uploadedChunks.includes(parseInt(chunk))
  });
});

// 开放API - 分片上传
const publicChunkUpload = multer({ storage: multer.memoryStorage() });

router.post('/public/upload/chunk', apiTokenMiddleware, publicChunkUpload.single('chunkData'), (req, res) => {
  const { filename, chunk, chunks } = req.body;
  const userId = req.apiToken ? req.apiToken.user_id : (req.user ? req.user.id : null);

  if (!req.file) {
    return res.status(400).json({ error: 'No chunk uploaded' });
  }

  const chunkDir = path.join(__dirname, '..', 'static', 'uploads', 'chunks', `${filename}_${userId}`);
  if (!fs.existsSync(chunkDir)) {
    fs.mkdirSync(chunkDir, { recursive: true });
  }

  const chunkPath = path.join(chunkDir, chunk);
  fs.writeFileSync(chunkPath, req.file.buffer);

  // 检查是否所有分片都已上传
  const uploadedChunks = fs.readdirSync(chunkDir).map(f => parseInt(f));

  if (uploadedChunks.length === parseInt(chunks)) {
    // 合并所有分片
    const uploadDir = path.join(__dirname, '..', config.upload.dir);
    const finalPath = path.join(uploadDir, filename);

    const writeStream = fs.createWriteStream(finalPath);
    for (let i = 0; i < parseInt(chunks); i++) {
      const chunkFile = fs.readFileSync(path.join(chunkDir, i.toString()));
      writeStream.write(chunkFile);
    }
    writeStream.end();

    // 计算文件大小
    const stats = fs.statSync(finalPath);

    // 保存到数据库
    const result = db.prepare(`
      INSERT INTO files (filename, original_name, size, user_id, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(filename, filename, stats.size, userId, new Date().toISOString());

    // 清理分片目录
    fs.rmSync(chunkDir, { recursive: true });

    res.json({
      id: result.lastInsertRowid,
      filename,
      size: stats.size,
      message: 'File uploaded successfully'
    });
  } else {
    res.json({
      chunk: parseInt(chunk),
      uploaded: uploadedChunks.length,
      total: parseInt(chunks),
      message: 'Chunk uploaded successfully'
    });
  }
});

// 开放API - 下载文件
router.get('/public/download/:id', apiTokenMiddleware, (req, res) => {
  const userId = req.apiToken ? req.apiToken.user_id : (req.user ? req.user.id : null);

  const file = db.prepare('SELECT * FROM files WHERE id = ? AND user_id = ?').get(req.params.id, userId);
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  const filePath = path.join(__dirname, '..', 'static', 'uploads', file.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found on disk' });
  }

  res.download(filePath, file.original_name);
});

// 文件分享 - 通过分享token下载文件
router.get('/share/download/:id', fileShareMiddleware, (req, res) => {
  const file = req.file;
  const filePath = path.join(__dirname, '..', 'static', 'uploads', file.filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found on disk' });
  }

  res.download(filePath, file.original_name);
});

// 公开预览 - 通过 token 预览文件（无需登录）或文件开放预览
router.get('/public/preview/:id', (req, res) => {
  const token = req.query.token;

  // 获取文件信息（无论是否有token都先检查文件是否存在且开放预览）
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id);
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  // 检查是否开放预览（文件本身开放预览，无需token）
  if (file.is_preview_open) {
    // 文件已开放预览，直接提供预览
    return servePreviewFile(file, res);
  }

  // 如果文件未开放预览，则需要token
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  // 验证 token 是否有效
  const tokenInfo = db.prepare('SELECT * FROM tokens WHERE token = ? AND disabled = 0').get(token);
  if (!tokenInfo) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  if (tokenInfo.expires_at && new Date(tokenInfo.expires_at) < new Date()) {
    return res.status(401).json({ error: 'Token expired' });
  }

  // 通过token验证，提供预览
  return servePreviewFile(file, res);
});

// 辅助函数：提供预览文件
function servePreviewFile(file, res) {
  const filePath = path.join(__dirname, '..', 'static', 'uploads', file.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found on disk' });
  }

  const ext = path.extname(file.original_name).toLowerCase();
  const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
  const textExts = ['.txt', '.json', '.js', '.css', '.html', '.xml', '.md', '.log'];
  const audioExts = ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac'];
  const videoExts = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv'];

  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.txt': 'text/plain',
    '.json': 'application/json',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.html': 'text/html',
    '.xml': 'application/xml',
    '.md': 'text/markdown',
    '.log': 'text/plain',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.ogg': 'video/ogg',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska',
    '.pdf': 'application/pdf'
  };

  const fileType = {
    type: 'unknown',
    mimeType: mimeTypes[ext] || 'application/octet-stream'
  };

  if (imageExts.includes(ext)) {
    fileType.type = 'image';
  } else if (textExts.includes(ext)) {
    fileType.type = 'text';
  } else if (audioExts.includes(ext)) {
    fileType.type = 'audio';
  } else if (videoExts.includes(ext)) {
    fileType.type = 'video';
  } else if (ext === '.pdf') {
    fileType.type = 'pdf';
    fileType.mimeType = 'application/pdf';
  }

  // 直接返回文件内容
  res.setHeader('Content-Type', fileType.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.original_name)}"`);
  res.sendFile(filePath);
}

module.exports = router;
