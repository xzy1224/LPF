const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const config = require('./config');
const dbPath = path.join(__dirname, config.database.path);
let sqlDb = null;

// 获取本地时间字符串 (格式: YYYY-MM-DD HH:mm:ss)
function getLocalDateTime() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

async function initDatabase() {
  // Ensure database directory exists
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const wasmPath = path.join(__dirname, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  const wasmBinary = fs.readFileSync(wasmPath);
  const SQL = await initSqlJs({ wasmBinary });

  // 加载现有数据库，如果不存在则创建新数据库
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    sqlDb = new SQL.Database(fileBuffer);
  } else {
    sqlDb = new SQL.Database();
  }

  // 创建用户表
  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME
    )
  `);

  // 创建文件表
  sqlDb.run(`
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
  try {
    // 检查表是否有数据
    const countResult = sqlDb.exec("SELECT COUNT(*) FROM files");
    if (countResult.length > 0 && countResult[0].values[0][0] > 0) {
      // 表有数据，检查 is_preview_open 字段
      sqlDb.exec("SELECT is_preview_open FROM files LIMIT 1");
    }
  } catch (e) {
    // 字段不存在，添加新字段
    try {
      sqlDb.run("ALTER TABLE files ADD COLUMN is_preview_open INTEGER DEFAULT 0");
      console.log("Database migrated: added is_preview_open column");
    } catch (alterError) {
      // 如果 ALTER TABLE 失败（某些 sqlite 版本不支持），则重建表
      sqlDb.run("DROP TABLE IF EXISTS files");
      sqlDb.run(`
        CREATE TABLE files (
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
      console.log("Database migrated: recreated files table with is_preview_open column");
    }
  }

  // 创建Token表
  sqlDb.run(`
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
    sqlDb.run('ALTER TABLE tokens ADD COLUMN user_id INTEGER');
  } catch (e) {
    // 列已存在，忽略错误
  }

  // 创建文件分享表
  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS file_shares (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      token TEXT UNIQUE NOT NULL,
      file_ids TEXT NOT NULL,
      type TEXT DEFAULT 'permanent',
      expires_at DATETIME,
      created_at DATETIME,
      user_id INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // 迁移：检测并修复 file_shares 表结构（旧版本使用 file_id 单数）
  let needsMigration = false;
  try {
    // 检查是否存在旧结构的 file_id 列
    sqlDb.exec("SELECT file_id FROM file_shares LIMIT 1");
    needsMigration = true;
  } catch (e) {
    // 检查是否有 file_ids 列
    try {
      sqlDb.exec("SELECT file_ids FROM file_shares LIMIT 1");
    } catch (e2) {
      needsMigration = true;
    }
  }

  if (needsMigration) {
    try {
      // 备份旧数据（如果有）
      let oldData = [];
      try {
        oldData = sqlDb.exec("SELECT * FROM file_shares");
      } catch (e) {}

      // 重建表
      sqlDb.run("DROP TABLE IF EXISTS file_shares");
      sqlDb.run(`
        CREATE TABLE file_shares (
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
      console.log("Database migrated: recreated file_shares table");
    } catch (e) {
      console.error("Error migrating file_shares:", e);
    }
  }

  // 迁移：为file_shares表添加password列（如果不存在）
  try {
    sqlDb.run('ALTER TABLE file_shares ADD COLUMN password TEXT');
  } catch (e) {
    // 列已存在，忽略错误
  }

  // 迁移：为file_shares表添加plain_password列（明文密码）
  try {
    sqlDb.run('ALTER TABLE file_shares ADD COLUMN plain_password TEXT');
  } catch (e) {
    // 列已存在，忽略错误
  }

  // 检查并迁移 collect_links 表
  let collectLinksTableExists = false;
  try {
    const collectLinksResult = sqlDb.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='collect_links'");
    collectLinksTableExists = collectLinksResult.length > 0 && collectLinksResult[0].values.length > 0;
  } catch (e) {
    collectLinksTableExists = false;
  }

  if (!collectLinksTableExists) {
    // 表不存在，创建新表
    sqlDb.run(`
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
    const addColumnIfNotExists = (columnName, columnDef) => {
      try {
        sqlDb.exec(`SELECT ${columnName} FROM collect_links LIMIT 1`);
      } catch (e) {
        try {
          sqlDb.run(`ALTER TABLE collect_links ADD COLUMN ${columnName} ${columnDef}`);
        } catch (e2) {
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
  const result = sqlDb.exec("SELECT id FROM users WHERE username = 'admin'");
  if (result.length === 0 || result[0].values.length === 0) {
    const passwordHash = bcrypt.hashSync('admin123', 10);
    sqlDb.run('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)', ['admin', passwordHash, getLocalDateTime()]);
    console.log('Default admin account created: admin / admin123');
  }

  saveDatabase();
  return sqlDb;
}

function saveDatabase() {
  if (sqlDb) {
    const data = sqlDb.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  }
}

// 封装类似 better-sqlite3 的 API
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
      sqlDb.run(sql, finalParams);
      saveDatabase();
      // 安全获取 lastInsertRowid
      let lastId = null;
      try {
        const result = sqlDb.exec("SELECT last_insert_rowid()");
        if (result.length > 0 && result[0].values.length > 0) {
          lastId = result[0].values[0][0];
        }
      } catch (e) {
        // 忽略错误
      }
      return { lastInsertRowid: lastId };
    },
    get: (...params) => {
      const stmt = sqlDb.prepare(sql);
      // 只有当有占位符时才绑定参数
      if (placeholderCount > 0 && params.length > 0) {
        stmt.bind(params);
      }
      if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        return row;
      }
      stmt.free();
      return undefined;
    },
    all: (...params) => {
      const stmt = sqlDb.prepare(sql);
      // 只有当有占位符时才绑定参数
      if (placeholderCount > 0 && params.length > 0) {
        stmt.bind(params);
      }
      const results = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.free();
      return results;
    }
  };
}

// 兼容旧代码
function dbExec(sql) {
  sqlDb.run(sql);
  saveDatabase();
}

const db = {
  exec: dbExec,
  prepare: prepare
};

module.exports = { initDatabase, db, saveDatabase };
