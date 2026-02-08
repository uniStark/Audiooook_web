import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  HiOutlineTrash,
  HiOutlineServerStack,
  HiOutlineFolderOpen,
  HiOutlineCloud,
  HiOutlineFolder,
  HiOutlinePlayCircle,
  HiOutlineArrowDownTray,
  HiChevronRight,
  HiChevronDown,
  HiChevronUp,
  HiArrowUturnLeft,
  HiArrowPath,
  HiCheck,
  HiXMark,
} from 'react-icons/hi2';
import { configApi, bookApi } from '../utils/api';
import useBookStore from '../stores/bookStore';
import useDownloadStore from '../stores/downloadStore';
import { getCacheSize, getAllCachedAudio, removeCachedAudio, getCachedAudioByBook, setSetting, getSetting } from '../utils/db';
import { formatSize } from '../utils/format';

export default function Settings() {
  const [config, setConfig] = useState(null);
  const [cacheSize, setCacheSize] = useState(0);
  const [cachedCount, setCachedCount] = useState(0);
  const [cacheLimitMB, setCacheLimitMB] = useState(300);
  const [clearing, setClearing] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [autoTranscode, setAutoTranscode] = useState(true);
  const [autoTranscodeCount, setAutoTranscodeCount] = useState(5);
  const [resumeRewindSeconds, setResumeRewindSeconds] = useState(3);
  // 下载管理
  const [cachedBooks, setCachedBooks] = useState([]);
  const [showCachedDetail, setShowCachedDetail] = useState(null);
  const [deletingKeys, setDeletingKeys] = useState(new Set());
  const { fetchBooks } = useBookStore();
  const { isDownloading: dlActive, tasks: dlTasks, completedCount: dlCompleted, totalCount: dlTotal, cancelDownload } = useDownloadStore();

  useEffect(() => {
    loadConfig();
    loadCacheInfo();
    loadLocalSettings();
  }, []);

  const loadConfig = async () => {
    try {
      const res = await configApi.getConfig();
      setConfig(res.data);
      if (res.data.cacheSizeMB) {
        setCacheLimitMB(res.data.cacheSizeMB);
      }
      if (res.data.autoTranscode !== undefined) {
        setAutoTranscode(res.data.autoTranscode);
      }
      if (res.data.autoTranscodeCount) {
        setAutoTranscodeCount(res.data.autoTranscodeCount);
      }
    } catch (e) {
      console.error('Failed to load config:', e);
    }
  };

  const loadCacheInfo = async () => {
    const size = await getCacheSize();
    const all = await getAllCachedAudio();
    setCacheSize(size);
    setCachedCount(all.length);
    // 按书籍分组
    const bookMap = {};
    for (const item of all) {
      const bid = item.bookId || 'unknown';
      if (!bookMap[bid]) {
        bookMap[bid] = {
          bookId: bid,
          bookName: item.bookName || bid,
          episodes: [],
          totalSize: 0,
        };
      }
      bookMap[bid].episodes.push(item);
      bookMap[bid].totalSize += item.size || 0;
    }
    setCachedBooks(Object.values(bookMap).sort((a, b) => b.totalSize - a.totalSize));
  };

  const loadLocalSettings = async () => {
    const limit = await getSetting('cacheLimitMB', 300);
    setCacheLimitMB(limit);
    const rw = await getSetting('resumeRewindSeconds', 3);
    setResumeRewindSeconds(rw);
  };

  const handleClearCache = async () => {
    if (clearing) return;
    setClearing(true);
    try {
      const all = await getAllCachedAudio();
      for (const item of all) {
        await removeCachedAudio(item.key);
      }
      await loadCacheInfo();
    } finally {
      setClearing(false);
    }
  };

  const handleCacheLimitChange = async (value) => {
    const mb = Math.max(50, Math.min(5000, parseInt(value) || 300));
    setCacheLimitMB(mb);
    await setSetting('cacheLimitMB', mb);
    try {
      await configApi.updateConfig({ cacheSizeMB: mb });
    } catch (e) {
      // 离线时忽略
    }
  };

  const handlePathSelected = async (newPath) => {
    try {
      const res = await configApi.updateConfig({ audiobookPath: newPath });
      if (res.success) {
        setConfig(prev => ({ ...prev, audiobookPath: newPath }));
        setShowBrowser(false);
        // 自动刷新书架
        await fetchBooks();
      }
    } catch (e) {
      console.error('Failed to update path:', e);
    }
  };

  const handleRefreshBooks = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await fetchBooks();
    } finally {
      setTimeout(() => setRefreshing(false), 600);
    }
  };

  const cachePercentage = cacheLimitMB > 0 ? Math.min(100, (cacheSize / (cacheLimitMB * 1024 * 1024)) * 100) : 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="page-container"
    >
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">设置</h1>
      </div>

      <div className="space-y-4">
        {/* 服务器信息 */}
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <HiOutlineServerStack className="w-5 h-5 text-primary-500" />
              <h2 className="font-semibold">服务器</h2>
            </div>
            <button
              onClick={handleRefreshBooks}
              disabled={refreshing}
              className="flex items-center gap-1.5 text-xs text-primary-500 hover:text-primary-400 bg-primary-500/10 hover:bg-primary-500/20 px-3 py-1.5 rounded-lg transition-all active:scale-95 disabled:opacity-50"
            >
              <HiArrowPath className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? '刷新中' : '刷新书库'}
            </button>
          </div>
          {config ? (
            <div className="space-y-3 text-sm">
              <div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-dark-400 flex items-center gap-2">
                    <HiOutlineFolderOpen className="w-4 h-4" />
                    有声书路径
                  </span>
                </div>
                <div
                  onClick={() => setShowBrowser(true)}
                  className="flex items-center gap-2 bg-dark-700/60 hover:bg-dark-700 border border-dark-600 rounded-xl px-3 py-2.5 cursor-pointer transition-colors active:scale-[0.98]"
                >
                  <HiOutlineFolder className="w-4 h-4 text-primary-500 flex-shrink-0" />
                  <span className="text-dark-200 text-xs truncate flex-1">
                    {config.audiobookPath}
                  </span>
                  <HiChevronRight className="w-4 h-4 text-dark-500 flex-shrink-0" />
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-dark-400 flex items-center gap-2">
                  <HiOutlineCloud className="w-4 h-4" />
                  OSS存储
                </span>
                <span className={config.ossEnabled ? 'text-green-500' : 'text-dark-500'}>
                  {config.ossEnabled ? '已启用' : '未配置'}
                </span>
              </div>

              {/* 自动转码设置 */}
              <div className="pt-2 border-t border-dark-700/30 space-y-3">
                <div className="flex justify-between items-center">
                  <div>
                    <span className="text-dark-300 text-sm">自动后台转码</span>
                    <p className="text-[10px] text-dark-500 mt-0.5">
                      WMA/FLAC/APE 等格式自动转为 MP3
                    </p>
                  </div>
                  <button
                    onClick={async () => {
                      const newVal = !autoTranscode;
                      setAutoTranscode(newVal);
                      try {
                        await configApi.updateConfig({ autoTranscode: newVal });
                        // 关闭时立即取消后台转码队列
                        if (!newVal) {
                          await bookApi.cancelTranscode().catch(() => {});
                        }
                      } catch {}
                    }}
                    className={`relative w-11 h-6 rounded-full transition-colors ${
                      autoTranscode ? 'bg-primary-500' : 'bg-dark-600'
                    }`}
                  >
                    <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                      autoTranscode ? 'translate-x-[22px]' : 'translate-x-0.5'
                    }`} />
                  </button>
                </div>

                {autoTranscode && (
                  <div>
                    <div className="flex justify-between items-center mb-1.5">
                      <span className="text-dark-400 text-xs">预转码集数</span>
                      <span className="text-primary-500 text-xs font-medium">{autoTranscodeCount} 集</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="20"
                      step="1"
                      value={autoTranscodeCount}
                      onChange={async (e) => {
                        const val = parseInt(e.target.value) || 5;
                        setAutoTranscodeCount(val);
                        try { await configApi.updateConfig({ autoTranscodeCount: val }); } catch {}
                      }}
                      className="w-full"
                    />
                    <div className="flex justify-between text-[10px] text-dark-600 mt-0.5">
                      <span>1集</span>
                      <span>20集</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-dark-500">加载中...</p>
          )}
        </div>

        {/* 播放设置 */}
        <div className="glass-card p-4">
          <div className="flex items-center gap-3 mb-3">
            <HiOutlinePlayCircle className="w-5 h-5 text-primary-500" />
            <h2 className="font-semibold">播放设置</h2>
          </div>
          <div className="space-y-3 text-sm">
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <div>
                  <span className="text-dark-300">继续播放回退</span>
                  <p className="text-[10px] text-dark-500 mt-0.5">恢复播放时自动回退几秒</p>
                </div>
                <span className="text-primary-500 text-sm font-medium">{resumeRewindSeconds}秒</span>
              </div>
              <input
                type="range"
                min="0"
                max="30"
                step="1"
                value={resumeRewindSeconds}
                onChange={async (e) => {
                  const val = parseInt(e.target.value) || 0;
                  setResumeRewindSeconds(val);
                  await setSetting('resumeRewindSeconds', val);
                }}
                className="w-full"
              />
              <div className="flex justify-between text-[10px] text-dark-600 mt-0.5">
                <span>0秒</span>
                <span>30秒</span>
              </div>
            </div>
          </div>
        </div>

        {/* 活跃下载进度 */}
        {dlActive && dlTasks.length > 0 && (
          <div className="glass-card p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
                <h2 className="font-semibold text-sm">正在下载</h2>
              </div>
              <button
                onClick={cancelDownload}
                className="text-xs text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 px-3 py-1.5 rounded-lg transition-all"
              >
                取消下载
              </button>
            </div>
            <div className="mb-2">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-dark-400">总进度 {dlCompleted}/{dlTotal}</span>
                <span className="text-primary-500">{dlTotal > 0 ? Math.round((dlCompleted / dlTotal) * 100) : 0}%</span>
              </div>
              <div className="h-2 bg-dark-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary-500 rounded-full transition-all duration-300"
                  style={{ width: `${dlTotal > 0 ? (dlCompleted / dlTotal) * 100 : 0}%` }}
                />
              </div>
            </div>
            {(() => {
              const current = dlTasks.find(t => t.status === 'downloading');
              return current ? (
                <div className="text-[10px] text-dark-500">
                  <div className="flex justify-between mb-0.5">
                    <span className="truncate">{current.episodeName}</span>
                    <span className="ml-2 flex-shrink-0">{current.progress}%</span>
                  </div>
                  <div className="h-1 bg-dark-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary-400/70 rounded-full transition-all duration-150"
                      style={{ width: `${current.progress}%` }}
                    />
                  </div>
                </div>
              ) : null;
            })()}
          </div>
        )}

        {/* 缓存管理 */}
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">离线缓存</h2>
            <span className="text-xs text-dark-400">{cachedCount} 个文件</span>
          </div>

          <div className="mb-4">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-dark-400">已使用 {formatSize(cacheSize)}</span>
              <span className="text-dark-500">限制 {cacheLimitMB}MB</span>
            </div>
            <div className="h-2 bg-dark-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  cachePercentage > 90 ? 'bg-red-500' :
                  cachePercentage > 70 ? 'bg-yellow-500' : 'bg-primary-500'
                }`}
                style={{ width: `${cachePercentage}%` }}
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="text-sm text-dark-400 mb-2 block">
              缓存大小限制：{cacheLimitMB} MB
            </label>
            <input
              type="range"
              min="50"
              max="5000"
              step="50"
              value={cacheLimitMB}
              onChange={(e) => handleCacheLimitChange(e.target.value)}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-dark-500 mt-1">
              <span>50MB</span>
              <span>5GB</span>
            </div>
          </div>

          <button
            onClick={handleClearCache}
            disabled={clearing || cacheSize === 0}
            className="w-full flex items-center justify-center gap-2 text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 py-3 rounded-xl transition-all disabled:opacity-50"
          >
            {clearing ? (
              <div className="w-4 h-4 border-2 border-red-400/30 border-t-red-400 rounded-full animate-spin" />
            ) : (
              <HiOutlineTrash className="w-5 h-5" />
            )}
            <span className="text-sm font-medium">
              {clearing ? '清除中...' : '清除所有缓存'}
            </span>
          </button>
        </div>

        {/* 下载管理 */}
        {cachedBooks.length > 0 && (
          <div className="glass-card p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <HiOutlineArrowDownTray className="w-5 h-5 text-primary-500" />
                <h2 className="font-semibold">已下载内容</h2>
              </div>
              <span className="text-xs text-dark-400">{formatSize(cacheSize)}</span>
            </div>
            <div className="space-y-2">
              {cachedBooks.map((cb) => (
                <div key={cb.bookId} className="bg-dark-800/50 rounded-xl overflow-hidden">
                  <div
                    className="flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-dark-700/50 transition-colors"
                    onClick={() => setShowCachedDetail(showCachedDetail === cb.bookId ? null : cb.bookId)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-dark-200 truncate">{cb.bookName}</p>
                      <p className="text-[10px] text-dark-500 mt-0.5">{cb.episodes.length}集 · {formatSize(cb.totalSize)}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!confirm(`确定删除「${cb.bookName}」的所有缓存？`)) return;
                          for (const ep of cb.episodes) {
                            await removeCachedAudio(ep.key);
                          }
                          await loadCacheInfo();
                        }}
                        className="text-red-400 hover:text-red-300 p-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
                        title="删除该书全部缓存"
                      >
                        <HiOutlineTrash className="w-4 h-4" />
                      </button>
                      {showCachedDetail === cb.bookId ? (
                        <HiChevronUp className="w-4 h-4 text-dark-500" />
                      ) : (
                        <HiChevronDown className="w-4 h-4 text-dark-500" />
                      )}
                    </div>
                  </div>
                  {showCachedDetail === cb.bookId && (
                    <div className="border-t border-dark-700/30 px-3 py-1 max-h-48 overflow-y-auto">
                      {cb.episodes
                        .sort((a, b) => (a.seasonName || '').localeCompare(b.seasonName || '') || (a.episodeName || '').localeCompare(b.episodeName || ''))
                        .map((ep) => (
                        <div key={ep.key} className="flex items-center justify-between py-1.5 text-xs border-b border-dark-700/20 last:border-b-0">
                          <div className="flex-1 min-w-0">
                            <span className="text-dark-300 truncate block">
                              {ep.seasonName ? `${ep.seasonName} · ` : ''}{ep.episodeName || ep.key}
                            </span>
                            <span className="text-dark-500 text-[10px]">{formatSize(ep.size || 0)}</span>
                          </div>
                          <button
                            disabled={deletingKeys.has(ep.key)}
                            onClick={async () => {
                              setDeletingKeys(prev => new Set(prev).add(ep.key));
                              await removeCachedAudio(ep.key);
                              await loadCacheInfo();
                              setDeletingKeys(prev => {
                                const s = new Set(prev);
                                s.delete(ep.key);
                                return s;
                              });
                            }}
                            className="text-dark-500 hover:text-red-400 p-1 rounded transition-colors disabled:opacity-30 flex-shrink-0"
                          >
                            {deletingKeys.has(ep.key) ? (
                              <div className="w-3.5 h-3.5 border border-dark-500 border-t-red-400 rounded-full animate-spin" />
                            ) : (
                              <HiXMark className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 关于 */}
        <div className="glass-card p-4">
          <h2 className="font-semibold mb-3">关于</h2>
          <div className="space-y-2 text-sm text-dark-400">
            <p>AudioBook - 在线听书 v1.0.0</p>
            <p>支持格式：MP3, WMA, WAV, FLAC, AAC, OGG, M4A, OPUS</p>
            <p className="text-dark-500 text-xs mt-2">
              将有声书文件夹按照"小说名/季(章节)/集"的结构放入服务器指定目录即可自动识别
            </p>
          </div>
        </div>
      </div>

      {/* 目录浏览器弹窗 */}
      <AnimatePresence>
        {showBrowser && (
          <DirBrowser
            currentPath={config?.audiobookPath || ''}
            onSelect={handlePathSelected}
            onClose={() => setShowBrowser(false)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ===== 目录浏览器组件 =====
function DirBrowser({ currentPath, onSelect, onClose }) {
  const [browsePath, setBrowsePath] = useState(currentPath || '');
  const [entries, setEntries] = useState([]);
  const [parentPath, setParentPath] = useState(null);
  const [drives, setDrives] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [inputPath, setInputPath] = useState('');
  const [showInput, setShowInput] = useState(false);

  useEffect(() => {
    loadDir(browsePath);
  }, []);

  const loadDir = async (dirPath) => {
    setLoading(true);
    setError('');
    try {
      const res = await configApi.browseDir(dirPath);
      if (res.success) {
        setBrowsePath(res.data.current);
        setEntries(res.data.entries || []);
        setParentPath(res.data.parent);
        setDrives(res.data.drives);
        setInputPath(res.data.current);
      }
    } catch (e) {
      const msg = e?.error || e?.message || '无法读取目录';
      setError(msg.includes('无法读取') || msg.includes('不存在') || msg.includes('不是目录')
        ? msg
        : '无法读取目录: ' + msg);
    } finally {
      setLoading(false);
    }
  };

  const handleGoTo = (entry) => {
    // 如果传入的是对象（目录条目），检查权限
    if (typeof entry === 'object') {
      if (entry.readable === false) {
        setError(`无权限访问: ${entry.name}`);
        setTimeout(() => setError(''), 2000);
        return;
      }
      loadDir(entry.path);
    } else {
      // 传入的是路径字符串（上级目录、盘符等）
      loadDir(entry);
    }
  };

  const handleInputGo = () => {
    if (inputPath.trim()) {
      loadDir(inputPath.trim());
      setShowInput(false);
    }
  };

  const handleConfirm = () => {
    onSelect(browsePath);
  };

  // 路径面包屑
  const pathParts = browsePath.split(/[/\\]/).filter(Boolean);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end justify-center"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="bg-dark-900 rounded-t-3xl w-full max-w-lg max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between p-4 border-b border-dark-700/50">
          <h3 className="font-semibold text-white">选择有声书目录</h3>
          <button onClick={onClose} className="text-dark-400 hover:text-white p-1">
            <HiXMark className="w-6 h-6" />
          </button>
        </div>

        {/* 当前路径 & 面包屑 */}
        <div className="px-4 py-2 border-b border-dark-700/30">
          {showInput ? (
            <div className="flex gap-2">
              <input
                type="text"
                value={inputPath}
                onChange={(e) => setInputPath(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleInputGo()}
                autoFocus
                placeholder="输入路径..."
                className="flex-1 bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-primary-500/50"
              />
              <button onClick={handleInputGo} className="text-primary-500 text-xs font-medium px-2">
                前往
              </button>
              <button onClick={() => setShowInput(false)} className="text-dark-400 text-xs px-1">
                取消
              </button>
            </div>
          ) : (
            <div
              onClick={() => setShowInput(true)}
              className="text-xs text-dark-400 truncate cursor-pointer hover:text-dark-200 transition-colors py-1"
              title="点击手动输入路径"
            >
              {browsePath || '/'}
            </div>
          )}
        </div>

        {/* 导航按钮 */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-dark-700/30">
          {parentPath && (
            <button
              onClick={() => handleGoTo(parentPath)}
              className="flex items-center gap-1 text-xs text-dark-300 hover:text-white bg-dark-700/50 hover:bg-dark-700 px-3 py-1.5 rounded-lg transition-colors"
            >
              <HiArrowUturnLeft className="w-3.5 h-3.5" />
              上级目录
            </button>
          )}
          {drives && drives.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {drives.map((d) => (
                <button
                  key={d.path}
                  onClick={() => handleGoTo(d.path)}
                  className="text-xs text-dark-300 hover:text-white bg-dark-700/50 hover:bg-dark-700 px-2.5 py-1.5 rounded-lg transition-colors"
                >
                  {d.name}
                </button>
              ))}
            </div>
          )}
          {/* 权限错误提示 */}
          {error && !loading && entries.length > 0 && (
            <span className="text-xs text-red-400 ml-auto">{error}</span>
          )}
        </div>

        {/* 目录列表 */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-dark-600 border-t-primary-500 rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="text-center py-12 text-dark-400 text-sm">{error}</div>
          ) : entries.length === 0 ? (
            <div className="text-center py-12">
              <HiOutlineFolder className="w-10 h-10 text-dark-600 mx-auto mb-2" />
              <p className="text-dark-500 text-sm">此目录下没有子文件夹</p>
            </div>
          ) : (
            <div className="py-1">
              {entries.map((entry) => (
                <button
                  key={entry.path}
                  onClick={() => handleGoTo(entry)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                    entry.readable === false
                      ? 'opacity-40 cursor-not-allowed'
                      : 'hover:bg-dark-800 active:bg-dark-700'
                  }`}
                >
                  <HiOutlineFolder className={`w-5 h-5 flex-shrink-0 ${
                    entry.readable === false ? 'text-dark-500' : 'text-primary-500/70'
                  }`} />
                  <span className={`text-sm truncate flex-1 ${
                    entry.readable === false ? 'text-dark-500' : 'text-dark-200'
                  }`}>
                    {entry.name}
                  </span>
                  {entry.readable === false ? (
                    <span className="text-[10px] text-dark-500 flex-shrink-0">无权限</span>
                  ) : (
                    <HiChevronRight className="w-4 h-4 text-dark-600 flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 底部确认 */}
        <div className="p-4 border-t border-dark-700/50 space-y-2">
          <p className="text-xs text-dark-500 truncate">
            选中：{browsePath}
          </p>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-xl text-sm font-medium text-dark-300 bg-dark-700/50 hover:bg-dark-700 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              className="flex-1 py-3 rounded-xl text-sm font-medium text-dark-900 bg-primary-500 hover:bg-primary-600 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              <HiCheck className="w-5 h-5" />
              确认选择
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
