# LPF - 轻量级文件服务器

<p align="center">
  <img src="https://img.shields.io/badge/LPF-Lightweight%20File%20Server-green?style=for-the-badge" alt="LPF">
  <img src="https://img.shields.io/badge/Node.js-18%2B-brightgreen?style=flat-square" alt="Node.js">
</p>

## 简介

LPF (Lightweight File) 是一款**轻量、高性能、易部署**的 Web 文件服务器管理系统。采用 Node.js + Express + SQLite 技术栈，无需复杂的数据库配置，开箱即用。

### 核心亮点

- **轻量级**: 极简依赖，安装包体积小
- **高性能**: 采用 SQLite 嵌入式数据库，读写速度快
- **易部署**: 单文件启动，无需 Nginx/Apache 等反向代理，即装即用
- **功能完善**: 支持文件上传、下载、预览、分片上传、分享、API 开放
- **跨平台**: 支持 Windows、Linux、macOS 系统

## 技术架构

```
┌─────────────────────────────────────────────────────────────┐
│                      LPF 架构图                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│   │   前端界面   │    │  Express    │    │   SQLite    │     │
│   │  (Bootstrap │◄──►│   Web服务器  │◄──►│  嵌入式数据库│     │
│   │   5 + JS)   │    │   (Node.js) │    │   (sql.js)  │     │
│   └─────────────┘    └─────────────┘    └─────────────┘     │
│         │                                    │              │
│         │         ┌─────────────┐            │              │
│         └────────►│   Multer    │◄───────────┘              │
│                   │  文件上传    │                           │
│                   └─────────────┘                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 技术栈

| 层级 | 技术选型 | 说明 |
|------|----------|------|
| **后端** | Node.js 18+ | JavaScript 运行时 |
| **框架** | Express 4.x | 轻量级 Web 框架 |
| **数据库** | SQLite (sql.js) | 嵌入式，无需安装 |
| **前端** | Bootstrap 5 + 原生 JS | 响应式 UI 框架 |
| **文件处理** | Multer | Node.js 文件上传中间件 |
| **认证** | JWT (jsonwebtoken) | 无状态令牌认证 |
| **工具** | bcryptjs, uuid | 密码加密、ID 生成 |

## 功能列表

### 文件管理
- [x] 文件上传（支持拖拽上传）
- [x] 文件批量上传（最多 50 个文件）
- [x] 大文件分片上传（支持断点续传）
- [x] 文件下载
- [x] 文件预览（图片、PDF、视频、音频、文本）
- [x] 文件删除
- [x] 批量下载（打包 ZIP）
- [x] 文件搜索（按文件名）
- [x] 文件排序（按名称、时间、大小）
- [x] 日期筛选（今天、本周、本月）
- [x] 文件开放预览（无需登录即可预览指定文件）

### 文件分享
- [x] 生成分享链接
- [x] 支持多文件分享
- [x] 永久/临时分享（可设置过期时间）
- [x] 密码保护（可选）
- [x] 分享列表管理（搜索、筛选、分页）
- [x] 调整分享有效期
- [x] 公开访问页面 `/share/:token`

### Token 管理
- [x] 创建 API Token
- [x] Token 启用/禁用
- [x] Token 过期时间设置
- [x] Token 删除

### 文件收取
- [x] 生成分享收取链接
- [x] 支持多文件上传
- [x] 单次/多次使用模式
- [x] 收取链接管理

### 开放 API
- [x] RESTful API 接口
- [x] Token 认证（URL 参数方式）
- [x] 文件上传 API
- [x] 批量上传 API
- [x] 分片上传 API（支持断点续传）
- [x] 文件列表 API
- [x] 文件预览 API
- [x] 文件下载 API
- [x] 文件删除 API
- [x] 分享文件下载 API

### 系统功能
- [x] 用户登录
- [x] 密码修改
- [x] 个人中心（统计信息）
- [x] 响应式设计（支持移动端）
- [x] 在线 API 文档
- [x] 开放 API 文档

## 快速开始

### 环境要求

- Node.js >= 18.0.0
- npm >= 9.0.0

### 安装与启动

#### Windows

```cmd
# 1. 进入项目目录
cd LPF

