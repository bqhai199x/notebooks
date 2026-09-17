import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { accessIsConfigured, getAccessSpace, hasAccess } from "../../../lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
const ABSOLUTE_MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024 * 1024;

function maxUploadBytes() {
  const configured = Number(process.env.MAX_UPLOAD_BYTES);
  return Number.isSafeInteger(configured) && configured > 0
    ? Math.min(configured, ABSOLUTE_MAX_UPLOAD_BYTES)
    : DEFAULT_MAX_UPLOAD_BYTES;
}

function readableSize(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(0)} GB`;
  return `${Math.ceil(bytes / (1024 * 1024))} MB`;
}

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

export async function POST(request) {
  const denied = authorize(request);
  if (denied) return denied;

  const spaceId = getAccessSpace(request);
  const reqContentType = request.headers.get("content-type") || "";

  // 1. Direct FormData upload (tối ưu cho ảnh và file thông thường, không lo vấn đề CORS trình duyệt)
  if (reqContentType.includes("multipart/form-data")) {
    try {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!file || typeof file === "string") {
        return response({ error: "Choose a non-empty file first." }, 400);
      }
      if (file.size > maxUploadBytes()) {
        return response({ error: `Each file is limited to ${readableSize(maxUploadBytes())}.` }, 413);
      }

      const stream = Readable.fromWeb(file.stream());
      const { uploadAttachmentDirect } = await import("../../../lib/gdrive-notes");
      const attachment = await uploadAttachmentDirect({
        id: randomUUID(),
        name: file.name,
        contentType: file.type,
        data: stream,
        size: file.size,
        spaceId,
      });

      return response({ attachment }, 201);
    } catch (error) {
      console.error("Direct upload error:", error);
      return response({ error: "Upload failed: " + (error.message || "Unknown error") }, 500);
    }
  }

  // 2. JSON actions (initiate session, complete, abort)
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return response({ error: "Invalid upload request." }, 400);

  try {
    if (body.action === "initiate") {
      const size = Number(body.size);
      if (!Number.isSafeInteger(size) || size <= 0) {
        return response({ error: "Choose a non-empty file first." }, 400);
      }
      if (size > maxUploadBytes()) {
        return response({ error: `Each file is limited to ${readableSize(maxUploadBytes())}.` }, 413);
      }

      const origin = request.headers.get("origin") || undefined;
      const { createAttachmentUpload } = await import("../../../lib/gdrive-notes");
      const result = await createAttachmentUpload({
        id: randomUUID(),
        name: typeof body.name === "string" ? body.name : "file",
        contentType: typeof body.contentType === "string" ? body.contentType : "",
        size,
        spaceId,
        origin,
      });
      return response(result, 201);
    }

    if (body.action === "complete") {
      const { completeAttachmentUpload } = await import("../../../lib/gdrive-notes");
      await completeAttachmentUpload();
      return response({ success: true });
    }

    if (body.action === "abort") {
      const { abortAttachmentUpload } = await import("../../../lib/gdrive-notes");
      await abortAttachmentUpload({ key: body.key });
      return response({ success: true });
    }

    return response({ error: "Unknown upload action." }, 400);
  } catch (error) {
    console.error("Upload error:", error);
    return response({ error: "Upload setup failed. Try again." }, 500);
  }
}

export async function DELETE(request) {
  const denied = authorize(request);
  if (denied) return denied;

  try {
    const spaceId = getAccessSpace(request);
    const key = new URL(request.url).searchParams.get("key");
    if (!key) return response({ error: "Missing file." }, 400);

    const { deleteAttachments } = await import("../../../lib/gdrive-notes");
    await deleteAttachments([key], spaceId);
    return response({ success: true });
  } catch (error) {
    console.error("Upload cleanup error:", error);
    return response({ error: "Could not remove file." }, 500);
  }
}
