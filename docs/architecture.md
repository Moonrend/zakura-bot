# Zakura Bot architecture

Zakura Bot is an Expo / React Native client for Zakura. The server owns sessions, execution, message history, queueing and context compaction. The client owns navigation, drafts, display state and reconnects.

## Connection and identity

Sign in uses Zakura's public OAuth client registration and authorization-code flow with PKCE. Web login opens a popup; native login uses the system browser. Tokens live in SecureStore on native and sessionStorage on web. Ordinary preferences contain account metadata and appearance, never token values. Old plaintext settings are migrated when loaded.

The WebSocket URL is `{instance}/api/zakurabot/ws`, preserving any instance path prefix and converting HTTP(S) to WS(S). Credentials are sent in `hello`, never in a URL. Base URLs reject credentials, queries and fragments. Account changes clear the old conversation state; appearance changes preserve the connection, messages and drafts.

An authorized bot has an internal channel binding. The Go server isolates its thread by tenant, user, binding and agent. The first message creates the session automatically. The client has no Start / Stop session / New session or manual compaction workflow. Composer Stop interrupts the current run; the server may continue with queued messages.

## Message ownership

The server stores user text separately from its context wrapper:

```json
{
  "messageId": "client-id",
  "content": "Read this file",
  "context": {
    "prefix": "[Zakura Bot message]\nSender: ...",
    "suffix": "[Reply delivery]\n..."
  }
}
```

Zakura's web timeline displays `content` and reveals the wrapper on message expansion. Model input receives prefix, content and suffix in order. These wrappers remain user-role context; they do not become privileged system messages. Queueing, retry and history replay preserve the wrapper.

The runtime exposes `chat_reply({ text })` to send a separate Markdown message. Each successful send writes both a `bot_message` event and a durable `chat_reply` frame in one transaction. Zakura displays the event as a bot bubble. If the run did not call `chat_reply`, its final answer is delivered automatically. Intermediate model text is never forwarded directly by the client. The Go tool currently accepts text; the client retains compatibility with richer cards, actions and attachment frames from other protocol-v1 servers.

The runtime summarizes older context automatically, preserving complete tool call/result groups and the latest work. Oversized summary requests are split and summarized in smaller pieces. Saved summaries are tied to their conversation branch. The client does not trigger or expose this maintenance.

## WebSocket v1

Client frames:

- `hello { protocol: 1, token, client: { name, version } }`
- `send { agentId, clientMessageId, text, attachments?: [{ fileId }] }`
- `interrupt { agentId, requestId? }`
- `ping`

Server frames:

- `ready { protocol: 1, agents, capabilities }`, then `agents` roster updates.
- `message { message }`: durable user echo, including `clientMessageId` and public attachment metadata.
- `chat_reply { agentId, messageId, createdAt, payload: { text, format } }`: assistant bubble.
- `typing { agentId, active }`: current execution state.
- `interrupt_ack { agentId, requestId? }`: Stop was handled; echoes the request id when provided. Queued work may still be running.
- `error { message, agentId?, clientMessageId?, fatal?, turnEnded? }`.
- `pong`.

The decoder also supports optional `message_delta`, `message_done`, `tool_activity`, rich cards and actions. Streaming deltas are accepted only after a streaming `chat_reply` announcement. The Go server currently delivers complete replies.

A `message_done` frame finishes one reply, not the entire turn. A run may send multiple bot messages. Typing or a correlated terminal error controls turn completion. Tool names, arguments and output do not become transcript rows; live work appears as a small temporary activity indicator.

## Delivery and recovery

User admission and its receipt are committed together. Replies are saved independently of any socket. On reconnect, the server replays the latest 100 frames, then follows new frames by sequence. Stable ids let the client merge history and live messages without duplicate bubbles. REST history provides earlier messages.

A send remains pending until its user echo arrives. A retry reuses the original id, text and attachment identities. The server rejects changed content under the same id and replays an accepted receipt without starting another run, even after an uploaded file has been removed. New messages still require valid files. The client retains receipt aliases across reconnect, checks conflicts before accepting them and keeps delivery failures separate from run failures. Durable run failures carry their original `clientMessageId`, so replay cannot stop a newer message's turn.

Reconnect uses exponential backoff and heartbeat checks. Authentication and protocol failures stop automatic retry; temporary server and network failures may reconnect. Reconnecting itself never resends unconfirmed user messages. The offline queue and explicit retry preserve the original identity when they send.

Stop has one pending request per bot. It settles on `interrupt_ack`, execution completion, refusal or timeout; acknowledgement clears only the pending request, so queued replies keep their activity state. It preserves received text and the next draft. Incoming history cannot reopen a completed stream or tool activity. Roster removal prunes inaccessible messages, drafts and pending work.

## Files and permissions

Uploads use the authenticated bot file endpoint. A send carries only uploaded file ids. The server resolves each file under the same tenant, user, binding and agent before adding its workspace path to model input. Receipt frames contain download URLs and display metadata, never workspace paths. Up to ten attachments may be referenced per server message.

Links and Markdown destinations are validated before opening. Raw HTML remains text. Account permissions apply to agent management, files, desktop and interactions. Required approval/question cards remain actionable and separate from hidden tool output.

## UI behavior

The layout follows the Grokbot references: a narrow conversation list, message bubbles, compact header controls and a composer at the bottom. Settings offers accounts, spaces and immediately saved appearance choices. Healthy chat has no connection instructions or session controls. Failures retain concise recovery actions.

Web theme variables are applied at the document root so static HTML cannot override theme changes. Focus returns to the prior control after navigation or to the transcript when that control disappeared. Reading history or selecting text pauses automatic following; Jump to latest resumes it. Mobile layout follows the visual viewport to keep the composer above the keyboard.

## Source map

| Path | Responsibility |
| --- | --- |
| `app/` | Screens and routing |
| `components/` | Sidebar, chat, composer, details and settings controls |
| `lib/channel/` | Mock/live clients and protocol validation |
| `lib/chat-state.ts` | Transcript, receipts, activity and error reduction |
| `lib/store.tsx` | Accounts, channel lifecycle, drafts and application state |
| `lib/settings.ts` | Preferences and secure credentials |
| `tests/` | Protocol, recovery, state and browser regressions |

Server integration lives in `apps/server/internal/runtime/zakurabot_ws.go`, `bot_messages.go`, `bot_attachments.go`, `message_context.go` and `context_compaction.go` in Zakura.

UI references: [Grokbot reconstruction](https://github.com/b-nnett/grok-bot-0.18-reconstructed) and the screenshots listed in [ux-grokbot.md](ux-grokbot.md). No proprietary assets are copied.
