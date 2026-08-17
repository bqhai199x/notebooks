import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { accessIsConfigured, hasAccess } from "../../../lib/access";

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

function validParts(parts) {
  if (!Array.isArray(parts) || !parts.length || parts.length > 10_000) return false;
  const partNumbers = new Set();
  return parts.every((part) => {
    if (!part || typeof part !== "object") return false;
    const { partNumber, eTag } = part;
    if (!Number.isInteger(partNumber) || partNumber <= 0 || partNumber > 10_000 || partNumbers.has(partNumber)) {
      return false;
    }
    if (typeof eTag !== "string" || !eTag.length || eTag.length > 1024) return false;
    partNumbers.add(partNumber);
    return true;
  });
}

export async function POST(request) {
  const denied = authorize(request);
  if (denied) return denied;

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

      const { createAttachmentUpload } = await import("../../../lib/s3-notes");
      const result = await createAttachmentUpload({
        id: randomUUID(),
        name: typeof body.name === "string" ? body.name : "file",
        contentType: typeof body.contentType === "string" ? body.contentType : "",
        size,
      });
      return response(result, 201);
    }

    if (body.action === "complete") {
      if (typeof body.key !== "string" || typeof body.uploadId !== "string" || !validParts(body.parts)) {
        return response({ error: "Invalid multipart upload." }, 400);
      }

      const { completeAttachmentUpload } = await import("../../../lib/s3-notes");
      await completeAttachmentUpload({ key: body.key, uploadId: body.uploadId, parts: body.parts });
      return response({ success: true });
    }

    if (body.action === "abort") {
      if (typeof body.key !== "string" || typeof body.uploadId !== "string") {
        return response({ error: "Invalid multipart upload." }, 400);
      }

      const { abortAttachmentUpload } = await import("../../../lib/s3-notes");
      await abortAttachmentUpload({ key: body.key, uploadId: body.uploadId });
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
    const key = new URL(request.url).searchParams.get("key");
    if (!key) return response({ error: "Missing file." }, 400);

    const { deleteAttachments } = await import("../../../lib/s3-notes");
    await deleteAttachments([key]);
    return response({ success: true });
  } catch (error) {
    console.error("Upload cleanup error:", error);
    return response({ error: "Could not remove file." }, 500);
  }
}
