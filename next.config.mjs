import { R2_FILE_PROXY_SOURCE, r2FileOrigin } from "./lib/r2-file-proxy.mjs";

export default {
  async rewrites() {
    const { endpoint, bucket } = r2FileOrigin();
    return [{
      source: R2_FILE_PROXY_SOURCE,
      destination: `${endpoint}/${bucket}/spaces/:spaceId/attachments/:attachmentId`,
    }];
  },
  async headers() {
    return [{
      source: R2_FILE_PROXY_SOURCE,
      headers: [
        { key: "x-vercel-enable-rewrite-caching", value: "0" },
        { key: "Cache-Control", value: "private, no-store" },
        { key: "Content-Security-Policy", value: "sandbox allow-downloads" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
      ],
    }];
  },
};
