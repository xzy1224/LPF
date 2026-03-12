const express = require('express');
const cors = require('cors');
const path = require('path');
const os = require('os');
const bcrypt = require('bcryptjs');
const { initDatabase } = require('./database');
const config = require('./config');

const app = express();
const PORT = process.env.PORT || config.server.port;

// 获取本机 IP 地址
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// 启用 gzip 压缩
const compression = require('compression');
app.use(compression());

// 中间件
app.use(cors());
app.use(express.json({ charset: 'utf-8' }));
app.use(express.urlencoded({ extended: true, charset: 'utf-8' }));

// 静态文件 - 添加缓存头
app.use(express.static(path.join(__dirname, 'static'), {
  maxAge: '1d',
  etag: false
}));
app.use('/uploads', express.static(path.join(__dirname, 'static', 'uploads'), {
  maxAge: '1d',
  etag: false
}));

// 等待数据库初始化后再加载路由和启动服务器
(async () => {
  await initDatabase();
  console.log('Database initialized');

  // API路由
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/files', require('./routes/files'));
  app.use('/api/tokens', require('./routes/token'));
  // collect 功能已集成到 api.js 中
  app.use('/api', require('./routes/api'));

  // 文件分享公开访问
  app.get('/share/:token', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'share.html'));
  });

  // 获取分享信息
  app.get('/api/share/:token', (req, res) => {
    const { db } = require('./database');
    const share = db.prepare('SELECT * FROM file_shares WHERE token = ?').get(req.params.token);

    console.log('Checking share:', req.params.token, 'type:', share?.type, 'expires_at:', share?.expires_at, 'hasPassword:', !!share?.password);

    if (!share) {
      return res.status(404).json({ error: 'Share not found' });
    }

    // 检查是否过期
    if (share.type === 'temporary' && share.expires_at) {
      const expiresAt = new Date(share.expires_at);
      if (expiresAt < new Date()) {
        return res.status(410).json({ error: 'Share has expired' });
      }
    }

    // 检查密码
    if (share.password) {
      const password = req.query.password || req.headers['x-share-password'];
      if (!password) {
        return res.status(401).json({ error: '请输入访问密码', requiresPassword: true });
      }
      if (!bcrypt.compareSync(password, share.password)) {
        return res.status(401).json({ error: '密码错误，请重新输入', requiresPassword: true, wrongPassword: true });
      }
    }

    // 获取分享的文件列表
    const fileIds = share.file_ids.split(',').map(id => parseInt(id));
    const files = db.prepare(`
      SELECT id, original_name, size, filename FROM files WHERE id IN (${fileIds.map(() => '?').join(',')})
    `).all(...fileIds);

    res.json({ ...share, files, password: undefined });
  });

  // 批量下载分享的文件
  app.get('/api/share/:token/download', (req, res) => {
    const { db } = require('./database');
    const fs = require('fs');
    const archiver = require('archiver');

    const share = db.prepare('SELECT * FROM file_shares WHERE token = ?').get(req.params.token);

    if (!share) {
      return res.status(404).json({ error: 'Share not found' });
    }

    // 检查是否过期
    if (share.type === 'temporary' && share.expires_at) {
      const expiresAt = new Date(share.expires_at);
      if (expiresAt < new Date()) {
        return res.status(410).json({ error: 'Share has expired' });
      }
    }

    // 检查密码
    if (share.password) {
      const password = req.query.password || req.headers['x-share-password'];
      if (!password) {
        return res.status(401).json({ error: '请输入访问密码', requiresPassword: true });
      }
      if (!bcrypt.compareSync(password, share.password)) {
        return res.status(401).json({ error: '密码错误，请重新输入', requiresPassword: true, wrongPassword: true });
      }
    }

    // 获取分享的文件列表
    const fileIds = share.file_ids.split(',').map(id => parseInt(id));
    const files = db.prepare(`
      SELECT * FROM files WHERE id IN (${fileIds.map(() => '?').join(',')})
    `).all(...fileIds);

    const uploadDir = path.join(__dirname, config.upload.dir);

    // 设置响应头
    const zipName = share.title ? `${share.title}.zip` : `share_${Date.now()}.zip`;
    res.attachment(zipName);

    const archive = archiver('zip', { zlib: { level: 9 } });
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

  // 收取页面路由
  app.get('/collect/:token', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'collect.html'));
  });

  // API文档页面
  app.get('/api-docs', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'api-docs.html'));
  });

  // 开放API文档页面
  app.get('/openapi-docs', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'openapi-docs.html'));
  });

  // 主页面
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'index.html'));
  });

  // 开放API分享页面
  app.get('/openapi', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'index.html'));
  });

  // 全局错误处理中间件 - 确保API错误返回JSON
  app.use('/api', (err, req, res, next) => {
    console.error('API Error:', err);
    res.status(err.status || 500).json({
      error: err.message || 'Internal server error'
    });
  });

  // 启动服务器
  const localIP = getLocalIP();
  app.listen(PORT, () => {
    console.log(`LPF Server running on http://localhost:${PORT}`);
    console.log(`LPF Server running on http://${localIP}:${PORT}`);
    console.log(`Default admin account: admin / admin123`);
  });
})();
