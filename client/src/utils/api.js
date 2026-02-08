const API_BASE = '/api';

async function request(url, options = {}) {
  const response = await fetch(`${API_BASE}${url}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  
  return response.json();
}

// 书籍相关API
export const bookApi = {
  // 获取所有书籍
  getBooks: () => request('/books'),
  
  // 获取单本书详情
  getBook: (bookId) => request(`/books/${bookId}`),
  
  // 获取封面URL
  getCoverUrl: (bookId) => `${API_BASE}/books/${bookId}/cover`,
  
  // 更新书籍元数据
  updateMetadata: (bookId, data) => request(`/books/${bookId}/metadata`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  
  // 上传自定义封面
  uploadCover: (bookId, file) => {
    return fetch(`${API_BASE}/books/${bookId}/cover`, {
      method: 'POST',
      headers: { 'Content-Type': file.type },
      body: file,
    }).then(res => res.json());
  },
  
  // 获取音频流URL
  getAudioUrl: (bookId, seasonId, episodeId) =>
    `${API_BASE}/audio/${bookId}/${seasonId}/${episodeId}`,
  
  // 获取音频下载URL
  getDownloadUrl: (bookId, seasonId, episodeId) =>
    `${API_BASE}/audio/download/${bookId}/${seasonId}/${episodeId}`,

  // 触发后台预转码（播放某集时预转码接下来的几集）
  pretranscode: (bookId, seasonIndex, episodeIndex) =>
    request('/audio/pretranscode', {
      method: 'POST',
      body: JSON.stringify({ bookId, seasonIndex, episodeIndex }),
    }).catch(() => {}), // fire-and-forget, 不阻塞播放

  // 取消后台转码队列
  cancelTranscode: () =>
    request('/audio/transcode-cancel', { method: 'POST' }),

  // 获取转码状态
  getTranscodeStatus: () =>
    request('/audio/transcode-status'),
};

// 配置相关API
export const configApi = {
  getConfig: () => request('/config'),
  updateConfig: (data) => request('/config', {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  // 浏览服务器目录
  browseDir: (dirPath) => request(`/config/browse?path=${encodeURIComponent(dirPath || '')}`),
};
