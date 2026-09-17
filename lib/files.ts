import type { MessageAttachment } from "./types";

export const MAX_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_ATTACHMENTS = 8;
export interface PickedFile { uri: string; name: string; mime: string; size: number; file?: File }
export interface UploadedFile extends MessageAttachment {
  id: string; name: string; mime: string; size: number; type: "image" | "file" | "audio" | "video";
}
export interface DraftAttachment {
  id: string; source: PickedFile; status: "uploading" | "ready" | "failed"; file?: UploadedFile; error?: string;
}

export function validatePickedFiles(files: PickedFile[], existing = 0): void {
  if (files.length + existing > MAX_ATTACHMENTS) throw new Error("Send up to 8 attachments per message.");
  for (const file of files) {
    if (!file.name.trim() || !file.uri) throw new Error("This file could not be read. Choose it again.");
    if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error(`${file.name} is empty or could not be read.`);
    if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} exceeds the 16 MiB file limit.`);
  }
}

export function parseUploadedFile(value: unknown): UploadedFile {
  const file = value as UploadedFile | null;
  if (!file || typeof file.id !== "string" || !file.id.trim() || file.id.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(file.id) || Object.hasOwn(Object.prototype, file.id) || file.id === "prototype" ||
    typeof file.name !== "string" || !file.name.trim() || typeof file.mime !== "string" ||
    !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_FILE_BYTES ||
    !["image", "file", "audio", "video"].includes(file.type)) throw new Error("Zakura returned an invalid uploaded file.");
  let url: URL;
  try { url = new URL(file.url); } catch { throw new Error("Zakura returned an invalid file URL."); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Zakura returned an invalid file URL.");
  return { id: file.id, name: file.name, mime: file.mime, size: file.size, type: file.type, url: url.href };
}

export function attachmentIdentity(files?: MessageAttachment[]): string {
  return JSON.stringify((files ?? []).map((file) => file.id ?? file.url));
}

/** Zakura's inbound runtime uses a filename caption for a send without typed text. */
export function fileMessageText(text: string, files?: MessageAttachment[]): string {
  return text.trim() || (files?.length ? `📎 ${files.map((file) => file.name ?? "File").join(", ")}` : "");
}

export function formatFileSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export const botFilePath = (agentId: string, fileId?: string) => `/api/zakurabot/agents/${encodeURIComponent(agentId)}/files${fileId ? `/${encodeURIComponent(fileId)}` : ""}`;
