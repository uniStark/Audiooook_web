# audiooook_web - 在线听书

一个基于 React + Express 的在线有声书播放器，专为手机端优化，支持 Docker 一键部署。

## 功能特性

- **多格式支持**：MP3、WMA、WAV、FLAC、AAC、OGG、M4A、OPUS 等（WMA等格式自动通过FFmpeg转码）
- **智能文件夹解析**：自动识别 `小说名/季(章节)/集` 的目录结构，支持中文数字和阿拉伯数字季号
- **书架与收藏**：浏览所有有声书，收藏喜爱的书籍
- **播放记忆**：精确记录每本书的播放位置（精确到秒），下次自动恢复
- **连续播放**：自动播放下一集，季播完自动切换下一季
- **跳过片头片尾**：可自定义每本书的片头片尾跳过时长
- **自定义元数据**：支持自定义书名、简介、封面图片
- **离线下载**：支持下载到手机本地，离线也能听
- **缓存管理**：可自定义缓存大小（默认300MB）
- **OSS支持**：可选接入阿里云OSS读取音频文件
- **PWA支持**：可添加到手机主屏幕，体验接近原生App
- **现代UI**：暗色主题，流畅动效，为移动端优化的交互

## 一键部署

在任意 Linux 服务器上执行以下命令，即可自动拉取代码并通过 Docker 部署：

```bash
# 默认部署（端口 3001，有声书目录 ~/audiobooks）
curl -fsSL https://cnb.cool/stark.inc/audiooook_web/-/git/raw/main/deploy.sh | bash

# 自定义配置（有声书在 /nas/books，挂载 /nas 以支持 UI 目录浏览）
AUDIOBOOK_DIR=/nas/books MOUNT_DIR=/nas HOST_PORT=8080 \
  curl -fsSL https://cnb.cool/stark.inc/audiooook_web/-/git/raw/main/deploy.sh | bash
```

部署完成后访问 `http://你的IP:3001` 即可使用。

## 有声书目录结构

```
audiobooks/
├── 盗墓笔记/                              ← 小说名（自动识别为书名）
│   ├── cover.jpg                          ← 封面图片（可选）
│   ├── 盗墓笔记1之七星鲁王宫(周建龙)[42回]/  ← 第一季
│   │   ├── 盗墓笔记1-七星鲁王宫01.wma
│   │   ├── 盗墓笔记1-七星鲁王宫02.wma
│   │   └── ...
│   ├── 盗墓笔记2之怒海潜沙(周建龙)[40回]/    ← 第二季
│   │   └── ...
│   └── ...
├── 鬼吹灯/
│   ├── 第一季/
│   │   └── 01.mp3 ...
│   └── 第二季/
│       └── ...
└── 三体/                                  ← 也支持没有季结构的（直接放音频文件）
    ├── 三体01.mp3
    └── ...
```

## Docker 部署

### 使用 deploy.sh（推荐）

```bash
git clone https://cnb.cool/stark.inc/audiooook_web.git
cd audiooook_web
bash deploy.sh
```

### 使用 Docker Compose

```bash
git clone https://cnb.cool/stark.inc/audiooook_web.git
cd audiooook_web

# 修改 docker-compose.yml 中的有声书路径，然后:
docker compose up -d

# 访问 http://localhost:3001
```

### 使用 Docker 命令

```bash
docker build -t audiooook_web .

# 将宿主机的 /nas 挂载进容器（保持同路径），这样可以在 UI 中浏览 /nas 下所有子目录
docker run -d -p 3001:4001 \
  -v /nas:/nas \
  -v ./data:/app/server/data \
  -e AUDIOBOOK_PATH=/nas/books \
  --name audiooook_web audiooook_web
```

> **注意**：挂载的宿主机目录在容器内保持同路径（如 `-v /nas:/nas`），这样 UI 中浏览和选择的目录路径在容器内外一致。你也可以挂载多个目录：`-v /nas:/nas -v /mnt/media:/mnt/media`

## 本地开发

```bash
# 安装依赖
npm run install:all

# 启动开发环境（或使用 ./dev.sh start）
npm run dev

# 前端: http://localhost:4001
# 后端: http://localhost:5001
```

开发环境管理脚本：

```bash
./dev.sh start    # 启动
./dev.sh stop     # 停止
./dev.sh restart  # 重启
./dev.sh status   # 查看状态
./dev.sh logs     # 查看日志
```

## 端口说明

| 环境 | 前端访问端口 | 后端服务端口 |
|------|-------------|-------------|
| 开发环境 | 4001 (Vite) | 5001 (Express) |
| Docker生产 | 3001 (宿主机) | 4001 (容器内) |

## 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `PORT` | 服务端口 | 开发`5001` / Docker`4001` |
| `AUDIOBOOK_PATH` | 有声书存放路径 | `./audiobooks` |
| `OSS_REGION` | 阿里云OSS区域 | - |
| `OSS_ACCESS_KEY_ID` | OSS AccessKeyId | - |
| `OSS_ACCESS_KEY_SECRET` | OSS AccessKeySecret | - |
| `OSS_BUCKET` | OSS Bucket名称 | - |
| `OSS_PREFIX` | OSS文件前缀 | `audiobooks/` |

## 仓库地址

- **GitHub**: https://github.com/uniStark/audiooook_web
- **CNB**: https://cnb.cool/stark.inc/audiooook_web

## 技术栈

- **前端**：React 18 + Vite + Tailwind CSS + Zustand + Framer Motion
- **后端**：Express.js + FFmpeg（音频转码）
- **离线**：IndexedDB + Service Worker (PWA)
- **部署**：Docker + Docker Compose

## 作者

**Adrian Stark**
