import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { accessIsConfigured, getAccessSpace, hasAccess } from "../../../lib/access";
import {
  inlineImageAttachmentIds,
  prepareRichTextContent,
  richTextHasText,
} from "../../../lib/rich-text";
import { DEFAULT_CATEGORY_ID } from "../../../lib/notes-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ATTACHMENTS = 10;

const isDev = process.env.NODE_ENV !== "production";

function corsHeaders() {
  if (!isDev) return {};
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-notes-access-key",
  };
}

function response(data, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...corsHeaders(),
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...corsHeaders(),
    },
  });
}

function authorize(request) {
  if (!accessIsConfigured()) return response({ error: "App is not ready." }, 503);
  if (!hasAccess(request)) return response({ error: "Wrong access key." }, 401);
  return null;
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

  if (!['image', 'file', 'video'].includes(value.kind) || typeof value.id !== "string" || typeof value.key !== "string" || !value.key.trim()) {
    return null;
  }

  const contentType = typeof value.contentType === "string"
    ? value.contentType.slice(0, 160)
    : "application/octet-stream";
  let kind = "file";
  if (contentType.startsWith("image/") || value.kind === "image") {
    kind = "image";
  } else if (contentType.startsWith("video/") || value.kind === "video") {
    kind = "video";
  }
  if (value.kind !== kind) return null;

  return {
    id: value.id,
    kind,
    key: value.key,
    name: typeof value.name === "string" ? value.name.slice(0, 180) : "Attachment",
    contentType,
    size: Number.isFinite(value.size) ? Math.max(0, value.size) : 0,
    ...(typeof value.thumbnail === "string" && (value.thumbnail.startsWith("data:image/") || value.thumbnail.startsWith("data:video/"))
      ? { thumbnail: value.thumbnail.slice(0, 80_000) }
      : {}),
  };
}

function attachments(value) {
  if (!Array.isArray(value)) return [];
  if (value.length > MAX_ATTACHMENTS) throw new Error("Too many attachments.");
  const normalized = value.map((attachment) => normalizeAttachment(attachment)).filter(Boolean);
  if (new Set(normalized.map((attachment) => attachment.id)).size !== normalized.length) {
    throw new Error("Duplicate attachment.");
  }
  return normalized;
}

async function verifyStoredAttachments(itemAttachments, spaceId) {
  const { attachmentKeyBelongsToSpace, getAttachmentMeta } = await import("../../../lib/r2-notes");
  await Promise.all(itemAttachments
    .filter((attachment) => attachment.kind !== "link")
    .map(async (attachment) => {
      if (!attachmentKeyBelongsToSpace(attachment.key, spaceId)) throw new Error("Invalid attachment.");
      const meta = await getAttachmentMeta({ key: attachment.key, spaceId });
      if (meta.size !== attachment.size || meta.mimeType !== attachment.contentType) {
        throw new Error("Attachment verification failed.");
      }
    }));
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
  if (error?.name === "PreconditionFailed" || error?.status === 412 || error?.$metadata?.httpStatusCode === 412) {
    return response({ error: "The list changed. Refresh and try again." }, 409);
  }
  if (error?.status === 503) return response({ error: error.message }, 503);
  return response({ error: "Could not save your notes. Try again." }, 500);
}

const MAX_RETRIES = 3;

