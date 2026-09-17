import { Readable } from "node:stream";
import { NextResponse } from "next/server";

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
    const key = searchParams.get("key");
    const id = searchParams.get("id");
    const token = searchParams.get("token");
    let spaceId = safeSpaceId(searchParams.get("space"));
    const isDownload = searchParams.get("download") === "1";

    if (!key || !id || !token) {
      return response({ error: "Thiếu thông tin yêu cầu tệp." }, 400);
    }

    const { getItems, getAttachment, getAttachmentDownloadUrl } = await import("../../../../lib/gdrive-notes");
    let items = await getItems(spaceId);
    let item = items.find((entry) => entry.id === id);

    if (!item) {
      const { parseConfiguredKeys } = await import("../../../../lib/access");
      const candidateSpaces = new Set(["default", ...parseConfiguredKeys().values()]);
      candidateSpaces.delete(spaceId);
      for (const other of candidateSpaces) {
        const otherItems = await getItems(other);
        const found = otherItems.find((entry) => entry.id === id);
        if (found) {
          item = found;
          spaceId = other;
          break;
        }
      }
    }

    if (!item || !item.share?.enabled || item.share?.token !== token) {
      return response({ error: "Không có quyền truy cập tệp." }, 403);
    }

    // Verify file key belongs to this note's attachments
    const hasKey = item.attachments?.some((att) => att.key === key);
    if (!hasKey) {
      return response({ error: "Tệp không thuộc ghi chú này." }, 403);
    }

    if (isDownload) {
      const url = await getAttachmentDownloadUrl({ key, spaceId });
      return response({ url });
    }

    const ifNoneMatch = request.headers.get("if-none-match");
    if (ifNoneMatch) {
      const { getAttachmentMeta } = await import("../../../../lib/gdrive-notes");
      const meta = await getAttachmentMeta({ key, spaceId });
      if (meta.eTag && (ifNoneMatch === meta.eTag || ifNoneMatch === `"${meta.eTag}"` || ifNoneMatch === meta.eTag.replace(/^"|"$/g, ""))) {
        return new NextResponse(null, {
          status: 304,
          headers: {
            "Cache-Control": "private, max-age=86400, stale-while-revalidate=604800",
            "ETag": meta.eTag,
          },
        });
      }
    }

    const file = await getAttachment({ key, spaceId });

    const stream = typeof file.body.transformToWebStream === "function"
      ? file.body.transformToWebStream()
      : Readable.toWeb(file.body);

    return new NextResponse(stream, {
      headers: {
        "Cache-Control": "private, max-age=86400, stale-while-revalidate=604800",
        "Content-Type": file.contentType,
        "Content-Disposition": file.contentDisposition || "attachment",
        "X-Content-Type-Options": "nosniff",
        ...(file.eTag ? { ETag: file.eTag } : {}),
      },
    });
  } catch (error) {
    console.error("Share files GET error:", error);
    return response({ error: "Không thể tải tệp tin." }, 500);
  }
}
