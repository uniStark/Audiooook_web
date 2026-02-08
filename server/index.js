const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// ========== 全局日志时间戳 ==========
// 为所有 console 输出添加时间戳，方便 Docker 日志查看
const _origLog = console.log;
const _origError = console.error;
const _origWarn = console.warn;
function timestamp() {
  return new Date().toLocaleString('zh-CN', {
    timeZone: process.env.TZ || 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}
console.log = (...args) => _origLog(`[${timestamp()}]`, ...args);
console.error = (...args) => _origError(`[${timestamp()}]`, ...args);
console.warn = (...args) => _origWarn(`[${timestamp()}]`, ...args);

// 统一路径管理（会自动创建必要目录）
const { CONFIG_FILE, METADATA_FILE } = require('./utils/paths');
const booksRouter = require('./routes/books');
const audioRouter = require('./routes/audio');
const configRouter = require('./routes/config');

const app = express();
const PORT = process.env.PORT || 5001;

// 中间件
app.use(cors());
app.use(express.json());

// API路由
app.use('/api/books', booksRouter);
app.use('/api/audio', audioRouter);
app.use('/api/config', configRouter);

// 生产环境：提供前端静态文件
const clientDistPath = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  // SPA fallback
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/')) {
      res.sendFile(path.join(clientDistPath, 'index.html'));
    }
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`📚 AudioBook Server running at http://localhost:${PORT}`);
  console.log(`📁 Audiobook path: ${process.env.AUDIOBOOK_PATH || path.join(__dirname, '..', 'audiobooks')}`);
  console.log(`📄 Config: ${CONFIG_FILE}`);
  console.log(`📄 Metadata: ${METADATA_FILE}`);
});
