import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { accessIsConfigured, getAccessSpace, hasAccess } from "../../../lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CONTENT_LENGTH = 20_000;
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

function text(value) {
  if (typeof value !== "string" || value.length > MAX_CONTENT_LENGTH) {
    throw new Error("Invalid content.");
  }
  return value.trim();
}

function normalizeAttachment(value) {
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

  return {
    id: value.id,
    kind: value.kind,
    key: value.key,
    name: typeof value.name === "string" ? value.name.slice(0, 180) : "Attachment",
    contentType: typeof value.contentType === "string" ? value.contentType.slice(0, 160) : "application/octet-stream",
    size: Number.isFinite(value.size) ? Math.max(0, value.size) : 0,
  };
}

function attachments(value) {
  if (!Array.isArray(value)) return [];
  if (value.length > MAX_ATTACHMENTS) throw new Error("Too many attachments.");
  return value.map(normalizeAttachment).filter(Boolean);
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
    return response({ items: await getItems(spaceId) });
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
    const content = text(input.content ?? "");
    const itemAttachments = attachments(input.attachments);
    if (!content && itemAttachments.length === 0) return response({ error: "Item is empty." }, 400);

    const now = new Date().toISOString();
    const item = {
      id: randomUUID(),
      content,
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
    if (!['edit-item', 'delete-item'].includes(input.action) || typeof input.id !== "string") {
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

      if (input.action === 'delete-item') {
        const deleted = items[index];
        removedAttachmentKeys = deleted.attachments.map((attachment) => attachment.key).filter(Boolean);
        return { nextItems: items.filter((entry) => entry.id !== input.id), isDelete: true };
      }

      const content = text(input.content ?? "");
      const itemAttachments = Array.isArray(input.attachments)
        ? attachments(input.attachments)
        : items[index].attachments;
      if (!content && itemAttachments.length === 0) {
        return { abort: true, empty: true };
      }

      const item = {
        ...items[index],
        content,
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

    if (removedAttachmentKeys.length > 0) {
      await deleteAttachments(removedAttachmentKeys, spaceId);
    }

    if (result?.isDelete) {
      return response({ success: true });
    }

    return response({ item: updatedItem });
  } catch (error) {
    return errorResponse(error);
  }
}
