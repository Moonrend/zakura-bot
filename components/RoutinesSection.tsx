import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, ChevronDown, ChevronRight, Ellipsis, Pause, Pencil, Play, Plus, Trash2 } from "lucide-react-native";
import { Field } from "@/components/ui/Field";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";
import {
  automationRunsPath,
  buildCronPattern,
  describeRunRow,
  filterRunsForSchedule,
  formatClock,
  formatNextRun,
  frequencyFromPattern,
  isValidTimezone,
  parseRoutineList,
  parseRoutineRuns,
  routineNameError,
  routinePath,
  routinePatternIssue,
  routinePromptError,
  routineRunPath,
  routinesPath,
  timeOfDayOptions,
  TIMEZONE_OPTIONS,
  WEEKDAY_OPTIONS,
  type RoutineDraft,
  type RoutineFrequency,
  type RoutineRun,
  type RoutineSchedule,
} from "@/lib/routines";

const ICON = "#8a8a8a";
const DANGER = "#ff5667";

const FREQUENCIES: { key: string; label: string }[] = [
  { key: "15", label: "Every 15 min" },
  { key: "30", label: "Every 30 min" },
  { key: "hour", label: "Hourly" },
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "custom", label: "Custom" },
];

function frequencyKey(frequency: RoutineFrequency): string {
  if (frequency.kind === "minutes") return String(frequency.every);
  if (frequency.kind === "hourly") return "hour";
  return frequency.kind;
}

