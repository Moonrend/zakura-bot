# Zakura Bot — architecture

## Role

**Zakura Bot** is a cross-platform (iOS / Android / web) messaging **client**, not an agent runtime.

- Agents live in [Moonrend/Zakura](https://github.com/Moonrend/Zakura).
- This app is a first-party **remote channel** surface — the same conceptual slot as Slack / Telegram / Discord bindings.
- Outbound user-visible text from agents must go through Zakura’s remote-channel tool **`chat_reply`** (see `apps/server/src/services/remote-channel-tools.ts` in Zakura). Assistant-only model text is not mirrored to external platforms.

## High-level diagram

```text
┌─────────────────────────────────────────────┐
│  Zakura Bot (this repo)                     │
│  Expo Router · RN · TypeScript · NativeWind │
│  Sidebar · search · chat · composer         │
│                                             │
│  ZakuraChannelClient                        │
│    ├─ MockZakuraChannelClient (default)     │
│    └─ LiveZakuraChannelClient (WS client;   │
│         needs server platform adapter)      │
└──────────────────┬──────────────────────────┘
                   │  WSS /api/zakurabot/ws
                   ▼
┌─────────────────────────────────────────────┐
│  Moonrend/Zakura                            │
│  platform: zakurabot  (planned adapter)     │
│                                             │
│  RemoteChannelSessionHandle                 │
│    chat, threadId, channelId, platform,     │
│    bindingId, inboundMessageId, isDM, …     │
│                                             │
│  inbound:  user message → agent turn        │
│  outbound: agent tools                      │
│     • chat_reply  (primary visible reply)   │
│     • chat_start_typing / reactions / …     │
└─────────────────────────────────────────────┘
```

## `RemoteChannelSessionHandle` (server contract)

From Zakura `remote-channel-tools.ts`, each remote turn binds a session handle:

| Field | Meaning |
| --- | --- |
| `chat` | `RemoteChatHandle` (thread / channel / openDM) |
| `threadId` | Full inbound thread id (e.g. `zakurabot:<device>:<thread>`) |
| `channelId` | Channel id for the binding |
| `platform` | Platform id — for this client, planned **`zakurabot`** |
| `bindingId` | Connector binding |
| `inboundMessageId` | User message id; **`chat_reply` defaults to quoting it** via `reply_to` |
| `isDM` / `channelName` / `isThread` | Location context |
| `sender` | `{ userId?, userName?, fullName? }` |
| `trigger` | `dm` \| `mention` \| `subscribed` |
| `permalink` | Original message URL when the platform provides one |
| `chatReplySuccessCount` | Successful `chat_reply` count this turn (silent-fallback guard) |
| `autoFallbackPosted` | Prevents duplicate auto-fallback posts |

Agents are instructed that **any user-visible text must call `chat_reply`**. Streaming assistant tokens alone must not appear on the channel.

### `chat_reply` payload (tool args → channel egress)

Aligned with Zakura `POSTABLE_PROPERTIES`:

| Field | Notes |
| --- | --- |
| `text` | Markdown body (omit only for file/button/card-only posts) |
| `format` | `markdown` \| `raw` (default markdown) |
| `kind` | Alias of format; `kind=card` requires a structured `card` |
| `reply_to` | Platform message id to quote (defaults to inbound) |
| `attachments` | Paths/URLs on the server; **adapter must resolve to https URLs** before client egress |
| `actions` | URL buttons `{ label, url, style? }` |
| `card` | Structured card: title, subtitle, text, fields, table, images, links |

Related tools the UI may surface as **activity chips**: `chat_start_typing`, `chat_add_reaction`, and other remote-channel tools. Visible bubbles still come from `chat_reply` (or post/DM variants mapped the same way).

## Binding as platform `zakurabot`

Planned work lands in **Moonrend/Zakura** (separate PR), not in this repo:

1. Register a Chat-SDK–compatible adapter factory for platform id **`zakurabot`** in `remote-channel-runtime` alongside `telegram`, `slack`, …
2. Device / token auth: client Settings stores **Base URL + auth token**. Zakura validates and maps device → tenant + agents.
3. Thread mapping: each sidebar agent row ↔ Zakura agent / thread (`zakurabot:<device>:<thread>` or similar).
4. Ingress: composer → `send` frame → Zakura inbound → agent turn with remote-channel tools.
5. Egress: agent `chat_reply` → adapter posts `chat_reply` / `message_delta` / `message_done` / `tool_activity` / `typing` frames to the socket.
6. Dashboard: enable the Zakura Bot binding like other remote platforms.

Until that platform exists, keep **`useMockChannel: true`**. The live client can connect to a real server once the adapter ships; today it fails closed with a clear error.

## Wire protocol (client ↔ planned `zakurabot` WS)

Implemented in `lib/channel/protocol.ts` + `lib/channel/live-client.ts` (`PROTOCOL_VERSION = 1`).

**Client → server**

- `hello` `{ protocol, token, client: { name, version } }` after socket open (token never in URL)
- `send` `{ agentId, clientMessageId, text }`
- `interrupt` `{ agentId }`
- `ping` / expect `pong`

**Server → client**

- `ready` `{ protocol, agents[] }` — auth complete; gates all data frames
- `agents` — roster refresh
- **`chat_reply`** `{ agentId, messageId, createdAt, streaming?, payload }` — **only** source of assistant bubbles (maps to UI `message`)
- `message_delta` / `message_done` — stream into a previously announced streaming `chat_reply`
- `message` — user echo / system only (never assistant mirror text)
- `tool_activity` — chip updates
- `typing` — busy indicator
- `error` `{ message, agentId?, clientMessageId?, fatal? }`
- `pong`

Live client rules:

- Ignore data frames until authenticated `ready`.
- Accept `message_delta` / `message_done` only for message ids announced by a streaming `chat_reply`.
- Drop unknown event types; reject malformed / non-http attachment URLs.
- Reconnect with backoff; treat close codes `1008` / `4401` / `4403` as auth/access failures (no retry).

Socket URL: `{base}/api/zakurabot/ws` (http→ws, https→wss; path prefixes retained).

## App structure (this repo)

| Path | Purpose |
| --- | --- |
| `app/` | Expo Router screens (`index` shell, `settings` modal) |
| `components/` | Sidebar (search / unread), chat pane, bubbles, activity chips, composer |
| `lib/channel/` | Client interface, mock, live WS, protocol decoder |
| `lib/chat-state.ts` | Pure reducer for messages / unread / connection |
| `lib/store.tsx` | React store wiring channel → UI |
| `lib/settings.ts` | Secure / AsyncStorage persistence for URL + token |
| `docs/architecture.md` | This document |
| `tests/` | Node unit tests for protocol, live client, chat state |

## UI event surface

`ZakuraChannelClient` events the UI understands:

- `connection` — disconnected / connecting / connected / error
- `agents` — roster upsert
- `message` — full message upsert (user, system)
- `message` via mapped `chat_reply` — assistant text / card / attachments
- `message_delta` / `message_done` — streaming assistant text
- `tool_activity` — chip updates
- `typing` — busy indicator
- `error` — banner / failed send

## Phase status

| Area | Status |
| --- | --- |
| Expo shell, Grok-style dark UI | **Done** |
| Sidebar search, unread filter, status dots | **Done** |
| Streaming bubbles, tool chips, empty/error states | **Done** |
| Composer drafts, keyboard avoidance, a11y labels | **Done** |
| Mock channel + demo transcript | **Done** |
| Live WS client + protocol decoder | **Done (client)** |
| Platform `zakurabot` adapter in Zakura | **Stub / separate PR** |
| End-to-end live chat against Zakura | **Blocked on server adapter** |
| Computer pane / voice / App Store | **Out of scope** |

## UX references (contracts only)

Studied for layout/interaction contracts; **no proprietary blobs vendored**:

- [b-nnett/grok-bot-0.18-reconstructed](https://github.com/b-nnett/grok-bot-0.18-reconstructed) `frontend/` — sidebar / transcript / composer evidence
- [aivsomkar/OpenGrokBot](https://github.com/aivsomkar/OpenGrokBot) — open React chat with SSE, tool chips, dark palette
