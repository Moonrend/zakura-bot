import { LiveZakuraChannelClient, type LiveClientOptions } from "../lib/channel/live-client";
import type { ChannelEvent } from "../lib/channel/types";

export const agents = [
  { id: "a", name: "Zakura", status: "idle" as const, color: "#1084fe", unread: false },
  { id: "b", name: "Research", status: "idle" as const, color: "#38d591", unread: false },
];

export function liveHarness(options: Partial<LiveClientOptions> = {}) {
  const sockets: Socket[] = [];
  class Socket {
    readyState = 0;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: ((event: { code: number; reason?: string }) => void) | null = null;
    sent: Record<string, unknown>[] = [];
    throwOnSend = false;
    constructor(readonly url: string) { sockets.push(this); }
    open() { this.readyState = 1; this.onopen?.(); }
    frame(value: unknown) { this.raw(JSON.stringify(value)); }
    raw(data: unknown) { this.onmessage?.({ data }); }
    send(data: string) {
      if (this.throwOnSend) throw new Error("Fake socket write failure");
      this.sent.push(JSON.parse(data));
    }
    close() { this.readyState = 3; }
    remoteClose(code: number) { this.readyState = 3; this.onclose?.({ code }); }
    ready() { this.frame({ type: "ready", protocol: 1, agents }); }
  }
  const events: ChannelEvent[] = [];
  const client = new LiveZakuraChannelClient({ baseUrl: "https://zakura.example.com/prefix/", token: "test-token",
    heartbeatMs: 0, ...options, WebSocketImpl: Socket as unknown as typeof WebSocket });
  client.subscribe((event) => events.push(event));
  return { client, sockets, events };
}
