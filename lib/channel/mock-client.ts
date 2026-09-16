/**
 * In-memory mock of ZakuraChannelClient.
 *
 * Simulates the event sequence the future `zakurabot` platform will produce:
 *   user message echo → typing → tool chip (chat_reply) → streamed reply → done.
 *
 * Triggers for testing UI states:
 *   - text containing "fail"  → the tool chip fails and an error event is emitted
 *   - text containing "slow"  → longer stream (useful for testing Stop)
 */

import type { Agent, ChatMessage } from "../types";
import {
  ChannelEmitter,
  MAX_MESSAGE_LENGTH,
  uid,
  type ChannelConnectionState,
  type ChannelListener,
  type SendMessageInput,
  type ZakuraChannelClient,
} from "./types";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface ActiveTurn {
  generation: number;
  replyId?: string;
  tool?: ChatMessage;
}

export const DEMO_AGENTS: Agent[] = [
  { id: "agent_zakura", name: "Zakura", title: "Platform agent", color: "#1084fe", status: "idle", unread: false },
  { id: "agent_research", name: "Research", title: "Briefs & digests", color: "#38d591", status: "idle", unread: true,
    preview: "Your research workspace is ready." },
  { id: "agent_ops", name: "Ops", title: "Routines", color: "#ff9800", status: "offline", unread: false },
];

export class MockZakuraChannelClient implements ZakuraChannelClient {
  readonly label = "Mock";
  private state: ChannelConnectionState = "disconnected";
  private emitter = new ChannelEmitter();
  /** One in-flight turn per agent; bumping `generation` cancels the old one. */
  private turns = new Map<string, ActiveTurn>();
  private generation = 0;
  private connectionGeneration = 0;
  private connecting: Promise<void> | null = null;

  getConnectionState(): ChannelConnectionState {
    return this.state;
  }

  subscribe(listener: ChannelListener): () => void {
    return this.emitter.subscribe(listener);
  }

  private setState(state: ChannelConnectionState, detail?: string) {
    this.state = state;
    this.emitter.emit({ type: "connection", state, detail });
  }

  async connect(): Promise<void> {
    if (this.state === "connected") return;
    if (this.connecting) return this.connecting;
    const generation = ++this.connectionGeneration;
    this.setState("connecting");
    this.connecting = sleep(250).then(() => {
      if (generation !== this.connectionGeneration) return;
      this.emitter.emit({ type: "agents", agents: DEMO_AGENTS });
      this.setState("connected", "mock transport");
      this.connecting = null;
    });
    return this.connecting;
  }

  disconnect(): void {
    this.connectionGeneration += 1;
    this.connecting = null;
    // Cancel every in-flight turn so no timers touch the store afterwards.
    for (const [agentId, turn] of this.turns) {
      this.finishTurn(agentId, turn, true);
    }
    this.turns.clear();
    this.setState("disconnected");
  }

  private isCurrent(agentId: string, generation: number): boolean {
    return this.turns.get(agentId)?.generation === generation;
  }

  private finishTurn(agentId: string, turn: ActiveTurn, interrupted: boolean) {
    if (turn.tool?.tool?.ok === undefined && turn.tool?.tool) {
      this.emitter.emit({ type: "tool_activity", agentId, message: { ...turn.tool,
        tool: { ...turn.tool.tool, interrupted: true, detail: "Stopped" } } });
    }
    if (turn.replyId) {
      this.emitter.emit({
        type: "message_done",
        agentId,
        messageId: turn.replyId,
        interrupted,
      });
    }
    this.emitter.emit({ type: "typing", agentId, active: false });
  }

  async sendMessage(input: SendMessageInput): Promise<void> {
    if (this.state !== "connected") {
      throw new Error("Not connected to Zakura channel");
    }
    const { agentId } = input;
    if (!DEMO_AGENTS.some((agent) => agent.id === agentId && agent.status !== "offline")) {
      throw new Error("This agent is offline. Choose an available agent.");
    }
    if (!input.text.trim() || input.text.length > MAX_MESSAGE_LENGTH) throw new Error("Message is empty or too long.");

    // Echo the user message back as the server would (ids are stable).
    const userMsg: ChatMessage = {
      id: input.clientMessageId ?? uid("user"),
      agentId,
      role: "user",
      kind: "text",
      text: input.text,
      createdAt: Date.now(),
    };
    this.emitter.emit({ type: "message", message: userMsg });

    // Start a new turn; any previous turn for this agent is cancelled.
    const previous = this.turns.get(agentId);
    if (previous) this.finishTurn(agentId, previous, true);
    const generation = ++this.generation;
    const turn: ActiveTurn = { generation };
    this.turns.set(agentId, turn);

    // Run the simulated turn without blocking the caller (matches a real
    // transport where send() resolves once the frame is written).
    void this.runTurn(input, turn);
  }