async function modifyItemsWithRetry(mutator, spaceId = null) {
  const { getItemsWithMeta, saveItems } = await import("../../../lib/r2-notes");
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { items, categories, eTag } = await getItemsWithMeta(spaceId);
    const result = await mutator({ items, categories });
    if (!result || result.abort) return result;
    try {
      await saveItems({
        items: result.nextItems,
        categories: result.nextCategories ?? categories,
      }, eTag ? { expectedETag: eTag } : {}, spaceId);
      return result;
    } catch (error) {
      const isPreconditionFailed = error?.name === "PreconditionFailed"
        || error?.$metadata?.httpStatusCode === 412
        || error?.status === 412
        || error?.code === 412;
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
    const { getItemsWithMeta } = await import("../../../lib/r2-notes");
    const { items, categories } = await getItemsWithMeta(spaceId);
    return response({ items, categories, spaceId: spaceId || "default" });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request) {
  const denied = authorize(request);
  if (denied) return denied;

  try {
    const { storageIsReadOnly } = await import("../../../lib/r2-notes");
    if (storageIsReadOnly()) return response({ error: "Notes are temporarily read-only while storage maintenance is in progress." }, 503);
    const spaceId = getAccessSpace(request);
    const input = await body(request);
    const itemAttachments = attachments(input.attachments);
    await verifyStoredAttachments(itemAttachments, spaceId);
    const prepared = itemContent(input, itemAttachments);
    if (!hasItemContent(prepared) && itemAttachments.length === 0) {
      return response({ error: "Item is empty." }, 400);
    }

    const now = new Date().toISOString();
    const categoryId = typeof input.categoryId === "string" && input.categoryId.trim()
      ? input.categoryId.trim()
      : DEFAULT_CATEGORY_ID;

    const item = {
      id: randomUUID(),
      categoryId,
      content: prepared.content,
      contentFormat: prepared.contentFormat,
      attachments: itemAttachments,
      createdAt: now,
      updatedAt: now,
    };

    await modifyItemsWithRetry(({ items, categories }) => {
      items.unshift(item);
      return { nextItems: items, nextCategories: categories, item };
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
    const { storageIsReadOnly } = await import("../../../lib/r2-notes");
    if (storageIsReadOnly()) return response({ error: "Notes are temporarily read-only while storage maintenance is in progress." }, 503);
    const spaceId = getAccessSpace(request);
    const input = await body(request);
    const validActions = [
      "edit-item",
      "delete-item",
      "reorder-item",
      "update-share",
      "move-category",
      "save-categories",
      "delete-category",
    ];
    if (!validActions.includes(input.action)) {
      return response({ error: "Invalid request." }, 400);
    }

    if (input.action === "save-categories") {
      if (!Array.isArray(input.categories)) {
        return response({ error: "Invalid categories." }, 400);
      }
      const { normalizeCategories } = await import("../../../lib/notes-data");
      const nextCategories = normalizeCategories(input.categories);
      await modifyItemsWithRetry(({ items }) => {
        return { nextItems: items, nextCategories };
      }, spaceId);
      return response({ success: true, categories: nextCategories });
    }

    if (input.action === "delete-category") {
      if (typeof input.categoryId !== "string" || input.categoryId === DEFAULT_CATEGORY_ID) {
        return response({ error: "Cannot delete default category." }, 400);
      }
      const { normalizeCategories } = await import("../../../lib/notes-data");
      const { deleteUnreferencedAttachments } = await import("../../../lib/r2-notes");
      const deleteNotes = Boolean(input.deleteNotes);
      let updatedItems = [];
      let finalCategories = [];
      let removedAttachmentKeys = [];

      await modifyItemsWithRetry(({ items, categories }) => {
        finalCategories = normalizeCategories(categories.filter((c) => c.id !== input.categoryId));
        if (deleteNotes) {
          const notesToDelete = items.filter((it) => it.categoryId === input.categoryId);
          removedAttachmentKeys = notesToDelete.flatMap((it) => it.attachments?.map((att) => att.key).filter(Boolean) || []);
          updatedItems = items.filter((it) => it.categoryId !== input.categoryId);
        } else {
          updatedItems = items.map((it) => {
            if (it.categoryId === input.categoryId) {
              return { ...it, categoryId: DEFAULT_CATEGORY_ID, updatedAt: new Date().toISOString() };
            }
            return it;
          });
        }
        return { nextItems: updatedItems, nextCategories: finalCategories };
      }, spaceId);

      if (removedAttachmentKeys.length > 0) {
        await deleteUnreferencedAttachments(removedAttachmentKeys, spaceId);
      }

      return response({ success: true, categories: finalCategories, items: updatedItems });
    }

    if (input.action === "move-category") {
      if (typeof input.id !== "string" || typeof input.categoryId !== "string") {
        return response({ error: "Invalid request." }, 400);
      }
      let movedItem = null;
      const result = await modifyItemsWithRetry(({ items, categories }) => {
        const index = items.findIndex((entry) => entry.id === input.id);
        if (index === -1) return { abort: true, notFound: true };
        movedItem = {
          ...items[index],
          categoryId: input.categoryId,
          updatedAt: new Date().toISOString(),
        };
        items[index] = movedItem;
        return { nextItems: items, nextCategories: categories, item: movedItem };
      }, spaceId);
      if (result?.notFound) return response({ error: "Item not found." }, 404);
      return response({ item: movedItem });
    }

    if (
      typeof input.id !== "string"
      || (input.action === "reorder-item" && input.beforeId != null && typeof input.beforeId !== "string")
      || (input.action === "reorder-item" && input.beforeId === input.id)
    ) {
      return response({ error: "Invalid request." }, 400);
    }

    const { deleteUnreferencedAttachments } = await import("../../../lib/r2-notes");
    let removedAttachmentKeys = [];
    let updatedItem = null;

    const result = await modifyItemsWithRetry(async ({ items, categories }) => {
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
        return { nextItems: items, nextCategories: categories, item, isShareUpdate: true };
      }

      if (input.action === "delete-item") {
        const deleted = items[index];
        removedAttachmentKeys = deleted.attachments.map((attachment) => attachment.key).filter(Boolean);
        return { nextItems: items.filter((entry) => entry.id !== input.id), nextCategories: categories, isDelete: true };
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
        return { nextItems: items, nextCategories: categories, isReorder: true, items };
      }

      const itemAttachments = Array.isArray(input.attachments)
        ? attachments(input.attachments)
        : items[index].attachments;
      if (Array.isArray(input.attachments)) await verifyStoredAttachments(itemAttachments, spaceId);
      const prepared = itemContent(input, itemAttachments);
      if (!hasItemContent(prepared) && itemAttachments.length === 0) {
        return { abort: true, empty: true };
      }

      const item = {
        ...items[index],
        ...(typeof input.categoryId === "string" ? { categoryId: input.categoryId } : {}),
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
      return { nextItems: items, nextCategories: categories, item };
    }, spaceId);

    if (result?.notFound) return response({ error: "Item not found." }, 404);
    if (result?.empty) return response({ error: "Item is empty." }, 400);
    if (result?.beforeNotFound) {
      return response({ error: "The list changed. Refresh and try again." }, 409);
    }

    if (removedAttachmentKeys.length > 0) {
      await deleteUnreferencedAttachments(removedAttachmentKeys, spaceId);
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
