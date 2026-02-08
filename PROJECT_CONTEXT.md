# audiooook_web — Project Context for AI Assistants

> **Purpose**: This document provides comprehensive context for AI models to understand, maintain, and extend this project. It captures all architectural decisions, historical requirements, and implementation details from the original development conversation.
>
> **IMPORTANT**: Keep this document updated whenever significant changes are made. This is the single source of truth for AI-assisted development.

---

## 1. Project Overview

**audiooook_web** is a self-hosted online audiobook player web application designed primarily for **mobile devices**. Users mount their local audiobook folders (or connect via Alibaba Cloud OSS) and listen through a browser — no app installation needed.

### Core Value Proposition
- **Zero-config audiobook server**: Drop audiobook folders onto a server, deploy via Docker, and start listening on your phone.
- **Smart folder parsing**: Automatically recognizes `Novel Name / Season (Chapter) / Episode` directory structures.
- **Offline-capable**: PWA support with local caching and offline playback on mobile.
- **Format agnostic**: Supports WMA, FLAC, APE, ALAC, and other non-browser-native formats via server-side FFmpeg transcoding.

---

## 2. Tech Stack

### Frontend (client/)
| Technology | Purpose |
|---|---|
| React 18 | UI framework |
| Vite | Build tool & dev server |
| Tailwind CSS | Styling (dark theme, mobile-first) |
| Zustand | Lightweight state management |
| Framer Motion | Animations & page transitions |
| React Router DOM | SPA routing |
| idb (IndexedDB) | Client-side persistent storage (progress, favorites, audio cache) |
| VitePWA | Progressive Web App support & Service Worker |
| react-icons (Hi2) | Icon library (Heroicons v2) |

### Backend (server/)
| Technology | Purpose |
|---|---|
| Node.js + Express | HTTP server & REST API |
| FFmpeg (system) | Audio transcoding (WMA/FLAC/APE/ALAC → MP3) |
| fs/path | Local filesystem scanning |
| child_process (spawn) | FFmpeg process management |

### Deployment
| Technology | Purpose |
|---|---|
| Docker + Docker Compose | Production deployment |
| node:20-alpine | Base image |
| POSIX shell scripts | One-click deploy (`deploy.sh`) and update (`update.sh`) |

---

## 3. Directory Structure

```
audiooook_web/
├── client/                     # React frontend (Vite)
│   ├── src/
│   │   ├── App.jsx             # Root component, route definitions
│   │   ├── main.jsx            # Entry point, initializes playerStore
│   │   ├── index.css           # Global styles (Tailwind directives)
│   │   ├── components/
│   │   │   ├── BookCard.jsx    # Book grid card (cover + name + progress)
│   │   │   ├── BottomNav.jsx   # Bottom navigation bar (Bookshelf/Favorites/Settings)
│   │   │   ├── EpisodeList.jsx # Episode list within a season
│   │   │   ├── MiniPlayer.jsx  # Persistent mini player bar
│   │   │   └── Player.jsx      # Full-screen player page
│   │   ├── pages/
│   │   │   ├── Bookshelf.jsx   # Main page: book grid + search + refresh
│   │   │   ├── BookDetail.jsx  # Book info, season/episode list, metadata editing, cover upload
│   │   │   ├── Favorites.jsx   # Favorited books list
│   │   │   └── Settings.jsx    # Server config, cache management, auto-transcode settings, dir browser
│   │   ├── stores/
│   │   │   ├── playerStore.js  # Zustand: audio playback state, skip intro/outro, progress, pre-transcode trigger
│   │   │   ├── bookStore.js    # Zustand: book list, favorites
│   │   │   └── downloadStore.js # Zustand: download task management, progress tracking, cancel
│   │   └── utils/
│   │       ├── api.js          # Centralized API client (bookApi, configApi, userApi)
│   │       ├── db.js           # IndexedDB operations + server sync (progress, favorites, audio cache, settings)
│   │       └── format.js       # Formatting utilities (time, size, date)
│   ├── vite.config.js          # Vite config: dev port 4001, proxy to backend 5001, PWA plugin
│   └── package.json
├── server/                     # Express backend
│   ├── index.js                # Server entry: Express app, routes, static serving
│   ├── routes/
│   │   ├── books.js            # /api/books — list, detail, metadata CRUD, cover upload, new-book pre-transcode trigger
│   │   ├── audio.js            # /api/audio — streaming, download, pre-transcode API, transcode status
│   │   ├── config.js           # /api/config — server settings, directory browser
│   │   └── user.js             # /api/user — server-side persistence for favorites, progress, user settings
│   ├── services/
│   │   ├── scanner.js          # Audiobook directory scanner, metadata CRUD, cover finder
│   │   ├── transcoder.js       # Background transcoding queue, pre-transcode strategies
│   │   └── oss.js              # Alibaba Cloud OSS integration (optional)
│   ├── utils/
│   │   └── parser.js           # File parsing: audio detection, episode/season number extraction, name cleaning
│   └── package.json
├── Dockerfile                  # Multi-stage: frontend build → production with FFmpeg
├── docker-compose.yml          # Container config: port 3001→4001, volume mounts
├── deploy.sh                   # One-click Linux deployment (POSIX sh compatible)
├── update.sh                   # Quick Docker update script
├── dev.sh                      # Development environment manager
├── .gitattributes              # Force LF line endings (critical for shell scripts)
└── PROJECT_CONTEXT.md          # ← This file
```

