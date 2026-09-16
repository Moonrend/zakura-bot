# Zakura Bot

Cross-platform chat client (iOS / Android / web) with a **Grok Bot–inspired** dark UI.
Talks to [Zakura](https://github.com/Moonrend/Zakura) as a messaging channel — agents reply with **`chat_reply`**, not a separate local runtime.

> Phase 1 scaffold: Expo + React Native + TypeScript + NativeWind, mock channel, demo conversation.

[中文说明](#zakura-bot-中文) · [Architecture](./docs/architecture.md)

---

## Features (phase 1)

- Left **agent sidebar**, main **chat thread**, rounded **composer**
- **Streaming** assistant bubbles + **tool-activity chips**
- **Settings**: Zakura base URL + auth token (stored on-device; never commit secrets)
- **`ZakuraChannelClient`** interface + **`MockZakuraChannelClient`**
- Demo mock conversation on first launch

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

Opens the Metro bundler and the web app (typically `http://localhost:8081`).

### iOS

```sh
npm run ios
```

Uses the iOS simulator when Xcode is available, or scan the QR code with **Expo Go**.

### Android

```sh
npm run android
```

Uses an emulator / connected device, or **Expo Go**.

### Generic Expo start

```sh
npm start
```

Then press `w` / `i` / `a` for web / iOS / Android.

## Configuration

Open **Settings** (sidebar footer):

| Field | Purpose |
| --- | --- |
| Base URL | Zakura server origin (default `http://127.0.0.1:8787`) |
| Auth token | Device / API token for the future live channel |
| Use mock channel | Keep **on** until platform `zakurabot` exists |

Settings persist in AsyncStorage. Do **not** put tokens in the repo or `.env` committed to git.

## Project layout

```text
app/                 Expo Router screens
components/          Sidebar, chat, composer, chips
lib/channel/         ZakuraChannelClient + mock
lib/store.tsx        UI state
docs/architecture.md How this binds as zakurabot + chat_reply
```

## Stubbed vs real

| Piece | Status |
| --- | --- |
| Expo shell, dark UI, sidebar, chat, composer | **Real** |
| Demo transcript + mock streaming replies | **Real (local mock)** |
| Settings persistence (URL / token) | **Real (local only)** |
| `ZakuraChannelClient` interface | **Real contract** |
| Live WS/SSE to Zakura | **Stubbed** (mock only) |
| Platform `zakurabot` in Moonrend/Zakura | **Not in this repo** (separate PR) |
| Computer desktop viewer / voice / App Store | **Out of scope** (phase 1) |

## How it will bind to Zakura

See **[docs/architecture.md](./docs/architecture.md)**. Summary: Zakura adds platform **`zakurabot`**; agents must use **`chat_reply`** for user-visible messages; this client renders those events.

## License

MIT © Moonrend

---

## Zakura Bot (中文)

跨平台（iOS / Android / Web）聊天客户端，深色 UI 灵感来自 Grok Bot。
作为 [Zakura](https://github.com/Moonrend/Zakura) 的**消息通道**使用：Agent 通过 **`chat_reply`** 对外可见回复，本仓库不是独立 Agent 运行时。

### 运行

```sh
npm install
npm run web      # Web
npm run ios      # iOS（需 macOS / Expo Go）
npm run android  # Android（模拟器 / Expo Go）
npm start        # 然后按 w / i / a
```

### 设置

侧边栏底部 **Settings**：填写 Zakura **Base URL** 与 **Auth Token**（仅本地存储，勿提交密钥）。Phase 1 请保持 **Use mock channel** 开启。

### 现状

- **已实现**：Expo 壳、侧边栏 / 会话 / 输入框、流式气泡、工具活动 Chip、Mock 通道与演示对话、设置持久化。
- **占位**：真实 WS/SSE、`zakurabot` 平台适配（在 Zakura 仓库另开 PR）、电脑桌面预览、语音、上架。

架构与 `chat_reply` 绑定说明见 [docs/architecture.md](./docs/architecture.md)。
