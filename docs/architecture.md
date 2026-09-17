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
- `message` — user echo / system only (never assistant mirror text); only user echoes carry client receipt aliases
- `tool_activity` — chip updates
- `typing` — busy indicator
- `error` `{ message, agentId?, clientMessageId?, fatal?, turnEnded? }` — `turnEnded` is an optional extension; the current reference gateway omits it
- `pong`

Live client rules:

- Ignore data frames until authenticated `ready`.
- Decoder validation errors retain the frame type and a validated agent id from the appropriate envelope. Invalid conversation payloads follow the same authentication/roster gate as valid data and report errors only in that conversation. They never carry receipt correlation or confirm pending delivery. Handshake, unreadable JSON and frame-size errors remain channel-wide; unrelated `agentId` fields cannot scope a roster/handshake error.
- Accept `message_delta` / `message_done` only for message ids announced by a streaming `chat_reply`. Duplicate announcements cannot erase tokens or reopen a completed reply, even after reconnect. Disconnect settles output but retains reply/tool lifecycle records until roster removal. With no stream cursor to distinguish replayed tokens, only a full, non-streaming snapshot can restore an old interrupted reply; new ids can stream normally.
- `message_done` finishes one reply. Only a turn-ending signal finishes the whole turn, which may contain several `chat_reply` calls. Completed/stopped tools cannot be reopened by replayed start events.
- Roster updates contain the complete authorized list. Removal drops the conversation, draft, pending requests and local read marker. Offline status settles output and pending writes. Explicit live typing survives an ordinary roster refresh; an idle roster can clear a busy handshake snapshot when no live turn was observed.
- Drop unknown event types; reject malformed / non-http attachment URLs. Normalize accepted attachment, card, action and Markdown links to absolute URLs before rendering/opening them. A URL such as `https:files.example.com/report.pdf` must use the validated host, rather than resolve against the app's origin; signed query strings are preserved.
- Omit visually empty card decoration without dropping the post's usable text, attachments or actions. Card fields are still validated, and a wholly blank reply is rejected.
- Reconnect with backoff; treat close codes `1008` / `4401` / `4403` as auth/access failures (no retry).
- Check the `ready` protocol version before decoding its roster. An unsupported version is terminal even if it uses a different roster schema.
- Heartbeats send `ping` every 25 seconds and require `pong` within 10 seconds. Stale callbacks and request timers cannot act on replacement sockets. A socket error immediately cancels handshake, heartbeat, delivery and interrupt deadlines while retaining the close handler for up to one second to receive an auth/policy code. Failed writes and expired handshake, pong, delivery or Stop deadlines use the same grace period when the browser already exposes a closing/closed socket before dispatching its close event, even without a preceding error event. If that event never arrives, the client releases the socket and starts its normal backoff; it never automatically resends.
- Browser offline events immediately settle the connection and cancel heartbeat, delivery, interrupt and reconnect timers. Online events start a fresh handshake, retaining idempotency keys without resending. An initially offline browser waits for connectivity. Terminal failures and explicit disconnect remove network listeners; coming online cannot revive them. Native clients continue to use socket events and heartbeat liveness.

Socket URL: `{base}/api/zakurabot/ws` (http→ws, https→wss; path prefixes retained). Base URLs reject credentials, queries and fragments, including empty `?` / `#` delimiters, before attempting a connection.

### Delivery, replay and interrupt

The server persists user echoes and `chat_reply` posts before delivery. It replays each authorized conversation’s latest 100 messages after `ready`, using stable ids. Live events can interleave with history. Typing/tool activity is live only; the current server emits complete `chat_reply` snapshots rather than token deltas.

A socket write is **pending delivery**, not evidence of an agent turn. The composer disables repeated sends while awaiting the echo and still accepts the next draft. A duplicate `clientMessageId` may produce only a user echo, without a new typing pulse. The client must clear pending state without inventing a running turn. New activity or explicit typing controls the Stop button.

Unconfirmed writes become manually retryable after 15 seconds or disconnect; reconnect never automatically resends. Retry keeps the original id and body. Automatic and manual reconnect reuse the live client and its body/server/client id mapping; settings changes create a new client. It rejects changed text or conflicting receipt ids and reuses an already accepted receipt. Replays may omit a previously mapped `clientMessageId`; the client restores it before validating and delivering the receipt. User receipts follow the server's nonempty 4000-character text limit. Receipt aliases are isolated by agent and cleared on roster removal. Late rejection cannot fail an accepted message. The server also deduplicates by authenticated conversation and id.

Delivery and turn failure are independent. An explicit `turnEnded: true` error must include `agentId`; when it also carries `clientMessageId`, only the latest user message in transcript order can end current output or clear its pending Stop request. A delivered message stays delivered even when its run fails, and replaying its receipt cannot dismiss the run error. Older unconfirmed writes can still become retryable without ending newer work. The reducer independently downgrades those older failures to delivery errors, so a late receipt can clear them. The store passes its optimistic timestamp as the local-only `SendMessageInput.localCreatedAt`; it is never serialized into a `send` frame. The transport stably sorts its user records after each upsert, matching the reducer when a receipt replaces the local clock or ties a timestamp from interleaved backfill.

