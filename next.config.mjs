import { R2_FILE_PROXY_SOURCE, r2FileOrigin } from "./lib/r2-file-proxy.mjs";

const isDev = process.env.NODE_ENV !== "production";

export default {
  allowedDevOrigins: [
    "192.168.1.47",
    "192.168.1.*",
    "192.168.*.*",
    "10.*.*.*",
    "172.16.*.*",
    "localhost",
    "127.0.0.1",
  ],
  async rewrites() {
    try {
      const { endpoint, bucket } = r2FileOrigin();
      return [{
        source: R2_FILE_PROXY_SOURCE,
        destination: `${endpoint}/${bucket}/:spaceId/attachments/:attachmentId`,
      }];
    } catch (err) {
      console.warn(`[next.config.mjs] Warning: ${err.message}. Skipping R2 file proxy rewrite.`);
      return [];
    }
  },
  async headers() {
    const headersList = [
      {
        source: R2_FILE_PROXY_SOURCE,
        headers: [
          { key: "x-vercel-enable-rewrite-caching", value: "0" },
          { key: "Cache-Control", value: "private, no-store" },
          { key: "Content-Security-Policy", value: "sandbox allow-downloads" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];

    if (isDev) {
      headersList.push({
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, PUT, DELETE, PATCH, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization, x-notes-access-key" },
        ],
      });
    }

    return headersList;
  },
};
