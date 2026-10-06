import { NextResponse } from "next/server";
import { accessIsConfigured, getAccessSpace, hasAccess } from "../../../lib/access";
import { parseFileTransport } from "../../../lib/file-transport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isDev = process.env.NODE_ENV !== "production";

function corsHeaders() {
  if (!isDev) return {};
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

export async function GET(request) {
  const denied = authorize(request);
  if (denied) return denied;

  try {
    const spaceId = getAccessSpace(request);
    const search = new URL(request.url).searchParams;
    const transport = parseFileTransport(search.get("transport") ?? undefined);
    const key = search.get("key");
    if (!key) return response({ error: "File not found." }, 400);

    const isDownload = search.get("download") === "1";
    const format = search.get("format");
    const name = search.get("name") || "download";
    const { getAttachmentMeta, getAttachmentDownloadUrl } = await import("../../../lib/r2-notes");
    const meta = await getAttachmentMeta({ key, spaceId });
    const url = await getAttachmentDownloadUrl({
      key,
      name,
      contentType: meta.mimeType,
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
    console.error("Attachment URL error:", { status, name: error?.name });
    return response({ error: status === 404 ? "File not found." : "Could not open file." }, status === 404 ? 404 : 500);
  }
}
