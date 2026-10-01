import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { ChevronLeft, Search } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";
import {
  buildInstallBody,
  connectionActionPath,
  connectionPath,
  installedPluginsPath,
  installedRowState,
  installPluginPath,
  listingComponents,
  parseInstallResult,
  parseInstalled,
  parseSearchResults,
  pluginKindLabel,
  pluginListingRow,
  pluginSearchPath,
  type InstallComponentResult,
  type InstalledPlugin,
  type PluginListing,
  type PluginStatusTone,
} from "@/lib/plugins";

const ICON = "#8a8a8a";

const TABS: { id: "marketplace" | "installed"; label: string }[] = [
  { id: "marketplace", label: "Marketplace" },
  { id: "installed", label: "Installed" },
];

const TONE_CLASS: Record<PluginStatusTone, string> = {
  success: "text-success",
  danger: "text-danger",
  muted: "text-ink-secondary",
};

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export function PluginsModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { request, settings } = useStore();
  const insets = useSafeAreaInsets();
  const live = !settings.useMockChannel;

  const [tab, setTab] = useState<"marketplace" | "installed">("marketplace");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PluginListing[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PluginListing | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [installResult, setInstallResult] = useState<{ name: string; failures: InstallComponentResult[] } | null>(null);
  const [installed, setInstalled] = useState<InstalledPlugin[] | null>(null);
  const [loadingInstalled, setLoadingInstalled] = useState(false);
  const [installedError, setInstalledError] = useState<string | null>(null);
  const [pendingRow, setPendingRow] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<InstalledPlugin | null>(null);
  const searchSeq = useRef(0);

  // Fresh surface each open: drop detail, result feedback and confirmations.
  useEffect(() => {
    if (!visible) return;
    setSelected(null);
    setInstallError(null);
    setInstallResult(null);
    setRowError(null);
    setConfirm(null);
  }, [visible]);

  // Debounced marketplace search; a newer keystroke or tab change abandons the old request.
  useEffect(() => {
    const seq = ++searchSeq.current;
    if (!visible || tab !== "marketplace" || !live) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      setSearchError(null);
      void request<unknown>(pluginSearchPath(query), { signal: controller.signal })
        .then((value) => { if (seq === searchSeq.current) setResults(parseSearchResults(value).items); })
        .catch((cause) => { if (seq === searchSeq.current && !controller.signal.aborted) setSearchError(messageOf(cause, "Could not search the marketplace.")); })
        .finally(() => { if (seq === searchSeq.current) setSearching(false); });
    }, query.trim() ? 300 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [visible, tab, live, query, request]);

  const loadInstalled = useCallback(async () => {
    setLoadingInstalled(true);
    setInstalledError(null);
    try {
      setInstalled(parseInstalled(await request<unknown>(installedPluginsPath())));
    } catch (cause) {
      setInstalledError(messageOf(cause, "Could not load installed plugins."));
    } finally {
      setLoadingInstalled(false);
    }
  }, [request]);

  useEffect(() => {
    if (!visible || tab !== "installed" || !live) return;
    void loadInstalled();
  }, [visible, tab, live, loadInstalled]);

  useEffect(() => {
    if (!visible || Platform.OS !== "web") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (selected) setSelected(null); else onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible, selected, onClose]);

  const install = async (listing: PluginListing) => {
    if (installing) return;
    setInstalling(true);
    setInstallError(null);
    setInstallResult(null);
    try {
      const result = parseInstallResult(await request<unknown>(installPluginPath(), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildInstallBody(listing)) }));
      setInstallResult({ name: result.name, failures: result.components.filter((component) => component.error) });
      setInstalled(null);
    } catch (cause) {
      setInstallError(messageOf(cause, "Could not install this plugin."));
    } finally {
      setInstalling(false);
    }
  };

  const uninstall = async () => {
    const row = confirm;
    if (!row || pendingRow) return;
    setPendingRow(row.id);
    setRowError(null);
    try {
      await request(connectionPath(row.id), { method: "DELETE" });
      setInstalled((previous) => previous?.filter((item) => item.id !== row.id) ?? previous);
      setConfirm(null);
    } catch (cause) {
      setRowError(messageOf(cause, "Could not uninstall this plugin."));
    } finally {
      setPendingRow(null);
    }
  };

  const toggle = async (row: InstalledPlugin, action: "start" | "stop") => {
    if (pendingRow) return;
    setPendingRow(row.id);
    setRowError(null);
    try {
      await request(connectionActionPath(row.id, action), { method: "POST" });
      await loadInstalled();
    } catch (cause) {
      setRowError(messageOf(cause, action === "start" ? "Could not start this plugin." : "Could not stop this plugin."));
    } finally {
      setPendingRow(null);
    }
  };

  const installedRows = (installed ?? []).map((connection) => ({ connection, state: installedRowState(connection) }));
  const detailComponents = selected ? listingComponents(selected) : [];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View className="flex-1 justify-end" accessibilityViewIsModal>
        <Pressable className="absolute inset-0 bg-black/60" onPress={onClose} accessibilityLabel="Close plugins" accessible={false} focusable={false} />
        <View className="w-full max-w-2xl self-center overflow-hidden rounded-t-3xl bg-panel"
          style={{ height: "85%", paddingBottom: Math.max(insets.bottom, 12) }}>
          <Text accessibilityRole="header" className="px-4 pt-4 text-[17px] font-medium text-ink">Plugins</Text>
          <View accessibilityRole="tablist" className="mt-1 flex-row gap-5 border-b border-hairline px-4">
            {TABS.map((item) => (
              <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected: tab === item.id }}
                accessibilityLabel={item.label} onPress={() => { setTab(item.id); setSelected(null); }}
                className="min-h-11 justify-center">
                <Text className={cn("text-[15px]", tab === item.id ? "font-medium text-ink" : "text-ink-secondary")}>{item.label}</Text>
              </Pressable>
            ))}
          </View>

          {!live ? (
            <Text className="px-4 py-6 text-[14px] leading-5 text-ink-secondary">Connect a Zakura instance to manage plugins.</Text>
          ) : tab === "marketplace" ? (
            selected ? (
              <View className="flex-1">
                <ScrollView className="flex-1" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 8 }}>
                  <Pressable onPress={() => setSelected(null)} accessibilityRole="button" accessibilityLabel="Back to results"
                    className="mb-1 -ml-2 min-h-11 flex-row items-center gap-1 self-start rounded-full px-2 active:bg-raised/40">
                    <ChevronLeft size={18} color={ICON} />
                    <Text className="text-[15px] text-ink-secondary">Back</Text>
                  </Pressable>
                  <Text className="text-[20px] font-medium text-ink">{selected.name}</Text>
                  <Text className="mt-1 text-[13px] text-ink-secondary">{pluginKindLabel(selected.kind)}</Text>
                  {selected.description ? <Text className="mt-3 text-[15px] leading-6 text-ink-secondary">{selected.description}</Text> : null}
                  {detailComponents.length ? <View className="mt-5">
                    <Text className="mb-1 text-[13px] text-ink-secondary">Includes</Text>
                    <View className="overflow-hidden rounded-2xl bg-inset">
                      {detailComponents.map((component, index) => (
                        <View key={`${component.kindLabel}:${component.name}:${index}`}
                          className={cn("mx-3 flex-row items-center justify-between gap-4 py-3", index > 0 && "border-t border-hairline")}>
                          <Text className="min-w-0 flex-1 text-[15px] text-ink" numberOfLines={1}>{component.name}</Text>
                          <Text className="shrink-0 text-[13px] text-ink-secondary">{component.kindLabel}</Text>
                        </View>
                      ))}
                    </View>
                  </View> : null}
                  {installError ? <Text accessibilityRole="alert" className="mt-4 text-[13px] leading-5 text-danger">{installError}</Text> : null}
                  {installResult ? <View className="mt-4" accessibilityLiveRegion="polite">
                    <Text className="text-[14px] text-ink">Installed {installResult.name}.</Text>
                    {installResult.failures.map((failure, index) => (
                      <Text key={`${failure.name}:${index}`} accessibilityRole="alert" className="mt-1 text-[13px] leading-5 text-danger">
                        {failure.name}: {failure.error}
                      </Text>
                    ))}
                  </View> : null}
                </ScrollView>
                <View className="border-t border-hairline px-4 py-3">
                  <Pressable onPress={() => void install(selected)} disabled={installing} accessibilityRole="button"
                    accessibilityLabel={`Install ${selected.name}`} accessibilityState={{ disabled: installing, busy: installing }}
                    className={cn("min-h-12 flex-row items-center justify-center gap-2 rounded-full bg-ink py-3 active:opacity-80", installing && "opacity-60")}>
                    {installing ? <ActivityIndicator size="small" color="#070707" /> : null}
                    <Text className="text-[16px] font-semibold text-app">{installing ? "Installing…" : "Install"}</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View className="flex-1">
                <View className="flex-row items-center gap-2 border-b border-hairline px-4">
                  <Search size={16} color={ICON} />
                  <TextInput value={query} onChangeText={setQuery} placeholder="Search plugins" placeholderTextColor={ICON}
                    accessibilityLabel="Search plugins" autoCorrect={false} autoCapitalize="none"
                    className="min-w-0 flex-1 py-3 text-[16px] text-ink outline-none" />
                  {searching ? <ActivityIndicator size="small" color={ICON} /> : null}
                </View>
                <ScrollView className="flex-1" keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 12 }}>
                  {searchError ? <Text accessibilityRole="alert" className="px-4 py-6 text-[14px] leading-5 text-danger">{searchError}</Text> : null}
                  {!searchError && !searching && results.length === 0 ? <Text className="px-4 py-6 text-[14px] leading-5 text-ink-secondary">
                    {query.trim() ? `No plugins match “${query.trim()}”.` : "Nothing to show from the marketplace."}
                  </Text> : null}
                  {results.map((listing) => {
                    const row = pluginListingRow(listing);
                    return <Pressable key={row.id} onPress={() => { setSelected(listing); setInstallError(null); setInstallResult(null); }}
                      accessibilityRole="button" accessibilityLabel={row.name}
                      className="mx-2 flex-row items-center gap-3 rounded-xl px-3 py-3 active:bg-raised/40">
                      <View className="min-w-0 flex-1">
                        <Text className="text-[15px] text-ink" numberOfLines={1}>{row.name}</Text>
                        <Text className="mt-0.5 text-[13px] text-ink-secondary" numberOfLines={2}>
                          {row.kindLabel}{row.description ? ` · ${row.description}` : ""}
                        </Text>
                      </View>
                    </Pressable>;
                  })}
                </ScrollView>
              </View>
            )
          ) : (
            <View className="flex-1">
              <View className="flex-row items-center justify-end px-4 pt-2">
                <Pressable onPress={() => void loadInstalled()} disabled={loadingInstalled} accessibilityRole="button"
                  accessibilityLabel="Refresh installed plugins" className="min-h-9 items-center justify-center rounded-full px-2 active:bg-raised/40">
                  {loadingInstalled ? <ActivityIndicator size="small" color={ICON} /> : <Text className="text-[13px] text-ink-secondary">Refresh</Text>}
                </Pressable>
              </View>
              <ScrollView className="flex-1" keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 12 }}>
                {installedError ? <Text accessibilityRole="alert" className="px-4 py-6 text-[14px] leading-5 text-danger">{installedError}</Text> : null}
                {rowError ? <Text accessibilityRole="alert" className="px-4 pt-3 text-[13px] leading-5 text-danger">{rowError}</Text> : null}
                {installed === null && loadingInstalled ? <View className="items-center py-10"><ActivityIndicator color={ICON} /></View> : null}
                {!installedError && installed !== null && installedRows.length === 0 ? <View className="px-4 py-6">
                  <Text className="text-[14px] text-ink">No plugins installed yet.</Text>
                  <Text className="mt-1 text-[13px] leading-5 text-ink-secondary">Find plugins in the Marketplace tab.</Text>
                </View> : null}
                {installedRows.map(({ connection, state }) => (
                  <View key={state.id} className="mx-4 border-b border-hairline py-3">
                    <Text className="text-[15px] text-ink" numberOfLines={1}>{state.name}</Text>
                    <View className="mt-0.5 flex-row items-center gap-2">
                      <Text className="text-[13px] text-ink-secondary">{state.kindLabel}</Text>
                      <Text className={cn("text-[13px]", TONE_CLASS[state.tone])}>{state.statusLabel}</Text>
                    </View>
                    <View className="mt-1 flex-row items-center gap-5">
                      {state.canStart ? <Pressable disabled={pendingRow === state.id} onPress={() => void toggle(connection, "start")}
                        accessibilityRole="button" accessibilityLabel={`Start ${state.name}`} className="min-h-11 justify-center active:opacity-60">
                        <Text className="text-[14px] text-ink">Start</Text>
                      </Pressable> : null}
                      {state.canStop ? <Pressable disabled={pendingRow === state.id} onPress={() => void toggle(connection, "stop")}
                        accessibilityRole="button" accessibilityLabel={`Stop ${state.name}`} className="min-h-11 justify-center active:opacity-60">
                        <Text className="text-[14px] text-ink">Stop</Text>
                      </Pressable> : null}
                      <Pressable disabled={pendingRow === state.id} onPress={() => { setRowError(null); setConfirm(connection); }}
                        accessibilityRole="button" accessibilityLabel={`Uninstall ${state.name}`} className="min-h-11 justify-center active:opacity-60">
                        <Text className="text-[14px] text-danger">Uninstall</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </ScrollView>
            </View>
          )}
        </View>
      </View>

      <Modal visible={!!confirm} transparent animationType="fade" onRequestClose={() => { setConfirm(null); setRowError(null); }} statusBarTranslucent>
        <View className="flex-1 items-center justify-center bg-black/60 px-6" accessibilityViewIsModal>
          <Pressable className="absolute inset-0" onPress={() => { setConfirm(null); setRowError(null); }} accessible={false} focusable={false} />
          <View className="w-full max-w-sm rounded-3xl bg-panel p-5">
            <Text className="text-[17px] font-medium text-ink">Uninstall {confirm?.name}?</Text>
            <Text className="mt-1 text-[14px] leading-5 text-ink-secondary">Your agent stops getting this tool.</Text>
            {rowError ? <Text accessibilityRole="alert" className="mt-3 text-[13px] leading-5 text-danger">{rowError}</Text> : null}
            <View className="mt-5 flex-row items-center justify-end gap-1">
              <Pressable onPress={() => { setConfirm(null); setRowError(null); }} accessibilityRole="button" accessibilityLabel="Cancel uninstall"
                className="min-h-11 items-center justify-center rounded-full px-4 active:bg-raised/40">
                <Text className="text-[15px] text-ink-secondary">Cancel</Text>
              </Pressable>
              <Pressable onPress={() => void uninstall()} disabled={pendingRow === confirm?.id} accessibilityRole="button" accessibilityLabel="Confirm uninstall"
                className="min-h-11 items-center justify-center rounded-full px-4 active:bg-raised/40">
                {pendingRow === confirm?.id ? <ActivityIndicator size="small" color="#ff5667" />
                  : <Text className="text-[15px] font-semibold text-danger">Uninstall</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}
