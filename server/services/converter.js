/**
 * 音频格式转换服务
 *
 * 架构：当检测到书籍包含 WMA/APE 文件时，后台全量转换为 AAC (.m4a)，
 * 转换完成后删除原始文件。之后播放直接读取 .m4a，无需在线转码。
 *
 * 转换参数：AAC 64kbps / 44.1kHz / mono（人声有声书最优平衡）
 * 性能保护：动态并发 + CPU/内存监控（不超过 85%）
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const SYSTEM_LOAD_LIMIT = 0.85;
const MAX_CONCURRENCY = 10;

// 需要转换的格式
const CONVERT_EXTENSIONS = new Set(['.wma', '.ape']);

// ========== 每本书的转换进度 ==========
// bookId -> { total, completed, failed, failedFiles, currentFile, status: 'idle'|'converting'|'done'|'error' }
const bookProgress = new Map();

// Permanently failed files — never retry these
const permanentlyFailed = new Set();

// 全局活跃 worker 数
let activeWorkers = 0;

// ========== 系统性能监控 ==========

let lastCpuSnapshot = null;

function getCpuSnapshot() {
  const cpus = os.cpus();
  let totalIdle = 0, totalTick = 0;
  for (const cpu of cpus) {
    for (const type in cpu.times) totalTick += cpu.times[type];
    totalIdle += cpu.times.idle;
  }
  return { idle: totalIdle, total: totalTick };
}

function getCpuUsage() {
  const current = getCpuSnapshot();
  if (!lastCpuSnapshot) {
    lastCpuSnapshot = current;
    const loadAvg1m = os.loadavg()[0];
    return Math.min(1, loadAvg1m / os.cpus().length);
  }
  const idleDiff = current.idle - lastCpuSnapshot.idle;
  const totalDiff = current.total - lastCpuSnapshot.total;
  lastCpuSnapshot = current;
  return totalDiff === 0 ? 0 : 1 - (idleDiff / totalDiff);
}

function getMemUsage() {
  return (os.totalmem() - os.freemem()) / os.totalmem();
}

function isSystemOverloaded() {
  return getCpuUsage() > SYSTEM_LOAD_LIMIT || getMemUsage() > SYSTEM_LOAD_LIMIT;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ========== 判断文件是否需要转换 ==========

function needsConversion(filename) {
  const ext = path.extname(filename).toLowerCase();
  return CONVERT_EXTENSIONS.has(ext);
}

// ========== 单文件转换 ==========

/**
 * 将单个音频文件转换为 AAC (.m4a)
 * 成功后删除原始文件，返回新文件路径
 */
function convertFile(inputPath) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(inputPath);
    const baseName = path.basename(inputPath, path.extname(inputPath));
    const outputPath = path.join(dir, `${baseName}.m4a`);
    const tempPath = outputPath + '.tmp';

    if (fs.existsSync(outputPath)) {
      try {
        const stat = fs.statSync(outputPath);
        if (stat.size > 1024) {
          fs.unlinkSync(inputPath);
          return resolve(outputPath);
        }
        fs.unlinkSync(outputPath);
      } catch { /* continue to convert */ }
    }

    const startTime = Date.now();
    const stderrChunks = [];

    const ffmpeg = spawn('ffmpeg', [
      '-i', inputPath,
      '-c:a', 'aac',
      '-b:a', '64k',
      '-ar', '44100',
      '-ac', '1',
      '-y',
      '-v', 'error',
      tempPath,
    ]);

    ffmpeg.stderr.on('data', (chunk) => stderrChunks.push(chunk));

    ffmpeg.on('close', (code) => {
      if (code === 0 && fs.existsSync(tempPath)) {
        try {
          const stat = fs.statSync(tempPath);
          if (stat.size < 1024) {
            fs.unlinkSync(tempPath);
            return reject(new Error('转换输出文件过小，可能失败'));
          }
          fs.renameSync(tempPath, outputPath);
          fs.unlinkSync(inputPath);
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`[Converter] ✓ ${path.basename(inputPath)} → .m4a (${elapsed}s)`);
          resolve(outputPath);
        } catch (e) {
          reject(new Error(`文件操作失败: ${e.message}`));
        }
      } else {
        try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
        const stderrStr = Buffer.concat(stderrChunks).toString().trim();
        const detail = stderrStr ? stderrStr.split('\n').pop() : '';
        reject(new Error(`FFmpeg exit code ${code}${detail ? ': ' + detail : ''}`));
      }
    });

    ffmpeg.on('error', (err) => {
      try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
      reject(err);
    });
  });
}

