// 全局变量
let token = localStorage.getItem('token') || '';
let currentUser = null;
let currentFiles = [];
let currentFolder = 'all';

// ========== 工具函数 ==========

async function api(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  let url = endpoint;
  if (token) {
    const separator = endpoint.includes('?') ? '&' : '?';
    url = `${endpoint}${separator}token=${token}`;
  }

  const response = await fetch(url, { ...options, headers });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast-item ${type}`;

  const icons = {
    success: 'bi-check-circle-fill',
    error: 'bi-x-circle-fill',
    warning: 'bi-exclamation-triangle-fill'
  };

  toast.innerHTML = `<i class="bi ${icons[type]}"></i><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => toast.remove(), 4000);
}

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 生成随机密码
function generatePassword(length = 8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

// 绑定生成密码按钮事件
document.getElementById('generateSharePassword')?.addEventListener('click', function() {
  document.getElementById('sharePassword').value = generatePassword();
});

document.getElementById('generateEditSharePassword')?.addEventListener('click', function() {
  document.getElementById('editSharePassword').value = generatePassword();
});

function formatDate(date) {
  if (!date) return '-';
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function formatDateOnly(date) {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('zh-CN');
}

// 分页渲染函数
function renderPagination(paginationKey, loadFn) {
  const containerId = paginationKey + 'Container';
  let container = document.getElementById(containerId);
  if (!container) return;

  let pagination;
  let currentPageSize = 20;
  if (paginationKey === 'filesPagination') { pagination = filesPagination; currentPageSize = filesPagination.pageSize; }
  else if (paginationKey === 'tokensPagination') { pagination = tokensPagination; currentPageSize = tokensPagination.pageSize; }
  else if (paginationKey === 'collectPagination') { pagination = collectPagination; currentPageSize = collectPagination.pageSize; }
  else if (paginationKey === 'sharesPagination') { pagination = sharesPagination; currentPageSize = sharesPagination.pageSize; }

  if (!pagination || pagination.total <= 0) {
    container.innerHTML = '';
    return;
  }

  const fnName = paginationKey === 'filesPagination' ? 'loadFiles' : (paginationKey === 'tokensPagination' ? 'loadTokens' : (paginationKey === 'collectPagination' ? 'loadCollectLinks' : 'loadShares'));

  let html = `<span class="total-info">共 ${pagination.total} 条</span>`;
  html += `<div class="pagination-wrapper">`;

  // 上一页
  html += `<button class="page-btn" onclick="${fnName}(${pagination.page - 1})" ${pagination.page <= 1 ? 'disabled' : ''}>
    <i class="bi bi-chevron-left"></i>
  </button>`;

  // 页码
  for (let i = 1; i <= pagination.totalPages; i++) {
    if (i === 1 || i === pagination.totalPages || (i >= pagination.page - 1 && i <= pagination.page + 1)) {
      html += `<button class="page-btn ${i === pagination.page ? 'active' : ''}" onclick="${fnName}(${i})">${i}</button>`;
    } else if (i === pagination.page - 2 || i === pagination.page + 2) {
      html += `<span style="padding:0 8px;color:#999;">...</span>`;
    }
  }

  // 下一页
  html += `<button class="page-btn" onclick="${fnName}(${pagination.page + 1})" ${pagination.page >= pagination.totalPages ? 'disabled' : ''}>
    <i class="bi bi-chevron-right"></i>
  </button>`;

  // 每页条数选择
  html += `<select class="page-size-select" onchange="${fnName}(1, this.value)">`;
  [10, 20, 50, 100].forEach(size => {
    html += `<option value="${size}" ${size === currentPageSize ? 'selected' : ''}>${size}条/页</option>`;
  });
  html += `</select>`;

  html += `</div>`;

  container.innerHTML = html;
}

function getDateCategory(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const fileDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today - fileDate) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays < 7) return 'week';
  if (diffDays < 30) return 'month';
  return 'older';
}

function getFileInfo(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const iconMap = {
    'jpg': { icon: 'bi-image-fill', class: 'image' },
    'jpeg': { icon: 'bi-image-fill', class: 'image' },
    'png': { icon: 'bi-image-fill', class: 'image' },
    'gif': { icon: 'bi-image-fill', class: 'image' },
    'webp': { icon: 'bi-image-fill', class: 'image' },
    'pdf': { icon: 'bi-file-earmark-pdf-fill', class: 'pdf' },
    'doc': { icon: 'bi-file-earmark-word-fill', class: 'doc' },
    'docx': { icon: 'bi-file-earmark-word-fill', class: 'doc' },
    'xls': { icon: 'bi-file-earmark-excel-fill', class: 'excel' },
    'xlsx': { icon: 'bi-file-earmark-excel-fill', class: 'excel' },
    'ppt': { icon: 'bi-file-earmark-ppt-fill', class: 'doc' },
    'pptx': { icon: 'bi-file-earmark-ppt-fill', class: 'doc' },
    'mp4': { icon: 'bi-file-earmark-play-fill', class: 'video' },
    'mov': { icon: 'bi-file-earmark-play-fill', class: 'video' },
    'avi': { icon: 'bi-file-earmark-play-fill', class: 'video' },
    'mp3': { icon: 'bi-file-earmark-music-fill', class: 'audio' },
    'wav': { icon: 'bi-file-earmark-music-fill', class: 'audio' },
    'zip': { icon: 'bi-file-earmark-zip-fill', class: 'zip' },
    'rar': { icon: 'bi-file-earmark-zip-fill', class: 'zip' },
    '7z': { icon: 'bi-file-earmark-zip-fill', class: 'zip' },
    'txt': { icon: 'bi-file-earmark-text-fill', class: 'default' },
    'js': { icon: 'bi-file-earmark-code-fill', class: 'default' },
    'json': { icon: 'bi-file-earmark-code-fill', class: 'default' },
    'html': { icon: 'bi-file-earmark-code-fill', class: 'default' },
    'css': { icon: 'bi-file-earmark-code-fill', class: 'default' }
  };
  return iconMap[ext] || { icon: 'bi-file-earmark-fill', class: 'default' };
}

function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// ========== 认证 ==========

// 页面加载时先隐藏所有内容
document.getElementById('loginPage').style.display = 'none';
document.getElementById('mainApp').style.display = 'none';

