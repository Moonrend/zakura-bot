# Zakura Bot

A cross-platform Zakura client for iOS, Android and web. Connect your own instance, authorize bots in your tenant, and talk to them through Zakura’s `zakurabot` channel and `chat_reply` tools.

## Status

| Product capability | Progress |
| --- | --- |
| Zakura login | **Implemented**: browser device authorization, tenant binding consent, rotating refresh credentials, native SecureStore, logout and multiple instances |
| Bot / Agent management | **Implemented**: authorized roster, binding/profile details, selection, start/stop and fresh sessions |
| Sidebar groups | Planned: locally persisted sections and ordering |
| Send files | Planned: image/file picker, uploads and attachment cards |
| View desktop | Planned: latest workspace screenshot and refresh |
| Special messages | Existing: tool activity, errors, system notices, quotes and cards; interactive approval/question support next |

The matching server changes are in [Zakura PR #15](https://github.com/Moonrend/Zakura/pull/15), branch `feat/zakurabot-channel`. Both repositories must be deployed for browser authorization. Production model/device use and native installation have not been verified against a deployed instance.

## Connect to Zakura

1. In Zakura, configure an agent’s model and add an enabled **Zakura Bot** platform binding.
2. Launch the app, enter the instance URL, and choose **Sign in with Zakura**.
3. Your browser opens Zakura. Complete the existing tenant login (including MFA/SSO if configured), confirm the displayed device code, and select up to 16 bot bindings.
4. Return to the app. It completes login automatically and shows the authorized bots.
5. **Settings → Add instance** adds another login; select a saved instance to switch. **Sign out** revokes the current live device and removes its credentials.

Access credentials refresh every 30 minutes without changing the device or its history. Refresh credentials expire after 90 days. Native credentials live in SecureStore; web credentials live in the current tab’s sessionStorage, so closing the tab requires a new login. Ordinary preferences contain only instance metadata. Older plaintext settings are migrated and erased on load.

**Advanced connection** retains manual device tokens for existing installations. **Try demo** opens local mock conversations without an account. The URL must be reachable from the phone/browser; use HTTPS for a public instance and retain any reverse-proxy path prefix.

Open **Manage bots** in the sidebar or **Bot details** in a conversation. Select an authorized bot, start its session, stop a running turn, or choose **New session** for fresh model context. The transcript keeps earlier messages. Bots and platform bindings are created in Zakura; **Authorize bots** opens another device authorization to choose bindings.

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

Browser checks cover product workflows and chat delivery, including device login, instance switching, logout and reconnection. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use an existing Chromium installation.

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
app/                 Expo Router screens
components/          Login, sidebar, chat and composer
lib/auth.ts          Device authorization and credential refresh
lib/settings.ts      SecureStore / sessionStorage and instance metadata
lib/channel/         Live WebSocket and mock transports
lib/chat-state.ts    Chat reducer
lib/store.tsx        App state and instance switching
tests/               Unit and browser workflow tests
```

## Zakura integration

See [docs/architecture.md](./docs/architecture.md) and [the server channel guide](https://github.com/Moonrend/Zakura/blob/feat/zakurabot-channel/docs/zakurabot-channel.md). Credentials are scoped to a tenant, device and explicit `bindingIds`; a device cannot call tenant management APIs. Authorization uses one-time device grants and rotating refresh tokens stored as hashes on the server. A browser approves the selected bindings using the normal tenant session.

WS reconnects restore the latest 100 delivered messages per authorized conversation. Message retries retain their idempotency key. Switching instances clears the current roster, drafts and transcript before the other instance connects. Credentials never travel in socket URLs.

## 产品进度（中文）

当前主线：Zakura 授权登录 → Bot 管理 → 分组 → 发文件 → 看桌面 → 特殊消息。顶部 Status 表随每次产品里程碑更新。App 首次启动使用浏览器设备授权；手动粘贴 token 仅作为高级 fallback。服务端功能跟随上面的 PR 部署。
