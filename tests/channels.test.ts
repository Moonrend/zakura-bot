import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildChannelRows, buildCredentialPayload, channelStateLabel, connectorForPlatform, credentialHint,
  KEEP_CREDENTIAL, missingCredentialFields, missingRequiredCredentials, parseConnectors, parseRemoteChannels,
  platformConnectorRef, remoteChannelPath, remoteChannelsPath, webhookUrlFor,
  type ConnectorField, type ConnectorSummary, type RemoteBindingView,
} from "../lib/channels.js";

const fields: ConnectorField[] = [
  { key: "botToken", label: "Bot Token", type: "secret", required: true },
  { key: "signingSecret", label: "Signing Secret", type: "secret", required: true },
  { key: "userName", label: "Bot name", type: "text" },
];

function binding(overrides: Partial<RemoteBindingView> = {}): RemoteBindingView {
  return {
    id: "b1", agentId: "a1", platform: "slack", profileKey: "remote-slack", label: "Slack",
    enabled: true, settings: {}, credentialsEnabled: true,
    configuredFields: ["botToken", "signingSecret"], createdAt: "", updatedAt: "", ...overrides,
  };
}

const slackConnector: ConnectorSummary = {
  ref: "remote-slack", name: "Slack",
  auth: { kind: "custom", profile: "remote-slack", fields, docsUrl: "https://chat-sdk.dev/adapters/official/slack" },
};

test("channel paths encode ids", () => {
  assert.equal(remoteChannelsPath(), "/api/remote-channels");
  assert.equal(remoteChannelPath("id 1/../two"), "/api/remote-channels/id%201%2F..%2Ftwo");
  assert.equal(platformConnectorRef("slack"), "remote-slack");
});

test("remote channel payloads parse and reject malformed snapshots", () => {
  const snapshot = parseRemoteChannels({
    platforms: ["slack", "discord"], initialized: true, webhookBaseUrl: "https://z/api/remote-channels/t1",
    bindings: [{ id: "b1", agentId: "a1", platform: "slack", enabled: true, configuredFields: ["botToken", 7],
      settings: { allowAll: true, allowedUsers: ["u1", 3], model: "gpt" } }],
  });
  assert.deepEqual(snapshot.platforms, ["slack", "discord"]);
  assert.equal(snapshot.initialized, true);
  const [row] = snapshot.bindings;
  assert.equal(row.label, "");
  assert.equal(row.credentialsEnabled, false);
  assert.deepEqual(row.configuredFields, ["botToken"]);
  assert.deepEqual(row.settings, { allowAll: true, allowedUsers: ["u1"], model: "gpt" });
  assert.throws(() => parseRemoteChannels({ bindings: "nope" }));
  assert.throws(() => parseRemoteChannels({ bindings: [{ id: "b1", platform: "slack" }] }));
});

test("connector payloads expose auth fields and options", () => {
  const connectors = parseConnectors({ connectors: [
    { ref: "remote-telegram", name: "Telegram", auth: { kind: "custom", fields: [
      { key: "botToken", label: "Bot Token", type: "secret", required: true },
      { key: "mode", label: "Mode", type: "select", options: [{ value: "webhook", label: "Webhook" }, { value: "polling" }] },
    ], docsUrl: "https://x" } },
    { auth: {} },
  ] });
  assert.equal(connectors.length, 1);
  assert.equal(connectors[0]!.auth.fields[1]!.type, "select");
  assert.deepEqual(connectors[0]!.auth.fields[1]!.options, [{ value: "webhook", label: "Webhook" }, { value: "polling", label: "polling" }]);
  assert.equal(connectors[0]!.auth.docsUrl, "https://x");
  assert.equal(parseConnectors(null).length, 0);
  assert.equal(connectorForPlatform(connectors, "telegram")?.name, "Telegram");
  assert.equal(connectorForPlatform(connectors, "slack"), null);
});

