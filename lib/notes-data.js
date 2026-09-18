import { randomUUID } from "node:crypto";
import { normalizeStoredContent } from "./rich-text";

function dateOrNow(value) {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime())
    ? value
    : new Date().toISOString();
}

export function safeSpaceId(raw) {
  if (!raw || raw === "default") return "default";
  return String(raw).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "default";
}

export function contentDisposition(name, inline = false) {
  const rawName = typeof name === "string" && name.trim() ? name.trim() : "download";
  const safeAscii = rawName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(rawName)}`;
}

export function normalizeAttachment(attachment) {
  if (!attachment || typeof attachment !== "object") return null;

  if (attachment.kind === "link" && typeof attachment.url === "string") {
    try {
      const url = new URL(attachment.url);
      if (!["http:", "https:"].includes(url.protocol)) return null;
      return {
        id: typeof attachment.id === "string" ? attachment.id : randomUUID(),
        kind: "link",
        url: url.toString(),
        name: typeof attachment.name === "string" ? attachment.name.slice(0, 180) : url.hostname,
      };
    } catch {
      return null;
    }
  }

  if (typeof attachment.key !== "string" || !attachment.key.trim()) return null;
  const contentType = typeof attachment.contentType === "string"
    ? attachment.contentType.slice(0, 160)
    : "application/octet-stream";

  return {
    id: typeof attachment.id === "string" ? attachment.id : randomUUID(),
    kind: contentType.startsWith("image/") ? "image" : "file",
    key: attachment.key,
    name: typeof attachment.name === "string" ? attachment.name.slice(0, 180) : "Attachment",
    contentType,
    size: Number.isFinite(attachment.size) ? Math.max(0, attachment.size) : 0,
    ...(typeof attachment.thumbnail === "string" && attachment.thumbnail.startsWith("data:image/")
      ? { thumbnail: attachment.thumbnail.slice(0, 60_000) }
      : {}),
  };
}

export function normalizeShare(share) {
  if (!share || typeof share !== "object") return undefined;
  return {
    enabled: Boolean(share.enabled),
    allowEdit: Boolean(share.allowEdit),
    token: typeof share.token === "string" ? share.token : "",
    updatedAt: typeof share.updatedAt === "string" ? share.updatedAt : undefined,
  };
}

export function normalizeMessage(message) {
  const attachments = Array.isArray(message?.attachments)
    ? message.attachments.map(normalizeAttachment).filter(Boolean)
    : [];
  const { content, contentFormat } = normalizeStoredContent(message?.content, message?.contentFormat);

  return {
    id: typeof message?.id === "string" ? message.id : randomUUID(),
    content,
    contentFormat,
    attachments,
    createdAt: dateOrNow(message?.createdAt),
    updatedAt: dateOrNow(message?.updatedAt ?? message?.createdAt),
    ...(message?.share ? { share: normalizeShare(message.share) } : {}),
  };
}

export function normalizeItems(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item.id === "string").map(normalizeMessage);
}

export function readStoredItems(document) {
  return normalizeItems(document?.items);
}