Message upserts retain optimistic ids and resolve `reply_to` through server/client aliases within the same conversation. User message bodies and known receipt aliases remain immutable in the reducer, including history received from a replacement client. A conflicting receipt cannot attach another message's server id or confirm its pending send. A replay using a known server id as its fallback correlation preserves the original client alias. Missing quote targets show “Reply to earlier message”. An in-memory read watermark keeps older backfill from making an already-read conversation unread, while new tokens in a known stream still mark it unread after the user leaves. No persistent client history, replay cursor, read receipts or turn ids are implemented.

Errors are deduplicated by agent, message correlation and whether they end a turn. A late delivery failure cannot replace a separate run failure; clearing the newest error reveals the previous unresolved one. Retrying a failed message clears only its delivery error, since the server may return only a receipt without starting another run. Run errors survive that retry and receipt. Dismissal clears the displayed error; sending a new message clears the conversation's previous errors.

The live client also retains reply, tool and system-notice identities across reconnect. It validates both receipt ids before clearing a pending write or caching an echo. An id conflict therefore leaves the delivery timeout and manual retry available. Conflicting output cannot reserve a user alias, announce a stream or start invisible tool work that blocks Stop recovery. Replayed starts for settled tools are also ignored before they can interfere with an idle roster confirming Stop. These identities are scoped to an agent and cleared when its roster access is removed. The reducer independently preserves settled reply text if a replacement client replays a stream announcement.

Message rows and date separators use distinct React key prefixes, so channel ids such as `day_anchor` cannot duplicate bubbles when timestamp updates reorder history. When a focused Retry, suggestion or error control disappears, focus returns to the transcript without scrolling; a draft that already has focus keeps it. This includes suggestions removed by an offline roster, errors cleared by a late receipt, and manual reconnect. With no selected agent, the channel setup region provides the focus target.

Removing a focused sidebar row through roster revocation or a changed search match restores focus to the agent list. Revoking the selected conversation restores focus to the replacement transcript or channel setup region, while revoked drafts are pruned. The shared removal hook waits for React to attach replacement refs and only restores focus if the old node is detached and no other control has taken focus. It therefore also preserves drawer dismissal and unread-filter navigation.

Sidebar search and unread filters live with the screen, so desktop/mobile transitions and drawer reopening retain them. The same removal hook moves focus from a disappearing sidebar to the new desktop list or mobile menu button. Resizing while drafting preserves the composer's focus.

The same removal hook restores transcript focus when a focused Jump to latest button disappears after scrolling to the bottom, including wheel scrolling without activating the button. Changes to the system's reduced-motion setting update subsequent scroll animation without resetting the selected conversation's reading position or moving draft focus.

Expanding tool details pauses automatic scrolling so the chip and the beginning of its output remain in view as new replies arrive. Short details that still fit near the end keep following new output. Collapsing details restores following when it brings the end back into view; scrolling to the end or Jump to latest also resumes it without changing the draft.

Interrupt is one outstanding request per agent. The UI shows “Stopping reply” until `typing: false`, refusal, or a 15-second timeout. An idle roster also confirms Stop when no explicit typing, stream or running tool is active on the current socket: a turn can finish between the busy `ready` snapshot and the live subscription. Roster confirmation clears the request timer and preserves the next draft. The current v1 gateway sends uncorrelated agent errors for interrupt refusals; the client treats an omitted `turnEnded` as false. An explicit `turnEnded: true` ends the turn subject to the message correlation rules above. Timeout/refusal restores Stop and preserves output and drafts. Removing an agent, going offline or disconnecting clears its interrupt timer.

Before writing an interrupt frame, the client also checks that the exact pending request still exists. A progress listener that observes completion, offline status or roster revocation cannot send the cancelled Stop into a subsequent turn.

Received workspace attachments are signed HTTP(S) download links (currently valid for 60 minutes; up to 8 files, 16 MB each on the reference server). The app displays links, including card images; blank attachment names and image descriptions fall back to a filename or “Open image”. Cards containing only links/media omit the empty body panel. Uploads remain unavailable: file drag/drop and file-only paste are blocked with an inline explanation so a browser drop cannot replace the page and discard drafts.

Standalone file, image and action links use the entire padded control as the link target, with a minimum height of 44px. Actions preserve `primary` / `danger` styles. Web controls remain real anchors with safe new-tab attributes, so keyboard activation and clicks in the padding open the same normalized URL. Inline Markdown links retain their inline layout.

The selectable Markdown subset uses a line-based fence parser. A closing fence must use the opening character, be at least as long, and occupy its own line; code strings and shorter fences remain verbatim. Unterminated code blocks stay formatted as chunks arrive. Backtick and tilde fences support up to three spaces of indentation, and Markdown line endings normalize CRLF/CR. Inline code matches whole backtick runs of equal length across soft line breaks, preserving embedded runs and link syntax as code; completed code spans normalize those breaks to spaces. Matching runs are indexed once per paragraph so unmatched runs do not repeatedly scan long streams. In the arriving paragraph, unfinished inline-code spans remain literal until the delimiter closes; receiving a newline cannot activate their links. Blank lines and fenced blocks end that paragraph's inline parsing. List markers are rendered only after identifying code spans. Inline HTTP(S) links keep balanced and escaped URL parentheses; incomplete destinations remain literal. Raw replies bypass Markdown parsing, and HTML remains text.

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
