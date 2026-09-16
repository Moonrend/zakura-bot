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
│  Sidebar agents · Chat · Composer · Settings│
│                                             │
│  ZakuraChannelClient (interface)            │
│    └─ MockZakuraChannelClient (phase 1)     │
│    └─ LiveWsOrSseClient (future)            │
└──────────────────┬──────────────────────────┘
                   │  WS / SSE / HTTPS
                   ▼
┌─────────────────────────────────────────────┐
│  Moonrend/Zakura                            │
│  platform: zakurabot  (Chat SDK–style)      │
│                                             │
│  inbound:  user message → agent turn        │
│  outbound: agent tools                      │
│     • chat_reply  (primary visible reply)   │
│     • chat_start_typing / reactions / …     │
│  location context for remote sessions       │
└─────────────────────────────────────────────┘
```

## Binding as platform `zakurabot`

Planned work lands in **Moonrend/Zakura** (separate PR), not in this repo:

1. Register a Chat-SDK–compatible adapter factory for platform id **`zakurabot`** alongside existing remote platforms (`telegram`, `slack`, …) in `remote-channel-runtime`.
2. Device / token auth: the mobile/web client stores **Base URL + auth token** (Settings). Zakura validates the token and maps the device to a tenant + optional default agent.
3. Thread mapping: each Zakura Bot agent row ↔ Zakura agent / thread id (`zakurabot:<device>:<thread>` or similar).
4. Ingress: user composer → channel client → Zakura inbound message → agent turn with remote-channel tool surface.
5. Egress: agent calls **`chat_reply`** (possibly multiple times: ack → progress → final). The `zakurabot` adapter posts those payloads to the connected client as `message` / `message_delta` / attachment events.
6. Dashboard: Zakura admin UI documents how to enable the Zakura Bot binding (mirror Slack/Telegram binding UX).

Until that platform exists, this app keeps **`useMockChannel: true`** and drives UI from `MockZakuraChannelClient`.

### Why `chat_reply` matters

Zakura remote sessions instruct agents that **any user-visible text must call `chat_reply`**. Streaming assistant tokens alone do not appear on external channels. Zakura Bot must therefore:

- Treat `chat_reply` (and related tools) as the source of bubbles, cards, and attachments.
- Surface tool activity as **activity chips** while tools run.
- Optionally show typing via `chat_start_typing`.

## App structure (this repo)

| Path | Purpose |
| --- | --- |
| `app/` | Expo Router screens (`index` shell, `settings` modal) |
| `components/` | Sidebar, chat pane, bubbles, activity chip, composer |
| `lib/channel/` | `ZakuraChannelClient` interface + mock |
| `lib/store.tsx` | In-memory agents / messages / connection |
| `lib/settings.ts` | AsyncStorage persistence for URL + token |
| `docs/architecture.md` | This document |

## Transport contract (sketch)

`ZakuraChannelClient` events the UI already understands:

- `connection` — disconnected / connecting / connected / error  
- `message` — full message upsert (user, assistant, activity)  
- `message_delta` / `message_done` — streaming assistant text  
- `tool_activity` — chip updates  
- `typing` — busy indicator  

Live client (future) should map Zakura `chat_reply` frames onto these events so the UI stays stable.

## Phase 1 vs later

| Area | Phase 1 (this scaffold) | Later |
| --- | --- | --- |
| Channel | Mock + interface | WS/SSE to `zakurabot` |
| Agents | Demo roster | Synced from Zakura |
| Settings | URL + token stored locally | Device login / pairing |
| Computer pane | Out of scope | Optional screen preview |
| Voice | Out of scope | Mic / speech |
| App Store | Out of scope | Production release |

## UX references (contracts only)

Studied for layout/interaction contracts; **no proprietary blobs vendored**:

- [b-nnett/grok-bot-0.18-reconstructed](https://github.com/b-nnett/grok-bot-0.18-reconstructed) `frontend/` — sidebar / transcript / composer evidence  
- [aivsomkar/OpenGrokBot](https://github.com/aivsomkar/OpenGrokBot) — open React chat with SSE, tool chips, dark palette  
