// LPF Configuration File

module.exports = {
  // Server
  server: {
    port: 8190,
    host: '0.0.0.0'
  },

  // Database
  database: {
    // Database file path (relative to project root)
    path: 'data/lpf.db'
  },

  // File storage
  upload: {
    // Upload directory (relative to project root)
    dir: 'static/uploads',
    // Max file size (bytes), default 50GB
    maxFileSize: 50 * 1024 * 1024 * 1024,
    // Max files per batch upload
    maxFiles: 50
  },

  // Token
  token: {
    // Token expiration (days)
    expireDays: 30
  },

  // Share
  share: {
    // Share link expiration (days), 0 means never expire
    expireDays: 7
  }
};
