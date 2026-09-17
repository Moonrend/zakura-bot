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
│    └─ LiveZakuraChannelClient (WS v1)       │
└──────────────────┬──────────────────────────┘
                   │  WSS /api/zakurabot/ws
                   ▼
┌─────────────────────────────────────────────┐
│  Moonrend/Zakura                            │
│  platform: zakurabot                        │
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
| `threadId` | Full inbound thread id (`zakurabot:<device>:<binding>:<agent>`) |
| `channelId` | Channel id for the binding |
| `platform` | Platform id — **`zakurabot`** |
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
| `attachments` | Paths/URLs on the server; **adapter resolves paths to HTTP(S) URLs** before client egress |
| `actions` | URL buttons `{ label, url, style? }` |
| `card` | Structured card: title, subtitle, text, fields, table (headers may be empty), images, links |

Related tools the UI may surface as **activity chips**: `chat_start_typing`, `chat_add_reaction`, and other remote-channel tools. Visible bubbles still come from `chat_reply` (or post/DM variants mapped the same way).

## Binding as platform `zakurabot`

The reference checkout of **Moonrend/Zakura** implements this platform in `zakurabot-gateway.ts`, `zakurabot-channel.ts`, `zakurabot-adapter.ts`, `zakurabot-protocol.ts` and `zakurabot-store.ts`. Deploy a server version containing those services; this client does not install them.

1. In the Zakura dashboard, add an enabled **Zakura Bot** binding to an agent and configure its chat model.
2. Create a device for the binding; copy its **Base URL + device token** into this app’s Settings and disable the mock channel. General API/admin tokens cannot authenticate the channel.
3. The server resolves the device to its tenant and authorized bindings. Threads are isolated by tenant/device/binding/agent; the client supplies only an authorized agent id.
4. Composer `send` frames enter `RemoteAgentIngress`. The runtime binds a `RemoteChannelSessionHandle` before starting the turn; `chat_reply` defaults to quoting its `inboundMessageId`.
5. The first-party raw WS gateway shares the API server with Socket.IO. Existing Slack/Telegram/etc. platforms retain their Chat SDK adapters.

