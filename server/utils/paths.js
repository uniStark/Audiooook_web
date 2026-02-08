/**
 * 统一路径管理
 *
 * Dev 环境：config.json / metadata.json 放在项目根目录，方便编辑
 * Production 环境：放在 server/data/ 下，通过 Docker volume 持久化
 * 转码缓存、封面等大体积数据始终放在 server/data/
 */

const path = require('path');
const fs = require('fs');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// 项目根目录（server/ 的上一级）
const PROJECT_ROOT = path.join(__dirname, '..', '..');

// server/data 目录（转码缓存、封面等）
const SERVER_DATA_DIR = path.join(__dirname, '..', 'data');

// 配置文件路径
const CONFIG_FILE = IS_PRODUCTION
  ? path.join(SERVER_DATA_DIR, 'config.json')
  : path.join(PROJECT_ROOT, 'config.json');

// 元数据文件路径
const METADATA_FILE = IS_PRODUCTION
  ? path.join(SERVER_DATA_DIR, 'metadata.json')
  : path.join(PROJECT_ROOT, 'metadata.json');

// 转码缓存目录（始终在 server/data 下）
const TRANSCODE_CACHE_DIR = path.join(SERVER_DATA_DIR, 'transcode-cache');

// 封面目录（始终在 server/data 下）
const COVERS_DIR = path.join(SERVER_DATA_DIR, 'covers');

// 确保必要目录存在
function ensureDirs() {
  for (const dir of [SERVER_DATA_DIR, TRANSCODE_CACHE_DIR, COVERS_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

ensureDirs();

module.exports = {
  IS_PRODUCTION,
  PROJECT_ROOT,
  SERVER_DATA_DIR,
  CONFIG_FILE,
  METADATA_FILE,
  TRANSCODE_CACHE_DIR,
  COVERS_DIR,
};
