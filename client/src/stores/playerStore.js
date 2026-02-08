/**
 * 播放器状态管理
 * 使用 Zustand 进行轻量级状态管理
 */
import { create } from 'zustand';
import { bookApi } from '../utils/api';
import { savePlayProgress, getPlayProgress, getCachedAudio } from '../utils/db';

// 全局 Audio 实例
let audioElement = null;

function getAudio() {
  if (!audioElement) {
    audioElement = new Audio();
    audioElement.preload = 'auto';
  }
  return audioElement;
}

const usePlayerStore = create((set, get) => ({
  // 当前播放状态
  isPlaying: false,
  currentBook: null,
  currentSeason: null,
  currentEpisode: null,
  currentSeasonIndex: 0,
  currentEpisodeIndex: 0,
  
  // 音频信息
  currentTime: 0,
  duration: 0,
  buffered: 0,
  isLoading: false,
  error: null,
  
  // 书籍详情（含全部季和集信息）
  bookDetail: null,
  
  // 跳过片头片尾
  skipIntro: 0,
  skipOutro: 0,

  // 初始化播放器
  initPlayer: () => {
    const audio = getAudio();
    
    audio.addEventListener('timeupdate', () => {
      const state = get();
      const currentTime = audio.currentTime;
      set({ currentTime });
      
      // 跳过片尾检查
      if (state.skipOutro > 0 && state.duration > 0) {
        if (currentTime >= state.duration - state.skipOutro) {
          get().playNext();
          return;
        }
      }
      
      // 每10秒自动保存进度
      if (state.currentBook && Math.floor(currentTime) % 10 === 0) {
        get().saveProgress();
      }
    });
    
    audio.addEventListener('loadedmetadata', () => {
      const dur = audio.duration;
      if (isFinite(dur) && dur > 0) {
        set({ duration: dur, isLoading: false });
      }
      
      // 跳过片头
      const state = get();
      if (state.skipIntro > 0 && audio.currentTime < state.skipIntro) {
        audio.currentTime = state.skipIntro;
      }
    });

    // 有些格式的 duration 在 loadedmetadata 时还不可用，会在 durationchange 中更新
    audio.addEventListener('durationchange', () => {
      const dur = audio.duration;
      if (isFinite(dur) && dur > 0) {
        set({ duration: dur });
      }
    });
    
    audio.addEventListener('waiting', () => set({ isLoading: true }));
    audio.addEventListener('canplay', () => set({ isLoading: false }));
    
    audio.addEventListener('ended', () => {
      get().playNext();
    });
    
    audio.addEventListener('error', (e) => {
      console.error('Audio error:', e);
      set({ error: '音频加载失败', isLoading: false, isPlaying: false });
    });
    
    audio.addEventListener('progress', () => {
      if (audio.buffered.length > 0) {
        const buffered = audio.buffered.end(audio.buffered.length - 1);
        set({ buffered });
      }
    });

    // 媒体会话API（锁屏控制）
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => get().togglePlay());
      navigator.mediaSession.setActionHandler('pause', () => get().togglePlay());
      navigator.mediaSession.setActionHandler('previoustrack', () => get().playPrev());
      navigator.mediaSession.setActionHandler('nexttrack', () => get().playNext());
      navigator.mediaSession.setActionHandler('seekbackward', () => get().seekRelative(-15));
      navigator.mediaSession.setActionHandler('seekforward', () => get().seekRelative(15));
    }
  },

  // 播放指定书籍的指定集
  playEpisode: async (book, seasonIndex, episodeIndex, seekTime = 0) => {
    const audio = getAudio();
    set({ isLoading: true, error: null });
    
    try {
      // 获取完整书籍详情（始终从 API 刷新，确保 skipIntro/skipOutro 等元数据最新）
      let bookDetail = get().bookDetail;
      if (!bookDetail || bookDetail.id !== book.id) {
        const res = await bookApi.getBook(book.id);
        bookDetail = res.data;
        set({ bookDetail });
      }
      
      const season = bookDetail.seasons[seasonIndex];
      if (!season) throw new Error('季不存在');
      
      const episode = season.episodes[episodeIndex];
      if (!episode) throw new Error('集不存在');
      
      // 检查是否有离线缓存
      const cacheKey = `${book.id}_${season.id}_${episode.id}`;
      const cached = await getCachedAudio(cacheKey);
      
      if (cached && cached.blob) {
        // 使用缓存的音频
        const url = URL.createObjectURL(cached.blob);
        audio.src = url;
      } else {
        // 在线播放
        audio.src = bookApi.getAudioUrl(book.id, season.id, episode.id);
      }
      
      // 使用 bookDetail 的 skipIntro/skipOutro（始终最新），而非 book 参数（可能过时）
      const skipIntro = bookDetail.skipIntro || 0;
      const skipOutro = bookDetail.skipOutro || 0;
      
      set({
        currentBook: book,
        currentSeason: season,
        currentEpisode: episode,
        currentSeasonIndex: seasonIndex,
        currentEpisodeIndex: episodeIndex,
        skipIntro,
        skipOutro,
        isPlaying: true,
      });
      
      audio.load();
      
      // 如果有恢复进度，优先恢复到上次位置（不再跳过片头，因为用户已经听过了）
      // 如果没有恢复进度但有跳过片头设置，会由 loadedmetadata 全局监听器处理
      if (seekTime > 0) {
        audio.addEventListener('loadedmetadata', function onLoaded() {
          audio.currentTime = seekTime;
          audio.removeEventListener('loadedmetadata', onLoaded);
        });
      }
      
      await audio.play();
      
      // 更新媒体会话信息
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: episode.name,
          artist: season.name,
          album: book.name,
          artwork: [{ src: bookApi.getCoverUrl(book.id), sizes: '512x512', type: 'image/jpeg' }],
        });
      }

      // 后台预转码接下来的几集（fire-and-forget，不阻塞播放）
      bookApi.pretranscode(book.id, seasonIndex, episodeIndex);
    } catch (e) {
      console.error('Play error:', e);
      set({ error: e.message, isLoading: false });
    }
  },

  // 从上次进度恢复播放
  resumeBook: async (book) => {
    const progress = await getPlayProgress(book.id);
    if (progress) {
      await get().playEpisode(
        book,
        progress.seasonIndex || 0,
        progress.episodeIndex || 0,
        progress.currentTime || 0
      );
    } else {
      await get().playEpisode(book, 0, 0);
    }
  },

  // 播放/暂停
  togglePlay: () => {
    const audio = getAudio();
    const { isPlaying } = get();
    
    if (isPlaying) {
      audio.pause();
      get().saveProgress();
    } else {
      audio.play().catch(console.error);
    }
    set({ isPlaying: !isPlaying });
  },

  // 相对跳转（快进/快退）
  seekRelative: (seconds) => {
    const audio = getAudio();
    const maxTime = isFinite(audio.duration) ? audio.duration : get().duration || 0;
    if (maxTime <= 0) return;
    const newTime = Math.max(0, Math.min(maxTime, audio.currentTime + seconds));
    audio.currentTime = newTime;
    set({ currentTime: newTime });
  },

  // 跳转到指定时间
  seekTo: (time) => {
    const audio = getAudio();
    if (!isFinite(time) || isNaN(time) || time < 0) return;
    audio.currentTime = time;
    set({ currentTime: time });
  },

  // 播放下一集
  playNext: async () => {
    const { currentBook, bookDetail, currentSeasonIndex, currentEpisodeIndex } = get();
    if (!currentBook || !bookDetail) return;
    
    const season = bookDetail.seasons[currentSeasonIndex];
    if (!season) return;
    
    // 还有下一集
    if (currentEpisodeIndex < season.episodes.length - 1) {
      await get().playEpisode(currentBook, currentSeasonIndex, currentEpisodeIndex + 1);
    }
    // 还有下一季
    else if (currentSeasonIndex < bookDetail.seasons.length - 1) {
      await get().playEpisode(currentBook, currentSeasonIndex + 1, 0);
    }
    // 全部播放完毕
    else {
      const audio = getAudio();
      audio.pause();
      set({ isPlaying: false });
      get().saveProgress();
    }
  },

  // 播放上一集
  playPrev: async () => {
    const { currentBook, bookDetail, currentSeasonIndex, currentEpisodeIndex, currentTime } = get();
    if (!currentBook || !bookDetail) return;
    
    // 如果当前播放超过5秒，重新播放当前集
    if (currentTime > 5) {
      get().seekTo(0);
      return;
    }
    
    // 有上一集
    if (currentEpisodeIndex > 0) {
      await get().playEpisode(currentBook, currentSeasonIndex, currentEpisodeIndex - 1);
    }
    // 有上一季
    else if (currentSeasonIndex > 0) {
      const prevSeason = bookDetail.seasons[currentSeasonIndex - 1];
      await get().playEpisode(currentBook, currentSeasonIndex - 1, prevSeason.episodes.length - 1);
    }
    // 第一集，重新开始
    else {
      get().seekTo(0);
    }
  },

  // 保存播放进度
  saveProgress: async () => {
    const { currentBook, currentSeasonIndex, currentEpisodeIndex, currentTime, currentSeason, currentEpisode } = get();
    if (!currentBook) return;
    
    await savePlayProgress(currentBook.id, {
      seasonIndex: currentSeasonIndex,
      episodeIndex: currentEpisodeIndex,
      seasonId: currentSeason?.id,
      episodeId: currentEpisode?.id,
      seasonName: currentSeason?.name,
      episodeName: currentEpisode?.name,
      currentTime,
      bookName: currentBook.name,
    });
  },

  // 使当前缓存的 bookDetail 失效（用于元数据更新后强制刷新）
  invalidateBookDetail: async (bookId) => {
    const { currentBook, bookDetail } = get();
    // 如果正在播放的书就是被更新的书，重新获取 bookDetail
    if (currentBook && currentBook.id === bookId) {
      try {
        const res = await bookApi.getBook(bookId);
        const newDetail = res.data;
        set({
          bookDetail: newDetail,
          skipIntro: newDetail.skipIntro || 0,
          skipOutro: newDetail.skipOutro || 0,
        });
      } catch (e) {
        // 如果获取失败，至少清除缓存让下次 playEpisode 重新获取
        set({ bookDetail: null });
      }
    } else if (bookDetail && bookDetail.id === bookId) {
      // 不在播放但缓存了这本书的详情，清除缓存
      set({ bookDetail: null });
    }
  },

  // 清除播放器状态
  clearPlayer: () => {
    const audio = getAudio();
    audio.pause();
    audio.src = '';
    set({
      isPlaying: false,
      currentBook: null,
      currentSeason: null,
      currentEpisode: null,
      currentSeasonIndex: 0,
      currentEpisodeIndex: 0,
      currentTime: 0,
      duration: 0,
      bookDetail: null,
    });
  },
}));

export default usePlayerStore;
