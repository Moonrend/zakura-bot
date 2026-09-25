# Zakura Bot

A cross-platform Zakura client for iOS, Android and web. Sign in with your Zakura account and talk to every agent you can reach through Zakura’s `zakurabot` channel and `chat_reply` tools.

## Status

UI mirrors Grok Bot minimalism (tools as tiny pills only).

| Product capability | Progress |
| --- | --- |
| Zakura login | **Implemented**: standard OAuth 2.1 (authorization code + PKCE) with the account's own permissions, rotating refresh tokens, native SecureStore, logout and multiple instances |
| Bot / Agent management | **Implemented**: the full tenant roster (new agents appear automatically), selection, start/stop and fresh sessions |
| Agent management in-app | **Implemented**: admins create, edit and delete agents from the app through Zakura's standard agent API |
| Sidebar groups | **Implemented**: create, rename, sort, assign bots and persist per instance on this device |
| Send files | **Implemented**: photo/file picker, paste/drop on web, uploads with retry, attachment-only sends, image previews and authenticated downloads |
| View desktop | **Implemented**: conversation desktop page, authenticated screenshots, refresh, automatic updates and capture recovery |
| Special messages | Tiny activity pills while running; compact approval/question cards, errors, notices and quotes |

The matching server implementation lives in the reCloud/Zakura repository (see `docs/zakurabot-channel.md` there). Deploy a server with the OAuth user channel enabled.

## Connect to Zakura

1. Launch the app, enter the instance URL, and choose **Sign in with Zakura**.
2. Your browser opens Zakura's standard OAuth consent. Complete the existing tenant login (including MFA/SSO if configured) and approve the request.
3. Return to the app. It completes login automatically and shows every agent in your tenant — no per-agent setup, bindings or device tokens. New agents appear on their own.
4. **Settings → Add instance** adds another login; select a saved instance to switch. **Sign out** revokes the OAuth refresh token and removes its credentials.

Access tokens refresh automatically (1-hour tokens, 30-day rotating refresh tokens). Native credentials live in SecureStore; web credentials live in the current tab’s sessionStorage, so closing the tab requires a new login. Ordinary preferences contain only instance metadata.

**Advanced connection** retains manual tokens — paste an OAuth access token from any Zakura session. **Try demo** opens local mock conversations without an account. The URL must be reachable from the phone/browser; use HTTPS for a public instance and retain any reverse-proxy path prefix.

Open **Manage bots** in the sidebar or **Bot details** in a conversation. Select a bot, start its session, stop a running turn, or choose **New session** for fresh model context. The transcript keeps earlier messages. Administrators see **New agent**, **Edit agent** (name, description, computer, memory) and **Delete agent** on the same screen, backed by Zakura's standard `/api/agents`; the roster refreshes on its own after each change. Members see and use every agent their account can reach.

Open **Groups** in the sidebar to create or rename sections, move them up/down, and place bots in a section. Deleting a section returns its bots to Ungrouped. Group layouts persist locally for each saved instance; cloud synchronization is not implemented.

In a connected bot conversation, tap **+ → Photos / Files**, or paste/drop files on web. The bot must have filesystem access enabled in Zakura. Upload up to 8 nonempty files, each at most 16 MiB; wait for **Ready to send**, optionally add text, then Send. Uploads stay with their bot when switching conversations and can be retried or removed. Tap an attachment to preview supported images or **Download** (the native share/save sheet on iOS and Android). Credentials stay in request headers, including downloads. Unsent file drafts are held in memory and clear on reload or instance switch.

Tap the **monitor icon** in a conversation to open the bot's desktop. Enable **Computer** on the agent in Zakura first. **Refresh** captures the latest screen; **Auto-refresh** follows it while the page is visible. Failed refreshes retain the last successful capture, and Done returns to the chat draft. This release provides viewing; mouse/keyboard control and VNC are not implemented in the app.

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
# Optional: check the actual sibling Zakura server, with its dependencies installed
ZAKURA_SERVER_PATH=../Zakura npm run test:integration
```

Browser checks cover product workflows and chat delivery, including OAuth login, instance switching, logout and reconnection. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use an existing Chromium installation.

The cross-repository integration check starts Zakura's HTTP/WebSocket server with PGlite and a controlled runtime, then drives it with this app's live client. It verifies file delivery to the agent workspace, authenticated downloads and retry deduplication without external model credentials.

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

## Project layout

```text
app/                 Expo Router screens (incl. the web OAuth callback)
components/          Login, sidebar, chat and composer
lib/auth.ts          OAuth 2.1 (PKCE) token exchange and refresh
lib/agents.ts        Standard /api/agents management client
lib/settings.ts      SecureStore / sessionStorage and instance metadata
lib/channel/         Live WebSocket and mock transports
lib/chat-state.ts    Chat reducer
lib/store.tsx        App state and instance switching
tests/               Unit and browser workflow tests
```

## Zakura integration

See [docs/architecture.md](./docs/architecture.md) and the server’s `docs/zakurabot-channel.md`. The app signs in with Zakura's standard OAuth 2.1 authorization-code flow (PKCE, dynamically registered public client, `api` scope) and then acts as the signed-in user: every tenant agent is reachable, and agent management uses the standard `/api/agents` endpoints with the account's own permissions. Chat runs over the `zakurabot` WS channel with the access token in the hello frame; credentials never travel in socket URLs.

WS reconnects restore the latest 100 delivered messages per conversation. Message retries retain their idempotency key. Switching instances clears the current roster, drafts and transcript before the other instance connects.

## 产品进度（中文）

当前主线：OAuth 登录（用户自身权限，免预配）→ 全量 Agent 使用 → 管理员在 App 内创建/编辑/删除 Agent → 分组 → 发文件 → 看桌面 → 特殊消息。顶部 Status 表随每次产品里程碑更新。登录走 Zakura 标准 OAuth（授权码 + PKCE，浏览器完成 MFA/SSO）；手动粘贴 token 仅作为高级 fallback。服务端功能跟随配套平台（reCloud/Zakura）的 `zakurabot-channel` 文档部署。
