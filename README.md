# Claude Manager

一个基于 Electron 的 Claude CLI 多会话管理工具，可以同时管理多个 Claude Code 会话，支持分屏、主题切换、自动审批等功能。

![Claude Manager](assets/icon.png)

## 平台支持

- **macOS** (Apple Silicon / Intel) — 完整支持
- Windows / Linux — 暂不支持

## 前置要求

| 依赖 | 最低版本 | 验证方式 |
|------|---------|---------|
| Node.js | 18+ | `node --version` |
| Claude Code CLI | 最新 | `claude --version` |
| npm | 8+ | `npm --version` |

### 安装 Claude Code CLI

```bash
npm install -g @anthropic-ai/claude-code
claude --version   # 验证安装成功
```

## 安装

### 从源码构建

```bash
# 克隆仓库
git clone https://github.com/jabitop/claude-manager.git
cd claude-manager

# 安装依赖
npm install

# 开发模式运行
npm start

# 构建生产版本（macOS DMG）
npm run build:all

# 仅类型检查
npm run typecheck
```

构建产物在 `release/` 目录下。

### 安装到 Applications

```bash
rm -rf "/Applications/Claude Manager.app"
cp -R "release/mac-arm64/Claude Manager.app" "/Applications/Claude Manager.app"
```

> **注意：** 通过 DMG 覆盖安装可能不会完全替换旧文件，建议先删除再复制。

## 功能特性

- **多会话管理** — 同时运行多个 Claude CLI 会话，每个会话对应不同的项目目录
- **分屏模式** — 支持左右分屏同时查看两个会话
- **状态检测** — 通过 hooks 实时检测会话状态（空闲/忙碌/等待确认/错误）
- **自动审批** — 可为单个会话或全局开启自动审批
- **主题切换** — 内置 14 种配色方案
- **历史项目** — 自动记录最近打开的项目
- **批量命令** — 向多个会话同时发送命令
- **拖拽支持** — 拖拽文件/文件夹到侧边栏创建会话
- **字体缩放** — 调整终端字体大小

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Cmd+N` | 新建会话 |
| `Cmd+W` | 关闭当前会话 |
| `Cmd+1` ~ `Cmd+9` | 切换到第 N 个会话 |
| `Cmd+[` | 切换到上一个会话 |
| `Cmd+]` | 切换到下一个会话 |
| `Cmd++` | 增大终端字体 |
| `Cmd+-` | 减小终端字体 |

## 安全提示

### 权限绕过

本工具以 `--dangerously-skip-permissions` 模式启动所有 Claude 会话。这意味着 Claude 将跳过权限确认直接执行文件读写、命令执行等操作。**请仅在信任的项目目录中使用。**

### Hook 注入

应用启动时会自动修改 `~/.claude/settings.json`，注入以下 hooks 用于检测会话状态：

- **Stop** — 会话空闲通知
- **UserPromptSubmit** — 会话忙碌通知
- **PermissionRequest** — 等待确认通知

这些 hooks 通过 `curl` 向本地 HTTP 服务器报告状态，仅在应用运行时生效。hooks 注入后会保留在 settings.json 中，不会在应用关闭时自动清理。

## 配置

### 主题

侧边栏底部提供主题选择器，支持 14 种配色方案，选择后自动保存。

### 自动审批

- **全局自动审批**：侧边栏工具栏的"自动"按钮，对所有会话生效
- **单会话自动审批**：每个会话卡片上的"AA"按钮，仅对该会话生效

## 故障排除

### 启动时提示"未找到 Claude CLI"

确认 Claude CLI 已安装并可从终端访问：

```bash
which claude
# 应输出类似 /opt/homebrew/bin/claude
```

如未安装，执行：
```bash
npm install -g @anthropic-ai/claude-code
```

安装后重启 Claude Manager。

### 会话状态不更新

检查 `~/.claude/settings.json` 中是否存在 hooks 配置。如果 hooks 丢失，重启应用会自动重新注入。

### 从 Finder 启动后 Claude CLI 找不到

应用已内置 PATH 修复逻辑，会自动从 shell 环境继承 PATH。如仍有问题，确保 Claude CLI 安装在以下路径之一：

- `/opt/homebrew/bin/claude`
- `/usr/local/bin/claude`

### 构建失败

```bash
# 清理构建产物后重试
npm run clean
npm install
npm run build:all
```

## 技术栈

- **Electron** — 桌面应用框架
- **React** — UI 框架
- **Vite** — 前端构建工具
- **xterm.js** (@xterm/xterm) — 终端模拟器
- **node-pty** — 伪终端
- **Zustand** — 状态管理

## NPM Scripts

| 命令 | 说明 |
|------|------|
| `npm start` | 开发模式启动 |
| `npm run dev` | 仅启动 Vite 开发服务器 |
| `npm run build` | 编译 TypeScript + 构建前端 |
| `npm run build:dmg` | 打包 macOS DMG |
| `npm run build:all` | 完整构建（编译 + 打包） |
| `npm run clean` | 清理所有构建产物 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm test` | 运行测试 |
| `npm run rebuild` | 重新编译 node-pty |

## 项目结构

```
├── electron/              # Electron 主进程代码
│   ├── main.ts            # 主进程入口、IPC 处理、Hook 服务器
│   ├── preload.ts         # 预加载脚本
│   ├── session-manager.ts # 会话管理（pty 创建/销毁/状态）
│   └── status-detector.ts # 会话状态检测
├── src/                   # React 前端代码
│   ├── App.tsx            # 主界面布局
│   ├── App.css            # 全局样式
│   ├── themes.ts          # 主题配色方案
│   ├── components/        # UI 组件
│   └── stores/            # Zustand 状态管理
├── assets/                # 应用图标
├── electron-builder.json  # 打包配置
└── vite.config.ts         # Vite 配置
```

## License

ISC
