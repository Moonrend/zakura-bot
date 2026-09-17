# Zakura Bot

Cross-platform chat client (iOS / Android / web) with a **Grok Bot–inspired** dark UI.
Talks to [Zakura](https://github.com/Moonrend/Zakura) as a messaging channel — agents reply with **`chat_reply`**, not a separate local runtime.

> **Mock channel** is the default for demos. Live mode uses the `zakurabot` v1 gateway implemented in the Zakura reference checkout; deploy a server with that gateway and create a Zakura Bot device token to connect.

[中文说明](#zakura-bot-中文) · [Architecture](./docs/architecture.md)

---

## Features

- Left **agent sidebar** with **search** across names, previews and drafts, unread filter, and status dots
- Main **chat thread**: streaming bubbles, tool-activity chips, empty / error states
- Rounded **composer** with per-agent drafts, delivery confirmation, interrupt progress, and keyboard avoidance
- Quoted replies, selectable tool details, keyboard-scrollable transcripts and card tables (including headerless tables)
- **Settings**: Zakura base URL + auth token (on-device only; never commit secrets)
- **`ZakuraChannelClient`**: mock (default) + **live WebSocket** client with stable retries and history upserts
- Accessibility labels / live regions on primary controls

Sending from the composer brings the transcript back to the latest messages; incoming replies preserve your position while reading history. Shortening a multiline draft resumes following when the latest messages come back into view. Jump to latest and disappearing Retry, suggestion and error controls keep keyboard focus in the transcript. Sending a suggestion preserves the draft. History timestamp corrections cannot duplicate bubbles through a collision with date separators. Long system notices wrap within narrow conversations. Raw and Markdown streams show a cursor beside the arriving text; unmatched Markdown delimiters remain visible. Unsupported file drops cannot navigate away from any app route. Mixed image/text paste keeps the text and explains that the image was not uploaded.

Long conversations initially show the latest 50 messages. **Load earlier messages** reveals another page of received history while preserving the visible row and keyboard focus. Reading or expanding history keeps those rows available as new replies arrive; quotes can still resolve to messages outside the displayed page. Switching conversations returns to the latest page. This pages messages already received by the app: v1 provides the latest 100 messages on reconnect and has no request for older server history. Whitespace-only reply bodies do not create blank space above files or cards, and completed attachment/card replies have meaningful screen-reader announcements.

Roster removal and changing search matches keep keyboard navigation in the agent list or the replacement conversation without moving focus away from another draft. Search and unread filters survive switching between the desktop sidebar and mobile drawer, including closing and reopening the drawer. If resizing removes the focused sidebar, focus moves to the visible agent list or its menu button. File, image and card-action links have a full 44px minimum hit area; primary and danger actions retain their supplied styles.

Reply updates preserve keyboard focus on the same action, file or image link when the list changes order. Removing a focused link or changing its destination returns focus to the transcript, including links in reply text, while a focused draft stays undisturbed. Scrolling upward with the keyboard cancels a queued follow scroll, so Home still reaches the top when a multiline draft has just resized the conversation.

Streaming Markdown keeps backticks inside code strings and supports matching backtick or tilde fences, including longer fences around Markdown examples. Inline code also requires matching backtick runs, keeping embedded backticks and link syntax literal across soft line breaks. An unfinished inline-code span stays literal until its closing delimiter arrives or the paragraph ends. Links preserve balanced or escaped parentheses in their destination. Reaching the bottom by scrolling also restores transcript focus when a focused Jump to latest control disappears. Changing the system's reduced-motion preference preserves your reading position and draft focus.

Send and Stop use separate controls so a held key or pointer press cannot activate the other action when a turn changes. Enter requires a fresh press before it can send the next draft. Focus returns to the draft when the focused action disappears or Stop enters its waiting state. Long search queries and agent names stay within narrow empty states, and the composer keeps a short placeholder. In short windows, sidebar search scrolls with the conversations so keyboard-focused rows remain visible above Settings. Taller web windows keep search pinned, with room for focused rows when navigating back up the list.

A Stop click that arrives after an idle or terminal channel update keeps the conversation ready for the next message, without creating another wait or false timeout. Pending delivery alone cannot start a Stop request; new live work and busy reconnect snapshots remain stoppable.

On web, losing network connectivity immediately pauses the live channel. Coming online starts a fresh handshake, preserves drafts, and leaves message retries manual. A socket already closing retains its brief wait for an auth/policy close code across network changes, so access failures cannot trigger an automatic reconnect. Both automatic and manual reconnect retain message identities; conflicting replay ids cannot confirm another message or replace a reply, tool or system notice. Received links resolve to absolute HTTP(S) destinations consistently across web and native. Connection setup remains scrollable in short windows; switching to the desktop sidebar closes the mobile drawer.

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
npm run export:web
npx playwright install chromium  # first browser-test run
npm run test:web
```

Browser checks cover desktop/mobile layouts, IME input, keyboard focus/scrolling, reading expanded tool details during incoming replies, network loss and recovery, reconnect retries, history replay, late interrupt refusal, mixed image/text paste, file drops outside the composer, and WCAG checks with axe. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use an existing Chromium installation.

The mock follows the live client's message-id and text validation. Reusing an accepted id returns its original receipt without restarting a reply, including after Stop or reconnect. Interrupted mock handshakes and receipt listeners cannot start output on a replacement connection.


## CI / packaging

### Web CI (not a mobile app)

`.github/workflows/ci.yml` runs on **push** / **pull_request** to `main`:

| Job | Steps | Notes |
| --- | --- | --- |
| `build` | `npm ci` → `typecheck` → `test` → `export:web` | Required gate; Node 22 |
| | Upload `dist/` as artifact **`zakura-bot-web`** | Retention ~14 days |
| `web-e2e` | Download artifact → Playwright Chromium → `npm run test:web` | Soft gate (`continue-on-error`) |

This only produces a **static web** bundle. It is **not** an Android APK / iOS IPA.

### App packaging (real mobile builds)

| Workflow | What it produces | Trigger | Cloud / secrets |
| --- | --- | --- | --- |
| **`EAS Build`** (`.github/workflows/eas-build.yml`) | Expo cloud builds: Android APK (preview) / store AAB+IPA (production) | `workflow_dispatch` (platform + profile) **or** push tag `v*` | Requires **`EXPO_TOKEN`** |
| **`Android APK`** (`.github/workflows/android-apk.yml`) | Local Gradle APK artifact **`zakura-bot-android-apk`** | push to **`main`**, `workflow_dispatch`, or tag `v*` | **No** Expo cloud; optional keystore secrets for release signing |

**Trigger EAS (cloud):**

1. Repo → **Settings → Secrets and variables → Actions** → add `EXPO_TOKEN` ([Expo access token](https://expo.dev/settings/access-tokens)).
2. Link the project once locally: `npx eas-cli login` → `npx eas-cli init` (writes `extra.eas.projectId` into `app.json` if missing).
3. Actions → **EAS Build** → Run workflow → choose `android` / `ios` / `all` and `preview` / `production`.
4. Or: `git tag v0.1.0 && git push origin v0.1.0` (defaults to `all` + `preview`).
5. Locally: `npm run eas:build:android` (preview APK), `npm run eas:build:ios`, `npm run eas:build:production`.

Profiles in `eas.json`:

- **`preview`**: internal distribution; Android **APK**; iOS **simulator** build.
- **`production`**: store builds (Android App Bundle + iOS).

**Trigger Android APK (no Expo cloud):**

1. Push to **`main`**, or Actions → **Android APK** → Run workflow, or push a `v*` tag.
2. Download artifact **`zakura-bot-android-apk`**.
3. Without keystore secrets the job builds a **debug-signed** APK (fine for internal sideload).
4. For release signing later, add: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, and wire `signingConfigs.release` in `android/app/build.gradle` to the `MYAPP_UPLOAD_*` gradle properties the workflow writes.

## Configuration

Open **Settings** (sidebar footer):

| Field | Purpose |
| --- | --- |
| Base URL | Zakura server origin (default `http://127.0.0.1:8787`) |
| Auth token | Zakura Bot device token (admin/API tokens cannot authenticate this channel) |
| Use mock channel | Keep **on** for demos; turn off after configuring a live device |

In Zakura, add an enabled **Zakura Bot** binding to the agent, configure its model, and create a device. Copy the returned Base URL and token into Settings. See [Zakura’s setup guide](https://github.com/Moonrend/Zakura/blob/main/docs/zakurabot-channel.md).

Settings persist locally in AsyncStorage (browser localStorage on web). Native SecureStore integration is not implemented. Do **not** put tokens in the repo or committed `.env` files.

Saving an equivalent Base URL keeps the current connection, drafts, replies and pending requests. Preparing live credentials while using the mock channel also leaves the demo running. Changing the actual WebSocket endpoint, device token or channel mode starts a separate conversation scope.

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
| `ZakuraChannelClient` + live WS client + decoder | **Real client; requires a configured Zakura server** |
| Attachment uploads / adding agents from the client | **Stubbed** (controls disabled) |
| Received attachments and card images | **Browser links**; embedded media playback is not implemented |
| Real WS / persistence / remote tool integration | **Checked locally against Zakura’s test fixture with a controlled runtime** |
| Platform `zakurabot` in Moonrend/Zakura | **Implemented in the reference checkout; deployed separately** |
| Production model/device integration | **Not verified against a deployed server** |
| Native SecureStore / persistent drafts | **Not implemented** |
| Computer desktop viewer / voice / App Store | **Out of scope** |

## How it binds to Zakura

See **[docs/architecture.md](./docs/architecture.md)**. Zakura binds a **`RemoteChannelSessionHandle`** per turn on platform **`zakurabot`**; agents use **`chat_reply`** for user-visible messages, which this client maps to bubbles and chips.

The v1 client also enforces these boundaries in `lib/channel/protocol.ts` and `live-client.ts`:

- `ready` and `agents` carry complete rosters. Events for removed agents are ignored; removal/offline status clears pending requests and active output. An ordinary roster refresh preserves explicit live work; an idle snapshot can recover a stale busy handshake state and confirm its outstanding Stop request.
- Invalid reply and receipt payloads with a valid agent id report errors only in that conversation. Malformed data before `ready` or from a revoked agent is ignored; malformed receipts cannot confirm delivery. Handshake, unreadable JSON and frame-size errors remain channel-wide, and unsupported protocol versions remain terminal.
- A streaming `chat_reply` announces an id once per conversation. Repeated announcements cannot erase tokens or reopen a finished reply, including after reconnect. Settled tool ids also survive reconnect, preventing stale starts from blocking Stop recovery. Without a replay cursor, interrupted streams recover through complete snapshots; new ids can stream normally. `message_done` finishes one reply; `typing: false` ends the turn, which may contain several replies. A non-streaming `chat_reply` is a complete snapshot and may include `interrupted: true` for stopped output.
- User echoes carry the original `clientMessageId`, even when the server assigns its own message id. The client remembers both ids across reconnects; a replay that omits an already-mapped client id still validates the original body. Conflicting receipt ids, changed user text and receipts outside the 1–4000 character limit are rejected. Retry uses the same key and text; an accepted duplicate can receive only its stored echo. Pending delivery is separate from an active turn. The client never automatically resends on reconnect; an unconfirmed write is available for manual retry.
- Send rejections include `agentId` and `clientMessageId`. An old rejection after acknowledgement cannot fail an accepted message. A delivery timeout or rejection preserves active work, including the interval before its first visible output. Interrupt requests have progress, timeout and duplicate-click protection. All v1 errors without `turnEnded` preserve ongoing output, even a delayed refusal arriving during the next turn; newer adapters must explicitly set `turnEnded: true` with an `agentId` for terminal errors. v1 lacks operation ids, so a delayed refusal can release a newer Stop request's progress indicator, but cannot terminate its reply.
- A correlated failure of the latest user turn stops output and clears Stop progress while keeping its message delivered; a replayed receipt cannot dismiss that run error. Older correlated failures cannot stop newer work. Transport and transcript share the optimistic timestamp and maintain the same stable order when receipts and history update timestamps.
- Delivery and run errors are retained separately for each message. A late receipt or retry clears only that message's delivery error; other failures remain available in the banner until dismissed or a new message starts recovery.
- The 1 MB frame limit counts UTF-8 bytes, including CJK and emoji. After a browser socket error, or a write or deadline that observes a closing socket, handshake, heartbeat and request deadlines are cleared before waiting up to one second for the close code. Authentication failures remain terminal; a missing close event falls back to reconnect without automatically resending messages.
- The adapter must resolve workspace attachments to HTTP(S) URLs and set `reply_to` to the actual quoted platform message id, including the `RemoteChannelSessionHandle.inboundMessageId` default. Quotes resolve only inside the current conversation; missing history shows “Reply to earlier message”.
- Blank card decoration is omitted when the same `chat_reply` contains usable text, attachments or actions. Wholly blank replies, malformed fields and unsafe URLs are still rejected.

Reconnect requires a fresh authenticated `ready`. The reference server then replays the latest 100 persisted messages per authorized conversation; repeated ids upsert, and older backfill does not re-mark a read conversation. The current server sends complete reply snapshots; optional streaming support is also covered by browser tests. Client-side persistent history/drafts, replay cursors and turn ids remain unimplemented.

A rapid reconnect during history catch-up exposed a duplicate-unsubscribe race in the reference **server** that can stop live posts while roster updates continue. The reproduction and required server-side fix are recorded in [the architecture notes](./docs/architecture.md#reference-server-limitation); the Zakura checkout was kept read-only.

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

在 Zakura 为 Agent 添加 **Zakura Bot** 绑定、配置模型并创建设备。在侧边栏 **Settings** 填入设备的 **Base URL** 与 **Token**，关闭 **Use mock channel**。普通 API / 管理员 Token 不能连接该消息通道；演示模式保持 Mock 开启。

保存等价的 Base URL（如增删末尾斜杠）会保留连接、草稿、回复和待确认请求；Mock 模式下准备 Live 参数也不会中断演示。更换实际 WebSocket 地址、设备 Token 或通道模式时，会隔离并清空旧会话数据。


### CI / 打包

**Web CI ≠ App 打包。** `ci.yml` 只导出静态 Web；真机安装包走下面两条工作流。

| 工作流 | 产物 | 触发 | 密钥 |
| --- | --- | --- | --- |
| **Web CI** `ci.yml` | 静态站点工件 `zakura-bot-web` | `main` push / PR | 无 |
| **EAS Build** `eas-build.yml` | Expo 云构建（preview APK / production 商店包） | 手动 `workflow_dispatch` 或推送 `v*` tag | 必填 **`EXPO_TOKEN`** |
| **Android APK** `android-apk.yml` | 本地 Gradle APK 工件 `zakura-bot-android-apk` | push `main` / 手动 / `v*` tag | 无需 Expo；发版签名可后续加 keystore secrets |

**跑 EAS：** 在仓库 Secrets 添加 `EXPO_TOKEN` → Actions → **EAS Build** → 选 platform / profile；或本地 `npm run eas:build:android`。首次需 `eas init` 写入 projectId。

**跑本地 APK：** Actions → **Android APK** → Run；无 keystore 时产出 **debug 签名** APK（内测可装）。发版后再配 `ANDROID_KEYSTORE_BASE64` 等。

### 现状

- **已实现**：Expo 壳、侧边栏搜索 / 未读 / 状态点、流式气泡、工具 Chip、空态与错误态、Composer 草稿与键盘避让、a11y、Mock 通道、Live WS 客户端与协议解码、设置持久化。已收到的历史按 50 条分页展开；v1 尚无请求更早服务端历史的接口。
- **已联调**：参考 Zakura 服务端的真实 WS、持久化回执与历史补发、远程工具引用和附件下载；使用受控 runtime，未连接生产模型。快速重连时参考服务端有重复退订竞态，详见架构文档。
- **仍占位**：附件上传、客户端添加 Agent、内嵌媒体、原生 SecureStore、持久化草稿；电脑桌面预览、语音和上架不在当前范围。

架构与 `chat_reply` / `RemoteChannelSessionHandle` 说明见 [docs/architecture.md](./docs/architecture.md)。
