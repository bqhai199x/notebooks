import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { accessIsConfigured, getAccessSpace, hasAccess } from "../../../lib/access";
import {
  inlineImageAttachmentIds,
  prepareRichTextContent,
  richTextHasText,
} from "../../../lib/rich-text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ATTACHMENTS = 10;

function response(data, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function authorize(request) {
  if (!accessIsConfigured()) return response({ error: "App is not ready." }, 503);
  if (!hasAccess(request)) return response({ error: "Wrong access key." }, 401);
  return null;
}

function uploadsPrefix(spaceId) {
  const basePrefix = (process.env.S3_UPLOAD_PREFIX || "notes/uploads").replace(/^\/+|\/+$/g, "");
  if (!spaceId || spaceId === "default") return basePrefix;

  const safeSpace = spaceId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  return `notes/spaces/${safeSpace}/uploads`;
}

function normalizeAttachment(value, spaceId) {
  if (!value || typeof value !== "object") return null;

  if (value.kind === "link" && typeof value.url === "string") {
    try {
      const url = new URL(value.url);
      if (!["http:", "https:"].includes(url.protocol)) return null;
      return {
        id: typeof value.id === "string" ? value.id : randomUUID(),
        kind: "link",
        url: url.toString(),
        name: typeof value.name === "string" ? value.name.slice(0, 180) : url.hostname,
      };
    } catch {
      return null;
    }
  }

  if (!['image', 'file'].includes(value.kind) || typeof value.id !== "string" || typeof value.key !== "string") {
    return null;
  }

  const contentType = typeof value.contentType === "string"
    ? value.contentType.slice(0, 160)
    : "application/octet-stream";
  const kind = contentType.startsWith("image/") ? "image" : "file";
  if (value.kind !== kind || !value.key.startsWith(`${uploadsPrefix(spaceId)}/`)) return null;

  return {
    id: value.id,
    kind,
    key: value.key,
    name: typeof value.name === "string" ? value.name.slice(0, 180) : "Attachment",
    contentType,
    size: Number.isFinite(value.size) ? Math.max(0, value.size) : 0,
    ...(typeof value.thumbnail === "string" && value.thumbnail.startsWith("data:image/")
      ? { thumbnail: value.thumbnail.slice(0, 60_000) }
      : {}),
  };
}

function attachments(value, spaceId) {
  if (!Array.isArray(value)) return [];
  if (value.length > MAX_ATTACHMENTS) throw new Error("Too many attachments.");
  const normalized = value.map((attachment) => normalizeAttachment(attachment, spaceId)).filter(Boolean);
  if (new Set(normalized.map((attachment) => attachment.id)).size !== normalized.length) {
    throw new Error("Duplicate attachment.");
  }
  return normalized;
}

function validateInlineImages(delta, itemAttachments) {
  if (!delta) return;

  const imageAttachmentIds = new Set(itemAttachments
    .filter((attachment) => attachment.kind === "image")
    .map((attachment) => attachment.id));

  for (const attachmentId of inlineImageAttachmentIds(delta)) {
    if (!imageAttachmentIds.has(attachmentId)) {
      throw new Error("An embedded image must reference an attached image.");
    }
  }
}

function itemContent(input, itemAttachments) {
  const prepared = prepareRichTextContent(input.content ?? "", input.contentFormat);
  validateInlineImages(prepared.delta, itemAttachments);
  return prepared;
}

function hasItemContent(prepared) {
  return prepared.delta ? richTextHasText(prepared.delta) : Boolean(prepared.content);
}

async function body(request) {
  try {
    return await request.json();
  } catch {
    throw new Error("Invalid data.");
  }
}

function errorResponse(error) {
  console.error("Items API error:", error);
  return response({ error: "Could not save your notes. Try again." }, 500);
}

const MAX_RETRIES = 3;

async function modifyItemsWithRetry(mutator, spaceId = null) {
  const { getItemsWithMeta, saveItems } = await import("../../../lib/s3-notes");
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { items, eTag } = await getItemsWithMeta(spaceId);
    const result = await mutator(items);
    if (!result || result.abort) return result;
    try {
      await saveItems(result.nextItems, eTag ? { expectedETag: eTag } : {}, spaceId);
      return result;
    } catch (error) {
      const isPreconditionFailed = error?.name === "PreconditionFailed"
        || error?.$metadata?.httpStatusCode === 412;
      if (isPreconditionFailed && attempt < MAX_RETRIES - 1) {
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
}

export async function GET(request) {
  const denied = authorize(request);
  if (denied) return denied;

  try {
    const spaceId = getAccessSpace(request);
    const { getItems } = await import("../../../lib/s3-notes");
    return response({ items: await getItems(spaceId), spaceId: spaceId || "default" });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request) {
  const denied = authorize(request);
  if (denied) return denied;

  try {
    const spaceId = getAccessSpace(request);
    const input = await body(request);
    const itemAttachments = attachments(input.attachments, spaceId);
    const prepared = itemContent(input, itemAttachments);
    if (!hasItemContent(prepared) && itemAttachments.length === 0) {
      return response({ error: "Item is empty." }, 400);
    }

    const now = new Date().toISOString();
    const item = {
      id: randomUUID(),
      content: prepared.content,
      contentFormat: prepared.contentFormat,
      attachments: itemAttachments,
      createdAt: now,
      updatedAt: now,
    };

    await modifyItemsWithRetry((items) => {
      items.unshift(item);
      return { nextItems: items, item };
    }, spaceId);

    return response({ item }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request) {
  const denied = authorize(request);
  if (denied) return denied;

  try {
    const spaceId = getAccessSpace(request);
    const input = await body(request);
    if (
      !["edit-item", "delete-item", "reorder-item", "update-share"].includes(input.action)
      || typeof input.id !== "string"
      || (input.action === "reorder-item" && input.beforeId != null && typeof input.beforeId !== "string")
      || (input.action === "reorder-item" && input.beforeId === input.id)
    ) {
      return response({ error: "Invalid request." }, 400);
    }

    const { deleteAttachments } = await import("../../../lib/s3-notes");
    let removedAttachmentKeys = [];
    let updatedItem = null;

    const result = await modifyItemsWithRetry((items) => {
      const index = items.findIndex((entry) => entry.id === input.id);
      if (index === -1) {
        return { abort: true, notFound: true };
      }

      if (input.action === "update-share") {
        const currentItem = items[index];
        const prevShare = currentItem.share || {};
        let token = prevShare.token;
        if (!token || input.regenerateToken) {
          token = randomUUID().replace(/-/g, "");
        }
        const updatedShare = {
          enabled: Boolean(input.enabled),
          allowEdit: Boolean(input.allowEdit),
          token,
          updatedAt: new Date().toISOString(),
        };
        const item = {
          ...currentItem,
          share: updatedShare,
        };
        items[index] = item;
        updatedItem = item;
        return { nextItems: items, item, isShareUpdate: true };
      }

      if (input.action === 'delete-item') {
        const deleted = items[index];
        removedAttachmentKeys = deleted.attachments.map((attachment) => attachment.key).filter(Boolean);
        return { nextItems: items.filter((entry) => entry.id !== input.id), isDelete: true };
      }

      if (input.action === "reorder-item") {
        const [item] = items.splice(index, 1);
        const destinationIndex = input.beforeId == null
          ? items.length
          : items.findIndex((entry) => entry.id === input.beforeId);

        if (destinationIndex === -1) {
          return { abort: true, beforeNotFound: true };
        }

        items.splice(destinationIndex, 0, item);
        return { nextItems: items, isReorder: true, items };
      }

      const itemAttachments = Array.isArray(input.attachments)
        ? attachments(input.attachments, spaceId)
        : items[index].attachments;
      const prepared = itemContent(input, itemAttachments);
      if (!hasItemContent(prepared) && itemAttachments.length === 0) {
        return { abort: true, empty: true };
      }

      const item = {
        ...items[index],
        content: prepared.content,
        contentFormat: prepared.contentFormat,
        attachments: itemAttachments,
        updatedAt: new Date().toISOString(),
      };
      removedAttachmentKeys = items[index].attachments
        .filter((attachment) => attachment.key && !itemAttachments.some((next) => next.key === attachment.key))
        .map((attachment) => attachment.key);

      items[index] = item;
      updatedItem = item;
      return { nextItems: items, item };
    }, spaceId);

    if (result?.notFound) return response({ error: "Item not found." }, 404);
    if (result?.empty) return response({ error: "Item is empty." }, 400);
    if (result?.beforeNotFound) {
      return response({ error: "The list changed. Refresh and try again." }, 409);
    }

    if (removedAttachmentKeys.length > 0) {
      await deleteAttachments(removedAttachmentKeys, spaceId);
    }

    if (result?.isDelete) {
      return response({ success: true });
    }

    if (result?.isReorder) {
      return response({ items: result.items });
    }

    return response({ item: updatedItem });
  } catch (error) {
    return errorResponse(error);
  }
}
