const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const archiver = require('archiver');
const bcrypt = require('bcryptjs');
const { db } = require('../database');
const { authMiddleware } = require('../middlewares/auth');
const config = require('../config');

const router = express.Router();

// 配置文件上传
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', config.upload.dir);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // 确保文件名使用UTF-8编码
    const uniqueName = uuidv4() + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

// 确保multer使用UTF-8
const fileFilter = (req, file, cb) => {
  // 保持原始文件名编码
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 * 1024 } // 50GB limit
});

// 断点上传 - 检查已上传的分片
router.post('/upload/chunk/check', authMiddleware, (req, res) => {
  const { filename, chunkIndex } = req.body;
  const chunkDir = path.join(__dirname, '..', config.upload.dir, 'chunks', filename);

  if (fs.existsSync(chunkDir)) {
    const chunks = fs.readdirSync(chunkDir).filter(f => f.startsWith('chunk_'));
    res.json({ uploadedChunks: chunks.map(c => parseInt(c.split('_')[1])) });
  } else {
    res.json({ uploadedChunks: [] });
  }
});

// 断点上传 - 上传分片
router.post('/upload/chunk', authMiddleware, upload.single('chunk'), (req, res) => {
  const { filename, chunkIndex, totalChunks } = req.body;
  if (!req.file) {
    return res.status(400).json({ error: 'No chunk uploaded' });
  }

  const chunkDir = path.join(__dirname, '..', config.upload.dir, 'chunks', filename);
  if (!fs.existsSync(chunkDir)) {
    fs.mkdirSync(chunkDir, { recursive: true });
  }

  const chunkPath = path.join(chunkDir, `chunk_${chunkIndex}`);
  fs.renameSync(req.file.path, chunkPath);

  // 检查是否所有分片都已上传
  if (parseInt(chunkIndex) === parseInt(totalChunks) - 1) {
    // 合并所有分片
    const finalDir = path.join(__dirname, '..', config.upload.dir);
    const finalPath = path.join(finalDir, filename);

    const writeStream = fs.createWriteStream(finalPath);
    for (let i = 0; i < parseInt(totalChunks); i++) {
      const chunkFile = path.join(chunkDir, `chunk_${i}`);
      if (fs.existsSync(chunkFile)) {
        const data = fs.readFileSync(chunkFile);
        writeStream.write(data);
      }
    }
    writeStream.end();

    // 清理分片目录
    fs.rmSync(chunkDir, { recursive: true });

    // 获取文件大小
    const stats = fs.statSync(finalPath);

    db.prepare(`
      INSERT INTO files (filename, original_name, size, path, user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(filename, filename, stats.size, finalPath, req.user.id);

    res.json({ success: true, filename });
  }

  res.json({ success: true, chunkIndex: parseInt(chunkIndex) });
});

// 获取文件列表 (支持搜索、排序和分页)
router.get('/', authMiddleware, (req, res) => {
  const { search, sort, order, dateFilter, page, pageSize } = req.query;

  let whereSql = ` WHERE 1=1 `;
  const params = [];

  // 搜索功能 - 文件名模糊搜索
  if (search) {
    whereSql += ` AND (f.original_name LIKE ? OR f.filename LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }

  // 日期筛选功能
  if (dateFilter && dateFilter !== 'all') {
    const now = new Date();
    let startDate = null;

    if (dateFilter === 'today') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (dateFilter === 'week') {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (dateFilter === 'month') {
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    if (startDate) {
      whereSql += ` AND f.created_at >= ?`;
      params.push(startDate.toISOString());
    }
  }

  // 获取总数
  const countSql = `SELECT COUNT(*) as total FROM files f JOIN users u ON f.user_id = u.id${whereSql}`;
  const totalResult = db.prepare(countSql).get(...params);
  const total = totalResult?.total || 0;

  // 排序功能
  const sortField = sort === 'size' ? 'f.size' : (sort === 'name' ? 'f.original_name' : 'f.created_at');
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

  // 分页
  const currentPage = parseInt(page) || 1;
  const size = parseInt(pageSize) || 20;
  const offset = (currentPage - 1) * size;

  let sql = `
    SELECT f.*, u.username as owner
    FROM files f
    JOIN users u ON f.user_id = u.id
    ${whereSql}
    ORDER BY ${sortField} ${sortOrder}
    LIMIT ? OFFSET ?
  `;

  const files = db.prepare(sql).all(...params, size, offset);

  res.json({
    list: files,
    total: total,
    page: currentPage,
    pageSize: size,
    totalPages: Math.ceil(total / size)
  });
});

// 上传文件
router.post('/upload', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  // 处理文件名编码问题：将Latin-1解释的字符串转回UTF-8
  let originalname = req.file.originalname;
  try {
    // 如果文件名是乱码的Latin-1字节，重新解释为Buffer然后以UTF-8解码
    const buf = Buffer.from(originalname, 'latin1');
    originalname = buf.toString('utf8');
  } catch (e) {
    // 忽略错误，使用原始名称
  }

  const { filename, size } = req.file;
  const result = db.prepare(`
    INSERT INTO files (filename, original_name, size, path, user_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(filename, originalname, size, req.file.path, req.user.id);

  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(result.lastInsertRowid);
  res.json(file);
});

// 获取文件信息（需要登录或文件开放预览）
router.get('/:id', (req, res) => {
  const file = db.prepare(`
    SELECT f.*, u.username as owner
    FROM files f
    JOIN users u ON f.user_id = u.id
    WHERE f.id = ?
  `).get(req.params.id);

  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  // 检查是否开放预览（无需登录即可查看文件信息）
  // 如果文件未开放预览，则需要登录
  if (!file.is_preview_open) {
    // 需要检查是否已登录
    const token = req.query.token || (req.headers.authorization && req.headers.authorization.replace('Bearer ', ''));
    if (!token) {
      return res.status(401).json({ error: '请先登录' });
    }
    // 验证token
    const { verifyToken } = require('../middlewares/auth');
    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  }

  res.json(file);
});

// 预览文件（需要登录或文件开放预览）
router.get('/:id/preview', (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id);
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  // 检查是否开放预览
  if (!file.is_preview_open) {
    return res.status(403).json({ error: 'Preview is not open for this file' });
  }

  const filePath = path.join(__dirname, '..', config.upload.dir, file.filename);
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
  }

  res.json({
    file,
    fileType,
    previewUrl: `/uploads/${file.filename}`
  });
});

// 下载/预览文件
router.get('/:id/download', authMiddleware, (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id);
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  const filePath = path.join(__dirname, '..', 'static', 'uploads', file.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found on disk' });
  }

  res.download(filePath, file.original_name);
});

// 批量下载文件
router.post('/batch-download', authMiddleware, (req, res) => {
  const { fileIds } = req.body;

  if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
    return res.status(400).json({ error: 'No files selected' });
  }

  // 获取文件信息
  const files = db.prepare(`
    SELECT * FROM files WHERE id IN (${fileIds.map(() => '?').join(',')})
  `).all(...fileIds);

  if (files.length === 0) {
    return res.status(404).json({ error: 'No files found' });
  }

  const uploadDir = path.join(__dirname, '..', config.upload.dir);

  // 设置响应头
  const zipName = `files_${Date.now()}.zip`;
  res.attachment(zipName);
  res.setHeader('Content-Type', 'application/zip');

  const archive = archiver('zip', { zlib: { level: 9 } });

  archive.on('error', (err) => {
    console.error('Archive error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Archive failed' });
    }
  });

  archive.pipe(res);

  // 添加文件到压缩包
  for (const file of files) {
    const filePath = path.join(uploadDir, file.filename);
    if (fs.existsSync(filePath)) {
      archive.file(filePath, { name: file.original_name });
    }
  }

  archive.finalize();
});

// 删除文件
router.delete('/:id', authMiddleware, (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id);
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  // 删除物理文件
  const filePath = path.join(__dirname, '..', 'static', 'uploads', file.filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  // 删除数据库记录
  db.prepare('DELETE FROM files WHERE id = ?').run(req.params.id);
  // 删除与该文件相关的分享记录（通过 file_ids 包含该文件ID）
  const shares = db.prepare("SELECT id, file_ids FROM file_shares WHERE file_ids LIKE ?").all(`%,${req.params.id},%`);
  shares.forEach(share => {
    const fileIds = share.file_ids.split(',').filter(id => id !== req.params.id);
    if (fileIds.length > 0) {
      db.prepare('UPDATE file_shares SET file_ids = ? WHERE id = ?').run(fileIds.join(','), share.id);
    } else {
      db.prepare('DELETE FROM file_shares WHERE id = ?').run(share.id);
    }
  });

  res.json({ message: 'File deleted successfully' });
});

// 分享文件
// 创建分享（支持多文件）
router.post('/shares', authMiddleware, (req, res) => {
  const { title, fileIds, type, expiresAt, password } = req.body;
  const userId = req.user.id;

  if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
    return res.status(400).json({ error: 'No files selected' });
  }

  // 验证文件存在且属于当前用户
  const files = db.prepare(`
    SELECT id FROM files WHERE id IN (${fileIds.map(() => '?').join(',')}) AND user_id = ?
  `).all(...fileIds, userId);

  if (files.length !== fileIds.length) {
    return res.status(400).json({ error: 'Some files not found or not owned by you' });
  }

  const token = uuidv4();
  const expiresAtValue = type === 'temporary' && expiresAt ? expiresAt : null;
  const fileIdsStr = fileIds.join(',');

  // 如果有密码，使用bcrypt加密
  let hashedPassword = null;
  if (password) {
    hashedPassword = bcrypt.hashSync(password, 10);
  }

  db.prepare(`
    INSERT INTO file_shares (title, token, file_ids, type, expires_at, created_at, user_id, password, plain_password)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title || 'Untitled', token, fileIdsStr, type || 'permanent', expiresAtValue, new Date().toISOString(), userId, hashedPassword, password || null);

  const share = db.prepare('SELECT * FROM file_shares WHERE token = ?').get(token);
  res.json(share);
});

// 获取分享列表（支持搜索和过滤和分页）
router.get('/shares/list', authMiddleware, (req, res) => {
  const { title, type, sort, page = 1, pageSize = 20 } = req.query;
  const userId = req.user.id;
  const pageNum = parseInt(page) || 1;
  const pageSizeNum = parseInt(pageSize) || 20;
  const offset = (pageNum - 1) * pageSizeNum;

  let whereSql = ` WHERE fs.user_id = ?`;
  const params = [userId];

  if (title) {
    whereSql += ` AND fs.title LIKE ?`;
    params.push(`%${title}%`);
  }

  if (type === 'permanent') {
    whereSql += ` AND fs.type = 'permanent'`;
  } else if (type === 'temporary') {
    whereSql += ` AND fs.type = 'temporary'`;
  }

  // 获取总数
  const countSql = `SELECT COUNT(*) as total FROM file_shares fs ${whereSql}`;
  const countResult = db.prepare(countSql).get(...params);
  const total = countResult.total;

  // 排序
  let orderSql = sort === 'created_asc' ? ' ORDER BY fs.created_at ASC' : ' ORDER BY fs.created_at DESC';

  // 分页查询
  const sql = `
    SELECT fs.*, f.original_name, f.size
    FROM file_shares fs
    JOIN files f ON SUBSTR(fs.file_ids, 1, INSTR(fs.file_ids || ',', ',') - 1) = CAST(f.id AS TEXT)
    ${whereSql} ${orderSql} LIMIT ? OFFSET ?
  `;
  const shares = db.prepare(sql).all(...params, pageSizeNum, offset);

  // 获取每个分享的文件列表
  const sharesWithFiles = shares.map(share => {
    const fileIds = share.file_ids.split(',').map(id => parseInt(id));
    const files = db.prepare(`
      SELECT id, original_name, size FROM files WHERE id IN (${fileIds.map(() => '?').join(',')})
    `).all(...fileIds);
    return { ...share, files };
  });

  res.json({
    list: sharesWithFiles,
    page: pageNum,
    pageSize: pageSizeNum,
    total: total,
    totalPages: Math.ceil(total / pageSizeNum)
  });
});

// 更新分享（修改有效期）
router.put('/shares/:id', authMiddleware, (req, res) => {
  const { title, type, expiresAt, password } = req.body;
  const userId = req.user.id;
  const shareId = req.params.id;

  // 验证分享属于当前用户
  const share = db.prepare('SELECT * FROM file_shares WHERE id = ? AND user_id = ?').get(shareId, userId);
  if (!share) {
    return res.status(404).json({ error: 'Share not found' });
  }

  // 只有当改为永久时才清除过期时间；限时模式保留原来的过期时间
  let expiresAtValue;
  const finalType = type || share.type;
  if (finalType === 'permanent') {
    expiresAtValue = null; // 改为永久时清除过期时间
  } else if (finalType === 'temporary' && expiresAt) {
    expiresAtValue = expiresAt; // 限时且有设置过期时间时使用新值
  } else {
    expiresAtValue = share.expires_at; // 否则保留原来的过期时间
  }

  const finalTitle = title || share.title;

  // 处理密码：如果传了password字段且不为空，则更新密码；如果是null则保持原密码；如果是空字符串则清空密码
  let passwordValue = share.password;
  let plainPasswordValue = share.plain_password;
  if (password !== undefined) {
    if (password === null) {
      // null 表示保持原密码，不做任何修改
    } else if (password) {
      passwordValue = bcrypt.hashSync(password, 10);
      plainPasswordValue = password; // 保存明文密码
    } else {
      passwordValue = null; // 清空密码
      plainPasswordValue = null;
    }
  }

  console.log('Updating share:', { shareId, finalType, expiresAtValue, finalTitle, hasPassword: !!passwordValue });

  db.prepare(`
    UPDATE file_shares SET title = ?, type = ?, expires_at = ?, password = ?, plain_password = ? WHERE id = ?
  `).run(finalTitle, finalType, expiresAtValue, passwordValue, plainPasswordValue, shareId);

  const updatedShare = db.prepare('SELECT * FROM file_shares WHERE id = ?').get(shareId);
  console.log('Updated share:', updatedShare);
  res.json(updatedShare);
});

// 删除分享
router.delete('/shares/:id', authMiddleware, (req, res) => {
  const userId = req.user.id;
  const shareId = req.params.id;

  // 验证分享属于当前用户
  const share = db.prepare('SELECT * FROM file_shares WHERE id = ? AND user_id = ?').get(shareId, userId);
  if (!share) {
    return res.status(404).json({ error: 'Share not found' });
  }

  db.prepare('DELETE FROM file_shares WHERE id = ?').run(shareId);
  res.json({ message: 'Share deleted successfully' });
});

// 设置预览开放状态
router.put('/:id/preview-open', authMiddleware, (req, res) => {
  const { open } = req.body;
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id);
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  db.prepare('UPDATE files SET is_preview_open = ? WHERE id = ?').run(open ? 1 : 0, req.params.id);

  const updatedFile = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id);
  res.json(updatedFile);
});

module.exports = router;