See [Zakura’s channel setup and deployment guide](https://github.com/Moonrend/Zakura/blob/main/docs/zakurabot-channel.md). The mock remains the default for local demos.

## Wire protocol (client ↔ `zakurabot` WS)

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
- `message_delta` / `message_done` — optional streaming extension, only after a streaming `chat_reply` announcement
- `message` — user echo / system only (never assistant mirror text)
- `tool_activity` — chip updates
- `typing` — busy indicator
- `error` `{ message, agentId?, clientMessageId?, fatal?, turnEnded? }` — `turnEnded` is an optional extension; the current reference gateway omits it
- `pong`

Live client rules:

- Ignore data frames until authenticated `ready`.
- Accept `message_delta` / `message_done` only for message ids announced by a streaming `chat_reply`. Duplicate announcements cannot erase tokens or reopen a completed reply. A full, non-streaming snapshot can restore interrupted content on reconnect.
- `message_done` finishes one reply. Only a turn-ending signal finishes the whole turn, which may contain several `chat_reply` calls. Completed/stopped tools cannot be reopened by replayed start events.
- Roster updates contain the complete authorized list. Removal drops the conversation, draft, pending requests and local read marker. Offline status settles output and pending writes. Explicit live typing survives an ordinary roster refresh; an idle roster can clear a busy handshake snapshot when no live turn was observed.
- Drop unknown event types; reject malformed / non-http attachment URLs.
- Reconnect with backoff; treat close codes `1008` / `4401` / `4403` as auth/access failures (no retry).
- Heartbeats send `ping` every 25 seconds and require `pong` within 10 seconds. Stale callbacks and request timers cannot act on replacement sockets.

Socket URL: `{base}/api/zakurabot/ws` (http→ws, https→wss; path prefixes retained).

### Delivery, replay and interrupt

The server persists user echoes and `chat_reply` posts before delivery. It replays each authorized conversation’s latest 100 messages after `ready`, using stable ids. Live events can interleave with history. Typing/tool activity is live only; the current server emits complete `chat_reply` snapshots rather than token deltas.

A socket write is **pending delivery**, not evidence of an agent turn. The composer disables repeated sends while awaiting the echo and still accepts the next draft. A duplicate `clientMessageId` may produce only a user echo, without a new typing pulse. The client must clear pending state without inventing a running turn. New activity or explicit typing controls the Stop button.

Unconfirmed writes become manually retryable after 15 seconds or disconnect; reconnect never automatically resends. Retry keeps the original id and body. The live client remembers the body across reconnects, rejects changed text under that id, validates receipt text, and reuses an already accepted receipt. Late rejection cannot fail an accepted message. The server also deduplicates by authenticated conversation and id.

Message upserts retain optimistic ids and resolve `reply_to` through server/client aliases within the same conversation. Missing quote targets show “Reply to earlier message”. An in-memory read watermark keeps older backfill from making an already-read conversation unread, while new tokens in a known stream still mark it unread after the user leaves. No persistent client history, replay cursor, read receipts or turn ids are implemented.

Interrupt is one outstanding request per agent. The UI shows “Stopping reply” until `typing: false`, refusal, or a 15-second timeout. The current v1 gateway sends uncorrelated agent errors for interrupt refusals; while an interrupt is outstanding (including a late refusal after timeout), the client treats an omitted `turnEnded` as false. Explicit `turnEnded: true` remains terminal. Timeout/refusal restores Stop and preserves output and drafts. Removing an agent, going offline or disconnecting clears its interrupt timer.

Received workspace attachments are signed HTTP(S) download links (currently valid for 60 minutes; up to 8 files, 16 MB each on the reference server). The app displays links, including card images. Uploads remain unavailable: file drag/drop and file-only paste are blocked with an inline explanation so a browser drop cannot replace the page and discard drafts.

### Reference server limitation

Checked against `Moonrend/Zakura@8c5ae1a`. The reference `ZakurabotChannel.subscribe` cleanup is not idempotent: calling an old unsubscribe again after a replacement subscription can delete the replacement from the subscriber map. Reproduction: subscribe A → unsubscribe A → subscribe B → unsubscribe A again; B disappears. `ZakurabotGateway` can call cleanup from both its failure and close paths. A rapid reconnect during history catch-up can therefore retain roster/heartbeat traffic while losing live posts. The service needs idempotent cleanup (or a check that the map still owns the captured listener set). The Zakura checkout is read-only for this change; this issue belongs in that repository.

## App structure (this repo)

| Path | Purpose |
| --- | --- |
| `app/` | Expo Router screens (`index` shell, `settings` modal) |
| `components/` | Sidebar (search / unread), chat pane, bubbles, activity chips, composer |
| `lib/channel/` | Client interface, mock, live WS, protocol decoder |
| `lib/chat-state.ts` | Pure reducer for messages / unread / connection |
| `lib/store.tsx` | React store wiring channel → UI |
| `lib/settings.ts` | AsyncStorage persistence for URL + token (SecureStore is not wired) |
| `docs/architecture.md` | This document |
| `tests/` | Node unit tests for protocol, live client, chat state |

## UI event surface

`ZakuraChannelClient` events the UI understands:

- `connection` — disconnected / connecting / connected / error
- `agents` — complete roster replacement
- `message` — full message upsert (user, system)
- `message` via mapped `chat_reply` — assistant text / card / attachments
- `message_delta` / `message_done` — streaming assistant text
- `tool_activity` — chip updates
- `typing` — busy indicator
- `interrupt_pending` — local Stop request state (not a server frame)
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
| Platform `zakurabot` adapter in Zakura | **Implemented in the reference server checkout** |
| Real WS / persistent server sessions | **Local integration uses Zakura’s test fixture with a controlled runtime; see the reconnect limitation above** |
| Deployed model / device integration | **Requires a configured server and device token; not exercised here** |
| Computer pane / voice / App Store | **Out of scope** |

## UX references (contracts only)

Studied for layout/interaction contracts; **no proprietary blobs vendored**:

- [b-nnett/grok-bot-0.18-reconstructed](https://github.com/b-nnett/grok-bot-0.18-reconstructed) `frontend/` — sidebar / transcript / composer evidence
- [aivsomkar/OpenGrokBot](https://github.com/aivsomkar/OpenGrokBot) — open React chat with SSE, tool chips, dark palette
