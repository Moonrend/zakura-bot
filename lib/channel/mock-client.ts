/**
 * In-memory mock of ZakuraChannelClient.
 *
 * Exercises the optional streaming extension of the `zakurabot` contract:
 *   user message echo → typing → quiet Working… activity → streamed reply → done.
 *
 * Triggers for testing UI states:
 *   - text containing "fail"  → activity fails (pill disappears) and an error event is emitted
 *   - text containing "slow"  → longer stream (useful for testing Stop)
 */

import type { Agent, ChatMessage } from "../types";
import { attachmentReferences, isChannelId } from "./protocol";
import { attachmentIdentity, fileMessageText } from "../files";
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
  // Like the live channel, an accepted id returns only its original receipt.
  // Keep receipts through reconnect for this in-memory client instance.
  private receipts = new Map<string, ChatMessage>();

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
    const pending = sleep(250).then(() => {
      if (generation !== this.connectionGeneration) return;
      this.emitter.emit({ type: "agents", agents: DEMO_AGENTS });
      // Roster listeners can disconnect or start a replacement connection.
      // Never publish readiness, or clear that replacement's pending promise.
      if (generation !== this.connectionGeneration) return;
      this.connecting = null;
      this.setState("connected", "mock transport");
    });
    // Publish the pending attempt before notifying listeners of connecting.
    this.connecting = pending;
    this.setState("connecting");
    return pending;
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
    const text = fileMessageText(input.text, input.attachments);
    const files = attachmentReferences(input.attachments);
    if ((!text && !files.length) || text.length > MAX_MESSAGE_LENGTH) throw new Error("Message is empty or too long.");
    const clientMessageId = input.clientMessageId ?? uid("user");
    if (!isChannelId(clientMessageId)) throw new Error("Invalid message id.");
    const receiptKey = JSON.stringify([agentId, clientMessageId]);
    const receipt = this.receipts.get(receiptKey);
    if (receipt) {
      if (receipt.text !== text) throw new Error("A message id cannot be reused for different text. Send a new message instead.");
      if (attachmentIdentity(receipt.attachments) !== attachmentIdentity(input.attachments)) throw new Error("A message id cannot be reused for different attachments.");
      this.emitter.emit({ type: "message", message: receipt });
      return;
    }

    // Echo the user message back as the server would (ids are stable).
    const userMsg: ChatMessage = {
      id: clientMessageId,
      clientMessageId,
      agentId,
      role: "user",
      kind: "text",
      text,
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      createdAt: Date.now(),
    };
    this.receipts.set(receiptKey, userMsg);
    const connectionGeneration = this.connectionGeneration;
    this.emitter.emit({ type: "message", message: userMsg });
    if (connectionGeneration !== this.connectionGeneration || this.state !== "connected") return;

    // Start a new turn; any previous turn for this agent is cancelled.
    const previous = this.turns.get(agentId);
    if (previous) this.finishTurn(agentId, previous, true);
    const generation = ++this.generation;
    const turn: ActiveTurn = { generation };
    this.turns.set(agentId, turn);

    // Run the simulated turn without blocking the caller (matches a real
    // transport where send() resolves once the frame is written).
    void this.runTurn({ ...input, text }, turn);
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
        turnEnded: true,
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
      "周末可以从一条安静的街道开始。找家咖啡店坐一会儿，带上想读的书，不必排满行程。" +
      "下午沿河散步，挑一家没去过的小店，或者约朋友一起做晚饭。" +
      "如果天气不好，就留在家里听音乐，整理照片，让这一天慢下来。" +
      "\n\nThe stream will keep going for a few more seconds so you can try interrupting it. " +
      "Interrupted replies keep the text received so far and are marked as stopped."
    );
  }
  if (/\b(hello|hi|hey)\b/.test(t) || t.includes("你好")) {
    return "你好！有什么想聊的？";
  }
  if (t.includes("settings") || t.includes("设置")) {
    return "打开 Settings，选择 Add account，登录你的 Zakura 账户。";
  }
  if (t.includes("help") || t.includes("帮助")) {
    return "试试这些：\n• 发送包含 “slow” 的消息 → 长流式回复，测试 Stop\n• 发送包含 “fail” 的消息 → 错误横幅（不展示工具名）\n• 切换 agent 看未读小点与预览更新";
  }
  return `收到：「${userText.slice(0, 200)}」\n\n登录 Zakura 后，就可以和你的 bot 聊天。`;
}

export function createDemoMessages(agentId: string): ChatMessage[] {
  const now = Date.now();
  return [
    {
      id: "demo_1",
      agentId,
      role: "assistant",
      kind: "text",
      text: "Hi! What would you like to work on?",
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
      kind: "text",
      text: "Try sending a message. This conversation is a demo.",
      createdAt: now - 80_000,
    },
    {
      id: "demo_4",
      agentId,
      role: "user",
      kind: "text",
      text: "How do replies look while you work?",
      createdAt: now - 40_000,
    },
    {
      id: "demo_5",
      agentId,
      role: "assistant",
      kind: "text",
      text: "Replies appear as they're written. You can stop them at any time.",
      createdAt: now - 30_000,
    },
  ];
}
