import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { 
  HiArrowLeft, HiPlay, HiHeart, HiOutlineHeart, 
  HiPencilSquare, HiArrowDownTray,
  HiChevronDown, HiChevronUp, HiCamera
} from 'react-icons/hi2';
import { bookApi } from '../utils/api';
import usePlayerStore from '../stores/playerStore';
import useBookStore from '../stores/bookStore';
import useDownloadStore from '../stores/downloadStore';
import EpisodeList from '../components/EpisodeList';
import { getPlayProgress } from '../utils/db';
import { formatTime } from '../utils/format';

export default function BookDetail() {
  const { bookId } = useParams();
  const navigate = useNavigate();
  const { playEpisode, resumeBook, currentBook, invalidateBookDetail } = usePlayerStore();
  const { toggleFavorite, checkFavorite, favorites } = useBookStore();
  
  const [book, setBook] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isFav, setIsFav] = useState(false);
  const [progress, setProgress] = useState(null);
  const [expandedSeason, setExpandedSeason] = useState(0);
  const [showMetaEdit, setShowMetaEdit] = useState(false);
  const [metaForm, setMetaForm] = useState({});
  const { isDownloading, tasks: downloadTasks, completedCount, totalCount, downloadSeason, cancelDownload } = useDownloadStore();
  const [uploading, setUploading] = useState(false);
  const coverInputRef = useRef(null);
  const [coverKey, setCoverKey] = useState(0); // 用于强制刷新封面图片

  useEffect(() => {
    loadBook();
    loadFav();
    loadProgress();
  }, [bookId]);

  const loadBook = async () => {
    try {
      const res = await bookApi.getBook(bookId);
      setBook(res.data);
      setMetaForm({
        customName: res.data.name,
        description: res.data.description || '',
        skipIntro: res.data.skipIntro || 0,
        skipOutro: res.data.skipOutro || 0,
      });
    } catch (e) {
      console.error('Failed to load book:', e);
    } finally {
      setLoading(false);
    }
  };

  const loadFav = async () => {
    const fav = await checkFavorite(bookId);
    setIsFav(fav);
  };

  const loadProgress = async () => {
    const p = await getPlayProgress(bookId);
    setProgress(p);
    if (p) {
      setExpandedSeason(p.seasonIndex || 0);
    }
  };

  const handleToggleFav = async () => {
    if (book) {
      await toggleFavorite(book);
      setIsFav(!isFav);
    }
  };

  const handlePlay = async (seasonIndex, episodeIndex) => {
    if (book) {
      await playEpisode(book, seasonIndex, episodeIndex);
      navigate('/player');
    }
  };

  const handleResume = async () => {
    if (book) {
      await resumeBook(book);
      navigate('/player');
    }
  };

  const handleSaveMeta = async () => {
    try {
      await bookApi.updateMetadata(bookId, metaForm);
      setShowMetaEdit(false);
      loadBook();
      // 同步更新 playerStore 的 bookDetail，确保 skipIntro/skipOutro 实时生效
      await invalidateBookDetail(bookId);
    } catch (e) {
      console.error('Failed to save metadata:', e);
    }
  };

  // 上传封面
  const handleCoverUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !book) return;
    
    // 验证文件类型
    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件');
      return;
    }
    // 限制大小 5MB
    if (file.size > 5 * 1024 * 1024) {
      alert('图片大小不能超过 5MB');
      return;
    }
    
    setUploading(true);
    try {
      const res = await bookApi.uploadCover(bookId, file);
      if (res.success) {
        // 强制刷新封面（浏览器缓存问题）
        setCoverKey(prev => prev + 1);
      }
    } catch (e) {
      console.error('Failed to upload cover:', e);
      alert('封面上传失败');
    } finally {
      setUploading(false);
      // 重置 input 以便再次选择同一文件
      if (coverInputRef.current) coverInputRef.current.value = '';
    }
  };

  // 批量下载整季
  const handleDownloadSeason = async (season, seasonIndex) => {
    if (isDownloading) return;
    await downloadSeason(book, season, seasonIndex);
  };

  if (loading) {
    return (
      <div className="page-container flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-dark-600 border-t-primary-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!book) {
    return (
      <div className="page-container text-center py-20">
        <p className="text-dark-400">书籍不存在</p>
        <button onClick={() => navigate('/')} className="btn-primary mt-4">返回书架</button>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="page-container"
    >
      {/* 顶部导航 */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate(-1)} className="btn-ghost p-2">
          <HiArrowLeft className="w-6 h-6" />
        </button>
        <h1 className="text-lg font-semibold flex-1 truncate">{book.name}</h1>
        <button onClick={handleToggleFav} className="btn-ghost p-2">
          {isFav ? (
            <HiHeart className="w-6 h-6 text-red-500" />
          ) : (
            <HiOutlineHeart className="w-6 h-6" />
          )}
        </button>
        <button onClick={() => setShowMetaEdit(!showMetaEdit)} className="btn-ghost p-2">
          <HiPencilSquare className="w-5 h-5" />
        </button>
      </div>

      {/* 书籍信息头部 */}
      <div className="glass-card p-4 mb-4">
        <div className="flex gap-4">
          <div
            className="w-28 h-28 rounded-xl overflow-hidden flex-shrink-0 bg-dark-700 relative group cursor-pointer"
            onClick={() => coverInputRef.current?.click()}
          >
            <img
              src={`${bookApi.getCoverUrl(book.id)}${coverKey ? `?v=${coverKey}` : ''}`}
              alt={book.name}
              className="w-full h-full object-cover"
            />
            {/* 上传遮罩层 */}
            <div className={`absolute inset-0 bg-black/50 flex flex-col items-center justify-center transition-opacity ${
              uploading ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-active:opacity-100'
            }`}>
              {uploading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <HiCamera className="w-6 h-6 text-white/90" />
                  <span className="text-[10px] text-white/70 mt-1">更换封面</span>
                </>
              )}
            </div>
            <input
              ref={coverInputRef}
              type="file"
              accept="image/*"
              onChange={handleCoverUpload}
              className="hidden"
            />
          </div>
          <div className="flex-1 flex flex-col justify-between">
            <div>
              <h2 className="text-lg font-bold">{book.name}</h2>
              {book.description && (
                <p className="text-sm text-dark-400 mt-1 line-clamp-2">{book.description}</p>
              )}
              <p className="text-xs text-dark-500 mt-2">
                {book.seasons.length > 1 ? `${book.seasons.length}季 · ` : ''}
                共{book.totalEpisodes}集
              </p>
            </div>
            <button
              onClick={handleResume}
              className="btn-primary text-sm py-2 mt-2 flex items-center justify-center gap-2"
            >
              <HiPlay className="w-5 h-5" />
              {progress ? '继续播放' : '开始播放'}
            </button>
          </div>
        </div>
        
        {/* 上次播放进度 */}
        {progress && (
          <div className="mt-3 pt-3 border-t border-dark-700/50">
            <p className="text-xs text-dark-400">
              上次听到：
              <span className="text-primary-500 ml-1">
                {progress.seasonName && `${progress.seasonName} · `}
                {progress.episodeName || `第${progress.episodeIndex + 1}集`}
                {progress.currentTime > 0 && ` · ${formatTime(progress.currentTime)}`}
              </span>
            </p>
          </div>
        )}

        {/* 跳过片头片尾信息 */}
        {(book.skipIntro > 0 || book.skipOutro > 0) && (
          <div className="mt-2 flex gap-2">
            {book.skipIntro > 0 && (
              <span className="text-[10px] bg-dark-700 text-dark-300 px-2 py-1 rounded-full">
                跳过片头 {book.skipIntro}s
              </span>
            )}
            {book.skipOutro > 0 && (
              <span className="text-[10px] bg-dark-700 text-dark-300 px-2 py-1 rounded-full">
                跳过片尾 {book.skipOutro}s
              </span>
            )}
          </div>
        )}
      </div>

      {/* 元数据编辑 */}
      {showMetaEdit && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          className="glass-card p-4 mb-4 overflow-hidden"
        >
          <h3 className="text-sm font-semibold mb-3">编辑书籍信息</h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-dark-400 mb-1 block">自定义名称</label>
              <input
                type="text"
                value={metaForm.customName || ''}
                onChange={(e) => setMetaForm({ ...metaForm, customName: e.target.value })}
                className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-dark-400 mb-1 block">简介</label>
              <textarea
                value={metaForm.description || ''}
                onChange={(e) => setMetaForm({ ...metaForm, description: e.target.value })}
                rows={2}
                className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500/50 resize-none"
              />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-dark-400 mb-1 block">跳过片头（秒）</label>
                <input
                  type="number"
                  min="0"
                  value={metaForm.skipIntro || 0}
                  onChange={(e) => setMetaForm({ ...metaForm, skipIntro: parseInt(e.target.value) || 0 })}
                  className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500/50"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs text-dark-400 mb-1 block">跳过片尾（秒）</label>
                <input
                  type="number"
                  min="0"
                  value={metaForm.skipOutro || 0}
                  onChange={(e) => setMetaForm({ ...metaForm, skipOutro: parseInt(e.target.value) || 0 })}
                  className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500/50"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleSaveMeta} className="btn-primary text-sm py-2 flex-1">
                保存
              </button>
              <button onClick={() => setShowMetaEdit(false)} className="btn-ghost text-sm py-2 flex-1 border border-dark-600">
                取消
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {/* 下载进度 */}
      {downloadTasks.length > 0 && (
        <div className="glass-card p-3 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-dark-300">
              {isDownloading
                ? `正在下载 ${completedCount + 1}/${totalCount}`
                : `下载完成 ${completedCount}/${totalCount}`}
            </span>
            {isDownloading && (
              <button
                onClick={cancelDownload}
                className="text-xs text-red-400 hover:text-red-300 bg-red-500/10 px-2 py-1 rounded-lg transition-colors"
              >
                取消下载
              </button>
            )}
          </div>
          {/* 总进度条 */}
          <div className="h-1.5 bg-dark-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary-500 rounded-full transition-all duration-300"
              style={{ width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%` }}
            />
          </div>
          {/* 当前下载文件 */}
          {isDownloading && (() => {
            const current = downloadTasks.find(t => t.status === 'downloading');
            return current ? (
              <div className="mt-2">
                <div className="flex justify-between text-[10px] text-dark-500 mb-0.5">
                  <span className="truncate flex-1">{current.episodeName}</span>
                  <span className="ml-2 flex-shrink-0">{current.progress}%</span>
                </div>
                <div className="h-1 bg-dark-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary-400 rounded-full transition-all duration-150"
                    style={{ width: `${current.progress}%` }}
                  />
                </div>
              </div>
            ) : null;
          })()}
        </div>
      )}

      {/* 季和集列表 */}
      <div className="space-y-3">
        {book.seasons.map((season, sIndex) => (
          <div key={season.id} className="glass-card overflow-hidden">
            {/* 季标题 */}
            <button
              onClick={() => setExpandedSeason(expandedSeason === sIndex ? -1 : sIndex)}
              className="w-full flex items-center justify-between p-4 text-left"
            >
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-sm truncate">{season.name}</h3>
                <p className="text-xs text-dark-400 mt-0.5">{season.episodes.length}集</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDownloadSeason(season, sIndex);
                  }}
                  disabled={isDownloading}
                  className="text-dark-400 hover:text-primary-500 p-1 disabled:opacity-30"
                  title="下载整季"
                >
                  <HiArrowDownTray className="w-4 h-4" />
                </button>
                {expandedSeason === sIndex ? (
                  <HiChevronUp className="w-5 h-5 text-dark-400" />
                ) : (
                  <HiChevronDown className="w-5 h-5 text-dark-400" />
                )}
              </div>
            </button>
            
            {/* 集列表 */}
            {expandedSeason === sIndex && (
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: 'auto' }}
                className="border-t border-dark-700/50"
              >
                <EpisodeList 
                  book={book} 
                  season={season} 
                  seasonIndex={sIndex}
                  onPlay={handlePlay}
                />
              </motion.div>
            )}
          </div>
        ))}
      </div>
    </motion.div>
  );
}
