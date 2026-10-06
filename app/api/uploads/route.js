import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { accessIsConfigured, getAccessSpace, hasAccess } from "../../../lib/access";
import { parseFileTransport } from "../../../lib/file-transport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

function maxUploadBytes() {
  const configured = Number(process.env.MAX_UPLOAD_BYTES);
  return Number.isSafeInteger(configured) && configured > 0
    ? Math.min(configured, DEFAULT_MAX_UPLOAD_BYTES)
    : DEFAULT_MAX_UPLOAD_BYTES;
}

function readableSize(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(0)} GB`;
  return `${Math.ceil(bytes / (1024 * 1024))} MB`;
}

const isDev = process.env.NODE_ENV !== "production";

function corsHeaders() {
  if (!isDev) return {};
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
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
    const transport = parseFileTransport(body.transport);
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
        transport,
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
    const status = error?.status || error?.$metadata?.httpStatusCode;
    if (status === 400) return response({ error: error.message }, 400);
    console.error("Upload error:", { status, name: error?.name });
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
    const searchParams = new URL(request.url).searchParams;
    const key = searchParams.get("key");
    const sessionId = searchParams.get("sessionId");

    if (sessionId) {
      await storage.abortAttachmentUpload({ sessionId, spaceId }).catch(() => {});
    }

    if (key && storage.attachmentKeyBelongsToSpace(key, spaceId)) {
      await storage.deleteUnreferencedAttachments([key], spaceId);
    }

    return response({ success: true });
  } catch (error) {
    console.error("Upload cleanup error:", { status: error?.$metadata?.httpStatusCode, name: error?.name });
    return response({ error: "Could not remove file." }, 500);
  }
}
