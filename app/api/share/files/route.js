import { NextResponse } from "next/server";
import { parseFileTransport } from "../../../../lib/file-transport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function response(data, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function safeSpaceId(raw) {
  if (!raw || raw === "default") return "default";
  return String(raw).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "default";
}

async function findSharedItem(id, requestedSpace) {
  const { getItems } = await import("../../../../lib/r2-notes");
  let spaceId = requestedSpace;
  let items = await getItems(spaceId);
  let item = items.find((entry) => entry.id === id);
  if (item) return { item, spaceId };

  const { parseConfiguredKeys } = await import("../../../../lib/access");
  const candidateSpaces = new Set(["default", ...parseConfiguredKeys().values()]);
  candidateSpaces.delete(spaceId);
  for (const otherSpace of candidateSpaces) {
    items = await getItems(otherSpace);
    item = items.find((entry) => entry.id === id);
    if (item) return { item, spaceId: otherSpace };
  }
  return { item: null, spaceId };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const transport = parseFileTransport(searchParams.get("transport") ?? undefined);
    const key = searchParams.get("key");
    const id = searchParams.get("id");
    const token = searchParams.get("token");
    const requestedSpace = safeSpaceId(searchParams.get("space"));
    const isDownload = searchParams.get("download") === "1";
    const format = searchParams.get("format");
    if (!key || !id || !token) return response({ error: "Thiếu thông tin yêu cầu tệp." }, 400);

    const { item, spaceId } = await findSharedItem(id, requestedSpace);
    if (!item || !item.share?.enabled || item.share.token !== token) {
      return response({ error: "Không có quyền truy cập tệp." }, 403);
    }
    const attachment = item.attachments?.find((entry) => entry.key === key);
    if (!attachment) return response({ error: "Tệp không thuộc ghi chú này." }, 403);

    const { getAttachmentMeta, getAttachmentDownloadUrl } = await import("../../../../lib/r2-notes");
    const meta = await getAttachmentMeta({ key, spaceId });
    const url = await getAttachmentDownloadUrl({
      key,
      name: attachment.name,
      contentType: meta.mimeType || attachment.contentType,
      download: isDownload,
      spaceId,
      transport,
    });
    if (format === "json") {
      return response({ url, expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() });
    }
    return NextResponse.redirect(new URL(url, request.url), { status: 302, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode || error?.status;
    if (status === 400) return response({ error: error.message }, 400);
    console.error("Share files GET error:", { status, name: error?.name });
    return response({ error: status === 404 ? "Không tìm thấy tệp tin." : "Không thể tải tệp tin." }, status === 404 ? 404 : 500);
  }
}
