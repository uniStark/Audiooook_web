/**
 * 用户数据 API
 * 将收藏、播放进度、用户设置持久化到服务端
 * 保证重部署 / 换设备 / 清浏览器缓存后数据不丢失
 *
 * 存储文件：user-data.json（通过 Docker volume 持久化）
 * 结构：
 * {
 *   favorites: { [bookId]: { ...bookInfo, addedAt } },
 *   progress:  { [bookId]: { seasonIndex, episodeIndex, currentTime, ... , updatedAt } },
 *   settings:  { resumeRewindSeconds, bookSortMode, ... }
 * }
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { USER_DATA_FILE } = require('../utils/paths');

// ========== 文件读写 ==========

function loadUserData() {
  try {
    if (fs.existsSync(USER_DATA_FILE)) {
      return JSON.parse(fs.readFileSync(USER_DATA_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to load user data:', e.message);
  }
  return { favorites: {}, progress: {}, settings: {} };
}

function saveUserData(data) {
  const dir = path.dirname(USER_DATA_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(USER_DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// ========== 收藏 ==========

/**
 * GET /api/user/favorites
 * 获取所有收藏
 */
router.get('/favorites', (req, res) => {
  const data = loadUserData();
  const list = Object.values(data.favorites || {});
  res.json({ success: true, data: list });
});

/**
 * PUT /api/user/favorites/:bookId
 * 添加/更新收藏
 */
router.put('/favorites/:bookId', (req, res) => {
  const data = loadUserData();
  if (!data.favorites) data.favorites = {};
  data.favorites[req.params.bookId] = {
    bookId: req.params.bookId,
    ...req.body,
    addedAt: req.body.addedAt || Date.now(),
  };
  saveUserData(data);
  res.json({ success: true });
});

/**
 * DELETE /api/user/favorites/:bookId
 * 删除收藏
 */
router.delete('/favorites/:bookId', (req, res) => {
  const data = loadUserData();
  if (data.favorites) {
    delete data.favorites[req.params.bookId];
    saveUserData(data);
  }
  res.json({ success: true });
});

// ========== 播放进度 ==========

/**
 * GET /api/user/progress
 * 获取所有播放进度
 */
router.get('/progress', (req, res) => {
  const data = loadUserData();
  const list = Object.values(data.progress || {});
  res.json({ success: true, data: list });
});

/**
 * PUT /api/user/progress/:bookId
 * 保存/更新播放进度
 */
router.put('/progress/:bookId', (req, res) => {
  const data = loadUserData();
  if (!data.progress) data.progress = {};
  data.progress[req.params.bookId] = {
    bookId: req.params.bookId,
    ...req.body,
    updatedAt: req.body.updatedAt || Date.now(),
  };
  saveUserData(data);
  res.json({ success: true });
});

// ========== 用户设置 ==========

/**
 * GET /api/user/settings
 * 获取用户设置
 */
router.get('/settings', (req, res) => {
  const data = loadUserData();
  res.json({ success: true, data: data.settings || {} });
});

/**
 * PUT /api/user/settings
 * 更新用户设置（增量合并）
 */
router.put('/settings', (req, res) => {
  const data = loadUserData();
  if (!data.settings) data.settings = {};
  Object.assign(data.settings, req.body);
  saveUserData(data);
  res.json({ success: true, data: data.settings });
});

module.exports = router;
