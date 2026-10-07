export const R2_FILE_PROXY_SOURCE = "/r2-files/:spaceId([a-zA-Z0-9_-]{1,64})/attachments/:attachmentId([a-zA-Z0-9_-]{8,128})";

export function r2FileOrigin() {
  const endpointStr = process.env.R2_ENDPOINT?.trim();
  const bucket = process.env.R2_BUCKET?.trim() || "";

  if (!endpointStr) {
    throw new Error("Missing R2_ENDPOINT environment variable.");
  }

  let endpoint;
  try {
    endpoint = new URL(endpointStr);
  } catch {
    throw new Error(`Invalid R2_ENDPOINT: "${endpointStr}". Must be a valid URL (e.g. https://<account-id>.r2.cloudflarestorage.com).`);
  }

  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password
    || endpoint.pathname !== "/" || endpoint.search || endpoint.hash
    || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new Error("Set R2_ENDPOINT to the HTTPS account endpoint and R2_BUCKET to a valid bucket name.");
  }
  return { endpoint: endpoint.origin, bucket };
}

export function proxyAttachmentUrl(signedUrl) {
  const { endpoint, bucket } = r2FileOrigin();
  const url = new URL(signedUrl);
  const prefix = `/${bucket}/`;
  const key = url.pathname.slice(prefix.length);
  if (url.origin !== endpoint || url.username || url.password || url.hash
    || !url.pathname.startsWith(prefix)
    || !/^[a-zA-Z0-9_-]{1,64}\/attachments\/[a-zA-Z0-9_-]{8,128}$/.test(key)) {
    throw new Error("Signed file URL does not match the configured R2 attachment path.");
  }
  // Preserve the signed query verbatim; transport is never part of the S3 query.
  return `/r2-files/${key}${url.search}`;
}