---

## 4. Requirements & Features (Complete History)

### 4.1 Audio Playback
- **Supported formats**: MP3, WMA, WAV, FLAC, AAC, OGG, M4A, OPUS, APE, ALAC
- **Server-side transcoding**: WMA, APE, ALAC, FLAC → MP3 (128kbps, 44.1kHz, stereo) via FFmpeg
- **Transcode caching**: Transcoded files are cached in `server/data/transcode-cache/` to avoid re-transcoding
- **Background auto-transcoding**:
  - When a new book is first detected, auto-transcode the first N episodes **across all seasons** (per-book, not per-season). E.g., if N=5 and season 1 has 3 episodes, it takes all 3 from S1 + first 2 from S2
  - When a user plays any episode, auto-transcode the next N episodes from that position (across season boundaries) — **high priority** (inserted at queue front)
  - N is user-configurable in Settings (range: 1–20, default: 5)
  - User can toggle auto-transcode on/off in Settings
  - **Cancellation**: When user disables auto-transcode, the current task finishes and the remaining queue is cleared (no more new tasks start)
  - **Performance safeguard**: System load (CPU & memory) is monitored. Concurrency is dynamically limited to `cpuCores / 2` (min 1, max 10). If CPU or memory exceeds **85%**, workers pause and wait for load to drop. After 3 consecutive overload checks (~45s), the worker exits and tasks remain queued for later
  - De-duplication: already-cached or in-progress files are skipped
  - **Priority queue**: Playback-triggered pre-transcodes are inserted at the front (high priority), while new-book pre-transcodes go to the back
- **Streaming**: Supports HTTP Range requests for seeking/progress bar dragging
- **Controls**: Play/pause, previous/next episode, fast-forward/rewind 15s, seekable progress bar
- **Media Session API**: Lock-screen controls on mobile

### 4.2 Playback Memory (Progress Persistence)
- Exact position saved: book ID + season index + episode index + current time (seconds)
- Auto-save every 10 seconds during playback
- Resume from exact position when returning to a book
- **Resume rewind**: When resuming, auto-rewind X seconds (configurable in Settings, default 3s, range 0–30s) to provide context
- **Quick resume on bookshelf**: Books with progress show a play button on the BookCard — tap to resume directly without entering detail page
- **Dual persistence**: Stored in both IndexedDB (fast local cache) AND server-side `user-data.json` (survives redeployment / device change / browser data clear)
- **Startup sync**: On app launch, client syncs with server using timestamp-based merge (newer wins); local-only data is pushed to server, server-only data is pulled to local

