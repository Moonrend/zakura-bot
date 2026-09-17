import { useCallback, useEffect, useRef, useState } from "react";
import { uid } from "./channel/types";
import { validatePickedFiles, type DraftAttachment, type PickedFile, type UploadedFile } from "./files";

/** Drafts and in-flight uploads belong to a bot and an instance, like text drafts. */
export function useAttachmentDrafts(scope: string, upload: (agentId: string, file: PickedFile, signal: AbortSignal) => Promise<UploadedFile>) {
  const [snapshot, setSnapshot] = useState<{ scope: string; drafts: Record<string, DraftAttachment[]> }>({ scope, drafts: {} });
  const snapshotRef = useRef(snapshot);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const jobs = useRef(new Map<string, AbortController>());
  useEffect(() => {
    snapshotRef.current = { scope, drafts: {} }; setSnapshot(snapshotRef.current);
    return () => { for (const job of jobs.current.values()) job.abort(); jobs.current.clear(); };
  }, [scope]);

  const change = useCallback((agentId: string, update: (rows: DraftAttachment[]) => DraftAttachment[]) => {
    if (scopeRef.current !== scope) return;
    const before = snapshotRef.current.scope === scope ? snapshotRef.current.drafts : {};
    snapshotRef.current = { scope, drafts: { ...before, [agentId]: update(before[agentId] ?? []) } };
    setSnapshot(snapshotRef.current);
  }, [scope]);

  const run = useCallback(async (agentId: string, row: DraftAttachment) => {
    if (scopeRef.current !== scope || jobs.current.has(row.id)) return;
    const controller = new AbortController(); jobs.current.set(row.id, controller);
    change(agentId, (rows) => rows.map((item) => item.id === row.id ? { ...item, status: "uploading", error: undefined } : item));
    try {
      const file = await upload(agentId, row.source, controller.signal);
      if (!controller.signal.aborted) change(agentId, (rows) => rows.map((item) => item.id === row.id ? { ...item, status: "ready", file } : item));
    } catch (cause) {
      if (!controller.signal.aborted) change(agentId, (rows) => rows.map((item) => item.id === row.id ? { ...item, status: "failed",
        error: cause instanceof Error ? cause.message : "Upload failed. Try again." } : item));
    } finally { if (jobs.current.get(row.id) === controller) jobs.current.delete(row.id); }
  }, [scope, upload, change]);

  const addAttachments = useCallback((agentId: string, files: PickedFile[]) => {
    if (scopeRef.current !== scope) throw new Error("The active instance changed. Choose the files again.");
    validatePickedFiles(files, snapshotRef.current.drafts[agentId]?.length ?? 0);
    const rows: DraftAttachment[] = files.map((source) => ({ id: uid("upload"), source, status: "uploading" }));
    change(agentId, (before) => [...before, ...rows]);
    for (const row of rows) void run(agentId, row);
  }, [scope, change, run]);
  const clearAttachments = useCallback((agentId: string, ids: string[]) => {
    for (const id of ids) { jobs.current.get(id)?.abort(); jobs.current.delete(id); }
    change(agentId, (rows) => rows.filter((row) => !ids.includes(row.id)));
  }, [change]);
  const retryAttachment = useCallback((agentId: string, id: string) => {
    const row = snapshotRef.current.drafts[agentId]?.find((item) => item.id === id);
    if (row?.status === "failed") void run(agentId, row);
  }, [run]);
  return { attachmentsByAgent: snapshot.scope === scope ? snapshot.drafts : {}, addAttachments, clearAttachments, retryAttachment };
}
