const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const { getAudiobookPath } = require('../services/scanner');
const { needsConversion, convertFile } = require('../services/converter');
const { isAudioFile } = require('../utils/parser');

const ARCHIVE_EXTS = new Set(['.zip', '.7z', '.rar']);

function isArchiveFile(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tar.bz2') || lower.endsWith('.tar.xz') || lower.endsWith('.tgz')) return true;
  return ARCHIVE_EXTS.has(path.extname(lower));
}

// Temp dir lives INSIDE the audiobook volume → same filesystem → rename works, no double space
const storage = multer.diskStorage({
  destination(req, file, cb) {
    if (!req._tempDir) {
      const base = path.join(getAudiobookPath(), '.upload_tmp');
      req._tempDir = path.join(base, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
      fs.mkdirSync(req._tempDir, { recursive: true });
    }
    cb(null, req._tempDir);
  },
  filename(req, file, cb) {
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
    if (req._fileIdx === undefined) req._fileIdx = 0;
    cb(null, `${req._fileIdx++}__${name}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
});

// ========== Archive extraction ==========

async function extractArchive(archivePath, outputDir) {
  const lower = path.basename(archivePath).toLowerCase();

  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz') || lower.endsWith('.tar.bz2') || lower.endsWith('.tar.xz')) {
    await execFileAsync('tar', ['-xf', archivePath, '-C', outputDir]);
  } else {
    // .zip, .7z, .rar — all handled by 7z
    await execFileAsync('7z', ['x', archivePath, `-o${outputDir}`, '-y', '-bso0', '-bsp0']);
  }
}

// ========== Helpers ==========

function moveFile(src, dest) {
  try {
    fs.renameSync(src, dest);
  } catch (e) {
    if (e.code === 'EXDEV') {
      fs.copyFileSync(src, dest);
      fs.unlinkSync(src);
    } else {
      throw e;
    }
  }
}

function moveDirContents(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir)) {
    if (entry === '__MACOSX' || entry === '.DS_Store') continue;
    const srcPath = path.join(srcDir, entry);
    const destPath = path.join(destDir, entry);
    if (fs.statSync(srcPath).isDirectory()) {
      moveDirContents(srcPath, destPath);
    } else {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      moveFile(srcPath, destPath);
    }
  }
}

function collectFilesToConvert(dir) {
  const results = [];
  try {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      try {
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          results.push(...collectFilesToConvert(full));
        } else if (isAudioFile(entry) && needsConversion(entry)) {
          results.push(full);
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return results;
}

function triggerConversion(dir) {
  const toConvert = collectFilesToConvert(dir);
  if (toConvert.length === 0) return 0;
  console.log(`[Upload] ${toConvert.length} 个文件需要格式转换`);
  (async () => {
    for (const f of toConvert) {
      try { await convertFile(f); } catch (e) {
        console.error(`[Upload] 转换失败: ${path.basename(f)}: ${e.message}`);
      }
    }
    console.log('[Upload] 上传后格式转换全部完成');
  })();
  return toConvert.length;
}

function cleanTemp(dir) {
  try { if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function stripArchiveExt(name) {
  return name.replace(/\.(zip|7z|rar|tar\.gz|tar\.bz2|tar\.xz|tgz|tar)$/i, '');
}

// ========== Route ==========

/**
 * POST /api/upload
 * mode: "files" | "folder" | "archive"
 */
router.post('/', upload.array('files', 500), async (req, res) => {
  const tempDir = req._tempDir;
  try {
    if (!req.files || req.files.length === 0) {
      cleanTemp(tempDir);
      return res.status(400).json({ success: false, error: '没有收到文件' });
    }

    const mode = req.body.mode || 'files';
    const bookName = (req.body.bookName || '').trim();
    const seasonName = (req.body.seasonName || '').trim();
    const audiobookPath = getAudiobookPath();

    if (mode === 'archive') {
      // ===== Archive mode =====
      const archiveFile = req.files[0];
      const origName = Buffer.from(archiveFile.originalname, 'latin1').toString('utf8');

      const extractDir = path.join(tempDir, '_extracted');
      fs.mkdirSync(extractDir, { recursive: true });

      try {
        await extractArchive(archiveFile.path, extractDir);
      } catch (e) {
        cleanTemp(tempDir);
        return res.status(400).json({ success: false, error: `解压失败: ${e.message}` });
      }

      // Determine structure
      const entries = fs.readdirSync(extractDir).filter(e => !e.startsWith('.') && e !== '__MACOSX');
      let finalBookName = bookName;
      let sourceDir;

      if (entries.length === 1 && fs.statSync(path.join(extractDir, entries[0])).isDirectory()) {
        sourceDir = path.join(extractDir, entries[0]);
        if (!finalBookName) finalBookName = entries[0];
      } else {
        sourceDir = extractDir;
        if (!finalBookName) finalBookName = stripArchiveExt(origName);
      }

      const destDir = path.join(audiobookPath, finalBookName);
      moveDirContents(sourceDir, destDir);
      const convertCount = triggerConversion(destDir);
      cleanTemp(tempDir);

      console.log(`[Upload] 解压完成: "${finalBookName}"`);
      return res.json({
        success: true,
        data: { bookName: finalBookName, mode: 'archive', convertingCount: convertCount },
      });

    } else if (mode === 'folder') {
      // ===== Folder mode =====
      let relativePaths;
      try { relativePaths = JSON.parse(req.body.relativePaths || '[]'); } catch { relativePaths = []; }

      if (relativePaths.length !== req.files.length) {
        cleanTemp(tempDir);
        return res.status(400).json({ success: false, error: '文件路径信息不匹配' });
      }

      // First path segment is the folder name selected by user
      let finalBookName = bookName;
      if (!finalBookName && relativePaths.length > 0) {
        const segments = relativePaths[0].split('/').filter(Boolean);
        finalBookName = segments.length > 1 ? segments[0] : 'uploaded_book';
      }

      for (let i = 0; i < req.files.length; i++) {
        const relPath = relativePaths[i];
        const segments = relPath.split('/').filter(Boolean);
        // Strip the first segment (selected folder name) — we use finalBookName instead
        const innerPath = segments.length > 1 ? segments.slice(1).join('/') : segments[0];

        const destPath = path.join(audiobookPath, finalBookName, innerPath);
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        moveFile(req.files[i].path, destPath);
      }

      const destDir = path.join(audiobookPath, finalBookName);
      const convertCount = triggerConversion(destDir);
      cleanTemp(tempDir);

      console.log(`[Upload] 文件夹上传完成: "${finalBookName}" (${req.files.length} 个文件)`);
      return res.json({
        success: true,
        data: { bookName: finalBookName, mode: 'folder', uploadedCount: req.files.length, convertingCount: convertCount },
      });

    } else {
      // ===== Files mode (default) =====
      if (!bookName) {
        cleanTemp(tempDir);
        return res.status(400).json({ success: false, error: '请输入书名' });
      }

      let destDir = path.join(audiobookPath, bookName);
      if (seasonName) destDir = path.join(destDir, seasonName);
      fs.mkdirSync(destDir, { recursive: true });

      const uploadedFiles = [];
      for (const file of req.files) {
        const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
        const destPath = path.join(destDir, originalName);
        moveFile(file.path, destPath);
        uploadedFiles.push(originalName);
      }

      const convertCount = triggerConversion(destDir);
      cleanTemp(tempDir);

      console.log(`[Upload] 文件上传完成: "${bookName}" (${uploadedFiles.length} 个文件)`);
      return res.json({
        success: true,
        data: { bookName, seasonName, mode: 'files', uploadedCount: uploadedFiles.length, convertingCount: convertCount },
      });
    }
  } catch (e) {
    cleanTemp(tempDir);
    console.error('Upload error:', e);
    res.status(500).json({ success: false, error: e.message || '上传失败' });
  }
});

router.get('/path', (req, res) => {
  res.json({ success: true, data: { path: getAudiobookPath() } });
});

router.use((err, req, res, next) => {
  cleanTemp(req?._tempDir);
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ success: false, error: '文件过大（单个文件最大 2GB）' });
    }
    return res.status(400).json({ success: false, error: err.message });
  }
  if (err) return res.status(400).json({ success: false, error: err.message });
  next();
});

module.exports = router;
