import { randomUUID } from "node:crypto";
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
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function authorize(request) {
  if (!accessIsConfigured()) return response({ error: "App is not ready." }, 503);
  if (!hasAccess(request)) return response({ error: "Wrong access key." }, 401);
  return null;
}

function readOnlyResponse() {
  return response({ error: "Notes are temporarily read-only while storage maintenance is in progress." }, 503);
}

function validateSize(size) {
  if (!Number.isSafeInteger(size) || size <= 0) return "Choose a non-empty file first.";
  if (size > maxUploadBytes()) return `Each file is limited to ${readableSize(maxUploadBytes())}.`;
  return null;
}

export async function POST(request) {
  const denied = authorize(request);
  if (denied) return denied;

  const reqContentType = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (reqContentType !== "application/json") {
    return response({ error: "Send upload metadata as JSON." }, 415);
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return response({ error: "Invalid upload request." }, 400);

  try {
    const spaceId = getAccessSpace(request);
    const storage = await import("../../../lib/r2-notes");
    if (storage.storageIsReadOnly()) return readOnlyResponse();

    if (body.action === "initiate") {
      const size = Number(body.size);
      const sizeError = validateSize(size);
      if (sizeError) return response({ error: sizeError }, size > maxUploadBytes() ? 413 : 400);
      const result = await storage.createAttachmentUpload({
        id: randomUUID(),
        name: typeof body.name === "string" ? body.name : "file",
        contentType: typeof body.contentType === "string" ? body.contentType : "",
        size,
        spaceId,
      });
      return response(result, 201);
    }

    if (body.action === "sign-parts") {
      if (typeof body.sessionId !== "string" || !Array.isArray(body.partNumbers)) {
        return response({ error: "Invalid upload parts request." }, 400);
      }
      return response(await storage.signAttachmentParts({
        sessionId: body.sessionId,
        partNumbers: body.partNumbers,
        spaceId,
      }));
    }

    if (body.action === "complete") {
      if (typeof body.sessionId !== "string") return response({ error: "Invalid upload completion request." }, 400);
      return response({ attachment: await storage.completeAttachmentUpload({ sessionId: body.sessionId, spaceId }) });
    }

    if (body.action === "abort") {
      if (typeof body.sessionId !== "string") return response({ error: "Invalid upload cancellation request." }, 400);
      await storage.abortAttachmentUpload({ sessionId: body.sessionId, spaceId });
      return response({ success: true });
    }

    return response({ error: "Unknown upload action." }, 400);
  } catch (error) {
    console.error("Upload error:", error);
    const status = error?.status || error?.$metadata?.httpStatusCode;
    return response({ error: status === 404 ? error.message : "Upload setup failed. Try again." }, status === 404 ? 404 : 500);
  }
}

export async function DELETE(request) {
  const denied = authorize(request);
  if (denied) return denied;

  try {
    const storage = await import("../../../lib/r2-notes");
    if (storage.storageIsReadOnly()) return readOnlyResponse();
    const spaceId = getAccessSpace(request);
    const key = new URL(request.url).searchParams.get("key");
    if (!key || !storage.attachmentKeyBelongsToSpace(key, spaceId)) return response({ error: "Missing or invalid file." }, 400);
    await storage.deleteUnreferencedAttachments([key], spaceId);
    return response({ success: true });
  } catch (error) {
    console.error("Upload cleanup error:", error);
    return response({ error: "Could not remove file." }, 500);
  }
}
