const jwt = require('jsonwebtoken');
const { db } = require('../database');

const JWT_SECRET = 'lpf-secret-key-2024';

function generateToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

function authMiddleware(req, res, next) {
  // 优先从query参数获取token，其次从header获取
  let token = req.query.token || req.headers.authorization;

  if (token && token.startsWith('Bearer ')) {
    token = token.substring(7);
  }

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(decoded.id);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }

  req.user = user;
  next();
}

function apiTokenMiddleware(req, res, next) {
  const token = req.query.token || req.headers['x-api-token'];
  if (!token) {
    return res.status(401).json({ error: 'No API token provided' });
  }

  // 优先检查是否是API Token（Token管理中创建的）
  const tokenInfo = db.prepare('SELECT * FROM tokens WHERE token = ? AND disabled = 0').get(token);
  if (tokenInfo) {
    if (tokenInfo.expires_at && new Date(tokenInfo.expires_at) < new Date()) {
      return res.status(401).json({ error: 'Token expired' });
    }
    req.apiToken = tokenInfo;
    req.isApiToken = true;
    return next();
  }

  // 其次检查是否是JWT Token（登录返回的）
  const decoded = verifyToken(token);
  if (decoded) {
    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(decoded.id);
    if (user) {
      req.user = user;
      req.isApiToken = false;
      return next();
    }
  }

  return res.status(401).json({ error: 'Invalid or disabled token' });
}

// 文件分享Token验证中间件
function fileShareMiddleware(req, res, next) {
  const token = req.query.token;
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  // 查询 file_shares 表
  const share = db.prepare('SELECT * FROM file_shares WHERE token = ?').get(token);
  if (!share) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // 检查是否过期
  if (share.expires_at && new Date(share.expires_at) < new Date()) {
    return res.status(401).json({ error: 'Token expired' });
  }

  // 获取文件信息
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(share.file_id);
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  req.share = share;
  req.file = file;
  next();
}

module.exports = { generateToken, verifyToken, authMiddleware, apiTokenMiddleware, fileShareMiddleware, JWT_SECRET };
