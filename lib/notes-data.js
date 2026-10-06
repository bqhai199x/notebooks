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

  let kind = "file";
  if (contentType.startsWith("image/") || attachment.kind === "image") {
    kind = "image";
  } else if (contentType.startsWith("video/") || attachment.kind === "video") {
    kind = "video";
  }

  return {
    id: typeof attachment.id === "string" ? attachment.id : randomUUID(),
    kind,
    key: attachment.key,
    name: typeof attachment.name === "string" ? attachment.name.slice(0, 180) : "Attachment",
    contentType,
    size: Number.isFinite(attachment.size) ? Math.max(0, attachment.size) : 0,
    ...(Number.isFinite(attachment.duration) && attachment.duration > 0
      ? { duration: Math.round(attachment.duration) }
      : {}),
    ...(typeof attachment.thumbnail === "string" && (attachment.thumbnail.startsWith("data:image/") || attachment.thumbnail.startsWith("data:video/"))
      ? { thumbnail: attachment.thumbnail.slice(0, 80_000) }
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

export const DEFAULT_CATEGORY_ID = "tab-1";
export const DEFAULT_CATEGORY_NAME = "Ghi chú";

export function normalizeCategory(category, index = 0) {
  if (!category || typeof category !== "object") return null;
  const id = typeof category.id === "string" && category.id.trim()
    ? category.id.trim().slice(0, 64)
    : `tab-${index + 1}`;
  const name = typeof category.name === "string" && category.name.trim()
    ? category.name.trim().slice(0, 60)
    : (id === DEFAULT_CATEGORY_ID ? DEFAULT_CATEGORY_NAME : `Danh mục ${index + 1}`);
  return {
    id,
    name,
    ...(category.isDefault || id === DEFAULT_CATEGORY_ID ? { isDefault: true } : {}),
  };
}

export function normalizeCategories(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return [{ id: DEFAULT_CATEGORY_ID, name: DEFAULT_CATEGORY_NAME, isDefault: true }];
  }
  const seenIds = new Set();
  const result = [];
  for (let i = 0; i < value.length; i++) {
    const cat = normalizeCategory(value[i], i);
    if (cat && !seenIds.has(cat.id)) {
      seenIds.add(cat.id);
      result.push(cat);
    }
  }
  if (!result.some((c) => c.id === DEFAULT_CATEGORY_ID)) {
    result.unshift({ id: DEFAULT_CATEGORY_ID, name: DEFAULT_CATEGORY_NAME, isDefault: true });
  }
  return result;
}

export function normalizeMessage(message) {
  const attachments = Array.isArray(message?.attachments)
    ? message.attachments.map(normalizeAttachment).filter(Boolean)
    : [];
  const { content, contentFormat } = normalizeStoredContent(message?.content, message?.contentFormat);
  const categoryId = typeof message?.categoryId === "string" && message.categoryId.trim()
    ? message.categoryId.trim()
    : (typeof message?.category === "string" && message.category.trim() ? message.category.trim() : DEFAULT_CATEGORY_ID);

  return {
    id: typeof message?.id === "string" ? message.id : randomUUID(),
    categoryId,
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

export function readStoredData(document) {
  return {
    categories: normalizeCategories(document?.categories),
    items: normalizeItems(document?.items),
  };
}
