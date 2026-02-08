const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { getBookDetail } = require('../services/scanner');
const { needsTranscode, getExtension } = require('../utils/parser');
const {
  ensureTranscoded,
  preTranscodeFromPosition,
  getTranscodeStatus,
  cancelQueue,
} = require('../services/transcoder');

/**
 * 查找音频集的信息
 */
function findEpisode(bookId, seasonId, episodeId) {
  const book = getBookDetail(bookId);
  if (!book) return { error: '书籍不存在' };

  const season = book.seasons.find(s => s.id === seasonId);
  if (!season) return { error: '季不存在' };

  const episode = season.episodes.find(e => e.id === episodeId);
  if (!episode) return { error: '集不存在' };

  if (!fs.existsSync(episode.filePath)) return { error: '音频文件不存在' };

  return { book, season, episode };
}

/**
 * POST /api/audio/pretranscode
 * 触发后台预转码（播放某集时，预转码接下来 N 集）
 * body: { bookId, seasonIndex, episodeIndex }
 */
router.post('/pretranscode', (req, res) => {
  try {
    const { bookId, seasonIndex, episodeIndex } = req.body;
    if (!bookId || seasonIndex === undefined || episodeIndex === undefined) {
      return res.status(400).json({ success: false, error: '参数不完整' });
    }

    const book = getBookDetail(bookId);
    if (!book) {
      return res.status(404).json({ success: false, error: '书籍不存在' });
    }

    // fire-and-forget：后台执行，不阻塞响应
    preTranscodeFromPosition(book, seasonIndex, episodeIndex);

    res.json({ success: true, message: '预转码已触发' });
  } catch (e) {
    console.error('Pretranscode error:', e);
    res.status(500).json({ success: false, error: '触发预转码失败' });
  }
});

/**
 * GET /api/audio/transcode-status
 * 查询后台转码队列状态
 */
router.get('/transcode-status', (req, res) => {
  res.json({ success: true, data: getTranscodeStatus() });
});

/**
 * POST /api/audio/transcode-cancel
 * 取消后台转码队列（完成当前任务后停止）
 */
router.post('/transcode-cancel', (req, res) => {
  const result = cancelQueue();
  res.json({ success: true, data: result });
});

/**
 * GET /api/audio/:bookId/:seasonId/:episodeId
 * 流式传输音频文件，支持Range请求（拖拽进度条）
 */
router.get('/:bookId/:seasonId/:episodeId', async (req, res) => {
  try {
    const { bookId, seasonId, episodeId } = req.params;
    const result = findEpisode(bookId, seasonId, episodeId);
    if (result.error) {
      return res.status(404).json({ success: false, error: result.error });
    }

    const { episode } = result;

    // 需要转码的格式：先转码到缓存文件，再以标准文件方式提供（支持Range）
    if (needsTranscode(episode.fileName)) {
      try {
        const cachedFile = await ensureTranscoded(episode.filePath, bookId, seasonId, episodeId);
        return streamDirectly(cachedFile, req, res);
      } catch (e) {
        console.error('Transcode error:', e);
        return res.status(500).json({ success: false, error: '音频转码失败，请确认已安装ffmpeg' });
      }
    }

    // 直接流式传输
    return streamDirectly(episode.filePath, req, res);
  } catch (e) {
    console.error('Audio streaming error:', e);
    res.status(500).json({ success: false, error: '音频流错误' });
  }
});

/**
 * GET /api/audio/download/:bookId/:seasonId/:episodeId
 * 下载音频文件（用于离线缓存）
 */
router.get('/download/:bookId/:seasonId/:episodeId', async (req, res) => {
  try {
    const { bookId, seasonId, episodeId } = req.params;
    const result = findEpisode(bookId, seasonId, episodeId);
    if (result.error) {
      return res.status(404).json({ success: false, error: result.error });
    }

    const { episode } = result;
    let servePath = episode.filePath;
    let serveName = episode.fileName;

    // 转码后下载
    if (needsTranscode(episode.fileName)) {
      try {
        servePath = await ensureTranscoded(episode.filePath, bookId, seasonId, episodeId);
        serveName = path.basename(episode.fileName, path.extname(episode.fileName)) + '.mp3';
      } catch (e) {
        return res.status(500).json({ success: false, error: '转码失败' });
      }
    }

    const stat = fs.statSync(servePath);
    const ext = getExtension(servePath);
    const mimeType = getMimeType(ext);
    
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(serveName)}"`);
    
    fs.createReadStream(servePath).pipe(res);
  } catch (e) {
    console.error('Audio download error:', e);
    res.status(500).json({ success: false, error: '下载失败' });
  }
});

/**
 * 直接流式传输音频（支持Range请求）
 */
function streamDirectly(filePath, req, res) {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const ext = getExtension(filePath);
  const mimeType = getMimeType(ext);
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': mimeType,
    });

    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
    });

    fs.createReadStream(filePath).pipe(res);
  }
}

/**
 * 获取MIME类型
 */
function getMimeType(ext) {
  const mimeTypes = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.aac': 'audio/aac',
    '.m4a': 'audio/mp4',
    '.wma': 'audio/x-ms-wma',
    '.opus': 'audio/opus',
    '.ape': 'audio/ape',
  };
  return mimeTypes[ext] || 'audio/mpeg';
}

module.exports = router;