/** Standalone Routines section for the agent info pane. Read-only when canManage is false. */
export function RoutinesSection({ agentId, canManage }: { agentId: string; canManage: boolean }) {
  const { request } = useStore();
  const [routines, setRoutines] = useState<RoutineSchedule[] | null>(null);
  const [runs, setRuns] = useState<RoutineRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirmFor, setConfirmFor] = useState<RoutineSchedule | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRoutines(parseRoutineList(await request(routinesPath(agentId))));
    } catch (cause) {
      setRoutines([]);
      setError(cause instanceof Error ? cause.message : "Could not load routines.");
    } finally {
      setLoading(false);
    }
    try {
      setRuns(parseRoutineRuns(await request(automationRunsPath(agentId, 30))));
    } catch {
      setRuns([]);
    }
  }, [agentId, request]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    setEditing(null); setMenuFor(null); setConfirmFor(null); setExpandedId(null); setBusyId(null); setNotice(null);
  }, [agentId]);

  const saveRoutine = async (id: string | null, draft: RoutineDraft) => {
    setError(null);
    await request(id ? routinePath(agentId, id) : routinesPath(agentId), {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    setEditing(null);
    await load();
  };
  const removeRoutine = async (routine: RoutineSchedule) => {
    setBusyId(routine.id);
    setError(null);
    try {
      await request(routinePath(agentId, routine.id), { method: "DELETE" });
      setConfirmFor(null);
      setExpandedId((current) => current === routine.id ? null : current);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete this routine.");
    } finally {
      setBusyId(null);
    }
  };
  const toggleRoutine = async (routine: RoutineSchedule) => {
    setMenuFor(null);
    setBusyId(routine.id);
    setError(null);
    setNotice(null);
    try {
      await request(routinePath(agentId, routine.id), {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !routine.enabled }),
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update this routine.");
    } finally {
      setBusyId(null);
    }
  };
  const runRoutine = async (routine: RoutineSchedule) => {
    setMenuFor(null);
    setBusyId(routine.id);
    setError(null);
    setNotice(null);
    try {
      const result = await request<{ run?: { status?: unknown } }>(routineRunPath(agentId, routine.id), { method: "POST" });
      setNotice(result?.run?.status === "queued" ? "Run queued." : "Run started.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start this routine.");
    } finally {
      setBusyId(null);
    }
  };

  if (editing !== null) {
    const routine = editing.id ? routines?.find((row) => row.id === editing.id) ?? null : null;
    return <RoutineEditor
      routine={routine}
      onCancel={() => setEditing(null)}
      onSave={(draft) => saveRoutine(editing.id, draft)}
    />;
  }

  const menuRoutine = routines?.find((row) => row.id === menuFor) ?? null;
  const now = Date.now();

  return <View>
    {loading && routines === null ? <View className="mx-4 min-h-14 flex-row items-center gap-2 border-b border-hairline">
      <ActivityIndicator size="small" color={ICON} />
      <Text className="text-[13px] text-ink-secondary">Loading routines…</Text>
    </View> : null}

    {!loading && routines && routines.length === 0
      ? <Text className="mx-4 py-3 text-[13px] text-ink-secondary">{canManage ? "No routines yet." : "No routines."}</Text>
      : null}

    {routines?.map((routine) => <View key={routine.id} className="mx-4 border-b border-hairline py-3">
      <View className="flex-row items-start gap-2">
        <Pressable accessibilityRole="button" accessibilityLabel={`${routine.name}, ${routine.enabled ? "active" : "paused"}`}
          onPress={() => setExpandedId((current) => current === routine.id ? null : routine.id)}
          className="min-h-11 min-w-0 flex-1 justify-center active:opacity-70">
          <Text className="text-[15px] text-ink" numberOfLines={1}>{routine.name}</Text>
          <Text className="mt-0.5 text-[13px] text-ink-secondary" numberOfLines={1}>
            {routine.triggerKind === "listener" ? routine.listenerSummary ?? "Event listener" : routine.pattern}
          </Text>
          <View className="mt-0.5 flex-row items-center gap-1">
            <Text className="min-w-0 flex-1 text-[12px] text-ink-secondary" numberOfLines={1}>
              {routine.enabled
                ? routine.triggerKind === "listener" ? "On event" : formatNextRun(routine.nextRunAt, now)
                : "Paused"}
            </Text>
            {expandedId === routine.id ? <ChevronDown size={14} color={ICON} /> : <ChevronRight size={14} color={ICON} />}
          </View>
        </Pressable>
        {canManage ? <Pressable accessibilityRole="button" accessibilityLabel={`Actions for ${routine.name}`}
          onPress={() => setMenuFor(routine.id)} className="h-11 w-11 items-center justify-center rounded-full active:bg-raised/40">
          {busyId === routine.id ? <ActivityIndicator size="small" color={ICON} /> : <Ellipsis size={18} color={ICON} />}
        </Pressable> : null}
      </View>
      {expandedId === routine.id ? <RoutineHistory runs={filterRunsForSchedule(runs, routine.id, 5)} canManage={canManage}
        busy={busyId === routine.id} onRun={() => void runRoutine(routine)} /> : null}
    </View>)}

    {canManage && !loading ? <Pressable accessibilityRole="button" accessibilityLabel="New routine"
      onPress={() => setEditing({ id: null })} className="active:bg-raised/40">
      <View className="mx-4 min-h-14 flex-row items-center justify-between gap-3 py-3">
        <Text className="text-[15px] text-ink">New routine</Text>
        <Plus size={18} color={ICON} />
      </View>
    </Pressable> : null}

    {notice ? <Text accessibilityLiveRegion="polite" className="mx-4 pb-3 text-[12px] text-ink-secondary">{notice}</Text> : null}
    {error ? <Text accessibilityRole="alert" className="mx-4 pb-3 text-[13px] leading-5 text-danger">{error}</Text> : null}

    <Sheet visible={menuFor !== null && menuRoutine !== null} onClose={() => setMenuFor(null)}>
      {menuRoutine ? <Text className="pb-1 text-[17px] font-medium text-ink" numberOfLines={1}>{menuRoutine.name}</Text> : null}
      <SheetRow icon={Pencil} label="Edit" onPress={() => { setEditing({ id: menuFor }); setMenuFor(null); }} />
      <SheetRow icon={Play} label="Run now" onPress={() => { if (menuRoutine) void runRoutine(menuRoutine); }} />
      <SheetRow icon={menuRoutine?.enabled ? Pause : Play} label={menuRoutine?.enabled ? "Pause" : "Resume"}
        onPress={() => { if (menuRoutine) void toggleRoutine(menuRoutine); }} />
      <SheetRow icon={Trash2} label="Delete" danger onPress={() => { setConfirmFor(menuRoutine); setMenuFor(null); }} />
    </Sheet>

    <Modal visible={confirmFor !== null} transparent animationType="fade" onRequestClose={() => setConfirmFor(null)} statusBarTranslucent>
      <View className="flex-1 items-center justify-center bg-black/60 px-6">
        <View className="w-full max-w-sm overflow-hidden rounded-3xl bg-panel">
          <Text accessibilityRole="header" className="px-5 pt-5 text-[17px] text-ink">Delete this routine?</Text>
          <Text className="px-5 pb-5 pt-1 text-[14px] leading-5 text-ink-secondary">This can't be undone.</Text>
          <View className="flex-row border-t border-hairline">
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel delete" disabled={busyId !== null}
              onPress={() => setConfirmFor(null)} className="min-h-12 flex-1 items-center justify-center active:bg-raised/40">
              <Text className="text-[15px] text-ink-secondary">Cancel</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Confirm delete routine" disabled={busyId !== null}
              onPress={() => { if (confirmFor) void removeRoutine(confirmFor); }}
              className="min-h-12 flex-1 items-center justify-center border-l border-hairline active:bg-raised/40">
              {busyId !== null ? <ActivityIndicator size="small" color={DANGER} /> : <Text className="text-[15px] text-danger">Delete</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  </View>;
}

function RoutineHistory({ runs, canManage, busy, onRun }: {
  runs: RoutineRun[]; canManage: boolean; busy: boolean; onRun: () => void;
}) {
  const now = Date.now();
  return <View className="mt-2 overflow-hidden rounded-2xl bg-inset">
    <Text className="px-3 pb-1 pt-3 text-[12px] text-ink-secondary">Recent runs</Text>
    {runs.length === 0 ? <Text className="px-3 pb-3 pt-1 text-[13px] text-ink-secondary">No runs yet</Text>
      : runs.map((run, index) => {
        const row = describeRunRow(run, now);
        return <View key={run.id} className={cn("mx-3 py-2", index > 0 && "border-t border-hairline")}>
          <View className="flex-row items-center justify-between gap-2">
            <Text className={cn("text-[13px]", row.status === "Failed" ? "text-danger" : "text-ink")}>{row.status}</Text>
            <Text className="min-w-0 flex-1 text-right text-[12px] text-ink-secondary" numberOfLines={1}>{row.started}</Text>
          </View>
          {row.completed ? <Text className="mt-0.5 text-[12px] text-ink-secondary">Ended {row.completed}</Text> : null}
          {row.error ? <Text className="mt-1 text-[12px] leading-4 text-danger">{row.error}</Text> : null}
        </View>;
      })}
    {canManage ? <Pressable accessibilityRole="button" accessibilityLabel="Run now" disabled={busy} onPress={onRun}
      className="mx-3 min-h-11 flex-row items-center gap-2 border-t border-hairline active:opacity-70">
      <Play size={15} color={ICON} />
      <Text className={cn("text-[14px]", busy ? "text-ink-secondary" : "text-ink")}>{busy ? "Starting…" : "Run now"}</Text>
    </Pressable> : null}
  </View>;
}

function RoutineEditor({ routine, onSave, onCancel }: {
  routine: RoutineSchedule | null;
  onSave: (draft: RoutineDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const isListener = routine?.triggerKind === "listener";
  const [name, setName] = useState(routine?.name ?? "");
  const [prompt, setPrompt] = useState(routine?.prompt ?? "");
  const [frequency, setFrequency] = useState<RoutineFrequency>(() =>
    routine && routine.triggerKind === "cron" ? frequencyFromPattern(routine.pattern) : { kind: "minutes", every: 15 });
  const [timezone, setTimezone] = useState(routine?.timezone ?? "UTC");
  const [customTimezone, setCustomTimezone] = useState(() =>
    routine ? !TIMEZONE_OPTIONS.includes(routine.timezone) : false);
  const [enabled, setEnabled] = useState(routine?.enabled ?? true);
  const [picker, setPicker] = useState<"time" | "timezone" | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pattern = buildCronPattern(frequency);
  const nameProblem = routineNameError(name);
  const promptProblem = routinePromptError(prompt);
  const patternProblem = isListener ? null : routinePatternIssue(pattern);
  const timezoneProblem = customTimezone && timezone.trim() && !isValidTimezone(timezone.trim())
    ? "That time zone isn't recognized." : null;
  const invalid = !!nameProblem || !!promptProblem || !!patternProblem || !!timezoneProblem;

  const chooseFrequency = (key: string) => {
    setFrequency((current) => {
      if (key === "15") return { kind: "minutes", every: 15 };
      if (key === "30") return { kind: "minutes", every: 30 };
      if (key === "hour") return { kind: "hourly" };
      const time = current.kind === "daily" || current.kind === "weekly"
        ? { hour: current.hour, minute: current.minute } : { hour: 9, minute: 0 };
      if (key === "daily") return { kind: "daily", ...time };
      if (key === "weekly") return { kind: "weekly", weekday: current.kind === "weekly" ? current.weekday : 1, ...time };
      return current.kind === "custom" ? current : { kind: "custom", pattern: "" };
    });
  };
  const chooseTime = (label: string) => {
    const option = timeOfDayOptions().find((row) => row.label === label);
    if (!option) return;
    setFrequency((current) => current.kind === "weekly"
      ? { ...current, hour: option.hour, minute: option.minute }
      : { kind: "daily", hour: option.hour, minute: option.minute });
  };
  const chooseWeekday = (weekday: number) => {
    setFrequency((current) => current.kind === "weekly" ? { ...current, weekday } : current);
  };
  const chooseTimezone = (value: string) => {
    if (value === "Other…") { setCustomTimezone(true); return; }
    setCustomTimezone(false);
    setTimezone(value);
  };

  const submit = async () => {
    if (pending) return;
    if (invalid) { setAttempted(true); return; }
    setPending(true);
    setError(null);
    try {
      const draft: RoutineDraft = {
        name: name.trim(),
        prompt: prompt.trim(),
        enabled,
        timezone: timezone.trim() || "UTC",
        ...(isListener ? {} : { pattern }),
      };
      await onSave(draft);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this routine.");
      setPending(false);
    }
  };

  return <View className="gap-4 px-4 pb-4 pt-3">
    <Field label="Name" value={name} onChangeText={(value) => { setName(value); if (attempted) setAttempted(false); }}
      placeholder="Routine name" maxLength={120} autoCapitalize="none" autoCorrect={false}
      error={attempted ? nameProblem ?? undefined : undefined} />
    <Field label="Instruction" value={prompt} onChangeText={setPrompt} placeholder="What should this routine do each time it runs?"
      maxLength={4000} multiline style={{ minHeight: 88, textAlignVertical: "top" }} />

    {isListener ? <View className="min-h-11 justify-center">
      <Text className="text-[13px] text-ink-secondary">Trigger: {routine?.listenerSummary ?? "Event listener"}</Text>
    </View> : <View className="gap-2">
      <Text className="pl-2.5 text-[13px] text-ink-secondary">Schedule</Text>
      <View className="flex-row flex-wrap gap-1">
        {FREQUENCIES.map((option) => <Pill key={option.key} label={option.label} active={frequencyKey(frequency) === option.key}
          onPress={() => chooseFrequency(option.key)} />)}
      </View>
      {frequency.kind === "weekly" ? <View className="flex-row flex-wrap gap-1">
        {WEEKDAY_OPTIONS.map((option) => <Pill key={option.value} label={option.label.slice(0, 3)} active={frequency.weekday === option.value}
          onPress={() => chooseWeekday(option.value)} />)}
      </View> : null}
      {frequency.kind === "daily" || frequency.kind === "weekly" ? <SelectRow label="Time"
        value={formatClock(frequency.hour, frequency.minute)} onPress={() => setPicker("time")} /> : null}
      {frequency.kind === "custom" ? <>
        <Field label="Schedule" value={frequency.pattern} onChangeText={(value) => setFrequency({ kind: "custom", pattern: value })}
          placeholder="*/15 * * * *" autoCapitalize="none" autoCorrect={false} />
        {attempted && patternProblem ? <Text accessibilityRole="alert" className="px-2.5 text-[12px] text-danger">{patternProblem}</Text>
          : <Text className="px-2.5 text-[12px] text-ink-secondary">minute hour day month weekday · @hourly · @every 5m</Text>}
      </> : null}
    </View>}

    <View className="gap-2">
      <SelectRow label="Time zone" value={timezone} onPress={() => setPicker("timezone")} />
      {customTimezone ? <Field label="Custom time zone" value={timezone} onChangeText={setTimezone} placeholder="Asia/Shanghai"
        autoCapitalize="none" autoCorrect={false}
        error={timezoneProblem && timezone.trim() ? timezoneProblem : undefined} /> : null}
    </View>

    <View className="min-h-11 flex-row items-center justify-between gap-3">
      <Text className="text-[15px] text-ink">Active</Text>
      <Switch value={enabled} onValueChange={setEnabled} disabled={pending} accessibilityLabel="Routine active"
        trackColor={{ false: "#444", true: "#fcfcfc" }} thumbColor={enabled ? "#070707" : "#fcfcfc"} />
    </View>

    {error ? <Text accessibilityRole="alert" className="px-2.5 text-[13px] leading-5 text-danger">{error}</Text> : null}
    <View className="flex-row items-center gap-3 pt-1">
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel" disabled={pending} onPress={onCancel}
        className="min-h-11 flex-1 items-center justify-center rounded-full active:bg-raised/40">
        <Text className="text-[15px] text-ink-secondary">Cancel</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={routine ? "Save changes" : "Create routine"} disabled={pending}
        onPress={() => void submit()}
        className={cn("min-h-11 flex-1 flex-row items-center justify-center gap-2 rounded-full bg-ink py-3 active:opacity-80", pending && "opacity-60")}>
        {pending ? <ActivityIndicator size="small" color="#070707" /> : null}
        <Text className="text-[15px] font-semibold text-app">{routine ? "Save changes" : "Create routine"}</Text>
      </Pressable>
    </View>

    <OptionSheet visible={picker === "time"} title="Time" options={timeOfDayOptions().map((option) => option.label)}
      selected={frequency.kind === "daily" || frequency.kind === "weekly" ? formatClock(frequency.hour, frequency.minute) : ""}
      onSelect={chooseTime} onClose={() => setPicker(null)} />
    <OptionSheet visible={picker === "timezone"} title="Time zone" options={TIMEZONE_OPTIONS} selected={timezone}
      otherLabel="Other…" onSelect={chooseTimezone} onClose={() => setPicker(null)} />
  </View>;
}

function Pill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    {...(Platform.OS === "web" ? { "aria-pressed": active } : { accessibilityState: { selected: active } })}
    onPress={onPress} className={cn("min-h-9 items-center justify-center rounded-full px-3", active ? "bg-raised" : "active:bg-raised/40")}>
    <Text className={cn("text-[13px]", active ? "font-semibold text-ink" : "text-ink-secondary")}>{label}</Text>
  </Pressable>;
}

function SelectRow({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} onPress={onPress}
    className="min-h-11 flex-row items-center justify-between gap-3 rounded-xl px-2.5 active:bg-raised/40">
    <Text className="text-[15px] text-ink">{label}</Text>
    <View className="min-w-0 flex-row items-center gap-1">
      <Text className="text-[15px] text-ink-secondary" numberOfLines={1}>{value}</Text>
      <ChevronDown size={16} color={ICON} />
    </View>
  </Pressable>;
}

function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
    <View className="flex-1 justify-end" accessibilityViewIsModal>
      <Pressable className="absolute inset-0 bg-black/60" onPress={onClose} accessible={false} focusable={false} />
      <View className="max-h-[80%] rounded-t-3xl bg-panel px-4 pt-4" style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
        {children}
      </View>
    </View>
  </Modal>;
}

function SheetRow({ label, icon: Icon, selected, danger, onPress }: {
  label: string; icon?: typeof Plus; selected?: boolean; danger?: boolean; onPress: () => void;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
    className="min-h-12 flex-row items-center gap-3 active:bg-raised/40">
    {Icon ? <Icon size={17} color={danger ? DANGER : ICON} /> : <View className="w-[17px]" />}
    <Text className={cn("min-w-0 flex-1 text-[16px]", danger ? "text-danger" : "text-ink")} numberOfLines={1}>{label}</Text>
    {selected ? <Check size={16} color={ICON} /> : null}
  </Pressable>;
}

function OptionSheet({ visible, title, options, selected, otherLabel, onSelect, onClose }: {
  visible: boolean; title: string; options: string[]; selected: string; otherLabel?: string;
  onSelect: (value: string) => void; onClose: () => void;
}) {
  return <Sheet visible={visible} onClose={onClose}>
    <Text className="pb-1 text-[17px] font-medium text-ink">{title}</Text>
    <ScrollView className="max-h-96" keyboardShouldPersistTaps="handled">
      {options.map((option) => <SheetRow key={option} label={option} selected={option === selected}
        onPress={() => { onSelect(option); onClose(); }} />)}
      {otherLabel ? <SheetRow label={otherLabel} selected={!options.includes(selected)}
        onPress={() => { onSelect(otherLabel); onClose(); }} /> : null}
    </ScrollView>
  </Sheet>;
}
