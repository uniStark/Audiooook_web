/**
 * 有声书目录扫描服务
 * 扫描指定目录，解析有声书结构
 */

const fs = require('fs');
const path = require('path');
const { 
  isAudioFile, 
  extractSortNumber, 
  extractEpisodeNumber, 
  cleanName, 
  generateId, 
  getExtension,
  needsTranscode 
} = require('../utils/parser');

const { CONFIG_FILE, METADATA_FILE, SERVER_DATA_DIR } = require('../utils/paths');
const DATA_DIR = SERVER_DATA_DIR;

// 运行时可动态修改的有声书路径
let _customAudiobookPath = null;

/**
 * 获取有声书根目录
 */
function getAudiobookPath() {
  // 优先使用运行时设置 > 环境变量 > 配置文件 > 默认路径
  if (_customAudiobookPath) return _customAudiobookPath;

  // 尝试从配置文件读取
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      if (config.audiobookPath && fs.existsSync(config.audiobookPath)) {
        return config.audiobookPath;
      }
    }
  } catch { /* ignore */ }

  return process.env.AUDIOBOOK_PATH || path.join(__dirname, '..', '..', 'audiobooks');
}

/**
 * 动态设置有声书根目录
 */
function setAudiobookPath(newPath) {
  _customAudiobookPath = newPath;
  console.log(`[Config] 有声书路径已更新: ${newPath}`);
}

/**
 * 加载元数据
 */
function loadMetadata() {
  try {
    if (fs.existsSync(METADATA_FILE)) {
      return JSON.parse(fs.readFileSync(METADATA_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to load metadata:', e);
  }
  return {};
}

/**
 * 保存元数据
 */
function saveMetadata(metadata) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata, null, 2), 'utf-8');
}

/**
 * 更新书籍元数据
 */
function updateBookMetadata(bookId, updates) {
  const metadata = loadMetadata();
  metadata[bookId] = { ...(metadata[bookId] || {}), ...updates };
  saveMetadata(metadata);
  return metadata[bookId];
}

/**
 * 获取书籍元数据
 */
function getBookMetadata(bookId) {
  const metadata = loadMetadata();
  return metadata[bookId] || {};
}

/**
 * 查找封面图片
 */
function findCoverImage(dirPath) {
  const coverNames = ['cover', 'Cover', 'COVER', 'folder', 'Folder', 'poster', 'thumb'];
  const imageExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];
  
  try {
    const files = fs.readdirSync(dirPath);
    
    // 优先查找命名为cover的文件
    for (const name of coverNames) {
      for (const ext of imageExts) {
        const coverFile = files.find(f => f.toLowerCase() === `${name}${ext}`);
        if (coverFile) return path.join(dirPath, coverFile);
      }
    }
    
    // 查找任何图片文件
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (imageExts.includes(ext)) {
        return path.join(dirPath, file);
      }
    }
  } catch (e) {
    // ignore
  }
  
  return null;
}

/**
 * 扫描有声书目录
 */
function scanAudiobooks() {
  const rootPath = getAudiobookPath();
  const metadata = loadMetadata();
  const books = [];

  if (!fs.existsSync(rootPath)) {
    console.warn(`Audiobook path does not exist: ${rootPath}`);
    fs.mkdirSync(rootPath, { recursive: true });
    return books;
  }

  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
  
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;

    const bookPath = path.join(rootPath, entry.name);
    const bookId = generateId(entry.name);
    const bookMeta = metadata[bookId] || {};
    
    const book = {
      id: bookId,
      folderName: entry.name,
      name: bookMeta.customName || cleanName(entry.name),
      description: bookMeta.description || '',
      cover: bookMeta.customCover || null,
      hasCoverFile: !!findCoverImage(bookPath),
      skipIntro: bookMeta.skipIntro || 0,
      skipOutro: bookMeta.skipOutro || 0,
      seasons: [],
      totalEpisodes: 0,
      path: bookPath,
    };

    // 扫描季/章节目录
    const subEntries = fs.readdirSync(bookPath, { withFileTypes: true });
    
    // 检查是否直接包含音频文件（无季结构）
    const directAudioFiles = subEntries.filter(e => e.isFile() && isAudioFile(e.name));
    const subDirs = subEntries.filter(e => e.isDirectory() && !e.name.startsWith('.'));

    if (subDirs.length === 0 && directAudioFiles.length > 0) {
      // 没有子目录，直接包含音频文件 -> 视为单季
      const episodes = directAudioFiles.map(f => ({
        id: generateId(f.name),
        name: cleanName(f.name.replace(/\.[^.]+$/, '')),
        fileName: f.name,
        filePath: path.join(bookPath, f.name),
        sortIndex: extractEpisodeNumber(f.name),
        format: getExtension(f.name),
        needsTranscode: needsTranscode(f.name),
      })).sort((a, b) => a.sortIndex - b.sortIndex);

      book.seasons.push({
        id: generateId(entry.name + '_s1'),
        name: '全集',
        folderName: entry.name,
        sortIndex: 1,
        episodes,
        path: bookPath,
      });
      book.totalEpisodes = episodes.length;
    } else {
      // 有子目录 -> 每个子目录为一季
      for (const subDir of subDirs) {
        const seasonPath = path.join(bookPath, subDir.name);
        const seasonId = generateId(subDir.name);
        
        let audioFiles;
        try {
          audioFiles = fs.readdirSync(seasonPath)
            .filter(f => {
              try {
                return fs.statSync(path.join(seasonPath, f)).isFile() && isAudioFile(f);
              } catch { return false; }
            });
        } catch (e) {
          continue;
        }

        if (audioFiles.length === 0) continue;

        const episodes = audioFiles.map(f => ({
          id: generateId(f),
          name: cleanName(f.replace(/\.[^.]+$/, '')),
          fileName: f,
          filePath: path.join(seasonPath, f),
          sortIndex: extractEpisodeNumber(f),
          format: getExtension(f),
          needsTranscode: needsTranscode(f),
        })).sort((a, b) => a.sortIndex - b.sortIndex);

        book.seasons.push({
          id: seasonId,
          name: cleanName(subDir.name),
          folderName: subDir.name,
          sortIndex: extractSortNumber(subDir.name),
          episodes,
          path: seasonPath,
        });
        book.totalEpisodes += episodes.length;
      }

      // 排序季
      book.seasons.sort((a, b) => a.sortIndex - b.sortIndex);
    }

    // 同时检查季目录中的封面
    if (!book.hasCoverFile) {
      for (const season of book.seasons) {
        if (findCoverImage(season.path)) {
          book.hasCoverFile = true;
          break;
        }
      }
    }

    if (book.seasons.length > 0) {
      books.push(book);
    }
  }

  return books;
}

/**
 * 获取单本书详情
 */
function getBookDetail(bookId) {
  const books = scanAudiobooks();
  return books.find(b => b.id === bookId) || null;
}

/**
 * 获取封面文件路径
 */
function getCoverPath(bookId) {
  const book = getBookDetail(bookId);
  if (!book) return null;
  
  const meta = getBookMetadata(bookId);
  if (meta.customCover) return meta.customCover;
  
  // 在书籍目录和季目录中查找
  let coverPath = findCoverImage(book.path);
  if (coverPath) return coverPath;
  
  for (const season of book.seasons) {
    coverPath = findCoverImage(season.path);
    if (coverPath) return coverPath;
  }
  
  return null;
}

module.exports = {
  scanAudiobooks,
  getBookDetail,
  getCoverPath,
  updateBookMetadata,
  getBookMetadata,
  getAudiobookPath,
  setAudiobookPath,
};
