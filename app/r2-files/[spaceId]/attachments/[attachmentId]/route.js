import { NextResponse } from "next/server";
import { r2FileOrigin } from "../../../../../lib/r2-file-proxy.mjs";

export const dynamic = "force-dynamic";

async function proxyRequest(request, context) {
  const resolvedParams = context.params instanceof Promise ? await context.params : context.params;
  const { spaceId, attachmentId } = resolvedParams || {};

  if (
    !/^[a-zA-Z0-9_-]{1,64}$/.test(spaceId || "") ||
    !/^[a-zA-Z0-9_-]{8,128}$/.test(attachmentId || "")
  ) {
    return new NextResponse("Invalid file path.", { status: 400 });
  }

  let endpoint;
  let bucket;
  try {
    const origin = r2FileOrigin();
    endpoint = origin.endpoint;
    bucket = origin.bucket;
  } catch (err) {
    console.error("[r2-files] Origin config error:", err);
    return new NextResponse("Storage configuration error.", { status: 500 });
  }

  const search = request.nextUrl ? request.nextUrl.search : new URL(request.url).search;
  const targetUrl = `${endpoint}/${bucket}/${spaceId}/attachments/${attachmentId}${search}`;

  const forwardHeaders = new Headers();
  const allowedHeaders = [
    "content-type",
    "content-length",
    "range",
    "if-match",
    "if-none-match",
    "if-modified-since",
    "if-unmodified-since",
  ];

  for (const [key, value] of request.headers.entries()) {
    if (allowedHeaders.includes(key.toLowerCase())) {
      forwardHeaders.set(key, value);
    }
  }

  const hasBody = request.method === "PUT" || request.method === "POST";
  const fetchOptions = {
    method: request.method,
    headers: forwardHeaders,
    body: hasBody ? request.body : undefined,
    ...(hasBody ? { duplex: "half" } : {}),
  };

  try {
    const r2Response = await fetch(targetUrl, fetchOptions);

    const responseHeaders = new Headers();
    const copyHeaders = [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
      "etag",
      "content-disposition",
      "last-modified",
    ];

    for (const [key, value] of r2Response.headers.entries()) {
      if (copyHeaders.includes(key.toLowerCase())) {
        responseHeaders.set(key, value);
      }
    }

    responseHeaders.set("x-vercel-enable-rewrite-caching", "0");
    responseHeaders.set("Cache-Control", "private, no-store");
    responseHeaders.set("Content-Security-Policy", "sandbox allow-downloads");
    responseHeaders.set("X-Content-Type-Options", "nosniff");
    responseHeaders.set("Referrer-Policy", "no-referrer");

    const isNoBodyStatus = r2Response.status === 204 || r2Response.status === 304;
    return new NextResponse(isNoBodyStatus ? null : r2Response.body, {
      status: r2Response.status,
      statusText: r2Response.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    console.error("[r2-files] Proxy request error:", err);
    return new NextResponse("Proxy error.", { status: 502 });
  }
}

export async function GET(request, context) {
  return proxyRequest(request, context);
}

export async function HEAD(request, context) {
  return proxyRequest(request, context);
}

export async function PUT(request, context) {
  return proxyRequest(request, context);
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}