# 2. 安装依赖
npm install

# 3. 启动服务
npm start

# 4. 打开浏览器访问 http://localhost:8190
```

或双击运行 `start/start-windows.bat`

#### Linux/macOS

```bash
# 1. 进入项目目录
cd LPF

# 2. 安装依赖
npm install

# 3. 启动服务
npm start

# 4. 打开浏览器访问 http://localhost:8190
```

或运行 `./start/start-linux.sh`

### 默认账号

- 用户名：`admin`
- 密码：`admin123`

**首次登录后请及时修改默认密码！**

## 配置文件

编辑 `config.js` 文件：

```javascript
module.exports = {
  // 服务器配置
  server: {
    port: 8190,        // 服务器端口
    host: '0.0.0.0'    // 服务器地址
  },

  // 数据库配置
  database: {
    path: 'data/lpf.db'  // 数据库文件路径
  },

  // 文件上传配置
  upload: {
    dir: 'static/uploads',                    // 上传目录
    maxFileSize: 50 * 1024 * 1024 * 1024,     // 最大文件大小 (50GB)
    maxFiles: 50                              // 批量上传最大文件数
  },

  // Token 配置
  token: {
    expireDays: 30   // Token 过期天数
  },

  // 分享配置
  share: {
    expireDays: 7    // 分享链接过期天数，0 表示永久有效
  }
};
```

## 目录结构

```
LPF/
├── server.js              # 主入口文件
├── config.js              # 配置文件
├── database.js            # 数据库初始化
├── package.json           # 项目配置
├── routes/                # 路由目录
│   ├── auth.js           # 认证接口
│   ├── files.js          # 文件管理接口
│   ├── token.js          # Token 管理接口
│   ├── collect.js        # 文件收取接口
│   └── api.js            # 开放 API 接口
├── middlewares/          # 中间件目录
│   └── auth.js           # 认证中间件
├── static/               # 静态文件目录
│   ├── index.html       # 主页面
│   ├── api-docs.html    # API 文档
│   ├── openapi-docs.html # 开放 API 文档
│   ├── collect.html     # 收取页面
│   ├── share.html       # 分享页面
│   ├── js/              # JavaScript 文件
│   └── uploads/         # 上传文件目录
├── data/                 # 数据目录
│   └── lpf.db           # SQLite 数据库文件
├── start/                # 启动脚本
│   ├── start-windows.bat # Windows 启动脚本
│   ├── start-linux.sh   # Linux 启动脚本
│   ├── stop-windows.bat # Windows 停止脚本
│   └── stop-linux.sh    # Linux 停止脚本
└── README.md             # 说明文档
```

## API 接口文档

### 认证接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/auth/login` | POST | 用户登录 |
| `/api/auth/password` | PUT | 修改密码 |
| `/api/auth/me` | GET | 获取当前用户信息 |

### 文件管理接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/files` | GET | 获取文件列表 |
| `/api/files/upload` | POST | 单文件上传 |
| `/api/files/upload/chunk` | POST | 分片上传 |
| `/api/files/upload/chunk/check` | POST | 分片检查（断点续传） |
| `/api/files/:id` | GET | 获取文件信息 |
| `/api/files/:id/preview` | GET | 文件预览 |
| `/api/files/:id/download` | GET | 文件下载 |
| `/api/files/batch-download` | POST | 批量下载（打包 ZIP） |
| `/api/files/:id` | DELETE | 删除文件 |
| `/api/files/:id/preview-open` | PUT | 开放/关闭文件预览 |
| `/api/files/shares` | POST | 创建分享 |
| `/api/files/shares/list` | GET | 分享列表 |
| `/api/files/shares/:id` | PUT | 更新分享 |
| `/api/files/shares/:id` | DELETE | 删除分享 |

