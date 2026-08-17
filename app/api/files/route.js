import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { accessIsConfigured, hasAccess } from "../../../lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET(request) {
  const denied = authorize(request);
  if (denied) return denied;

  try {
    const search = new URL(request.url).searchParams;
    const key = search.get("key");
    if (!key) return response({ error: "File not found." }, 400);

    if (search.get("download") === "1") {
      const { getAttachmentDownloadUrl } = await import("../../../lib/s3-notes");
      const url = await getAttachmentDownloadUrl({ key });
      return response({ url });
    }

    const { getAttachment } = await import("../../../lib/s3-notes");
    const file = await getAttachment({ key });
    const stream = typeof file.body.transformToWebStream === "function"
      ? file.body.transformToWebStream()
      : Readable.toWeb(file.body);

    return new NextResponse(stream, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": file.contentType,
        "Content-Disposition": file.contentDisposition || "attachment",
        "X-Content-Type-Options": "nosniff",
        ...(file.contentLength ? { "Content-Length": String(file.contentLength) } : {}),
      },
    });
  } catch (error) {
    console.error("Attachment URL error:", error);
    return response({ error: "Could not open file." }, 500);
  }
}
