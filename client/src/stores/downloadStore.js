/**
 * 下载管理 Store
 * 跟踪下载进度，支持取消下载
 */
import { create } from 'zustand';
import { bookApi } from '../utils/api';
import { cacheAudio, getCachedAudio } from '../utils/db';

const useDownloadStore = create((set, get) => ({
  // 当前下载任务列表
  // { id, bookId, bookName, seasonName, episodeName, status: 'pending'|'downloading'|'done'|'error'|'cancelled', progress: 0-100 }
  tasks: [],
  // 是否正在下载
  isDownloading: false,
  // 总进度
  completedCount: 0,
  totalCount: 0,
  // AbortController 用于取消当前下载
  _abortController: null,
  // 是否请求取消
  _cancelRequested: false,

  /**
   * 批量下载一季
   */
  downloadSeason: async (book, season, seasonIndex) => {
    const { isDownloading } = get();
    if (isDownloading) return;

    const tasks = [];
    for (let i = 0; i < season.episodes.length; i++) {
      const ep = season.episodes[i];
      const key = `${book.id}_${season.id}_${ep.id}`;
      // 检查是否已缓存
      const cached = await getCachedAudio(key);
      if (cached && cached.blob) continue; // 已缓存跳过

      tasks.push({
        id: key,
        bookId: book.id,
        bookName: book.name,
        seasonId: season.id,
        seasonName: season.name,
        episodeId: ep.id,
        episodeName: ep.name,
        status: 'pending',
        progress: 0,
      });
    }

    if (tasks.length === 0) return;

    set({
      tasks,
      isDownloading: true,
      completedCount: 0,
      totalCount: tasks.length,
      _cancelRequested: false,
    });

    for (let i = 0; i < tasks.length; i++) {
      if (get()._cancelRequested) {
        // 将剩余任务标记为 cancelled
        set(state => ({
          tasks: state.tasks.map((t, idx) =>
            idx >= i ? { ...t, status: 'cancelled' } : t
          ),
        }));
        break;
      }

      const task = tasks[i];
      // 更新当前任务状态为 downloading
      set(state => ({
        tasks: state.tasks.map(t =>
          t.id === task.id ? { ...t, status: 'downloading', progress: 0 } : t
        ),
      }));

      try {
        const abortController = new AbortController();
        set({ _abortController: abortController });

        const url = bookApi.getDownloadUrl(task.bookId, task.seasonId, task.episodeId);
        const response = await fetch(url, { signal: abortController.signal });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const contentLength = response.headers.get('Content-Length');
        const total = contentLength ? parseInt(contentLength) : 0;

        if (total > 0 && response.body) {
          // 使用 ReadableStream 跟踪进度
          const reader = response.body.getReader();
          const chunks = [];
          let received = 0;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            chunks.push(value);
            received += value.length;
            const progress = Math.round((received / total) * 100);

            set(state => ({
              tasks: state.tasks.map(t =>
                t.id === task.id ? { ...t, progress } : t
              ),
            }));
          }

          const blob = new Blob(chunks);
          await cacheAudio(task.id, task.bookId, blob, {
            episodeName: task.episodeName,
            seasonName: task.seasonName,
            bookName: task.bookName,
          });
        } else {
          // fallback: 无 Content-Length，直接获取 blob
          const blob = await response.blob();
          await cacheAudio(task.id, task.bookId, blob, {
            episodeName: task.episodeName,
            seasonName: task.seasonName,
            bookName: task.bookName,
          });
        }

        set(state => ({
          tasks: state.tasks.map(t =>
            t.id === task.id ? { ...t, status: 'done', progress: 100 } : t
          ),
          completedCount: state.completedCount + 1,
        }));
      } catch (e) {
        if (e.name === 'AbortError') {
          set(state => ({
            tasks: state.tasks.map(t =>
              t.id === task.id ? { ...t, status: 'cancelled' } : t
            ),
          }));
        } else {
          console.error(`Download failed: ${task.episodeName}`, e);
          set(state => ({
            tasks: state.tasks.map(t =>
              t.id === task.id ? { ...t, status: 'error', progress: 0 } : t
            ),
          }));
        }
      }
    }

    set({ isDownloading: false, _abortController: null });
  },

  /**
   * 取消下载
   */
  cancelDownload: () => {
    const { _abortController } = get();
    set({ _cancelRequested: true });
    if (_abortController) {
      _abortController.abort();
    }
  },

  /**
   * 清除已完成/取消的任务列表
   */
  clearTasks: () => {
    set({ tasks: [], completedCount: 0, totalCount: 0 });
  },
}));

export default useDownloadStore;
