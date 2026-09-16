/**
 * In-memory mock of ZakuraChannelClient.
 * Plays a demo conversation on connect and streams fake replies on send.
 */

import type { ChatMessage } from "../types";
import type {
  ChannelConnectionState,
  ChannelListener,
  SendMessageInput,
  ZakuraChannelClient,
} from "./types";

function uid(prefix = "msg"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class MockZakuraChannelClient implements ZakuraChannelClient {
  private state: ChannelConnectionState = "disconnected";
  private listeners = new Set<ChannelListener>();
  private aborted = new Set<string>();

  getConnectionState(): ChannelConnectionState {
    return this.state;
  }

  subscribe(listener: ChannelListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(...events: Parameters<ChannelListener>[0][]): void {
    for (const event of events) {
      for (const l of this.listeners) l(event);
    }
  }

  async connect(): Promise<void> {
    this.state = "connecting";
    this.emit({ type: "connection", state: "connecting" });
    await sleep(250);
    this.state = "connected";
    this.emit({ type: "connection", state: "connected" });
    // Demo transcript for the first agent is seeded by the store; optional nudge:
    this.emit({
      type: "typing",
      agentId: "agent_zakura",
      active: false,
    });
  }

  disconnect(): void {
    this.state = "disconnected";
    this.emit({ type: "connection", state: "disconnected" });
  }

  async sendMessage(input: SendMessageInput): Promise<void> {
    if (this.state !== "connected") {
      this.emit({ type: "error", message: "Not connected to Zakura channel" });
      return;
    }

    const userMsg: ChatMessage = {
      id: input.clientMessageId ?? uid("user"),
      agentId: input.agentId,
      role: "user",
      kind: "text",
      text: input.text,
      createdAt: Date.now(),
    };
    this.emit({ type: "message", message: userMsg });

    this.aborted.delete(input.agentId);
    this.emit({ type: "typing", agentId: input.agentId, active: true });

    // Fake tool chip
    await sleep(400);
    if (this.aborted.has(input.agentId)) return;

    const toolId = uid("tool");
    const toolRunning: ChatMessage = {
      id: toolId,
      agentId: input.agentId,
      role: "assistant",
      kind: "activity",
      tool: { name: "chat_reply", ok: undefined, detail: "preparing reply" },
      createdAt: Date.now(),
    };
    this.emit({ type: "tool_activity", agentId: input.agentId, message: toolRunning });

    await sleep(600);
    if (this.aborted.has(input.agentId)) return;

    this.emit({
      type: "tool_activity",
      agentId: input.agentId,
      message: {
        ...toolRunning,
        tool: { name: "chat_reply", ok: true, detail: "sent" },
      },
    });

    // Stream assistant text
    const replyId = uid("asst");
    const full = mockReplyFor(input.text);
    this.emit({
      type: "message",
      message: {
        id: replyId,
        agentId: input.agentId,
        role: "assistant",
        kind: "text",
        text: "",
        createdAt: Date.now(),
        streaming: true,
      },
    });

    for (const chunk of chunkText(full, 12)) {
      if (this.aborted.has(input.agentId)) return;
      await sleep(35);
      this.emit({
        type: "message_delta",
        agentId: input.agentId,
        messageId: replyId,
        delta: chunk,
      });
    }

    this.emit({ type: "message_done", agentId: input.agentId, messageId: replyId });
    this.emit({ type: "typing", agentId: input.agentId, active: false });
  }

  async interrupt(agentId: string): Promise<void> {
    this.aborted.add(agentId);
    this.emit({ type: "typing", agentId, active: false });
  }
}

function chunkText(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

function mockReplyFor(userText: string): string {
  const t = userText.trim().toLowerCase();
  if (t.includes("hello") || t.includes("你好") || t.includes("hi")) {
    return "你好！我是 Zakura Bot 演示助手。当前走的是 MockZakuraChannelClient；接上真实 `zakurabot` 通道后，回复会来自 Zakura agent 的 chat_reply。";
  }
  if (t.includes("settings") || t.includes("设置")) {
    return "打开左下角设置，填写 Zakura Base URL 与 Auth Token。Phase 1 默认仍使用 mock 通道。";
  }
  return `收到：「${userText.slice(0, 200)}」\n\n这是 mock 流式回复。真正绑定后，Zakura 会在远程会话里调用 chat_reply，把可见消息推送到本客户端。`;
}

export function createDemoMessages(agentId: string): ChatMessage[] {
  const now = Date.now();
  return [
    {
      id: "demo_1",
      agentId,
      role: "assistant",
      kind: "text",
      text: "Welcome to Zakura Bot — a Grok Bot–inspired chat client for the Zakura platform.",
      createdAt: now - 120_000,
    },
    {
      id: "demo_2",
      agentId,
      role: "user",
      kind: "text",
      text: "How will this bind as a Zakura channel?",
      createdAt: now - 90_000,
    },
    {
      id: "demo_3",
      agentId,
      role: "assistant",
      kind: "activity",
      tool: { name: "remote_channel.lookup", ok: true, detail: "platform=zakurabot" },
      createdAt: now - 85_000,
    },
    {
      id: "demo_4",
      agentId,
      role: "assistant",
      kind: "text",
      text: "Moonrend/Zakura will add a Chat-SDK platform `zakurabot`. Agents reply with the `chat_reply` tool (text / cards / attachments). This app is the messaging surface — not a separate agent runtime. See docs/architecture.md.",
      createdAt: now - 80_000,
    },
    {
      id: "demo_5",
      agentId,
      role: "user",
      kind: "text",
      text: "Show me a tool chip while you think.",
      createdAt: now - 40_000,
    },
    {
      id: "demo_6",
      agentId,
      role: "assistant",
      kind: "activity",
      tool: { name: "chat_reply", ok: true },
      createdAt: now - 35_000,
    },
    {
      id: "demo_7",
      agentId,
      role: "assistant",
      kind: "text",
      text: "Tool-activity chips appear above bubbles while the agent works. Send a message below to try the mock stream.",
      createdAt: now - 30_000,
    },
  ];
}