### 4.3 Skip Intro / Outro
- **Per-book setting**: Each book can have independent skipIntro (seconds) and skipOutro (seconds)
- **Global effect within book**: Once set, applies to ALL episodes/chapters of that book
- **skipIntro**: On `loadedmetadata`, if `currentTime < skipIntro`, jump forward
- **skipOutro**: On `timeupdate`, if `currentTime >= duration - skipOutro`, auto-play next episode
- **Resume override**: When resuming from saved progress (seekTime > 0), skip intro is bypassed (user already heard it)
- **Live update**: When user edits skipIntro/skipOutro in BookDetail, playerStore's `bookDetail` is invalidated and re-fetched from API. Uses `bookDetail.skipIntro/skipOutro` (always fresh), not the potentially stale `book` parameter.
- Stored server-side in `server/data/metadata.json`

### 4.4 Folder Parsing Rules
- **Structure**: `NovelName / Season(Chapter) / Episode.ext`
- **Single-season books**: If a book folder contains audio files directly (no subdirectories), treated as a single season named "全集"
- **Season sorting**: Supports Chinese numerals (第一季, 第二季), Arabic numerals (第1季), mixed formats (Season1, Vol.1)
- **Episode sorting**: Extracts trailing numbers from filenames for ordering
- **Name cleaning**: Strips brackets `()[]（）【】`, full-width pipes `｜|` (takes first segment as name), episode counts `[42回]`, narrator info
- **Auto-play across seasons**: When last episode of a season ends, automatically plays first episode of next season

### 4.5 Custom Book Metadata
- **Custom name**: Override the folder-derived book name
- **Description**: Add a book description
- **Custom cover**: Upload image (jpg/png/webp/gif/bmp, max 5MB) — stored in `server/data/covers/`
- **Cover priority**: Custom upload > cover.jpg in book dir > any image in book dir > cover in season dir > default SVG
- **Cover upload UI**: Click on cover image in BookDetail page → file picker → upload with loading animation
- All metadata stored in `server/data/metadata.json`

### 4.6 Bookshelf & Favorites
- **Bookshelf**: List view of all detected audiobooks with covers, names, episode counts
- **Search**: Filter books by name
- **Sorting**: Three modes cycling via button — Recent (default, by last played), Name A→Z, Name Z→A. Sort preference persisted in IndexedDB settings
- **Refresh**: Manual refresh button to re-scan audiobook directory
- **Favorites**: Star/unstar books, stored in both IndexedDB AND server-side `user-data.json` (survives redeployment)

### 4.7 Offline Download & Caching
- **Season download**: Download all episodes of a season for offline playback
- **Download progress**: Real-time progress tracking per file (percentage) and overall progress (completed/total), using ReadableStream for byte-level progress
- **Cancel download**: Active downloads can be cancelled mid-flight via AbortController; remaining tasks are marked as cancelled
- **Download manager store** (`downloadStore.js`): Centralized Zustand store tracking all download tasks, statuses, and progress
- **Settings download panel**: Shows active download progress with cancel button; also shows all downloaded content grouped by book with per-episode delete and per-book bulk delete
- **IndexedDB storage**: Audio blobs stored in `audioCache` object store
- **Cache management**: User-configurable cache size limit (50MB–5GB, default 300MB)
- **Auto-cleanup**: Old cache entries removed when limit exceeded (LRU)
- **Offline playback**: Cached audio served from IndexedDB, no server needed

