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
const os = require('os');
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
let cancelRequested = false;  // 取消标志：完成当前任务后停止
const SYSTEM_LOAD_LIMIT = 0.85; // 系统负载上限 85%

// ========== 系统性能监控 ==========

// 上一次 CPU 快照（用于计算 CPU 使用率）
let lastCpuSnapshot = null;

/**
 * 获取当前 CPU 使用率快照
 */
function getCpuSnapshot() {
  const cpus = os.cpus();
  let totalIdle = 0, totalTick = 0;
  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  }
  return { idle: totalIdle, total: totalTick };
}

/**
 * 计算两次快照之间的 CPU 使用率 (0.0 ~ 1.0)
 */
function getCpuUsage() {
  const current = getCpuSnapshot();
  if (!lastCpuSnapshot) {
    lastCpuSnapshot = current;
    // 首次调用用 loadavg 估算
    const loadAvg1m = os.loadavg()[0];
    const cpuCount = os.cpus().length;
    return Math.min(1, loadAvg1m / cpuCount);
  }
  const idleDiff = current.idle - lastCpuSnapshot.idle;
  const totalDiff = current.total - lastCpuSnapshot.total;
  lastCpuSnapshot = current;
  if (totalDiff === 0) return 0;
  return 1 - (idleDiff / totalDiff);
}

/**
 * 获取内存使用率 (0.0 ~ 1.0)
 */
function getMemUsage() {
  const total = os.totalmem();
  const free = os.freemem();
  return (total - free) / total;
}

/**
 * 检查系统是否过载（CPU 或内存超过 85%）
 */
function isSystemOverloaded() {
  const cpuUsage = getCpuUsage();
  const memUsage = getMemUsage();
  const overloaded = cpuUsage > SYSTEM_LOAD_LIMIT || memUsage > SYSTEM_LOAD_LIMIT;
  if (overloaded) {
    console.log(`[Transcode] 系统负载过高，暂停调度 (CPU: ${(cpuUsage * 100).toFixed(1)}%, MEM: ${(memUsage * 100).toFixed(1)}%, 上限: ${SYSTEM_LOAD_LIMIT * 100}%)`);
  }
  return overloaded;
}

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
 * 等待指定毫秒
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 启动一个 worker：从队列取任务执行，执行完再取下一个，直到队列空
 * 每次取任务前检查：1) 取消标志  2) 配置是否还开启  3) 系统负载是否过高
 */
async function startWorker() {
  activeWorkers++;
  while (transcodeQueue.length > 0) {
    // 检查取消标志
    if (cancelRequested) {
      console.log('[Transcode] Worker 收到取消信号，停止处理队列');
      break;
    }
    // 检查配置是否仍开启
    const config = getTranscodeConfig();
    if (!config.autoTranscode) {
      console.log('[Transcode] 自动转码已关闭，停止后台队列');
      cancelRequested = true;
      break;
    }
    // 检查系统负载是否过高，过载时等待后重试
    if (isSystemOverloaded()) {
      // 等待 10 秒后重新检查
      await sleep(10000);
      // 重新检查，如果连续过载超过 3 次，当前 worker 退出
      let retries = 0;
      while (isSystemOverloaded() && retries < 3) {
        retries++;
        console.log(`[Transcode] 系统仍然过载，等待中... (${retries}/3)`);
        await sleep(15000);
      }
      if (retries >= 3) {
        console.log('[Transcode] 系统持续过载，Worker 暂时退出，剩余任务保留在队列中');
        break;
      }
    }

    const task = transcodeQueue.shift();
    try {
      await ensureTranscoded(task.filePath, task.bookId, task.seasonId, task.episodeId);
    } catch (e) {
      console.error(`[Transcode] 后台转码失败: ${path.basename(task.filePath)}: ${e.message}`);
    }
  }
  activeWorkers--;
  if (activeWorkers === 0) {
    if (cancelRequested) {
      // 清空队列中剩余任务
      transcodeQueue.length = 0;
      cancelRequested = false;
      console.log('[Transcode] 后台转码队列已取消，剩余任务已清空');
    } else if (transcodeQueue.length === 0) {
      console.log('[Transcode] 后台转码队列已全部完成');
    }
    // 如果队列还有任务（因过载退出的 worker），后续入队时会重新调度
  }
}

/**
 * 根据待处理任务数自动调整并发 worker 数
 * 规则：并发数 = min(新增任务数, 队列总长度, MAX_CONCURRENCY) - 已有worker数
 * 额外限制：如果系统已过载，不启动新 worker
 */
