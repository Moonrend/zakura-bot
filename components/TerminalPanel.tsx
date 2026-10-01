import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useStore } from "@/lib/store";
import { ZakuraApiError } from "@/lib/auth";
import { cn } from "@/lib/cn";
import {
  buildTranscript, describeExecFailure, runCommand, validateCommand, type TerminalEntry,
} from "@/lib/terminal";

const HISTORY_LIMIT = 50;
const MUTED = "#a3a3a3";
let runSequence = 0;

/** Desktop-web terminal: run one command at a time and keep its output as a transcript. */
export function TerminalPanel({ agentId }: { agentId: string }) {
  const { request } = useStore();
  const [command, setCommand] = useState("");
  const [entries, setEntries] = useState<TerminalEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const preservedDraft = useRef("");
  const scrollRef = useRef<ScrollView | null>(null);

  const rows = buildTranscript(entries);
  const runDisabled = running || command.length === 0;

  const recall = useCallback((direction: -1 | 1) => {
    if (!history.length || (direction === 1 && historyIndex === null)) return;
    const next = direction === -1
      ? historyIndex === null ? 0 : Math.min(historyIndex + 1, history.length - 1)
      : historyIndex === null ? null : Math.max(historyIndex - 1, -1);
    const target = next !== null && next < 0 ? null : next;
    if (historyIndex === null && target !== null) preservedDraft.current = command;
    setHistoryIndex(target);
    setCommand(target === null ? preservedDraft.current : history[target]);
  }, [command, history, historyIndex]);

  const run = useCallback(async () => {
    if (running) return;
    const value = command;
    const problem = validateCommand(value);
    if (problem) { setInputError(problem); return; }
    setInputError(null);
    runSequence += 1;
    const id = `run-${Date.now()}-${runSequence}`;
    const startedAt = Date.now();
    setCommand("");
    setHistoryIndex(null);
    setHistory((current) => [value, ...current.filter((entry) => entry !== value)].slice(0, HISTORY_LIMIT));
    setEntries((current) => [...current, { id, command: value, status: "running" }]);
    setRunning(true);
    try {
      const result = await runCommand(request, agentId, value);
      setEntries((current) => current.map((entry) => entry.id === id
        ? { ...entry, status: "done", output: result.output, exitCode: result.exitCode, truncated: result.truncated, elapsedMs: Date.now() - startedAt }
        : entry));
    } catch (cause) {
      const status = cause instanceof ZakuraApiError ? cause.status : null;
      const failure = describeExecFailure(status, cause instanceof Error ? cause.message : "The command could not run.");
      setEntries((current) => current.map((entry) => entry.id === id
        ? { ...entry, status: "failed", error: failure.message, hint: failure.hint ?? undefined }
        : entry));
    } finally {
      setRunning(false);
    }
  }, [agentId, command, request, running]);

  const clear = useCallback(() => setEntries([]), []);

  return <View className="overflow-hidden rounded-2xl border border-hairline bg-panel">
    <View className="flex-row min-h-11 items-center justify-between gap-3 border-b border-hairline px-4">
      <Text className="text-[15px] font-medium text-ink">Terminal</Text>
      {rows.length ? <Pressable accessibilityRole="button" accessibilityLabel="Clear terminal" onPress={clear}
        className="min-h-9 justify-center px-2 active:opacity-70"><Text className="text-[13px] text-ink-secondary">Clear</Text></Pressable> : null}
    </View>
    <View className="gap-3 p-4">
      {rows.length ? <ScrollView ref={scrollRef} accessibilityLabel="Command output" className="max-h-80 rounded-xl border border-hairline bg-inset p-3"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}>
        <View className="gap-3">
          {rows.map((row) => {
            if (row.kind === "command") return <Text key={row.key} selectable className="text-[13px] leading-5 text-ink">
              <Text className="text-ink-secondary">$ </Text>{row.text}</Text>;
            if (row.kind === "pending") return <View key={row.key} className="flex-row items-center gap-2">
              <ActivityIndicator size="small" color={MUTED} /><Text className="text-[13px] text-ink-secondary">Running…</Text></View>;
            if (row.kind === "error") return <View key={row.key} className="gap-1">
              <Text accessibilityRole="alert" selectable className="text-[13px] leading-5 text-danger">{row.text}</Text>
              {row.note ? <Text className="text-[12px] leading-5 text-ink-secondary">{row.note}</Text> : null}</View>;
            return <View key={row.key} className="gap-1">
              <Text selectable className="text-[13px] leading-5 text-ink">{row.text || "(no output)"}</Text>
              {row.note ? <Text className="text-[12px] leading-5 text-ink-secondary">{row.note}</Text> : null}</View>;
          })}
        </View>
      </ScrollView> : <Text className="text-[13px] leading-5 text-ink-secondary">Run a command on this agent's computer. Output appears here.</Text>}
      <View className="gap-1">
        <View className={cn("min-h-11 flex-row items-center gap-2 rounded-xl border bg-inset px-3", inputError ? "border-danger" : "border-hairline")}>
          <Text className="text-[15px] text-ink-secondary">$</Text>
          <TextInput value={command} onChangeText={(value) => { setCommand(value); if (inputError) setInputError(null); }}
            accessibilityLabel="Command" placeholder="Run a command" placeholderTextColor={MUTED}
            autoCapitalize="none" autoCorrect={false} spellCheck={false}
            className="min-w-0 min-h-11 flex-1 py-3 text-[15px] text-ink outline-none"
            onKeyPress={(event) => {
              if (Platform.OS !== "web") return;
              const nativeEvent = event.nativeEvent as { key?: string; isComposing?: boolean; keyCode?: number };
              if (nativeEvent.isComposing || nativeEvent.keyCode === 229) return;
              if (nativeEvent.key === "ArrowUp") { event.preventDefault(); recall(-1); }
              else if (nativeEvent.key === "ArrowDown") { event.preventDefault(); recall(1); }
              else if (nativeEvent.key === "Enter") { event.preventDefault(); void run(); }
            }} />
          <Pressable accessibilityRole="button" accessibilityLabel="Run command" disabled={runDisabled} onPress={() => void run()}
            className={cn("min-h-9 flex-row items-center justify-center rounded-lg px-3", runDisabled ? "opacity-50" : "active:bg-raised/40")}>
            {running ? <ActivityIndicator size="small" color={MUTED} /> : <Text className="text-[13px] font-medium text-ink">Run</Text>}
          </Pressable>
        </View>
        {inputError ? <Text accessibilityRole="alert" className="pl-2.5 text-[12px] text-danger">{inputError}</Text> : null}
      </View>
    </View>
  </View>;
}