### Token 管理接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/tokens` | GET | 获取 Token 列表 |
| `/api/tokens` | POST | 创建 Token |
| `/api/tokens/:id` | PUT | 更新 Token（启用/禁用） |
| `/api/tokens/:id` | DELETE | 删除 Token |

### 文件收取接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/collect/generate` | POST | 生成分享收取链接 |
| `/api/collect/list` | GET | 收取链接列表 |
| `/api/collect/:id` | DELETE | 删除收取链接 |
| `/api/collect/upload/:token` | POST | 通过收取链接上传文件 |

### 开放 API

所有开放 API 通过 URL 参数传递 Token：`?token=YOUR_TOKEN`

#### 1. 文件上传

```
POST /api/public/upload?token=YOUR_TOKEN
Content-Type: multipart/form-data
参数: file (表单文件字段)
```

#### 2. 批量上传

```
POST /api/public/upload/multiple?token=YOUR_TOKEN
Content-Type: multipart/form-data
参数: files (文件数组，最多 50 个)
```

#### 3. 分片上传

```
POST /api/public/upload/chunk?token=YOUR_TOKEN
Content-Type: multipart/form-data
参数:
  - filename: 最终文件名
  - chunk: 当前分片编号(0开始)
  - chunks: 总分片数
  - chunkData: 分片数据
```

**分片上传流程:**
1. 将大文件分割成多个小分片
2. 循环上传每个分片，从 chunk=0 开始
3. 每次上传后检查响应：如果响应包含 `id` 字段，说明上传完成
4. 如果响应不包含 `id` 字段，继续上传下一个分片

#### 4. 分片检查（断点续传）

```
POST /api/public/upload/chunk/check?token=YOUR_TOKEN
Content-Type: application/json
Body: {"filename": "file.mp4", "chunk": 0, "chunks": 100}
响应: {"uploadedChunks": [0,1,2], "needUpload": true}
```

#### 5. 文件列表查询

```
GET /api/public/files?token=YOUR_TOKEN&page=1&pageSize=20
```

#### 6. 文件预览

```
GET /api/public/preview/:id?token=YOUR_TOKEN
注意: 需要在文件管理中开启"开放预览"开关
```

#### 7. 文件下载

```
GET /api/public/download/:id?token=YOUR_TOKEN
```

#### 8. 文件删除

```
DELETE /api/public/files/:id?token=YOUR_TOKEN
```

#### 9. 分享文件下载

```
GET /api/share/download/:id?password=xxx
```

### 响应格式

```json
// 成功响应
{
  "id": 1,
  "filename": "xxx.pdf",
  "original_name": "test.pdf",
  "size": 1024,
  "message": "File uploaded successfully"
}

// 列表响应
{
  "list": [...],
  "total": 100,
  "page": 1,
  "pageSize": 20,
  "totalPages": 5
}

// 错误响应
{
  "error": "Error message"
}
```

## 页面访问

| 页面 | 路径 | 说明 |
|------|------|------|
| 主页面 | `/` | 文件管理界面（需登录） |
| 登录页 | `/login` | 用户登录 |
| API 文档 | `/api-docs` | 管理员 API 文档 |
| 开放 API 文档 | `/openapi-docs` | 开放 API 文档（可公开访问） |
| 收取页面 | `/collect/:token` | 文件收取页面 |
| 分享页面 | `/share/:token` | 文件分享页面 |

## 常见问题

### Q: 如何重启服务？

- Windows: 按 `Ctrl+C` 停止服务，然后运行 `start/start-windows.bat` 重新启动
- Linux: 运行 `./start/stop-linux.sh` 停止服务，然后运行 `./start/start-linux.sh` 重新启动

### Q: 如何修改端口？

编辑 `config.js` 文件中的 `server.port` 值。

### Q: 数据库文件在哪里？

数据存储在 `data/lpf.db` 文件中。

### Q: 如何备份数据？

只需复制 `data/lpf.db` 文件和 `static/uploads` 目录即可。

### Q: 上传的文件在哪里？

上传的文件默认存储在 `static/uploads` 目录中。

---

<p align="center">Made with ❤️ by LPF Team</p>