async function checkAuth() {
  // 显示加载状态
  showLoading();

  if (!token) {
    showLogin();
    return false;
  }
  try {
    const { user } = await api('/api/auth/me');
    currentUser = user;
    updateUserInfo(user);
    showMain();
    loadFiles();
    return true;
  } catch (err) {
    localStorage.removeItem('token');
    token = '';
    showLogin();
    return false;
  }
}

function showLoading() {
  const loading = document.getElementById('loadingPage');
  if (loading) {
    loading.style.display = 'flex';
  }
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('mainApp').style.display = 'none';
}

function hideLoading() {
  const loading = document.getElementById('loadingPage');
  if (loading) {
    loading.style.display = 'none';
  }
}

function showLogin() {
  hideLoading();
  document.getElementById('loginPage').style.display = 'flex';
  document.getElementById('mainApp').style.display = 'none';
}

function showMain() {
  hideLoading();
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('mainApp').style.display = 'block';
  // 默认显示文件管理页面
  document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
  document.getElementById('pageFiles').style.display = 'block';
  // 设置侧边栏激活状态
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.querySelector('.nav-link[data-page="files"]').classList.add('active');
}

function updateUserInfo(user) {
  document.getElementById('userName').textContent = user.username;
  document.getElementById('userAvatar').textContent = user.username.charAt(0).toUpperCase();
  document.getElementById('profileUsername').textContent = user.username;
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value;
  const password = document.getElementById('loginPassword').value;

  try {
    const { token: t } = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    token = t;
    localStorage.setItem('token', t);
    checkAuth();
    showToast('登录成功', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('token');
  token = '';
  currentUser = null;
  showLogin();
  showToast('已退出登录', 'success');
});

// ========== 页面导航 ==========

document.querySelectorAll('.nav-link[data-page]').forEach(link => {
  link.addEventListener('click', () => {
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    link.classList.add('active');

    const page = link.dataset.page;
    document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
    document.getElementById('page' + page.charAt(0).toUpperCase() + page.slice(1)).style.display = 'block';

    if (page === 'files') loadFiles();
    if (page === 'tokens') loadTokens();
    if (page === 'collect') loadCollectLinks();
    if (page === 'share') loadShares();
    if (page === 'profile') loadProfileStats();
  });
});

// ========== 文件管理 ==========

// 分页状态
let filesPagination = { page: 1, pageSize: 10, total: 0, totalPages: 0 };

async function loadFiles(page = 1, pageSize = null) {
  // Clear batch selection
  selectedFiles.clear();
  document.getElementById('batchToolbar').style.display = 'none';
  document.getElementById('selectAllFiles').checked = false;

  const search = document.getElementById('searchInput')?.value || '';
  const sort = document.getElementById('sortSelect')?.value || 'created_at';
  const order = document.getElementById('orderSelect')?.value || 'desc';
  const dateFilter = currentFolder || 'all';

  if (pageSize) {
    filesPagination.pageSize = parseInt(pageSize);
    filesPagination.page = 1;
    page = 1;
  } else {
    filesPagination.page = page;
  }

  const params = new URLSearchParams();
  if (search) params.append('search', search);
  if (sort) params.append('sort', sort);
  if (order) params.append('order', order);
  if (dateFilter && dateFilter !== 'all') params.append('dateFilter', dateFilter);
  params.append('page', page);
  params.append('pageSize', filesPagination.pageSize);

  const query = params.toString();
  const result = await api(`/api/files?${query}`);
  currentFiles = result.list;
  filesPagination = { page: result.page, pageSize: result.pageSize, total: result.total, totalPages: result.totalPages };
  renderFiles(currentFiles);
  renderPagination('filesPagination', loadFiles);
}

function renderFiles(files) {
  const tbody = document.getElementById('filesTableBody');

  if (!files.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state"><i class="bi bi-folder-x d-block mb-2" style="font-size: 32px;"></i>暂无文件</td></tr>`;
    return;
  }

  tbody.innerHTML = files.map(f => {
    const fileInfo = getFileInfo(f.original_name);
    return `
      <tr>
        <td><input type="checkbox" class="file-checkbox" value="${f.id}"></td>
        <td>
          <div class="file-name-cell">
            <div class="file-icon ${fileInfo.class}"><i class="bi ${fileInfo.icon}"></i></div>
            <span class="file-name" title="${f.original_name}">${f.original_name}</span>
          </div>
        </td>
        <td>${formatSize(f.size)}</td>
        <td>${f.owner}</td>
        <td>${f.is_preview_open ? '<span class="badge bg-success">开放</span>' : '<span class="badge bg-secondary">关闭</span>'}</td>
        <td>${formatDate(f.created_at)}</td>
        <td>
          <button class="btn btn-sm btn-outline-primary" onclick="previewFile(${f.id})" title="预览"><i class="bi bi-eye"></i></button>
          <button class="btn btn-sm btn-outline-primary" onclick="downloadFile(${f.id})" title="下载"><i class="bi bi-download"></i></button>
          <button class="btn btn-sm btn-outline-info" onclick="shareSingleFile(${f.id})" title="分享"><i class="bi bi-share"></i></button>
          <button class="btn btn-sm ${f.is_preview_open ? 'btn-outline-warning' : 'btn-outline-success'}" onclick="togglePreviewOpen(${f.id}, ${!f.is_preview_open})" title="${f.is_preview_open ? '关闭' : '开放'}"><i class="bi bi-${f.is_preview_open ? 'eye-slash' : 'eye'}"></i></button>
          <button class="btn btn-sm btn-outline-danger" onclick="deleteFile(${f.id})" title="删除"><i class="bi bi-trash"></i></button>
        </td>
      </tr>
    `;
  }).join('');
}

document.getElementById('searchBtn')?.addEventListener('click', loadFiles);
document.getElementById('searchInput')?.addEventListener('keypress', (e) => { if (e.key === 'Enter') loadFiles(); });

document.querySelectorAll('.folder-tab').forEach(tab => {
  tab.addEventListener('click', function() {
    document.querySelectorAll('.folder-tab').forEach(t => t.classList.remove('active'));
    this.classList.add('active');
    currentFolder = this.dataset.folder;
    loadFiles(1); // 重新加载文件列表
  });
});

document.getElementById('sortSelect')?.addEventListener('change', loadFiles);
document.getElementById('orderSelect')?.addEventListener('change', loadFiles);

// ========== 批量选择 ==========

let selectedFiles = new Set();

function updateBatchToolbar() {
  const toolbar = document.getElementById('batchToolbar');
  const countEl = document.getElementById('selectedCount');
  const selectedCount = selectedFiles.size;

  if (selectedCount > 0) {
    toolbar.style.display = 'flex';
    countEl.textContent = `已选择 ${selectedCount} 个文件`;
  } else {
    toolbar.style.display = 'none';
  }
}

// 全选
document.getElementById('selectAllFiles')?.addEventListener('change', function() {
  const checkboxes = document.querySelectorAll('.file-checkbox');
  checkboxes.forEach(cb => {
    cb.checked = this.checked;
    if (this.checked) {
      selectedFiles.add(parseInt(cb.value));
    } else {
      selectedFiles.delete(parseInt(cb.value));
    }
  });
  updateBatchToolbar();
});

// 单个选择
document.addEventListener('change', function(e) {
  if (e.target.classList.contains('file-checkbox')) {
    const fileId = parseInt(e.target.value);
    if (e.target.checked) {
      selectedFiles.add(fileId);
    } else {
      selectedFiles.delete(fileId);
    }
    updateBatchToolbar();
  }
});

// 取消选择
document.getElementById('cancelSelectBtn')?.addEventListener('click', function() {
  selectedFiles.clear();
  const checkboxes = document.querySelectorAll('.file-checkbox');
  checkboxes.forEach(cb => cb.checked = false);
  document.getElementById('selectAllFiles').checked = false;
  updateBatchToolbar();
});

// 批量下载
document.getElementById('batchDownloadBtn')?.addEventListener('click', async function() {
  if (selectedFiles.size === 0) {
    showToast('请选择要下载的文件', 'warning');
    return;
  }

  const fileIds = Array.from(selectedFiles);

  try {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/files/batch-download', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ fileIds })
    });

    if (!response.ok) {
      let errMsg = 'Download failed';
      try {
        const err = await response.json();
        errMsg = err.error || errMsg;
      } catch (e) {
        // 如果不是JSON，尝试获取text
        try {
          errMsg = await response.text() || errMsg;
        } catch (e2) {}
      }
      throw new Error(errMsg);
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `files_${Date.now()}.zip`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    showToast('下载已开始', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// 批量分享
document.getElementById('batchShareBtn')?.addEventListener('click', async function() {
  if (selectedFiles.size === 0) {
    showToast('请选择要分享的文件', 'warning');
    return;
  }

  // 打开分享模态框并预选文件
  currentFilesForShare = [];

  // 获取选中文件的详细信息
  try {
    const data = await api('/api/files?page=1&pageSize=100');
    const allFiles = data.list || [];

    // 过滤出选中的文件
    currentFilesForShare = allFiles.filter(f => selectedFiles.has(f.id));

    const fileList = document.getElementById('shareFileList');
    fileList.innerHTML = currentFilesForShare.map(f => {
      const fileInfo = getFileInfo(f.original_name);
      return `
        <div class="share-file-item">
          <input class="form-check-input" type="checkbox" value="${f.id}" id="shareFile_${f.id}" checked>
          <div class="file-icon ${fileInfo.class}"><i class="bi ${fileInfo.icon}"></i></div>
          <div class="file-info">
            <div class="file-name" title="${f.original_name}">${f.original_name}</div>
            <div class="file-size">${formatSize(f.size)}</div>
          </div>
        </div>
      `;
    }).join('');

    document.getElementById('shareTitle').value = '';
    document.getElementById('shareType').value = 'permanent';
    document.getElementById('shareExpiresContainer').style.display = 'none';
    document.getElementById('shareLinkContainer').style.display = 'none';
    document.getElementById('createShareBtn2').style.display = 'block';
    document.getElementById('sharePassword').value = ''; // 清空密码输入框

    const modal = new bootstrap.Modal(document.getElementById('shareModal'));
    modal.show();
  } catch (err) {
    showToast('加载文件列表失败', 'error');
  }
});

// ========== 文件操作 ==========

let currentPreviewUrl = '';
let currentPreviewFileId = null;
async function previewFile(id) {
  try {
    // 直接尝试获取文件信息（不需要认证，检查是否开放预览）
    const res = await fetch(`/api/files/${id}`);
    if (!res.ok) {
      showToast('请先开启预览功能', 'warning');
      return;
    }
    const file = await res.json();

    if (!file.is_preview_open) {
      showToast('请先开启预览功能', 'warning');
      return;
    }

    // 获取文件信息用于预览
    const ext = file.original_name.split('.').pop().toLowerCase();
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
    const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'];
    const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'];

    let fileType = { type: 'unknown', mimeType: 'application/octet-stream' };
    if (imageExts.includes(ext)) {
      fileType.type = 'image';
    } else if (audioExts.includes(ext)) {
      fileType.type = 'audio';
    } else if (videoExts.includes(ext)) {
      fileType.type = 'video';
    } else if (ext === 'pdf' || ['txt', 'json', 'js', 'css', 'html', 'xml', 'md', 'log'].includes(ext)) {
      fileType.type = ext === 'pdf' ? 'pdf' : 'text';
    }

    // 生成预览链接 - 文件已开放预览，无需token
    const fileUrl = `/uploads/${file.filename}`;
    // 复制链接时使用公开预览API
    currentPreviewUrl = `${window.location.origin}/api/public/preview/${id}`;
    currentPreviewFileId = id;

    const modal = new bootstrap.Modal(document.getElementById('previewModal'));
    const modalBody = document.getElementById('previewContent');
    document.getElementById('previewFileName').textContent = file.original_name;

    if (fileType.type === 'image') {
      modalBody.innerHTML = `<div class="text-center p-3"><img src="${fileUrl}" class="img-fluid" style="max-height: 60vh;"></div>`;
    } else if (fileType.type === 'audio') {
      modalBody.innerHTML = `<div class="p-3"><audio controls class="w-100"><source src="${fileUrl}" type="${fileType.mimeType}"></audio></div>`;
    } else if (fileType.type === 'video') {
      modalBody.innerHTML = `<div class="p-3"><video controls class="w-100" style="max-height: 50vh;"><source src="${fileUrl}" type="${fileType.mimeType}"></video></div>`;
    } else if (fileType.type === 'text' || fileType.type === 'pdf') {
      modalBody.innerHTML = `<iframe src="${fileUrl}" style="width: 100%; height: 60vh; border: none;"></iframe>`;
    } else {
      const fi = getFileInfo(file.original_name);
      modalBody.innerHTML = `<div class="text-center p-5"><div class="file-icon ${fi.class}" style="width: 80px; height: 80px; font-size: 36px; margin: 0 auto 16px;"><i class="bi ${fi.icon}"></i></div><p class="text-muted">该文件类型暂不支持预览</p><p>大小：${formatSize(file.size)}</p></div>`;
    }
    modal.show();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function downloadFile(id) {
  window.location.href = `/api/files/${id}/download?token=${token}`;
}

let currentShareFileId = null;
let sharePreSelectedFiles = [];

// 分享单个文件（使用新系统）
async function shareSingleFile(id) {
  currentShareFileId = id;
  sharePreSelectedFiles = [id];
  currentFilesForShare = []; // 清空之前的文件列表

  try {
    // 获取文件信息
    const file = await api(`/api/files/${id}`);

    // 更新 currentFilesForShare
    currentFilesForShare = [file];

    const fileList = document.getElementById('shareFileList');
    const fileInfo = getFileInfo(file.original_name);
    fileList.innerHTML = `
      <div class="share-file-item">
        <input class="form-check-input" type="checkbox" value="${file.id}" id="shareFile_${file.id}" checked>
        <div class="file-icon ${fileInfo.class}"><i class="bi ${fileInfo.icon}"></i></div>
        <div class="file-info">
          <div class="file-name" title="${file.original_name}">${file.original_name}</div>
          <div class="file-size">${formatSize(file.size)}</div>
        </div>
      </div>
    `;

    document.getElementById('shareTitle').value = '';
    document.getElementById('shareType').value = 'permanent';
    document.getElementById('shareExpiresContainer').style.display = 'none';
    document.getElementById('shareLinkContainer').style.display = 'none';
    document.getElementById('createShareBtn2').style.display = 'block';

    const modal = new bootstrap.Modal(document.getElementById('shareModal'));
    modal.show();
  } catch (err) {
    showToast('加载文件失败', 'error');
  }
}

// 兼容旧的shareFile调用
async function shareFile(id) {
  shareSingleFile(id);
}

async function togglePreviewOpen(id, open) {
  try {
    await api(`/api/files/${id}/preview-open`, { method: 'PUT', body: JSON.stringify({ open }) });
    loadFiles();
    showToast(open ? '已开放预览' : '已关闭预览', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteFile(id) {
  if (!confirm('确定删除此文件？')) return;
  try {
    await api(`/api/files/${id}`, { method: 'DELETE' });
    loadFiles();
    showToast('文件已删除', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ========== 上传 ==========

const CHUNK_SIZE = 5 * 1024 * 1024;

// 上传任务管理
const uploadTasks = new Map();
let uploadTaskId = 0;

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getFileIconClass(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const iconMap = {
    'jpg': 'bi-file-image', 'jpeg': 'bi-file-image', 'png': 'bi-file-image', 'gif': 'bi-file-image', 'webp': 'bi-file-image',
    'pdf': 'bi-file-pdf', 'doc': 'bi-file-word', 'docx': 'bi-file-word',
    'xls': 'bi-file-excel', 'xlsx': 'bi-file-excel',
    'ppt': 'bi-file-ppt', 'pptx': 'bi-file-ppt',
    'zip': 'bi-file-zip', 'rar': 'bi-file-zip', '7z': 'bi-file-zip',
    'mp3': 'bi-file-music', 'wav': 'bi-file-music', 'ogg': 'bi-file-music',
    'mp4': 'bi-file-video', 'mov': 'bi-file-video', 'avi': 'bi-file-video', 'mkv': 'bi-file-video',
    'txt': 'bi-file-text', 'md': 'bi-file-text', 'json': 'bi-file-code', 'js': 'bi-file-code',
    'css': 'bi-file-code', 'html': 'bi-file-code', 'xml': 'bi-file-code'
  };
  return iconMap[ext] || 'bi-file-earmark';
}

function createUploadTask(file) {
  console.log('Creating upload task for:', file.name, file.size);
  const taskId = ++uploadTaskId;
  const task = {
    id: taskId,
    name: file.name,
    size: file.size,
    status: 'uploading',
    progress: 0,
    uploaded: 0,
    startTime: new Date()
  };
  uploadTasks.set(taskId, task);

  // 添加到右侧栏
  const container = document.getElementById('uploadTasksContainer');
  if (!container) {
    console.error('uploadTasksContainer not found!');
    return taskId;
  }
  const empty = document.getElementById('uploadTasksEmpty');
  if (empty) empty.style.display = 'none';

  const taskEl = document.createElement('div');
  taskEl.className = 'upload-task-item';
  taskEl.id = `upload-task-${taskId}`;
  taskEl.innerHTML = `
    <div class="upload-task-header">
      <div class="upload-task-icon uploading"><i class="bi ${getFileIconClass(file.name)}"></i></div>
      <div class="upload-task-info">
        <div class="upload-task-name" title="${file.name}">${file.name}</div>
        <div class="upload-task-size">${formatSize(file.size)} <span class="upload-task-time">${formatDate(new Date())}</span></div>
      </div>
      <button class="upload-task-close" onclick="removeUploadTask(${taskId})"><i class="bi bi-x"></i></button>
    </div>
    <div class="upload-task-progress">
      <div class="upload-task-progress-bar" id="progress-${taskId}" style="width: 0%"></div>
    </div>
    <div class="upload-task-status" id="status-${taskId}">
      <span>准备上传...</span>
      <span>0%</span>
    </div>
  `;
  container.appendChild(taskEl);

  // 显示右侧栏（仅首次或任务栏隐藏时）
  if (uploadTasks.size === 1 || !document.getElementById('rightSidebar').classList.contains('show')) {
    showRightSidebar();
  }
  updateUploadBadge();

  return taskId;
}

function updateUploadTaskProgress(taskId, percent, uploaded) {
  const task = uploadTasks.get(taskId);
  if (!task) return;

  task.progress = percent;
  task.uploaded = uploaded;

  const progressBar = document.getElementById(`progress-${taskId}`);
  const status = document.getElementById(`status-${taskId}`);

  if (progressBar) progressBar.style.width = percent + '%';
  if (status) {
    status.innerHTML = `<span>上传中...</span><span>${percent}%</span>`;
  }
}

function completeUploadTask(taskId, success, errorMsg) {
  const task = uploadTasks.get(taskId);
  if (!task) return;

  task.status = success ? 'success' : 'error';

  const taskEl = document.getElementById(`upload-task-${taskId}`);
  const progressBar = document.getElementById(`progress-${taskId}`);
  const status = document.getElementById(`status-${taskId}`);
  const icon = taskEl?.querySelector('.upload-task-icon');

  if (progressBar) {
    progressBar.classList.add('success');
    progressBar.style.width = '100%';
  }
  if (status) {
    status.className = `upload-task-status ${success ? 'success' : 'error'}`;
    status.innerHTML = `<span>${success ? '上传完成' : errorMsg}</span><span>${success ? '100%' : ''}</span>`;
  }
  if (icon) {
    icon.className = `upload-task-icon ${success ? 'success' : 'error'}`;
    icon.innerHTML = `<i class="bi ${success ? 'bi-check-lg' : 'bi-x-lg'}"></i>`;
  }

  updateUploadBadge();
}

function removeUploadTask(taskId) {
  const task = uploadTasks.get(taskId);
  if (!task) return;

  const taskEl = document.getElementById(`upload-task-${taskId}`);
  if (taskEl) {
    taskEl.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => {
      taskEl.remove();
      uploadTasks.delete(taskId);
      updateUploadBadge();

      // 如果没有任务了，显示空状态
      const container = document.getElementById('uploadTasksContainer');
      if (uploadTasks.size === 0) {
        const empty = document.getElementById('uploadTasksEmpty');
        if (empty) empty.style.display = 'block';
      }
    }, 300);
  } else {
    uploadTasks.delete(taskId);
    updateUploadBadge();
  }
}

function updateUploadBadge() {
  const badge = document.getElementById('uploadTaskBadge');
  const count = uploadTasks.size;
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

function showRightSidebar() {
  document.getElementById('rightSidebar').classList.add('show');
}

function toggleRightSidebar() {
  document.getElementById('rightSidebar').classList.toggle('show');
}

// 添加动画样式
const uploadTaskStyle = document.createElement('style');
uploadTaskStyle.textContent = `
  @keyframes slideOut {
    from { opacity: 1; transform: translateX(0); }
    to { opacity: 0; transform: translateX(20px); }
  }
`;
document.head.appendChild(uploadTaskStyle);

async function uploadFile(file, taskId) {
  console.log('Starting upload for:', file.name, 'size:', file.size, 'taskId:', taskId);
  return new Promise((resolve, reject) => {
    // 如果没有taskId，创建一个
    if (!taskId) {
      taskId = createUploadTask(file);
      console.log('Created task with ID:', taskId);
    }

    if (file.size < 500 * 1024 * 1024) { // 小于500MB用普通上传
      const formData = new FormData();
      formData.append('file', file);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/files/upload?token=${token}`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          updateUploadTaskProgress(taskId, percent, e.loaded);
        }
      };

      xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) {
          completeUploadTask(taskId, true);
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch (e) {
            resolve({ success: true });
          }
        } else {
          const errMsg = '上传失败: ' + xhr.status;
          completeUploadTask(taskId, false, errMsg);
          reject(new Error(errMsg));
        }
      };
      xhr.onerror = function() {
        const errMsg = '上传失败: 网络错误';
        completeUploadTask(taskId, false, errMsg);
        reject(new Error(errMsg));
      };
      xhr.send(formData);
      return;
    }

    // 大文件断点上传
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const filename = file.name;
    let chunkIndex = 0;

    async function uploadChunk() {
      if (chunkIndex >= totalChunks) {
        completeUploadTask(taskId, true);
        resolve({ success: true, filename });
        return;
      }

      const start = chunkIndex * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end);

      const formData = new FormData();
      formData.append('chunk', chunk);
      formData.append('filename', filename);
      formData.append('chunkIndex', chunkIndex);
      formData.append('totalChunks', totalChunks);

      try {
        const res = await fetch(`/api/files/upload/chunk?token=${token}`, { method: 'POST', body: formData });
        if (!res.ok) throw new Error('Chunk upload failed');

        chunkIndex++;
        const percent = Math.round((chunkIndex / totalChunks) * 100);
        const uploaded = chunkIndex * CHUNK_SIZE;
        updateUploadTaskProgress(taskId, percent, uploaded);

        await new Promise(r => setTimeout(r, 50));
        await uploadChunk();
      } catch (err) {
        completeUploadTask(taskId, false, err.message);
        reject(err);
      }
    }

    uploadChunk().then(resolve).catch(reject);
  });
}

document.getElementById('uploadBtn').addEventListener('click', () => {
  const input = document.getElementById('fileInput');
  if (!input.files.length) {
    showToast('请选择文件', 'warning');
    return;
  }

  const files = Array.from(input.files);

  // 立即关闭模态框
  const modalEl = document.getElementById('uploadModal');
  const modal = bootstrap.Modal.getInstance(modalEl);
  if (modal) {
    modal.hide();
  } else {
    modalEl.style.display = 'none';
    modalEl.classList.remove('show');
    document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
  }

  // 清空文件输入
  input.value = '';

  // 显示提示
  showToast(`已开始上传 ${files.length} 个文件`, 'info');

  // 并行上传所有文件
  let completedCount = 0;
  files.forEach(file => {
    uploadFile(file).then(() => {
      completedCount++;
      if (completedCount === files.length) {
        showToast('全部上传完成', 'success');
        loadFiles();
      }
    }).catch(err => {
      showToast('上传失败: ' + err.message, 'error');
    });
  });
});

document.getElementById('uploadModal')?.addEventListener('hidden.bs.modal', function() {
  document.getElementById('uploadProgress').style.display = 'none';
});

// ========== Token管理 ==========

// Token 分页状态
let tokensPagination = { page: 1, pageSize: 10, total: 0, totalPages: 0 };

async function loadTokens(page = 1, pageSize = null) {
  if (pageSize) {
    tokensPagination.pageSize = parseInt(pageSize);
    tokensPagination.page = 1;
    page = 1;
  } else {
    tokensPagination.page = page;
  }
  const result = await api(`/api/tokens?page=${page}&pageSize=${tokensPagination.pageSize}`);
  const tokens = result.list;
  tokensPagination = { page: result.page, pageSize: result.pageSize, total: result.total, totalPages: result.totalPages };

  const tbody = document.getElementById('tokensTableBody');

  if (!tokens.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state"><i class="bi bi-key d-block mb-2" style="font-size: 32px;"></i>暂无Token</td></tr>`;
    return;
  }

  tbody.innerHTML = tokens.map(t => `
    <tr>
      <td><strong>${t.name}</strong></td>
      <td><code class="token-value">${t.token}</code></td>
      <td>${t.type === 'permanent' ? '<span class="badge bg-primary">永久</span>' : '<span class="badge bg-warning text-dark">临时</span>'}</td>
      <td>${t.expires_at ? formatDate(t.expires_at) : '-'}</td>
      <td>${t.disabled ? '<span class="badge bg-danger">禁用</span>' : '<span class="badge bg-success">启用</span>'}</td>
      <td>
        <button class="btn btn-sm ${t.disabled ? 'btn-success' : 'btn-warning'}" onclick="toggleToken(${t.id}, ${!t.disabled})"><i class="bi bi-toggle-${t.disabled ? 'on' : 'off'}"></i></button>
        <button class="btn btn-sm btn-danger" onclick="deleteToken(${t.id})"><i class="bi bi-trash"></i></button>
      </td>
    </tr>
  `).join('');

  renderPagination('tokensPagination', loadTokens);
}

document.getElementById('createTokenBtn').addEventListener('click', async () => {
  const name = document.getElementById('tokenName').value;
  const type = document.getElementById('tokenType').value;
  const expiresAt = document.getElementById('tokenExpiresAt').value;

  if (!name) { showToast('请输入名称', 'warning'); return; }

  try {
    await api('/api/tokens', { method: 'POST', body: JSON.stringify({ name, type, expiresAt: expiresAt || null }) });
    bootstrap.Modal.getInstance(document.getElementById('tokenModal')).hide();
    document.getElementById('tokenName').value = '';
    loadTokens();
    showToast('Token创建成功', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

document.getElementById('tokenType').addEventListener('change', (e) => {
  document.getElementById('expiresAtContainer').style.display = e.target.value === 'temporary' ? 'block' : 'none';
});

async function toggleToken(id, disabled) {
  try {
    await api(`/api/tokens/${id}`, { method: 'PUT', body: JSON.stringify({ disabled }) });
    loadTokens();
    showToast(disabled ? 'Token已禁用' : 'Token已启用', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteToken(id) {
  if (!confirm('确定删除此Token？')) return;
  try {
    await api(`/api/tokens/${id}`, { method: 'DELETE' });
    loadTokens();
    showToast('Token已删除', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ========== 文件收取 ==========

// 收取链接分页状态
let collectPagination = { page: 1, pageSize: 10, total: 0, totalPages: 0 };

// ========== 文件分享 ==========

// 分享分页状态
let sharesPagination = { page: 1, pageSize: 10, total: 0, totalPages: 0 };

async function loadCollectLinks(page = 1, pageSize = null) {
  collectPagination.page = page;
  if (pageSize !== null) {
    collectPagination.pageSize = pageSize;
  }
  const result = await api(`/api/collect/list?page=${page}&pageSize=${collectPagination.pageSize}`);
  const links = result.list;
  collectPagination = { page: result.page, pageSize: result.pageSize, total: result.total, totalPages: result.totalPages };

  const tbody = document.getElementById('collectTableBody');

  if (!links.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state"><i class="bi bi-link-45deg d-block mb-2" style="font-size: 32px;"></i>暂无收取链接</td></tr>`;
    return;
  }

  tbody.innerHTML = links.map(l => `
    <tr>
      <td><code class="token-value">${l.token}</code></td>
      <td>${l.creator}</td>
      <td>${l.used ? '<span class="badge bg-secondary">已使用</span>' : '<span class="badge bg-success">可用</span>'}</td>
      <td>${l.used_at ? formatDate(l.used_at) : '-'}</td>
      <td>${l.uploaded_filename ? l.uploaded_filename : '-'}</td>
      <td>${l.uploader_ip ? l.uploader_ip : '-'}</td>
      <td>
        <button class="btn btn-sm btn-primary" onclick="copyCollectLink('${l.token}')"><i class="bi bi-clipboard"></i></button>
        <button class="btn btn-sm btn-danger" onclick="deleteCollectLink(${l.id})"><i class="bi bi-trash"></i></button>
      </td>
    </tr>
  `).join('');

  renderPagination('collectPagination', loadCollectLinks);
}

document.getElementById('generateCollectLink').addEventListener('click', async () => {
  try {
    const { url } = await api('/api/collect/generate', { method: 'POST' });
    const fullUrl = window.location.origin + url;
    copyToClipboard(fullUrl, '链接已复制到剪贴板');
    loadCollectLinks();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

function copyCollectLink(token) {
  const url = `${window.location.origin}/collect/${token}`;
  copyToClipboard(url, '链接已复制');
}

async function deleteCollectLink(id) {
  if (!confirm('确定删除此链接？')) return;
  try {
    await api(`/api/collect/${id}`, { method: 'DELETE' });
    loadCollectLinks();
    showToast('链接已删除', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ========== 文件分享 ==========

let currentFilesForShare = [];

async function loadShares(page = 1, pageSize = null) {
  const title = document.getElementById('shareSearchInput')?.value || '';
  const type = document.getElementById('shareTypeFilter')?.value || '';
  const sort = document.getElementById('shareSortSelect')?.value || 'created_desc';

  if (pageSize) {
    sharesPagination.pageSize = parseInt(pageSize);
    sharesPagination.page = 1;
    page = 1;
  } else {
    sharesPagination.page = page;
  }

  try {
    const params = new URLSearchParams();
    if (title) params.append('title', title);
    if (type) params.append('type', type);
    params.append('sort', sort);
    params.append('page', page);
    params.append('pageSize', sharesPagination.pageSize);

    const result = await api(`/api/files/shares/list?${params}`);
    const shares = result.list || [];
    sharesPagination = { page: result.page, pageSize: result.pageSize, total: result.total, totalPages: result.totalPages };

    const tbody = document.getElementById('shareTableBody');
    if (shares.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">暂无分享记录</td></tr>';
      return;
    }

    tbody.innerHTML = shares.map(share => {
      const fileCount = share.files ? share.files.length : 0;
      const typeText = share.type === 'permanent' ? '永久' : '临时';
      const expireText = share.type === 'permanent' ? '永久有效' : (share.expires_at ? new Date(share.expires_at).toLocaleString('zh-CN') : '-');
      const createdText = share.created_at ? new Date(share.created_at).toLocaleString('zh-CN') : '-';
      const shareUrl = `${window.location.origin}/share/${share.token}`;

      // 获取分享中第一个文件的图标（如果有）
      let fileIconHtml = '';
      if (share.files && share.files.length > 0) {
        const firstFile = share.files[0];
        const fileInfo = getFileInfo(firstFile.original_name);
        fileIconHtml = `<div class="file-icon ${fileInfo.class}"><i class="bi ${fileInfo.icon}"></i></div>`;
      } else {
        fileIconHtml = `<div class="file-icon default"><i class="bi bi-folder-fill"></i></div>`;
      }

      // 生成文件列表预览（显示前3个文件名）
      let filesPreview = '';
      if (share.files && share.files.length > 0) {
        const fileNames = share.files.slice(0, 3).map(f => `<div class="share-file-name">${f.original_name}</div>`).join('');
        const moreText = share.files.length > 3 ? `<div class="share-file-more">+${share.files.length - 3} 个文件</div>` : '';
        filesPreview = `<div class="share-files-preview">${fileNames}${moreText}</div>`;
      }

      // 密码显示
      const passwordDisplay = share.plain_password ? `
        <span class="badge bg-secondary"><i class="bi bi-key-fill me-1"></i>有密码</span>
        <button class="btn btn-sm btn-outline-secondary ms-1" onclick="copySharePassword('${share.plain_password}')" title="复制密码"><i class="bi bi-clipboard"></i></button>
      ` : '<span class="text-muted">-</span>';

      return `
        <tr>
          <td>
            <div class="file-name-cell">
              ${fileIconHtml}
              <div>
                <div class="file-name" title="${share.title || 'Untitled'}">${share.title || 'Untitled'}</div>
                ${filesPreview}
              </div>
            </div>
          </td>
          <td><span class="badge ${share.type === 'permanent' ? 'bg-success' : 'bg-warning text-dark'}">${typeText}</span></td>
          <td>${passwordDisplay}</td>
          <td>${expireText}</td>
          <td>${createdText}</td>
          <td>
            <button class="btn btn-sm btn-outline-primary" onclick="copyShareLink('${shareUrl}')" title="复制链接"><i class="bi bi-clipboard"></i></button>
            <button class="btn btn-sm btn-outline-primary" onclick="openEditShareModal(${share.id}, '${share.title}', '${share.type}', '${share.expires_at || ''}', ${share.plain_password ? 'true' : 'false'})" title="编辑"><i class="bi bi-pencil"></i></button>
            <button class="btn btn-sm btn-outline-danger" onclick="deleteShare(${share.id})" title="删除"><i class="bi bi-trash"></i></button>
          </td>
        </tr>
      `;
    }).join('');

    renderPagination('sharesPagination', loadShares);
  } catch (err) {
    console.error(err);
    showToast('加载分享记录失败', 'error');
  }
}

window.copyShareLink = function(url) {
  copyToClipboard(url, '链接已复制');
};

window.copySharePassword = function(password) {
  copyToClipboard(password, '密码已复制');
};

function copyToClipboard(text, successMsg) {
  // 优先使用 Clipboard API
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(successMsg, 'success');
    }).catch(() => {
      fallbackCopy(text, successMsg);
    });
  } else {
    fallbackCopy(text, successMsg);
  }
}

function fallbackCopy(text, successMsg) {
  // 后备方案：使用 textarea + execCommand
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
    showToast(successMsg, 'success');
  } catch (err) {
    showToast('复制失败，请手动复制', 'danger');
  }
  document.body.removeChild(textarea);
}

let currentEditShareId = null;

window.openEditShareModal = function(id, title, type, expiresAt, hasPassword) {
  currentEditShareId = id;
  document.getElementById('editShareTitle').value = title || '';
  document.getElementById('editShareType').value = type || 'permanent';
  document.getElementById('editShareExpiresAt').value = expiresAt ? expiresAt.slice(0, 16) : '';
  document.getElementById('editShareExpiresContainer').style.display = type === 'temporary' ? 'block' : 'none';
  document.getElementById('editSharePassword').value = ''; // 清空密码输入框
  document.getElementById('editSharePassword').dataset.hasPassword = hasPassword ? 'true' : 'false';

  const modal = new bootstrap.Modal(document.getElementById('editShareModal'));
  modal.show();
};

document.getElementById('editShareType')?.addEventListener('change', function() {
  document.getElementById('editShareExpiresContainer').style.display = this.value === 'temporary' ? 'block' : 'none';
});

document.getElementById('saveShareBtn')?.addEventListener('click', async function() {
  if (!currentEditShareId) return;

  const title = document.getElementById('editShareTitle').value;
  const type = document.getElementById('editShareType').value;
  const expiresAt = document.getElementById('editShareExpiresAt').value;
  const passwordInput = document.getElementById('editSharePassword');
  const hasPassword = passwordInput.dataset.hasPassword === 'true';
  const newPassword = passwordInput.value;

  // 如果没有填写新密码，且原本有密码，则保持原密码（传 null 表示不修改密码）
  // 如果没有填写新密码，且原本无密码，则保持无密码（传空字符串或不传）
  // 只有填写了新密码，才传新密码
  const password = newPassword ? newPassword : (hasPassword ? null : '');

  try {
    await api(`/api/files/shares/${currentEditShareId}`, {
      method: 'PUT',
      body: JSON.stringify({ title, type, expiresAt, password })
    });
    showToast('分享已更新', 'success');
    bootstrap.Modal.getInstance(document.getElementById('editShareModal')).hide();
    loadShares();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

window.deleteShare = async function(id) {
  if (!confirm('确定删除此分享？')) return;
  try {
    await api(`/api/files/shares/${id}`, { method: 'DELETE' });
    showToast('分享已删除', 'success');
    loadShares();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// 打开分享模态框时加载文件列表
document.getElementById('createShareBtn')?.addEventListener('click', async function() {
  // 加载文件列表
  try {
    const data = await api('/api/files?page=1&pageSize=100');
    currentFilesForShare = data.list || [];

    const fileList = document.getElementById('shareFileList');
    if (currentFilesForShare.length === 0) {
      fileList.innerHTML = '<div style="text-align: center; color: var(--text-muted);">请先在文件管理中上传文件</div>';
    } else {
      fileList.innerHTML = currentFilesForShare.map(f => {
        const fileInfo = getFileInfo(f.original_name);
        return `
          <div class="share-file-item">
            <input class="form-check-input" type="checkbox" value="${f.id}" id="shareFile_${f.id}">
            <div class="file-icon ${fileInfo.class}"><i class="bi ${fileInfo.icon}"></i></div>
            <div class="file-info">
              <div class="file-name" title="${f.original_name}">${f.original_name}</div>
              <div class="file-size">${formatSize(f.size)}</div>
            </div>
          </div>
        `;
      }).join('');
    }

    document.getElementById('shareTitle').value = '';
    document.getElementById('shareType').value = 'permanent';
    document.getElementById('shareExpiresContainer').style.display = 'none';
    document.getElementById('shareLinkContainer').style.display = 'none';
    document.getElementById('createShareBtn2').style.display = 'block';

    const modal = new bootstrap.Modal(document.getElementById('shareModal'));
    modal.show();
  } catch (err) {
    showToast('加载文件列表失败', 'error');
  }
});

document.getElementById('shareType')?.addEventListener('change', function() {
  document.getElementById('shareExpiresContainer').style.display = this.value === 'temporary' ? 'block' : 'none';
});

document.getElementById('createShareBtn2')?.addEventListener('click', async function() {
  const title = document.getElementById('shareTitle').value;
  const type = document.getElementById('shareType').value;
  const expiresAt = document.getElementById('shareExpiresAt').value;
  const password = document.getElementById('sharePassword').value;

  // 获取选中的文件
  const selectedFiles = [];
  currentFilesForShare.forEach(f => {
    const checkbox = document.getElementById(`shareFile_${f.id}`);
    if (checkbox && checkbox.checked) {
      selectedFiles.push(f.id);
    }
  });

  if (selectedFiles.length === 0) {
    showToast('请选择至少一个文件', 'error');
    return;
  }

  try {
    const share = await api('/api/files/shares', {
      method: 'POST',
      body: JSON.stringify({
        title,
        fileIds: selectedFiles,
        type,
        expiresAt,
        password
      })
    });

    const shareUrl = `${window.location.origin}/share/${share.token}`;
    document.getElementById('shareLink').value = shareUrl;
    document.getElementById('shareLinkContainer').style.display = 'block';
    document.getElementById('createShareBtn2').style.display = 'none';

    showToast('分享已创建', 'success');
    loadShares();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

document.getElementById('searchShareBtn')?.addEventListener('click', loadShares);
document.getElementById('shareSearchInput')?.addEventListener('keypress', function(e) {
  if (e.key === 'Enter') loadShares();
});

// ========== 个人中心 ==========

async function loadProfileStats() {
  try {
    const filesData = await api('/api/files');
    const tokensData = await api('/api/tokens');
    const files = filesData.list || [];
    const tokens = tokensData.list || [];
    let totalSize = 0;
    files.forEach(f => totalSize += f.size);
    document.getElementById('statFileCount').textContent = filesData.total || 0;
    document.getElementById('statStorage').textContent = formatSize(totalSize);
    document.getElementById('statTokenCount').textContent = tokensData.total || 0;
  } catch (err) {
    console.error(err);
  }
}

// ========== 开放API文档 ==========

let currentOpenApiToken = '';

function loadOpenApiDocs() {
  // 获取服务器地址
  const serverAddress = window.location.host;
  document.getElementById('serverAddress').textContent = serverAddress;

  // 获取一个有效的Token用于分享
  loadOpenApiToken();
}

async function loadOpenApiToken() {
  try {
    const tokensData = await api('/api/tokens');
    if (tokensData.list && tokensData.list.length > 0) {
      const validToken = tokensData.list.find(t => !t.disabled);
      if (validToken) {
        currentOpenApiToken = validToken.token;
      }
    }
  } catch (err) {
    console.error('Failed to load token:', err);
  }
}

function generateOpenApiShareLink() {
  if (!currentOpenApiToken) {
    showToast('请先创建有效的Token', 'warning');
    return;
  }

  const serverAddress = window.location.host;
  // 使用 hash 格式 #/openapi?token=xxx
  const shareUrl = `${window.location.protocol}//${serverAddress}/#/openapi?token=${currentOpenApiToken}`;

  // 复制到剪贴板
  copyToClipboard(shareUrl, '分享链接已复制到剪贴板');
}

function copyServerAddress() {
  const serverAddress = window.location.host;
  copyToClipboard(serverAddress, '服务器地址已复制');
}

document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const oldPassword = document.getElementById('oldPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;

  if (newPassword !== confirmPassword) { showToast('两次密码不一致', 'error'); return; }
  if (newPassword.length < 6) { showToast('密码至少6位', 'error'); return; }

  try {
    await api('/api/auth/password', { method: 'PUT', body: JSON.stringify({ oldPassword, newPassword }) });
    showToast('密码修改成功', 'success');
    document.getElementById('changePasswordForm').reset();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

document.getElementById('copyPreviewLinkBtn').addEventListener('click', async () => {
  if (!currentPreviewUrl) { showToast('无链接可复制', 'warning'); return; }
  const fullUrl = currentPreviewUrl.startsWith('http') ? currentPreviewUrl : window.location.origin + currentPreviewUrl;
  copyToClipboard(fullUrl, '链接已复制');
});

// ========== 初始化 ==========

checkAuth();

// 检查URL参数，如果是/openapi页面则自动切换
(function() {
  const urlParams = new URLSearchParams(window.location.search);
  const hash = window.location.hash;

  // 检查是否是开放API页面
  if (hash.includes('openapi') || urlParams.get('page') === 'openapi') {
    // 移除hash并切换到openapi页面
    document.querySelectorAll('.nav-link').forEach(link => {
      if (link.dataset.page === 'openapi') {
        link.click();
      }
    });
  }
})();
