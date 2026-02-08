import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { HiMagnifyingGlass, HiXMark, HiArrowPath } from 'react-icons/hi2';
import useBookStore from '../stores/bookStore';
import usePlayerStore from '../stores/playerStore';
import BookCard from '../components/BookCard';
import { getAllPlayProgress } from '../utils/db';

export default function Bookshelf() {
  const { books, isLoading, error, searchQuery, setSearchQuery, fetchBooks, getFilteredBooks } = useBookStore();
  const { initPlayer } = usePlayerStore();
  const [progressMap, setProgressMap] = useState({});
  const [showSearch, setShowSearch] = useState(false);

  useEffect(() => {
    initPlayer();
    fetchBooks();
    loadProgress();
  }, []);

  const loadProgress = async () => {
    const allProgress = await getAllPlayProgress();
    const map = {};
    for (const p of allProgress) {
      map[p.bookId] = p;
    }
    setProgressMap(map);
  };

  const filteredBooks = getFilteredBooks();

  // 按最近播放排序：有进度的排在前面
  const sortedBooks = [...filteredBooks].sort((a, b) => {
    const pa = progressMap[a.id];
    const pb = progressMap[b.id];
    if (pa && pb) return (pb.updatedAt || 0) - (pa.updatedAt || 0);
    if (pa) return -1;
    if (pb) return 1;
    return 0;
  });

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="page-container"
    >
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">书架</h1>
          <p className="text-sm text-dark-400 mt-1">
            共 {books.length} 本有声书
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { fetchBooks(); loadProgress(); }}
            className="btn-ghost"
            title="刷新书库"
          >
            <HiArrowPath className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowSearch(!showSearch)}
            className="btn-ghost"
          >
            {showSearch ? <HiXMark className="w-6 h-6" /> : <HiMagnifyingGlass className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* 搜索栏 */}
      {showSearch && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="mb-4"
        >
          <div className="relative">
            <HiMagnifyingGlass className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索有声书..."
              autoFocus
              className="w-full bg-dark-800 border border-dark-700 rounded-xl pl-12 pr-4 py-3 text-white placeholder-dark-500 focus:outline-none focus:border-primary-500/50 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-dark-400"
              >
                <HiXMark className="w-5 h-5" />
              </button>
            )}
          </div>
        </motion.div>
      )}

      {/* 加载状态 */}
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-3 border-dark-600 border-t-primary-500 rounded-full animate-spin" />
        </div>
      )}

      {/* 错误状态 */}
      {error && (
        <div className="text-center py-20">
          <p className="text-dark-400 mb-4">{error}</p>
          <button onClick={fetchBooks} className="btn-primary text-sm">
            重试
          </button>
        </div>
      )}

      {/* 空状态 */}
      {!isLoading && !error && sortedBooks.length === 0 && (
        <div className="text-center py-20">
          <div className="text-6xl mb-4">📚</div>
          <p className="text-dark-400 text-lg mb-2">
            {searchQuery ? '没有找到匹配的有声书' : '书架空空如也'}
          </p>
          <p className="text-dark-500 text-sm">
            {searchQuery ? '试试其他关键词' : '请在服务器的有声书目录中添加音频文件'}
          </p>
        </div>
      )}

      {/* 书籍列表 */}
      <div className="space-y-3">
        {sortedBooks.map((book, index) => (
          <BookCard
            key={book.id}
            book={book}
            progress={progressMap[book.id]}
            index={index}
          />
        ))}
      </div>
    </motion.div>
  );
}