test("channel rows describe connection state and credentials per platform", () => {
  const rows = buildChannelRows(["slack", "discord", "zakurabot"], [binding()], [slackConnector], "a1", "https://z/api/remote-channels/t1");
  const [slack, discord, zakurabot] = rows;
  assert.equal(slack!.state, "connected");
  assert.equal(slack!.stateLabel, "Connected");
  assert.equal(slack!.credentialSummary, "2 of 3 credentials set");
  assert.equal(slack!.webhookUrl, "https://z/api/remote-channels/t1/b1/webhook");
  assert.equal(discord!.state, "available");
  assert.equal(discord!.stateLabel, "Not connected");
  assert.equal(discord!.webhookUrl, null);
  assert.equal(zakurabot!.state, "available");

  const all = buildChannelRows(["slack"], [binding({ configuredFields: ["botToken", "signingSecret", "userName"] })], [slackConnector], "a1", "https://z/t1");
  assert.equal(all[0]!.credentialSummary, "All credentials set");

  const disabled = buildChannelRows(["slack"], [binding({ enabled: false })], [slackConnector], "a1", "https://z/t1");
  assert.equal(disabled[0]!.state, "disabled");
  assert.equal(disabled[0]!.stateLabel, "Disabled");

  const incomplete = buildChannelRows(["slack"], [binding({ configuredFields: ["botToken"] })], [slackConnector], "a1", "https://z/t1");
  assert.equal(incomplete[0]!.state, "incomplete");
  assert.equal(incomplete[0]!.credentialSummary, "Missing Signing Secret");

  const zakurabotBound = buildChannelRows(["zakurabot"], [binding({ platform: "zakurabot", id: "z1" })], [], "a1", "https://z/t1");
  assert.equal(zakurabotBound[0]!.webhookUrl, null);

  const foreign = buildChannelRows(["slack"], [binding({ agentId: "other" })], [], "a1", "https://z/t1");
  assert.equal(foreign[0]!.binding, null);
  assert.equal(channelStateLabel("available"), "Not connected");
});

test("bindings on platforms outside the list still render", () => {
  const rows = buildChannelRows(["slack"], [binding({ platform: "webex", id: "w1" })], [], "a1", "https://z/t1");
  assert.deepEqual(rows.map((row) => row.platform), ["slack", "webex"]);
  assert.equal(rows[1]!.name, "webex");
  assert.equal(rows[1]!.state, "connected");
});

test("credential payload submits only changed fields with keep/delete semantics", () => {
  assert.deepEqual(buildCredentialPayload(fields, {}), {});
  assert.deepEqual(buildCredentialPayload(fields, { botToken: KEEP_CREDENTIAL, signingSecret: KEEP_CREDENTIAL }), {});
  assert.deepEqual(buildCredentialPayload(fields, { userName: "new" }), { userName: "new" });
  assert.deepEqual(buildCredentialPayload(fields, { botToken: "fresh" }), { botToken: "fresh" });
  assert.deepEqual(buildCredentialPayload(fields, { botToken: "" }), {});
  assert.deepEqual(buildCredentialPayload(fields, { botToken: "" }, ["botToken"]), { botToken: "" });
  assert.deepEqual(buildCredentialPayload(fields, { signingSecret: KEEP_CREDENTIAL, userName: "" }), {});
});

test("required credential gaps mix saved and submitted values", () => {
  assert.deepEqual(missingCredentialFields(fields, ["botToken", "signingSecret"]), []);
  assert.deepEqual(missingCredentialFields(fields, ["botToken"]), ["Signing Secret"]);
  assert.deepEqual(missingRequiredCredentials(fields, { signingSecret: "x" }, ["botToken"]), []);
  assert.deepEqual(missingRequiredCredentials(fields, {}, []), ["Bot Token", "Signing Secret"]);
  assert.deepEqual(missingRequiredCredentials(fields, { botToken: "  " }, []), ["Bot Token", "Signing Secret"]);
});

test("credential guidance is derived from declared labels", () => {
  assert.equal(credentialHint(fields), "Requires Bot Token and Signing Secret.");
  assert.equal(credentialHint([{ key: "a", label: "A", type: "text" }, { key: "b", label: "B", type: "text" }]), "Optional: A and B.");
  assert.equal(credentialHint([]), "No credentials are required.");
  assert.equal(webhookUrlFor("https://z/t1/", "b1"), "https://z/t1/b1/webhook");
  assert.equal(webhookUrlFor("", "b1"), "");
});
