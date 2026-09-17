import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import type { ChatMessage, InteractionAnswer, MessageInteraction } from "@/lib/types";
import { interactionPending, interactionStatus, prepareInteractionAnswer } from "@/lib/interactions";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";
import { ExternalLink } from "./ExternalLink";

export function InteractionCard({ message }: { message: ChatMessage & { interaction: MessageInteraction } }) {
  const { connection, agents, respondInteraction, refreshInteraction } = useStore();
  const interaction = message.interaction;
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [fields, setFields] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);
  const submitting = useRef(false);
  const pending = interactionPending(interaction);
  const offline = connection !== "connected" || agents.find((agent) => agent.id === message.agentId)?.status === "offline";
  const disabled = !pending || busy || offline;

  useEffect(() => {
    if (!interaction.expiresAt || interaction.status !== "pending") return;
    const timer = setTimeout(() => tick((value) => value + 1), Math.max(0, Math.min(2_147_483_647, Date.parse(interaction.expiresAt) - Date.now())));
    return () => clearTimeout(timer);
  }, [interaction.expiresAt, interaction.status]);
  useEffect(() => {
    if (!pending) { setText(""); setSelected([]); setFields({}); setError(null); }
  }, [pending]);

  const run = async (answer?: InteractionAnswer) => {
    if (submitting.current || offline || (answer && !pending)) return;
    submitting.current = true; setBusy(true); setError(null);
    try {
      if (answer) await respondInteraction(message.agentId, message.id, answer);
      else await refreshInteraction(message.agentId, message.id);
    } catch {
      setError("Couldn’t send");
    } finally { submitting.current = false; setBusy(false); }
  };

  const formContent: NonNullable<InteractionAnswer["content"]> = {};
  for (const field of interaction.fields ?? []) {
    const value = fields[field.id];
    if (value === undefined || value === "") continue;
    formContent[field.id] = field.type === "boolean" ? value as boolean
      : field.type === "integer" || field.type === "number" ? Number(value)
      : field.type === "array" ? String(value).split("\n").map((line) => line.trim()).filter(Boolean) : String(value);
  }
  const answer: InteractionAnswer = interaction.type === "question" ? { selected, text } : { content: formContent };
  let canSubmit = pending;
  try { prepareInteractionAnswer(interaction, answer); } catch { canSubmit = false; }
  const unsupportedForm = interaction.type === "form" && interaction.fields?.some((field) =>
    !["string", "number", "integer", "boolean", "array"].includes(field.type));

  return <View testID={`interaction-${message.id}`} className="min-w-0 w-full gap-3">
    <View className="flex-row items-start gap-2">
      <Text className="min-w-0 flex-1 text-[14px] leading-5 text-ink" selectable>{interaction.title}</Text>
      {busy ? <ActivityIndicator size="small" color="#b3b3b3" accessibilityLabel="Sending response" /> : null}
    </View>
    {!pending ? <Text testID="interaction-status" className="text-[12px] text-ink-secondary">{interactionStatus(interaction)}</Text> : null}
    {pending ? <>
      {interaction.type === "approval" ? <View className="flex-row flex-wrap gap-2">
        {interaction.options?.map((option) => <Action key={option.id} label={option.label} disabled={disabled}
          danger={option.kind?.startsWith("reject")} onPress={() => void run({ optionId: option.id })} />)}
        {!interaction.options?.some((option) => option.kind?.startsWith("reject")) ?
          <Action label="Cancel" disabled={disabled} onPress={() => void run({ cancelled: true })} /> : null}
      </View> : interaction.type === "question" ? <>
        {interaction.options?.length ? <>
          <View className="gap-2">{interaction.options.map((option) => <Pressable key={option.id} disabled={disabled}
            accessibilityRole={interaction.allowMultiple ? "checkbox" : "radio"} accessibilityLabel={option.label}
            accessibilityState={{ checked: selected.includes(option.id), disabled }}
            onPress={() => setSelected((previous) => previous.includes(option.id) ? previous.filter((id) => id !== option.id)
              : interaction.allowMultiple ? [...previous, option.id] : [option.id])}
            className={cn("rounded-lg border px-3 py-2.5", selected.includes(option.id) ? "border-accent bg-accent/15" : "border-hairline bg-panel", disabled && "opacity-50")}>
            <Text className="text-[14px] text-ink">{selected.includes(option.id) ? "✓ " : ""}{option.label}</Text>
          </Pressable>)}</View>
        </> : null}
        <TextInput value={text} onChangeText={setText} editable={!disabled} secureTextEntry={interaction.secret}
          multiline={!interaction.secret} autoCapitalize="none" autoCorrect={!interaction.secret} maxLength={8000}
          accessibilityLabel={interaction.secret ? "Private answer" : "Your answer"}
          placeholder={interaction.secret ? "Private answer…" : "Answer…"}
          placeholderTextColor="#a3a3a3" className="min-h-11 rounded-lg border border-hairline bg-panel px-3 py-2.5 text-[14px] text-ink" />
      </> : <>
        {interaction.url ? <ExternalLink url={interaction.url} label="Open request" buttonStyle="primary" /> : null}
        {interaction.fields?.map((field) => <View key={field.id} className="gap-2">
          <Text className="text-[13px] text-ink">{field.title || field.id}{field.required ? " *" : ""}</Text>
          {field.type === "boolean" ? <View className="flex-row gap-2">{[true, false].map((value) => <Choice key={String(value)}
            label={value ? "Yes" : "No"} checked={fields[field.id] === value} disabled={disabled}
            onPress={() => setFields((previous) => ({ ...previous, [field.id]: value }))} />)}</View>
            : field.options?.length ? <View className="flex-row flex-wrap gap-2">{field.options.map((option) => <Choice key={option}
              label={option} checked={fields[field.id] === option} disabled={disabled}
              onPress={() => setFields((previous) => ({ ...previous, [field.id]: option }))} />)}</View>
              : <TextInput value={String(fields[field.id] ?? "")} onChangeText={(value) => setFields((previous) => ({ ...previous, [field.id]: value }))}
                editable={!disabled} accessibilityLabel={field.title || field.id} multiline={field.type === "array"} maxLength={8000}
                placeholder={field.type === "array" ? "One item per line" : field.type === "integer" ? "Whole number" : field.type === "number" ? "Number" : "Enter a value"}
                placeholderTextColor="#a3a3a3" className="min-h-11 rounded-lg border border-hairline bg-panel px-3 py-2.5 text-[14px] text-ink" />}
        </View>)}
        {unsupportedForm ? <Text className="text-[12px] text-warning">Open in Zakura</Text> : null}
      </>}
      {interaction.type !== "approval" ? <View className="flex-row flex-wrap items-center gap-2">
        <Action label={interaction.type === "question" ? "Send" : interaction.mode === "url" ? "Done" : "Submit"}
          disabled={disabled || !canSubmit || !!unsupportedForm} onPress={() => void run(answer)} primary />
        <Action label={interaction.type === "question" ? "Skip" : "Cancel"} disabled={disabled} onPress={() => void run({ cancelled: true })} />
      </View> : null}
      {offline ? <Text className="text-[12px] text-ink-secondary">Offline</Text> : null}
    </> : null}
    {error ? <View className="gap-2">
      <Text accessibilityRole="alert" className="text-[13px] text-danger">{error}</Text>
      <Action label="Refresh" disabled={busy || offline} onPress={() => void run()} />
    </View> : null}
  </View>;
}

function Action({ label, disabled, onPress, danger, primary }: {
  label: string; disabled: boolean; onPress: () => void; danger?: boolean; primary?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    className={cn("min-h-11 justify-center rounded-lg border px-3 py-2", primary ? "border-accent bg-accent" : "border-hairline bg-panel", disabled && "opacity-50")}>
    <Text className={cn("text-[13px] font-medium", danger ? "text-danger" : "text-ink")}>{label}</Text>
  </Pressable>;
}

function Choice({ label, checked, disabled, onPress }: { label: string; checked: boolean; disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked, disabled }} disabled={disabled} onPress={onPress}
    className={cn("min-h-11 justify-center rounded-lg border px-3 py-2", checked ? "border-accent bg-accent/15" : "border-hairline bg-panel")}>
    <Text className="text-[13px] text-ink">{checked ? "✓ " : ""}{label}</Text>
  </Pressable>;
}