// ========== 整本书转换 ==========

/**
 * 收集一本书中所有需要转换的文件路径
 */
function collectFilesToConvert(book) {
  const files = [];
  if (!book.seasons) return files;
  for (const season of book.seasons) {
    for (const ep of season.episodes) {
      if (needsConversion(ep.fileName)) {
        files.push(ep.filePath);
      }
    }
  }
  return files;
}

/**
 * 启动一本书的全量格式转换
 * 如果已经在转换中则跳过
 */
function startBookConversion(book) {
  if (!book || !book.id) return;

  const existing = bookProgress.get(book.id);
  if (existing && existing.status === 'converting') return;

  const allFiles = collectFilesToConvert(book);
  // Filter out files that have permanently failed — no point retrying
  const files = allFiles.filter(f => !permanentlyFailed.has(f));
  if (files.length === 0) return;

  const progress = {
    total: files.length,
    completed: 0,
    failed: 0,
    failedFiles: [],
    currentFile: '',
    status: 'converting',
    startedAt: Date.now(),
  };
  bookProgress.set(book.id, progress);

  console.log(`[Converter] 开始转换: "${book.name}" (${files.length} 个文件)`);
  runConversionQueue(book.id, files, progress);
}

/**
 * 并发执行转换队列
 */
async function runConversionQueue(bookId, files, progress) {
  const queue = [...files];
  const cpuCores = os.cpus().length;
  const maxWorkers = Math.max(1, Math.min(Math.floor(cpuCores / 2), MAX_CONCURRENCY));

  const worker = async () => {
    activeWorkers++;
    while (queue.length > 0) {
      // 系统过载时等待
      let overloadRetries = 0;
      while (isSystemOverloaded() && overloadRetries < 6) {
        overloadRetries++;
        console.log(`[Converter] 系统负载高，等待中... (${overloadRetries}/6)`);
        await sleep(10000);
      }
      if (overloadRetries >= 6) {
        console.log('[Converter] 系统持续过载，Worker 暂时退出');
        break;
      }

      const filePath = queue.shift();
      if (!filePath) break;

      progress.currentFile = path.basename(filePath);

      try {
        await convertFile(filePath);
        progress.completed++;
      } catch (e) {
        progress.failed++;
        progress.failedFiles.push({ file: path.basename(filePath), error: e.message });
        permanentlyFailed.add(filePath);
        console.error(`[Converter] ✗ ${path.basename(filePath)}: ${e.message}`);
      }
    }
    activeWorkers--;
  };

  // 启动并发 worker
  const workerCount = Math.min(maxWorkers - activeWorkers, files.length);
  const workers = [];
  for (let i = 0; i < Math.max(1, workerCount); i++) {
    workers.push(worker());
  }

  await Promise.all(workers);

  // 更新最终状态
  progress.currentFile = '';
  progress.finishedAt = Date.now();
  if (progress.failed > 0 && progress.completed === 0) {
    progress.status = 'error';
  } else {
    progress.status = 'done';
  }

  const elapsed = ((progress.finishedAt - progress.startedAt) / 1000).toFixed(1);
  console.log(`[Converter] 转换完成: "${bookId}" — 成功 ${progress.completed}, 失败 ${progress.failed}, 耗时 ${elapsed}s`);
}

/**
 * 获取某本书的转换进度
 */
function getConversionProgress(bookId) {
  return bookProgress.get(bookId) || null;
}

/**
 * 检查一本书是否有需要转换的文件
 */
function bookNeedsConversion(book) {
  if (!book || !book.seasons) return false;
  for (const season of book.seasons) {
    for (const ep of season.episodes) {
      if (needsConversion(ep.fileName)) return true;
    }
  }
  return false;
}

module.exports = {
  startBookConversion,
  getConversionProgress,
  bookNeedsConversion,
  collectFilesToConvert,
  needsConversion,
  convertFile,
  CONVERT_EXTENSIONS,
};