### 4.8 Server Directory Browser
- **UI**: Bottom sheet modal for browsing server filesystem
- **Features**: Navigate directories, go to parent, breadcrumb path, manual path input
- **Windows support**: Lists available drive letters (C:, D:, etc.)
- **Permission handling**: Directories without read permission shown grayed out with "无权限" label; clicking shows error toast
- **System directory filtering**: `proc`, `sys`, `dev` etc. hidden at root level only (not in subdirectories)
- **Auto-refresh**: After selecting a new audiobook directory, book list refreshes automatically
- **Docker note**: The browse endpoint lists the **container's** filesystem, not the host's. To browse host directories (e.g., `/nas/books`), the parent directory must be mounted into the container at the same path (e.g., `-v /nas:/nas`). See Volume Mounts section.

### 4.9 UI/UX Requirements
- **Mobile-first**: Designed for phone screens (max-width container)
- **Dark theme**: Dark background with amber/gold accent colors
- **Glass morphism**: Semi-transparent cards with backdrop blur
- **Smooth animations**: Page transitions, button feedback, loading states (Framer Motion)
- **Clean & modern**: Minimalist design, intuitive navigation
- **Bottom navigation**: 3-tab bar (Bookshelf / Favorites / Settings)
- **Mini player**: Persistent bar at bottom showing current playback, tap to expand

---

## 5. API Endpoints

