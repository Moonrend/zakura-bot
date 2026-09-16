# Zakura Bot

Cross-platform chat client (iOS / Android / web) with a **Grok Bot–inspired** dark UI.
Talks to [Zakura](https://github.com/Moonrend/Zakura) as a messaging channel — agents reply with **`chat_reply`**, not a separate local runtime.

> Phase 1+: Expo UI polish is in place; **mock channel** is the default. Live WS client is implemented against a documented `zakurabot` wire protocol; the server-side platform adapter is still a separate Zakura PR.

[中文说明](#zakura-bot-中文) · [Architecture](./docs/architecture.md)

---

## Features

- Left **agent sidebar** with **search**, unread filter, and status dots
- Main **chat thread**: streaming bubbles, tool-activity chips, empty / error states
- Rounded **composer** with drafts, interrupt, and keyboard avoidance
- **Settings**: Zakura base URL + auth token (on-device only; never commit secrets)
- **`ZakuraChannelClient`**: mock (default) + **live WebSocket** client (needs server adapter)
- Accessibility labels / live regions on primary controls

## Requirements

- Node.js 20+ (tested on 22)
- npm 10+
- For iOS: macOS + Xcode (or Expo Go)
- For Android: Android Studio / emulator (or Expo Go)

## Quick start

```sh
git clone https://github.com/Moonrend/zakura-bot.git
cd zakura-bot
npm install
```

### Web

```sh
npm run web
```

Opens Metro and the web app (typically `http://localhost:8081`).

### Static web export (optional)

```sh
npm run export:web   # writes to dist/
npm run preview:web  # serve dist locally
```

If export is slow or fails in CI, use `npm run web` for day-to-day development.

### iOS / Android

```sh
npm run ios
npm run android
# or
npm start   # then press w / i / a
```

### Checks

```sh
npm run typecheck
npm test
```


## CI / 打包

GitHub Actions (`.github/workflows/ci.yml`) runs on **push** and **pull_request** to `main`:

| Job | Steps | Notes |
| --- | --- | --- |
| `build` | `npm ci` → `typecheck` → `test` → `export:web` | Required gate; Node 22 |
| | Upload `dist/` as artifact **`zakura-bot-web`** | Retention ~14 days |
| `web-e2e` | Download artifact → Playwright Chromium → `npm run test:web` | Soft gate (`continue-on-error`); uses `preview:web` via Playwright `webServer` |

Download the static web build from the Actions run → Artifacts → `zakura-bot-web`.

## Configuration

Open **Settings** (sidebar footer):

| Field | Purpose |
| --- | --- |
| Base URL | Zakura server origin (default `http://127.0.0.1:8787`) |
| Auth token | Device / API token for the live channel |
| Use mock channel | Keep **on** until platform `zakurabot` exists on the server |

Settings persist locally (SecureStore / AsyncStorage). Do **not** put tokens in the repo or committed `.env` files.

## Project layout

```text
app/                 Expo Router screens
components/          Sidebar, chat, composer, chips
lib/channel/         ZakuraChannelClient · mock · live WS · protocol
lib/chat-state.ts    Pure chat reducer
lib/store.tsx        UI state
docs/architecture.md zakurabot + chat_reply + RemoteChannelSessionHandle
tests/               Protocol / client / reducer unit tests
```

## Stubbed vs real

| Piece | Status |
| --- | --- |
| Expo shell, dark UI, sidebar search, chat, composer | **Real** |
| Streaming bubbles, tool chips, empty/error/a11y | **Real** |
| Demo transcript + mock streaming replies | **Real (local mock)** |
| Settings persistence (URL / token) | **Real (local only)** |
| `ZakuraChannelClient` + live WS client + decoder | **Real client; needs server** |
| End-to-end live channel to Zakura | **Stubbed** until `zakurabot` adapter |
| Platform `zakurabot` in Moonrend/Zakura | **Not in this repo** (separate PR) |
| Computer desktop viewer / voice / App Store | **Out of scope** |

## How it binds to Zakura

See **[docs/architecture.md](./docs/architecture.md)**. Summary: Zakura adds platform **`zakurabot`** and binds a **`RemoteChannelSessionHandle`** per turn; agents must use **`chat_reply`** for user-visible messages; this client maps those frames to bubbles and chips.

## License

MIT © Moonrend

---

## Zakura Bot (中文)

跨平台（iOS / Android / Web）聊天客户端，深色 UI 灵感来自 Grok Bot。
作为 [Zakura](https://github.com/Moonrend/Zakura) 的**消息通道**使用：Agent 通过 **`chat_reply`** 对外可见回复，本仓库不是独立 Agent 运行时。

### 运行

```sh
npm install
npm run web         # Web（日常开发）
npm run export:web  # 可选静态导出到 dist/
npm run ios         # iOS（需 macOS / Expo Go）
npm run android     # Android（模拟器 / Expo Go）
npm run typecheck && npm test
```

### 设置

侧边栏底部 **Settings**：填写 Zakura **Base URL** 与 **Auth Token**（仅本地存储，勿提交密钥）。在服务端 `zakurabot` 适配就绪前请保持 **Use mock channel** 开启。


### CI / 打包

`.github/workflows/ci.yml` 在 `main` 的 push / PR 上跑：

- **`build`**（硬门禁）：Node 22、`npm ci`、`typecheck`、`test`、`export:web`，并上传 `dist/` 工件 **`zakura-bot-web`**（约 14 天）。
- **`web-e2e`**（软门禁，`continue-on-error`）：下载工件后装 Playwright Chromium，跑 `npm run test:web`（内部会起 `preview:web`）。

在 Actions 运行页的 Artifacts 中下载静态 Web 包。

### 现状

- **已实现**：Expo 壳、侧边栏搜索 / 未读 / 状态点、流式气泡、工具 Chip、空态与错误态、Composer 草稿与键盘避让、a11y、Mock 通道、Live WS 客户端与协议解码、设置持久化。
- **仍占位**：对真实 Zakura 的端到端 Live 通道（依赖仓库外的 `zakurabot` 平台适配）、电脑桌面预览、语音、上架。

架构与 `chat_reply` / `RemoteChannelSessionHandle` 说明见 [docs/architecture.md](./docs/architecture.md)。
