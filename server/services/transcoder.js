/**
 * 后台转码服务
 * 
 * 功能：
 * 1. 共享的转码逻辑（ensureTranscoded），供播放和后台预转码共用
 * 2. 后台队列：逐个执行转码任务，避免服务器过载
 * 3. 新书预转码：首次添加书籍时，自动转码第一季前 N 集
 * 4. 播放预转码：播放某集时，自动转码接下来的 N 集
 * 5. 配置项：autoTranscode 开关、autoTranscodeCount 集数
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { needsTranscode } = require('../utils/parser');

const { TRANSCODE_CACHE_DIR, CONFIG_FILE } = require('../utils/paths');

// ========== 转码状态管理 ==========

// 正在转码中的文件（防止并发重复）
const transcodingInProgress = new Map();

// 后台转码队列
const transcodeQueue = [];
let activeWorkers = 0;        // 当前正在运行的转码 worker 数
const MAX_CONCURRENCY = 10;   // 最大并发数硬上限

// ========== 配置 ==========

function getTranscodeConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      return {
        autoTranscode: config.autoTranscode !== false, // 默认开启
        autoTranscodeCount: Math.max(1, Math.min(20, config.autoTranscodeCount || 5)),
      };
    }
  } catch { /* ignore */ }
  return { autoTranscode: true, autoTranscodeCount: 5 };
}

// ========== 核心转码 ==========

/**
 * 获取转码缓存文件路径
 */
function getTranscodeCachePath(bookId, seasonId, episodeId) {
  return path.join(TRANSCODE_CACHE_DIR, `${bookId}_${seasonId}_${episodeId}.mp3`);
}

/**
 * 检查某集是否已完成转码
 */
function isTranscoded(bookId, seasonId, episodeId) {
  const cachePath = getTranscodeCachePath(bookId, seasonId, episodeId);
  try {
    if (fs.existsSync(cachePath)) {
      const stat = fs.statSync(cachePath);
      return stat.size > 1024;
    }
  } catch { /* ignore */ }
  return false;
}

/**
 * 确保转码缓存存在（不存在则转码）
 * 供播放请求同步等待，也供后台队列调用
 * 返回缓存文件路径
 */
