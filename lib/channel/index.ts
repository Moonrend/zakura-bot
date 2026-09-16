export type {
  ChannelConnectionState,
  ChannelEvent,
  ChannelListener,
  SendMessageInput,
  ZakuraChannelClient,
} from "./types";
export { uid } from "./types";
export { MockZakuraChannelClient, createDemoMessages } from "./mock-client";
export {
  LiveZakuraChannelClient,
  validateLiveSettings,
  zakuraSocketUrl,
  type LiveClientOptions,
} from "./live-client";

import type { AppSettings } from "../types";
import type { ZakuraChannelClient } from "./types";
import { MockZakuraChannelClient } from "./mock-client";
import { LiveZakuraChannelClient } from "./live-client";

/** Pick a transport from persisted settings. */
export function createChannelClient(settings: AppSettings): ZakuraChannelClient {
  if (settings.useMockChannel) return new MockZakuraChannelClient();
  return new LiveZakuraChannelClient({
    baseUrl: settings.zakuraBaseUrl,
    token: settings.authToken,
  });
}