  private async runTurn(input: SendMessageInput, turn: ActiveTurn): Promise<void> {
    const { agentId, text } = input;
    const { generation } = turn;
    const lower = text.toLowerCase();
    const shouldFail = lower.includes("fail");
    const slow = lower.includes("slow");

    this.emitter.emit({ type: "typing", agentId, active: true });

    await sleep(400);
    if (!this.isCurrent(agentId, generation)) return;

    const toolId = uid("tool");
    const toolRunning: ChatMessage = {
      id: toolId,
      agentId,
      role: "assistant",
      kind: "activity",
      tool: { name: "chat_reply", ok: undefined, detail: "composing reply" },
      createdAt: Date.now(),
    };
    turn.tool = toolRunning;
    this.emitter.emit({ type: "tool_activity", agentId, message: toolRunning });

    await sleep(600);
    if (!this.isCurrent(agentId, generation)) return;

    if (shouldFail) {
      turn.tool = { ...toolRunning, tool: { name: "chat_reply", ok: false, detail: "Reply could not be delivered (demo)" } };
      this.emitter.emit({
        type: "tool_activity",
        agentId,
        message: turn.tool,
      });
      this.emitter.emit({
        type: "error",
        agentId,
        message: "Demo reply failed. Send another message without “fail” to try again.",
      });
      this.turns.delete(agentId);
      this.finishTurn(agentId, turn, false);
      return;
    }

    const replyId = uid("asst");
    turn.replyId = replyId;
    const full = mockReplyFor(text, slow);
    this.emitter.emit({
      type: "message",
      message: {
        id: replyId,
        agentId,
        role: "assistant",
        kind: "text",
        text: "",
        createdAt: Date.now(),
        streaming: true,
      },
    });

    for (const chunk of chunkText(full, slow ? 6 : 12)) {
      await sleep(slow ? 60 : 35);
      if (!this.isCurrent(agentId, generation)) return;
      this.emitter.emit({ type: "message_delta", agentId, messageId: replyId, delta: chunk });
    }

    turn.tool = { ...toolRunning, tool: { name: "chat_reply", ok: true, detail: "Delivered" } };
    this.emitter.emit({ type: "tool_activity", agentId, message: turn.tool });
    this.turns.delete(agentId);
    this.finishTurn(agentId, turn, false);
  }

  async interrupt(agentId: string): Promise<void> {
    const turn = this.turns.get(agentId);
    if (!turn) return;
    this.turns.delete(agentId);
    this.finishTurn(agentId, turn, true);
  }
}

function chunkText(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

function mockReplyFor(userText: string, slow: boolean): string {
  const t = userText.trim().toLowerCase();
  if (slow) {
    return (
      "这是一条较长的模拟回复，用来测试 Stop 按钮与流式渲染。" +
      "Zakura 远程会话里，agent 每次对用户可见的输出都必须调用 `chat_reply`；" +
      "本客户端把这些调用渲染为气泡，把工具运行过程渲染为 activity chip。" +
      "你可以随时点击右侧的停止按钮中断本轮回复。" +
      "\n\nThe stream will keep going for a few more seconds so you can try interrupting it. " +
      "Interrupted replies keep the text received so far and are marked as stopped."
    );
  }
  if (/\b(hello|hi|hey)\b/.test(t) || t.includes("你好")) {
    return "你好！我是 Zakura Bot 演示助手。当前走的是 `MockZakuraChannelClient`；接上真实 `zakurabot` 通道后，回复会来自 Zakura agent 的 `chat_reply`。";
  }
  if (t.includes("settings") || t.includes("设置")) {
    return "打开左下角 Settings，填写 Zakura Base URL 与 Auth Token，然后关闭「Use mock channel」。在 Zakura 侧的 `zakurabot` 平台落地前，Live 模式会显示连接错误并自动重试。";
  }
  if (t.includes("help") || t.includes("帮助")) {
    return "试试这些：\n• 发送包含 “slow” 的消息 → 长流式回复，测试 Stop\n• 发送包含 “fail” 的消息 → 工具失败态与错误横幅\n• 切换 agent 看未读小点与预览更新";
  }
  return `收到：「${userText.slice(0, 200)}」\n\n这是 mock 流式回复。真正绑定后，Zakura 会在远程会话里调用 \`chat_reply\`，把可见消息推送到本客户端。`;
}

export function createDemoMessages(agentId: string): ChatMessage[] {
  const now = Date.now();
  return [
    {
      id: "demo_1",
      agentId,
      role: "assistant",
      kind: "text",
      text: "Welcome to Zakura Bot. Your agents and conversations, in one place.",
      createdAt: now - 120_000,
    },
    {
      id: "demo_2",
      agentId,
      role: "user",
      kind: "text",
      text: "What can I try here?",
      createdAt: now - 90_000,
    },
    {
      id: "demo_3",
      agentId,
      role: "assistant",
      kind: "activity",
      tool: { name: "workspace.search", ok: true, detail: "Checked the demo workspace" },
      createdAt: now - 85_000,
    },
    {
      id: "demo_4",
      agentId,
      role: "assistant",
      kind: "text",
      text: "You're in **demo mode**. Try a conversation, switch between agents, and watch replies arrive. You can configure a live connection in Settings when your server supports it.",
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
      text: "Send a message below to try a streaming reply. Include **slow** to try Stop, or **fail** to see how errors appear. Click a tool chip to see its details.",
      createdAt: now - 30_000,
    },
  ];
}
