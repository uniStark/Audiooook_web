/**
 * IndexedDB 工具 + 服务端同步
 *
 * IndexedDB 作为本地缓存（离线可用）
 * 服务端 user-data.json 作为持久化源（重部署/换设备不丢失）
 *
 * 写操作：同时写 IndexedDB + 服务端（服务端失败不阻塞）
 * 读操作：优先 IndexedDB（快），应用启动时从服务端同步一次
 */
import { openDB } from 'idb';
import { userApi } from './api';

const DB_NAME = 'audiooook';
const DB_VERSION = 1;

let dbPromise = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // 播放进度存储
        if (!db.objectStoreNames.contains('playProgress')) {
          db.createObjectStore('playProgress', { keyPath: 'bookId' });
        }
        
        // 收藏存储
        if (!db.objectStoreNames.contains('favorites')) {
          const store = db.createObjectStore('favorites', { keyPath: 'bookId' });
          store.createIndex('addedAt', 'addedAt');
        }
        
        // 离线缓存音频
        if (!db.objectStoreNames.contains('audioCache')) {
          const store = db.createObjectStore('audioCache', { keyPath: 'key' });
          store.createIndex('bookId', 'bookId');
          store.createIndex('cachedAt', 'cachedAt');
        }
        
        // 缓存设置
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
}

// ===== 播放进度 =====

export async function savePlayProgress(bookId, progress) {
  const data = { bookId, ...progress, updatedAt: Date.now() };
  const db = await getDB();
  await db.put('playProgress', data);
  // 同步到服务端（fire-and-forget）
  userApi.saveProgress(bookId, data).catch(() => {});
}

export async function getPlayProgress(bookId) {
  const db = await getDB();
  return db.get('playProgress', bookId);
}

export async function getAllPlayProgress() {
  const db = await getDB();
  return db.getAll('playProgress');
}

// ===== 收藏 =====

export async function addFavorite(bookId, bookInfo) {
  const data = { bookId, ...bookInfo, addedAt: Date.now() };
  const db = await getDB();
  await db.put('favorites', data);
  // 同步到服务端
  userApi.addFavorite(bookId, data).catch(() => {});
}

export async function removeFavorite(bookId) {
  const db = await getDB();
  await db.delete('favorites', bookId);
  // 同步到服务端
  userApi.removeFavorite(bookId).catch(() => {});
}

export async function isFavorite(bookId) {
  const db = await getDB();
  const item = await db.get('favorites', bookId);
  return !!item;
}

export async function getAllFavorites() {
  const db = await getDB();
  return db.getAll('favorites');
}

// ===== 离线缓存 =====

export async function cacheAudio(key, bookId, audioBlob, metadata) {
  const db = await getDB();
  await db.put('audioCache', {
    key,
    bookId,
    blob: audioBlob,
    size: audioBlob.size,
    ...metadata,
    cachedAt: Date.now(),
  });
}

export async function getCachedAudio(key) {
  const db = await getDB();
  return db.get('audioCache', key);
}

export async function removeCachedAudio(key) {
  const db = await getDB();
  await db.delete('audioCache', key);
}

export async function getCachedAudioByBook(bookId) {
  const db = await getDB();
  return db.getAllFromIndex('audioCache', 'bookId', bookId);
}

export async function getAllCachedAudio() {
  const db = await getDB();
  return db.getAll('audioCache');
}

export async function getCacheSize() {
  const db = await getDB();
  const all = await db.getAll('audioCache');
  return all.reduce((total, item) => total + (item.size || 0), 0);
}

export async function clearOldCache(maxSizeBytes) {
  const db = await getDB();
  const all = await db.getAll('audioCache');
  
  // 按缓存时间排序，最老的在前
  all.sort((a, b) => a.cachedAt - b.cachedAt);
  
  let totalSize = all.reduce((sum, item) => sum + (item.size || 0), 0);
  
  // 删除最老的缓存直到低于限制
  for (const item of all) {
    if (totalSize <= maxSizeBytes) break;
    await db.delete('audioCache', item.key);
    totalSize -= item.size || 0;
  }
}

// ===== 设置 =====

export async function setSetting(key, value) {
  const db = await getDB();
  await db.put('settings', { key, value });
  // 同步到服务端
  userApi.saveSettings({ [key]: value }).catch(() => {});
}

export async function getSetting(key, defaultValue = null) {
  const db = await getDB();
  const item = await db.get('settings', key);
  return item ? item.value : defaultValue;
}

// ===== 服务端同步（应用启动时调用一次） =====

/**
 * 从服务端拉取用户数据并合并到本地 IndexedDB
 * 策略：服务端有而本地没有的 → 写入本地
 *       两边都有的 → 取 updatedAt/addedAt 更新的那个
 *       本地有而服务端没有的 → 推送到服务端
 */
export async function syncFromServer() {
  const db = await getDB();

  try {
    // === 同步收藏 ===
    const serverFavRes = await userApi.getFavorites();
    const serverFavs = serverFavRes.data || [];
    const localFavs = await db.getAll('favorites');
    const localFavMap = {};
    for (const f of localFavs) localFavMap[f.bookId] = f;

    // 服务端 → 本地
    for (const sf of serverFavs) {
      const lf = localFavMap[sf.bookId];
      if (!lf || (sf.addedAt || 0) > (lf.addedAt || 0)) {
        await db.put('favorites', sf);
      }
      delete localFavMap[sf.bookId];
    }
    // 本地有、服务端没有 → 推送到服务端
    for (const bookId in localFavMap) {
      userApi.addFavorite(bookId, localFavMap[bookId]).catch(() => {});
    }

    // === 同步播放进度 ===
    const serverProgRes = await userApi.getAllProgress();
    const serverProgs = serverProgRes.data || [];
    const localProgs = await db.getAll('playProgress');
    const localProgMap = {};
    for (const p of localProgs) localProgMap[p.bookId] = p;

    for (const sp of serverProgs) {
      const lp = localProgMap[sp.bookId];
      if (!lp || (sp.updatedAt || 0) > (lp.updatedAt || 0)) {
        await db.put('playProgress', sp);
      }
      delete localProgMap[sp.bookId];
    }
    for (const bookId in localProgMap) {
      userApi.saveProgress(bookId, localProgMap[bookId]).catch(() => {});
    }

    // === 同步用户设置 ===
    const serverSettingsRes = await userApi.getSettings();
    const serverSettings = serverSettingsRes.data || {};
    for (const key in serverSettings) {
      const local = await db.get('settings', key);
      if (!local) {
        await db.put('settings', { key, value: serverSettings[key] });
      }
    }
    // 推送本地设置到服务端
    const localSettings = await db.getAll('settings');
    const toSync = {};
    for (const s of localSettings) {
      if (serverSettings[s.key] === undefined) {
        toSync[s.key] = s.value;
      }
    }
    if (Object.keys(toSync).length > 0) {
      userApi.saveSettings(toSync).catch(() => {});
    }

    console.log('[Sync] 服务端数据同步完成');
  } catch (e) {
    console.warn('[Sync] 服务端同步失败（离线模式，使用本地数据）:', e.message);
  }
}