function scheduleWorkers(newTaskCount) {
  // 系统过载时仅确保至少有 1 个 worker（worker 内部会自行等待负载下降）
  if (isSystemOverloaded()) {
    if (activeWorkers === 0 && transcodeQueue.length > 0) {
      console.log('[Transcode] 系统负载较高，仅启动 1 个 worker（将等待负载下降后执行）');
      startWorker();
    }
    return;
  }

  // 根据 CPU 核数动态限制并发（CPU 核数 / 2，但至少 1，最多 MAX_CONCURRENCY）
  const cpuCores = os.cpus().length;
  const dynamicMax = Math.max(1, Math.min(Math.floor(cpuCores / 2), MAX_CONCURRENCY));

  const desired = Math.min(newTaskCount, transcodeQueue.length, dynamicMax);
  const toSpawn = Math.max(0, desired - activeWorkers);
  if (toSpawn > 0) {
    console.log(`[Transcode] 启动 ${toSpawn} 个并发转码 worker (活跃: ${activeWorkers}, 队列: ${transcodeQueue.length}, CPU核数: ${cpuCores}, 动态上限: ${dynamicMax})`);
    for (let i = 0; i < toSpawn; i++) {
      startWorker(); // fire-and-forget，不 await
    }
  }
}

/**
 * 向后台队列中添加转码任务（去重、跳过已完成）
 * 自动根据任务数量启动对应数量的并发 worker
 * @param {Array} tasks - 转码任务列表
 * @param {boolean} priority - 是否高优先级（插入队头），默认 false
 */
function enqueueTranscode(tasks, priority = false) {
  // 入队前重置取消标志（用户可能重新开启了转码）
  cancelRequested = false;

  let added = 0;
  const toAdd = [];
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

    toAdd.push(task);
    added++;
  }

  if (added > 0) {
    if (priority) {
      // 高优先级：插入队头
      transcodeQueue.unshift(...toAdd);
      console.log(`[Transcode] 高优先级入队 ${added} 个任务 (插入队头)`);
    } else {
      transcodeQueue.push(...toAdd);
    }
    scheduleWorkers(added);
  }
  return added;
}

/**
 * 取消后台转码队列（完成当前正在执行的任务后停止）
 */
function cancelQueue() {
  if (transcodeQueue.length === 0 && activeWorkers === 0) {
    return { cancelled: 0, message: '没有正在进行的转码任务' };
  }
  const remaining = transcodeQueue.length;
  cancelRequested = true;
  console.log(`[Transcode] 收到取消请求，队列中 ${remaining} 个任务将在当前任务完成后清空`);
  return { cancelled: remaining, inProgress: activeWorkers, message: `将在 ${activeWorkers} 个当前任务完成后停止` };
}

// ========== 预转码策略 ==========

/**
 * 新书预转码：以整本小说为单位，跨季收集前 N 集中需要转码的
 * 从第一季第一集开始，按顺序跨季收集，直到收集够 N 集
 * @param {object} book - 完整的 book 对象（含 seasons[].episodes[]）
 */
function preTranscodeBook(book) {
  const config = getTranscodeConfig();
  if (!config.autoTranscode) return;

  if (!book.seasons || book.seasons.length === 0) return;

  const count = config.autoTranscodeCount;
  const tasks = [];
  let collected = 0;

  // 从第一季第一集开始，跨季顺序收集前 N 集
  for (let sIdx = 0; sIdx < book.seasons.length && collected < count; sIdx++) {
    const season = book.seasons[sIdx];
    for (let eIdx = 0; eIdx < season.episodes.length && collected < count; eIdx++) {
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
    }
  }

  if (tasks.length > 0) {
    console.log(`[Transcode] 新书预转码: "${book.name}" 前 ${collected} 集 (${tasks.length} 集需转码)`);
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
    // 播放触发的预转码使用高优先级（插入队头），让用户尽快听到
    enqueueTranscode(tasks, true);
  }
}

/**
 * 获取转码状态（供 API 查询）
 */
function getTranscodeStatus() {
  const cpuUsage = getCpuUsage();
  const memUsage = getMemUsage();
  return {
    queueLength: transcodeQueue.length,
    activeWorkers,
    maxConcurrency: MAX_CONCURRENCY,
    inProgress: transcodingInProgress.size,
    systemLoad: {
      cpuPercent: +(cpuUsage * 100).toFixed(1),
      memPercent: +(memUsage * 100).toFixed(1),
      limit: SYSTEM_LOAD_LIMIT * 100,
      cpuCores: os.cpus().length,
      totalMemMB: Math.round(os.totalmem() / 1024 / 1024),
      freeMemMB: Math.round(os.freemem() / 1024 / 1024),
    },
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
  cancelQueue,
  TRANSCODE_CACHE_DIR,
};
