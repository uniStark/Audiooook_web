import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { HiPlay } from 'react-icons/hi2';
import { bookApi } from '../utils/api';
import { formatTime, formatDate } from '../utils/format';
import usePlayerStore from '../stores/playerStore';

export default function BookCard({ book, progress, index = 0 }) {
  const navigate = useNavigate();
  const { resumeBook } = usePlayerStore();

  const handleResume = async (e) => {
    e.stopPropagation();
    await resumeBook(book);
    navigate('/player');
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
      onClick={() => navigate(`/book/${book.id}`)}
      className="glass-card p-3 flex gap-3 active:scale-[0.98] transition-transform cursor-pointer"
    >
      {/* 封面 */}
      <div className="w-20 h-20 rounded-xl overflow-hidden flex-shrink-0 bg-dark-700">
        <img
          src={bookApi.getCoverUrl(book.id)}
          alt={book.name}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={(e) => {
            e.target.style.display = 'none';
          }}
        />
      </div>
      
      {/* 信息 */}
      <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
        <div>
          <h3 className="font-semibold text-sm text-white truncate">{book.name}</h3>
          <p className="text-xs text-dark-400 mt-1">
            {book.seasonCount > 1 ? `${book.seasonCount}季 · ` : ''}{book.totalEpisodes}集
          </p>
        </div>
        
        {/* 格式转换进度 */}
        {book.converting && book.converting.status === 'converting' && (
          <div className="mt-1">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 border border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
              <span className="text-[10px] text-amber-400">
                转换中 {book.converting.completed + (book.converting.failed || 0)}/{book.converting.total}
              </span>
            </div>
            <div className="h-1 bg-dark-700 rounded-full overflow-hidden mt-1">
              <div
                className="h-full bg-amber-500 rounded-full transition-all duration-500"
                style={{ width: `${book.converting.total > 0 ? ((book.converting.completed + (book.converting.failed || 0)) / book.converting.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}
        {book.converting && book.converting.status === 'error' && (
          <div className="mt-1">
            <span className="text-[10px] text-red-400">转换失败 {book.converting.failed} 个文件</span>
          </div>
        )}

        {/* 播放进度 */}
        {(!book.converting || book.converting.status === 'done' || book.converting.status === 'error') && progress && (
          <div className="mt-1">
            <p className="text-xs text-primary-500 truncate">
              {progress.seasonName && `${progress.seasonName} · `}
              {progress.episodeName || `第${progress.episodeIndex + 1}集`}
              {progress.currentTime > 0 && ` · ${formatTime(progress.currentTime)}`}
            </p>
            <p className="text-xs text-dark-500 mt-0.5">{formatDate(progress.updatedAt)}</p>
          </div>
        )}
      </div>
      
      {/* 继续播放按钮 / 箭头 */}
      <div className="flex items-center">
        {progress ? (
          <button
            onClick={handleResume}
            className="w-9 h-9 rounded-full bg-primary-500 hover:bg-primary-600 flex items-center justify-center text-dark-900 active:scale-90 transition-all shadow-lg shadow-primary-500/20"
            title="继续播放"
          >
            <HiPlay className="w-5 h-5 ml-0.5" />
          </button>
        ) : (
          <div className="text-dark-500">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        )}
      </div>
    </motion.div>
  );
}
