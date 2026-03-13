const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const config = require('./config');
const dbPath = path.join(__dirname, config.database.path);
let db = null;

// 获取本地时间字符串 (格式: YYYY-MM-DD HH:mm:ss)
function getLocalDateTime() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).toString().padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function initDatabase() {
  // 确保数据库目录存在
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  // 打开数据库连接
  db = new Database(dbPath);

  // 启用外键约束
  db.pragma('foreign_keys = ON');

  // 创建用户表
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME
    )
  `);

  // 创建文件表
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      size INTEGER NOT NULL,
      path TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      created_at DATETIME,
      is_public INTEGER DEFAULT 0,
      is_preview_open INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // 数据库迁移：检查 is_preview_open 字段是否存在，不存在则添加
  const fileColumns = db.prepare("PRAGMA table_info(files)").all();
  const columnNames = fileColumns.map(col => col.name);
  if (!columnNames.includes('is_preview_open')) {
    db.exec("ALTER TABLE files ADD COLUMN is_preview_open INTEGER DEFAULT 0");
    console.log("Database migrated: added is_preview_open column");
  }

  // 创建Token表
  db.exec(`
    CREATE TABLE IF NOT EXISTS tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      user_id INTEGER,
      type TEXT DEFAULT 'permanent',
      expires_at DATETIME,
      disabled INTEGER DEFAULT 0,
      created_at DATETIME
    )
  `);

  // 迁移：为tokens表添加user_id列（如果不存在）
  try {
    db.exec('ALTER TABLE tokens ADD COLUMN user_id INTEGER');
  } catch (e) {
    // 列已存在，忽略错误
  }

  // 创建文件分享表
  db.exec(`
    CREATE TABLE IF NOT EXISTS file_shares (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      token TEXT UNIQUE NOT NULL,
      file_ids TEXT NOT NULL,
      type TEXT DEFAULT 'permanent',
      expires_at DATETIME,
      created_at DATETIME,
      user_id INTEGER NOT NULL,
      password TEXT,
      plain_password TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // 迁移：为file_shares表添加password列（如果不存在）
  try {
    db.exec('ALTER TABLE file_shares ADD COLUMN password TEXT');
  } catch (e) {
    // 列已存在，忽略错误
  }

  // 迁移：为file_shares表添加plain_password列（明文密码）
  try {
    db.exec('ALTER TABLE file_shares ADD COLUMN plain_password TEXT');
  } catch (e) {
    // 列已存在，忽略错误
  }

  // 检查并迁移 collect_links 表
  const collectLinksTableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='collect_links'"
  ).get();

  if (!collectLinksTableExists) {
    // 表不存在，创建新表
    db.exec(`
      CREATE TABLE collect_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT UNIQUE NOT NULL,
        user_id INTEGER NOT NULL,
        used INTEGER DEFAULT 0,
        used_at DATETIME,
        uploader_ip TEXT,
        uploader_ip_location TEXT,
        uploaded_filename TEXT,
        uploaded_size INTEGER,
        created_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
  } else {
    // 表已存在，检查是否需要添加新字段
    const collectColumns = db.prepare("PRAGMA table_info(collect_links)").all();
    const collectColumnNames = collectColumns.map(col => col.name);

    const addColumnIfNotExists = (columnName, columnDef) => {
      if (!collectColumnNames.includes(columnName)) {
        try {
          db.exec(`ALTER TABLE collect_links ADD COLUMN ${columnName} ${columnDef}`);
        } catch (e) {
          // 忽略错误
        }
      }
    };

    addColumnIfNotExists('used_at', 'DATETIME');
    addColumnIfNotExists('uploader_ip', 'TEXT');
    addColumnIfNotExists('uploader_ip_location', 'TEXT');
    addColumnIfNotExists('uploaded_filename', 'TEXT');
    addColumnIfNotExists('uploaded_size', 'INTEGER');
    addColumnIfNotExists('multi_use', 'INTEGER DEFAULT 0');
    addColumnIfNotExists('max_files', 'INTEGER DEFAULT 10');
  }

  // 创建默认管理员账号
  const adminUser = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
  if (!adminUser) {
    const passwordHash = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)').run('admin', passwordHash, getLocalDateTime());
    console.log('Default admin account created: admin / admin123');
  }

  console.log('Database initialized successfully');
  return db;
}

// 封装类似 better-sqlite3 的 API（兼容旧代码）
function prepare(sql) {
  // 检查是否是 INSERT 语句
  const isInsert = sql.trim().toUpperCase().startsWith('INSERT');

  // 检查是否包含 created_at 列
  const hasCreatedAtColumn = isInsert && sql.toLowerCase().includes('created_at');

  // 统计 SQL 中占位符的数量
  const placeholderCount = (sql.match(/\?/g) || []).length;

  return {
    run: (...params) => {
      // 如果是 INSERT 语句且包含 created_at 列但参数中没有提供，自动添加当前时间
      let finalParams = params;
      if (hasCreatedAtColumn && params.length < placeholderCount) {
        finalParams = [...params, getLocalDateTime()];
      }
      return db.prepare(sql).run(...finalParams);
    },
    get: (...params) => {
      return db.prepare(sql).get(...params);
    },
    all: (...params) => {
      return db.prepare(sql).all(...params);
    }
  };
}

// 兼容旧代码
function dbExec(sql) {
  db.exec(sql);
}

function saveDatabase() {
  // better-sqlite3 自动持久化，无需手动保存
  // 保留此函数以兼容旧代码
}

const database = {
  exec: dbExec,
  prepare: prepare
};

module.exports = { initDatabase, db: database, saveDatabase };