async function ensureTranscoded(filePath, bookId, seasonId, episodeId) {
  const cachePath = getTranscodeCachePath(bookId, seasonId, episodeId);

  // 已有缓存且有效
  if (fs.existsSync(cachePath)) {
    const stat = fs.statSync(cachePath);
    if (stat.size > 1024) {
      return cachePath;
    }
    // 损坏文件，删除重来
    fs.unlinkSync(cachePath);
  }

  // 正在转码中，等待完成
  const cacheKey = `${bookId}_${seasonId}_${episodeId}`;
  if (transcodingInProgress.has(cacheKey)) {
    return transcodingInProgress.get(cacheKey);
  }

  // 开始转码
  const transcodePromise = new Promise((resolve, reject) => {
    const tempPath = cachePath + '.tmp';

    console.log(`[Transcode] 开始转码: ${path.basename(filePath)} -> MP3`);
    const startTime = Date.now();

    const ffmpeg = spawn('ffmpeg', [
      '-i', filePath,
      '-f', 'mp3',
      '-ab', '128k',
      '-ar', '44100',
      '-ac', '2',
      '-y',
      '-v', 'quiet',
      tempPath,
    ]);

    ffmpeg.on('close', (code) => {
      transcodingInProgress.delete(cacheKey);
      if (code === 0 && fs.existsSync(tempPath)) {
        fs.renameSync(tempPath, cachePath);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[Transcode] 转码完成 (${elapsed}s): ${path.basename(filePath)}`);
        resolve(cachePath);
      } else {
        try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
        reject(new Error(`转码失败 (exit code: ${code})`));
      }
    });

    ffmpeg.on('error', (err) => {
      transcodingInProgress.delete(cacheKey);
      try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
      reject(err);
    });
  });

  transcodingInProgress.set(cacheKey, transcodePromise);
  return transcodePromise;
}

// ========== 后台并发队列 ==========

/**
 * 启动一个 worker：从队列取任务执行，执行完再取下一个，直到队列空
 */
async function startWorker() {
  activeWorkers++;
  while (transcodeQueue.length > 0) {
    const task = transcodeQueue.shift();
    try {
      await ensureTranscoded(task.filePath, task.bookId, task.seasonId, task.episodeId);
    } catch (e) {
      console.error(`[Transcode] 后台转码失败: ${path.basename(task.filePath)}: ${e.message}`);
    }
  }
  activeWorkers--;
  if (activeWorkers === 0) {
    console.log('[Transcode] 后台转码队列已全部完成');
  }
}

/**
 * 根据待处理任务数自动调整并发 worker 数
 * 规则：并发数 = min(新增任务数, 队列总长度, MAX_CONCURRENCY) - 已有worker数
 */
function scheduleWorkers(newTaskCount) {
  // 期望的并发数 = 实际需要处理的任务量，但不超过上限
  const desired = Math.min(newTaskCount, transcodeQueue.length, MAX_CONCURRENCY);
  const toSpawn = Math.max(0, desired - activeWorkers);
  if (toSpawn > 0) {
    console.log(`[Transcode] 启动 ${toSpawn} 个并发转码 worker (当前活跃: ${activeWorkers}, 队列: ${transcodeQueue.length})`);
    for (let i = 0; i < toSpawn; i++) {
      startWorker(); // fire-and-forget，不 await
    }
  }
}

/**
 * 向后台队列中添加转码任务（去重、跳过已完成）
 * 自动根据任务数量启动对应数量的并发 worker
 */
function enqueueTranscode(tasks) {
  let added = 0;
  for (const task of tasks) {
    // 已转码完成，跳过
    if (isTranscoded(task.bookId, task.seasonId, task.episodeId)) continue;
    // 正在转码中，跳过
    const key = `${task.bookId}_${task.seasonId}_${task.episodeId}`;
    if (transcodingInProgress.has(key)) continue;
    // 已在队列中，跳过
    if (transcodeQueue.some(t =>
      t.bookId === task.bookId && t.seasonId === task.seasonId && t.episodeId === task.episodeId
    )) continue;

    transcodeQueue.push(task);
    added++;
  }

  if (added > 0) {
    scheduleWorkers(added);
  }
  return added;
}

// ========== 预转码策略 ==========

/**
 * 新书预转码：转码第一季/第一章的前 N 集中需要转码的
 * @param {object} book - 完整的 book 对象（含 seasons[].episodes[]）
 */
function preTranscodeBook(book) {
  const config = getTranscodeConfig();
  if (!config.autoTranscode) return;

  if (!book.seasons || book.seasons.length === 0) return;

  const count = config.autoTranscodeCount;
  const tasks = [];
  const firstSeason = book.seasons[0];

  // 取第一季的前 N 集
  const limit = Math.min(count, firstSeason.episodes.length);
  for (let i = 0; i < limit; i++) {
    const ep = firstSeason.episodes[i];
    if (ep.needsTranscode) {
      tasks.push({
        filePath: ep.filePath,
        bookId: book.id,
        seasonId: firstSeason.id,
        episodeId: ep.id,
      });
    }
  }

  if (tasks.length > 0) {
    console.log(`[Transcode] 新书预转码: "${book.name}" 第一季前 ${limit} 集 (${tasks.length} 集需转码)`);
    enqueueTranscode(tasks);
  }
}

/**
 * 播放位置预转码：从当前播放位置往后转码 N 集中需要转码的
 * @param {object} book - 完整 book 对象
 * @param {number} seasonIndex - 当前播放的季索引
 * @param {number} episodeIndex - 当前播放的集索引
 */
function preTranscodeFromPosition(book, seasonIndex, episodeIndex) {
  const config = getTranscodeConfig();
  if (!config.autoTranscode) return;

  if (!book.seasons || book.seasons.length === 0) return;

  const count = config.autoTranscodeCount;
  const tasks = [];
  let collected = 0;

  // 从当前集的下一集开始往后收集
  let sIdx = seasonIndex;
  let eIdx = episodeIndex + 1;

  while (sIdx < book.seasons.length && collected < count) {
    const season = book.seasons[sIdx];
    while (eIdx < season.episodes.length && collected < count) {
      const ep = season.episodes[eIdx];
      if (ep.needsTranscode) {
        tasks.push({
          filePath: ep.filePath,
          bookId: book.id,
          seasonId: season.id,
          episodeId: ep.id,
        });
      }
      collected++;
      eIdx++;
    }
    sIdx++;
    eIdx = 0;
  }

  if (tasks.length > 0) {
    console.log(`[Transcode] 播放预转码: "${book.name}" 接下来 ${count} 集 (${tasks.length} 集需转码)`);
    enqueueTranscode(tasks);
  }
}

/**
 * 获取转码状态（供 API 查询）
 */
function getTranscodeStatus() {
  return {
    queueLength: transcodeQueue.length,
    activeWorkers,
    maxConcurrency: MAX_CONCURRENCY,
    inProgress: transcodingInProgress.size,
    queueItems: transcodeQueue.slice(0, 10).map(t => ({
      bookId: t.bookId,
      seasonId: t.seasonId,
      episodeId: t.episodeId,
    })),
  };
}

module.exports = {
  ensureTranscoded,
  isTranscoded,
  getTranscodeCachePath,
  preTranscodeBook,
  preTranscodeFromPosition,
  getTranscodeStatus,
  getTranscodeConfig,
  TRANSCODE_CACHE_DIR,
};
