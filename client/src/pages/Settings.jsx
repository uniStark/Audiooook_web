import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  HiOutlineTrash,
  HiOutlineServerStack,
  HiOutlineFolderOpen,
  HiOutlineCloud,
  HiOutlineFolder,
  HiChevronRight,
  HiArrowUturnLeft,
  HiArrowPath,
  HiCheck,
  HiXMark,
} from 'react-icons/hi2';
import { configApi } from '../utils/api';
import useBookStore from '../stores/bookStore';
import { getCacheSize, getAllCachedAudio, removeCachedAudio, setSetting, getSetting } from '../utils/db';
import { formatSize } from '../utils/format';

export default function Settings() {
  const [config, setConfig] = useState(null);
  const [cacheSize, setCacheSize] = useState(0);
  const [cachedCount, setCachedCount] = useState(0);
  const [cacheLimitMB, setCacheLimitMB] = useState(300);
  const [clearing, setClearing] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { fetchBooks } = useBookStore();

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
    } catch (e) {
      console.error('Failed to load config:', e);
    }
  };

  const loadCacheInfo = async () => {
    const size = await getCacheSize();
    const all = await getAllCachedAudio();
    setCacheSize(size);
    setCachedCount(all.length);
  };

  const loadLocalSettings = async () => {
    const limit = await getSetting('cacheLimitMB', 300);
    setCacheLimitMB(limit);
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
            </div>
          ) : (
            <p className="text-sm text-dark-500">加载中...</p>
          )}
        </div>

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
      setError('无法读取目录');
    } finally {
      setLoading(false);
    }
  };

  const handleGoTo = (path) => {
    loadDir(path);
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
                  onClick={() => handleGoTo(entry.path)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-dark-800 active:bg-dark-700 transition-colors"
                >
                  <HiOutlineFolder className="w-5 h-5 text-primary-500/70 flex-shrink-0" />
                  <span className="text-sm text-dark-200 truncate flex-1">{entry.name}</span>
                  <HiChevronRight className="w-4 h-4 text-dark-600 flex-shrink-0" />
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