### Books (`/api/books`)
| Method | Path | Description |
|---|---|---|
| GET | `/api/books` | List all audiobooks (triggers new-book pre-transcode) |
| GET | `/api/books/:bookId` | Get book detail with seasons/episodes |
| GET | `/api/books/:bookId/cover` | Get cover image (or default SVG) |
| POST | `/api/books/:bookId/cover` | Upload custom cover (Content-Type: image/*, raw body) |
| PUT | `/api/books/:bookId/metadata` | Update metadata (customName, description, skipIntro, skipOutro) |

### Audio (`/api/audio`)
| Method | Path | Description |
|---|---|---|
| GET | `/api/audio/:bookId/:seasonId/:episodeId` | Stream audio (auto-transcodes if needed, supports Range) |
| GET | `/api/audio/download/:bookId/:seasonId/:episodeId` | Download audio file |
| POST | `/api/audio/pretranscode` | Trigger background pre-transcode (body: {bookId, seasonIndex, episodeIndex}) |
| GET | `/api/audio/transcode-status` | Get transcoding queue status |
| POST | `/api/audio/transcode-cancel` | Cancel background transcode queue (finish current, clear rest) |

### Config (`/api/config`)
| Method | Path | Description |
|---|---|---|
| GET | `/api/config` | Get server configuration |
| PUT | `/api/config` | Update config (cacheSizeMB, audiobookPath, autoTranscode, autoTranscodeCount) |
| GET | `/api/config/browse?path=xxx` | Browse server directories |

### User Data (`/api/user`) — Server-side persistence
| Method | Path | Description |
|---|---|---|
| GET | `/api/user/favorites` | Get all favorites |
| PUT | `/api/user/favorites/:bookId` | Add/update a favorite |
| DELETE | `/api/user/favorites/:bookId` | Remove a favorite |
| GET | `/api/user/progress` | Get all playback progress |
| PUT | `/api/user/progress/:bookId` | Save/update playback progress |
| GET | `/api/user/settings` | Get user settings (resumeRewindSeconds, bookSortMode, etc.) |
| PUT | `/api/user/settings` | Update user settings (incremental merge) |

---

## 6. Data Models

### server/data/metadata.json
```json
{
  "bookId": {
    "customName": "Custom Book Name",
    "description": "Book description",
    "skipIntro": 15,
    "skipOutro": 30,
    "customCover": "/abs/path/to/server/data/covers/bookId.jpg",
    "_pretranscoded": true
  }
}
```

### server/data/config.json
```json
{
  "cacheSizeMB": 300,
  "audiobookPath": "/audiobooks",
  "autoTranscode": true,
  "autoTranscodeCount": 5
}
```

### server/data/user-data.json (NEW — server-side user data persistence)
```json
{
  "favorites": {
    "bookId1": { "bookId": "bookId1", "name": "...", "addedAt": 1700000000000 }
  },
  "progress": {
    "bookId1": { "bookId": "bookId1", "seasonIndex": 0, "episodeIndex": 3, "currentTime": 1423.5, "updatedAt": 1700000000000 }
  },
  "settings": {
    "resumeRewindSeconds": 3,
    "bookSortMode": "recent",
    "cacheLimitMB": 300
  }
}
```

### Client IndexedDB (`audiooook` database)
| Store | Key | Fields |
|---|---|---|
| `playProgress` | bookId | seasonIndex, episodeIndex, currentTime, seasonName, episodeName, bookName, updatedAt |
| `favorites` | bookId | book info fields, addedAt |
| `audioCache` | `${bookId}_${seasonId}_${episodeId}` | blob, size, bookId, episodeName, seasonName, bookName, cachedAt |
| `settings` | key string | value (any) |

---

## 7. Key Implementation Patterns

### ID Generation
- Book/season/episode IDs are generated from folder/file names via a simple string hash → base36.
- Function: `generateId(str)` in `server/utils/parser.js`
- **Implication**: IDs are deterministic — same folder name always produces same ID.

### Audiobook Scanning
- `scanAudiobooks()` in `scanner.js` is called on every `/api/books` request (no caching).
- It re-reads the filesystem each time, merging with metadata from `metadata.json`.
- This means directory changes are reflected immediately on refresh.

### Transcoding Architecture
- **On-demand** (audio.js): When a user requests a WMA/FLAC/APE/ALAC file, `ensureTranscoded()` checks cache → transcodes if needed → serves cached MP3.
- **Pre-emptive** (transcoder.js): Background queue transcodes upcoming episodes before user reaches them.
  - Trigger 1: New book detected → first N episodes **across all seasons** (per-book unit, not per-season)
  - Trigger 2: User plays episode → next N episodes from current position (high priority, queue front)
- **Queue**: Multi-threaded concurrent queue. Workers pull from a shared FIFO queue until empty.
- **Dynamic concurrency**: `min(cpuCores / 2, MAX_CONCURRENCY=10)`. Adjusts based on actual CPU core count.
- **Performance safeguard**: Workers check CPU and memory usage (via `os` module) before each task. If either exceeds **85%**, the worker pauses (up to ~45s with retries). If overload persists, worker exits; tasks remain queued for later.
- **Cache key**: `${bookId}_${seasonId}_${episodeId}.mp3` in `server/data/transcode-cache/`

### State Management
- **playerStore** (Zustand): Singleton audio element, playback state, skip settings, progress saving.
- **bookStore** (Zustand): Book list fetching, favorites management.
- **Data persistence strategy**: Client-side IndexedDB for fast access + server-side `user-data.json` for durability. Writes go to both; on startup, a sync merges both directions (timestamp-based, newer wins).

### Config File Location (via `server/utils/paths.js`)
- **Dev** (`NODE_ENV != production`): `{project_root}/config.json`, `{project_root}/metadata.json`, `{project_root}/user-data.json`
- **Production** (`NODE_ENV=production`): `{server}/data/config.json`, `{server}/data/metadata.json`, `{server}/data/user-data.json`
- **Transcode cache & covers**: Always in `{server}/data/` regardless of environment
- In Docker, `./data` is bind-mounted to `/app/server/data`, making config files directly editable on host

### Audiobook Path Priority
1. Runtime override (`setAudiobookPath()` via API)
2. `config.json` → `audiobookPath`
3. `AUDIOBOOK_PATH` environment variable
4. Default: `./audiobooks` relative to project root

---

## 8. Port Configuration

| Environment | Frontend | Backend | Access |
|---|---|---|---|
| Development | 4001 (Vite) | 5001 (Express) | http://localhost:4001 |
| Docker Production | — (static files) | 4001 (internal) | http://host:3001 |

---

## 9. Deployment

### Docker (Production)
```bash
# One-click deploy (Linux, fetches from CNB repository)
curl -fsSL https://cnb.cool/stark.inc/audiooook_web/-/git/raw/main/deploy.sh | sh

# Or manual
docker compose up -d --build
```

### Environment Variables (Docker)
| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | production | |
| `AUDIOBOOK_PATH` | /audiobooks | Mount point for audiobook files |
| `PORT` | 4001 | Internal container port |

### Volume Mounts
- **Audiobook directory**: Mount the host's parent directory at **the same path** inside the container (e.g., `-v /nas:/nas`). This allows the UI directory browser to see the host filesystem, and the selected audiobook path (e.g., `/nas/books`) works identically inside and outside the container.
  - Example: If audiobooks are in `/nas/books`, mount `/nas:/nas` and set `AUDIOBOOK_PATH=/nas/books`
  - Multiple mounts supported: `-v /nas:/nas -v /mnt/media:/mnt/media`
- `/app/server/data` — Persistent data (config, metadata, transcode cache, covers). Bind-mounted to `./data` on host for easy access/editing
- **deploy.sh variables**: `AUDIOBOOK_DIR` (audiobook path), `MOUNT_DIR` (parent dir to mount, defaults to AUDIOBOOK_DIR)

### Development
```bash
# Windows
npm run install:all
npm run dev
# Or use dev.sh (Linux/macOS)
```

---

## 10. Git Repositories
- GitHub: `https://github.com/uniStark/audiooook_web.git`
- CNB: `https://cnb.cool/stark.inc/audiooook_web`

---

## 11. Critical Implementation Notes

### Line Endings
- All files use LF line endings (enforced via `.gitattributes`).
- Shell scripts MUST be LF — CRLF causes `$'\r': command not found` errors on Linux.
- Git config: `core.autocrlf = false`

### Shell Script Compatibility
- `deploy.sh` and `update.sh` use `#!/bin/sh` (POSIX), NOT `#!/bin/bash`.
- No bashisms: use `printf` instead of `echo -e`, `>/dev/null 2>&1` instead of `&>/dev/null`, no `local` keyword.

### Logging
- All `console.log/error/warn` calls are patched in `server/index.js` to include a `[YYYY/MM/DD HH:MM:SS]` timestamp prefix (timezone: `TZ` env var or `Asia/Shanghai`).
- This ensures Docker logs always show precise timestamps for debugging.

### Browser Audio Limitations
- Browsers cannot natively play WMA, APE, ALAC, FLAC.
- These formats MUST be transcoded to MP3 on the server side.
- Streaming untranscoded WMA causes `Infinity:NaN:NaN` duration and non-seekable progress bars.
- Solution: Transcode to a file first (not pipe-stream), then serve the file with proper Content-Length and Accept-Ranges headers.

### Duration Handling
- `formatTime()` guards against NaN, Infinity, and negative values.
- `playerStore` checks `isFinite(audio.duration)` before updating state.
- Both `loadedmetadata` and `durationchange` events are monitored (some formats report duration late).

---

## 12. Future Extension Points

These are areas the owner may want to extend:

1. **Alibaba Cloud OSS**: The `oss.js` service exists but is minimal. Full implementation would allow reading audiobooks from cloud storage.
2. **Multi-user support**: Currently single-user. Would need user accounts, per-user progress/favorites, authentication.
3. **Playback speed control**: Not yet implemented. Would need `audio.playbackRate` control in playerStore + UI.
4. **Sleep timer**: Common audiobook feature — auto-pause after N minutes.
5. **Chapter markers**: Some audio formats support embedded chapters.
6. **Book categorization/tags**: Organize books beyond flat list.
7. **Transcoding quality settings**: Currently fixed at 128kbps MP3. Could be configurable.

---

*Author: Adrian Stark*
*Last updated: 2026-02-08*
*Document version: 1.3*
