import { NextResponse } from "next/server";
import {
  inlineImageAttachmentIds,
  prepareRichTextContent,
  richTextHasText,
} from "../../../lib/rich-text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function response(data, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function safeSpaceId(raw) {
  if (!raw || raw === "default") return "default";
  return String(raw).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const token = searchParams.get("token");
    const spaceId = safeSpaceId(searchParams.get("space"));

    if (!id || !token) {
      return response({ error: "Thiếu thông tin liên kết chia sẻ." }, 400);
    }

    const { getItems } = await import("../../../lib/s3-notes");
    let items = await getItems(spaceId);
    let item = items.find((entry) => entry.id === id);

    if (!item) {
      const { parseConfiguredKeys } = await import("../../../lib/access");
      const keyMap = parseConfiguredKeys();
      const candidateSpaces = new Set(["default", ...keyMap.values()]);
      candidateSpaces.delete(spaceId);

      for (const other of candidateSpaces) {
        const otherItems = await getItems(other);
        const found = otherItems.find((entry) => entry.id === id);
        if (found) {
          item = found;
          break;
        }
      }
    }

    if (!item) {
      return response({ error: "Ghi chú không tồn tại hoặc đã bị xóa." }, 404);
    }

    if (!item.share?.enabled) {
      return response({ error: "Liên kết chia sẻ này đã bị tắt hoặc thu hồi." }, 403);
    }

    if (item.share?.token !== token) {
      return response({ error: "Liên kết chia sẻ không hợp lệ hoặc đã bị thay đổi." }, 403);
    }

    return response({
      item,
      allowEdit: Boolean(item.share.allowEdit),
    });
  } catch (error) {
    console.error("Share GET error:", error);
    return response({ error: "Không thể tải ghi chú chia sẻ." }, 500);
  }
}

export async function PATCH(request) {
  try {
    const input = await request.json();
    const { id, token, content, contentFormat } = input;
    let spaceId = safeSpaceId(input.space);

    if (!id || !token) {
      return response({ error: "Thiếu thông tin xác thực chia sẻ." }, 400);
    }

    const prepared = prepareRichTextContent(content ?? "", contentFormat);

    let updatedItem = null;
    const { getItemsWithMeta, saveItems, getItems } = await import("../../../lib/s3-notes");

    // Verify space where item actually resides
    let itemsCheck = await getItems(spaceId);
    if (!itemsCheck.some((entry) => entry.id === id)) {
      const { parseConfiguredKeys } = await import("../../../lib/access");
      const candidateSpaces = new Set(["default", ...parseConfiguredKeys().values()]);
      candidateSpaces.delete(spaceId);
      for (const other of candidateSpaces) {
        const otherItems = await getItems(other);
        if (otherItems.some((entry) => entry.id === id)) {
          spaceId = other;
          break;
        }
      }
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      const { items, eTag } = await getItemsWithMeta(spaceId);
      const index = items.findIndex((entry) => entry.id === id);

      if (index === -1) {
        return response({ error: "Ghi chú không tồn tại." }, 404);
      }

      const item = items[index];
      if (!item.share?.enabled || item.share?.token !== token) {
        return response({ error: "Liên kết chia sẻ này đã bị tắt hoặc thu hồi." }, 403);
      }

      if (!item.share?.allowEdit) {
        return response({ error: "Ghi chú này không cho phép chỉnh sửa." }, 403);
      }

      let nextAttachments = item.attachments;
      if (Array.isArray(input.attachments)) {
        const allowedIds = new Set(input.attachments.map((a) => (typeof a === "string" ? a : a?.id)));
        nextAttachments = (item.attachments || []).filter((a) => allowedIds.has(a.id));
      }

      const nextItem = {
        ...item,
        content: prepared.content,
        contentFormat: prepared.contentFormat,
        attachments: nextAttachments,
        updatedAt: new Date().toISOString(),
      };

      items[index] = nextItem;
      updatedItem = nextItem;

      try {
        await saveItems(items, eTag ? { expectedETag: eTag } : {}, spaceId);
        break;
      } catch (error) {
        const isPrecondition = error?.name === "PreconditionFailed" || error?.$metadata?.httpStatusCode === 412;
        if (isPrecondition && attempt < 2) {
          await new Promise((res) => setTimeout(res, 50 * (attempt + 1)));
          continue;
        }
        throw error;
      }
    }

    return response({
      item: updatedItem,
      allowEdit: true,
    });
  } catch (error) {
    console.error("Share PATCH error:", error);
    return response({ error: "Không thể lưu thay đổi cho ghi chú." }, 500);
  }
}
