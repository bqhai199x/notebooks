# Notes (Cloudflare R2 Edition)

A responsive private list app for desktop and mobile. Notes, images, and attachments are stored in a private **Cloudflare R2** bucket. The Next.js app continues to run on Vercel.

Each access key maps to one isolated space at `<spaceId>/items.json`, directly under the bucket root. Attachments use unique object keys at `<spaceId>/attachments/<attachmentId>`; multipart upload sessions use `<spaceId>/upload-sessions/<sessionId>.json`. File transfers use short-lived signed URLs. By default the browser connects directly to R2. Turn on **Dùng proxy cho tệp** in the main or shared-note toolbar when the network cannot reach R2; file requests then use the app domain through a Vercel external rewrite.

Migration from the old `spaces/` layout is manual. Remove that prefix from object keys and from attachment `key` values in `items.json`. If retaining completed upload-session JSON documents, also update their `key` and `attachment.key` values. Restart pending multipart uploads after migration. The app reads and writes only the new layout.

## Setup

```powershell
Copy-Item .env.example .env.local
npm.cmd install
npm.cmd run dev
```

Create a private R2 bucket and an API token limited to that bucket, then set `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` in `.env.local`. Set `NOTES_ACCESS_KEY` before starting the app.

The maximum upload size is 1 GiB (the configured limit can be lower). Uploads use 8 MiB multipart parts and share a limit of two active part PUTs per tab across all files and notes. Each part is signed immediately before sending, with at most three attempts and fresh signatures after 250/500 ms delays. Proxy PUTs time out after 115 seconds; direct PUTs retain the browser's default timeout. Progress reaches 100% only after R2 confirms completion. Cancelling or exhausting retries stops active and queued work before aborting the multipart session.

## File transport preference

The switch applies to uploads, previews, thumbnails and downloads. Its value is stored in `localStorage` as `notes-file-transport=direct|proxy`, shared by tabs on the same origin and by the main and share pages. Missing or invalid values mean `direct`. Locking the notebook keeps the preference. When storage is unavailable, changes still work in the open page. Each browser and domain has its own preference; notes, R2 objects and copied share links do not contain it.

The saved preference is read before requesting remote previews. Switching clears remote preview URLs and retries failed previews while preserving local draft images. Results from the previous mode are discarded. Upload sessions keep the transport selected at initiation, including retries, and browser downloads already started keep their URL. New transfers use the current choice; errors never automatically switch transport.

`POST /api/uploads` accepts `transport` during `initiate` and returns `upload.transport`. `sign-parts` uses the stored session transport. `GET /api/files` and `GET /api/share/files` accept the same query parameter in JSON and redirect modes. Omitted transport defaults to direct for old clients/sessions; other values return 400. Existing access-key, space, read-only and share checks still apply.

## R2 CORS

Add the app's real origins to the bucket CORS policy before using direct browser uploads or image previews. Keep the bucket private and do not enable `r2.dev` for it.

```json
[
  {
    "AllowedOrigins": [
      "https://your-app.vercel.app",
      "http://localhost:3000"
    ],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["Content-Type", "Range"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Add any production custom domain or Vercel preview domain that will upload directly to R2. Part upload URLs expire after 15 minutes; download URLs expire after five minutes. A URL already issued can remain usable until it expires after a share link is revoked.

Also configure an R2 lifecycle rule that aborts incomplete multipart uploads after one day. This releases storage from uploads interrupted by a closed browser tab.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `R2_ENDPOINT` | Account S3 endpoint: `https://<account-id>.r2.cloudflarestorage.com`; required at build and runtime |
| `R2_BUCKET` | Private R2 bucket name; required at build and runtime |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 API token credentials, server-only |
| `NOTES_ACCESS_KEY` / `NOTES_ACCESS_KEYS` | Unlock key(s) and isolated spaces |
| `MAX_UPLOAD_BYTES` | Attachment size limit, default and maximum 1 GiB |
| `R2_UPLOAD_PART_BYTES` | Multipart part size, default 8 MiB (`8388608`) |
| `NOTES_READ_ONLY` | Set to `true` to allow reads while blocking writes and uploads |

## Deploying on Vercel

Add the R2 variables and access key variables in Vercel Project Settings. Add the deployed Vercel domain to the R2 CORS policy. The R2 credential values are server secrets and must never use the `NEXT_PUBLIC_` prefix.

Keep `R2_ENDPOINT` pointing at Cloudflare, not at Vercel. Endpoint and bucket must be available during build to generate the fixed attachment-only rewrite:

```text
/r2-files/:spaceId/attachments/:attachmentId
  -> <R2_ENDPOINT>/<R2_BUCKET>/:spaceId/attachments/:attachmentId
```

The rewrite is always configured. There is no `R2_FILE_PROXY_ENABLED` flag or user-supplied destination. The S3 client uses path-style URLs and `requestChecksumCalculation: "WHEN_REQUIRED"`. Proxy URLs replace only the signed path prefix and preserve the signature query. File bytes do not enter a Next.js API handler. The external rewrite must forward method, body, query and `Range` without redirecting to R2, preserving content headers, filename, length, ETag and range responses.

Proxy routes set `x-vercel-enable-rewrite-caching: 0`, `Cache-Control: private, no-store`, `Content-Security-Policy: sandbox allow-downloads`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`. Proxy GET signatures also include `ResponseCacheControl: "private, no-store"` for existing objects. The bucket remains private; a missing, modified or expired signature must never return file bytes. The CSP sandbox prevents uploaded HTML/SVG opened on the app origin from running scripts or reading app storage.

Use these deployment values:

```dotenv
R2_UPLOAD_PART_BYTES=8388608
MAX_UPLOAD_BYTES=1073741824
```

## Preview acceptance and rollout

Run `npm run build` and inspect `.next/routes-manifest.json` for the attachment rewrite and all five proxy headers. Deploy a Preview first; the switch defaults to off. Use temporary, non-sensitive files and remove them afterwards. No test files need to be added to the repository.

| Check | Required result |
| --- | --- |
| Preference | Fresh browser defaults to direct; reload and lock/unlock preserve the choice; same-origin tabs sync; separate browsers choose independently |
| Initial requests | A saved proxy choice causes no direct R2 file request when either page opens |
| Switching | Failed previews retry; drafts and `blob:` images survive; delayed old responses cannot overwrite new URLs |
| Concurrent uploads | Across multiple notes/files, at most two part PUTs run; active sessions keep their mode; new sessions use the new mode |
| Multipart | Small file and final part below 5 MiB succeed; 1 GiB uses 128 parts without hitting the 100-part signing limit |
| 200 MB transfer | Upload/download succeed in both modes; downloaded SHA-256 matches the source |
| Downloads | Native browser download, Unicode filenames, `Range` returns 206, download lasting more than 120 seconds |
| Shares | Preview/download work in both modes; revoking a share prevents issuing new URLs |
| Signatures/cache | Warm the cache with a valid GET, then confirm missing, modified and expired signatures cannot read/write file bytes |
| Content safety | Inspect actual proxy response headers; uploaded HTML/SVG cannot execute scripts or read application data |
| Restricted network | With proxy on, file traffic uses the Vercel domain without a redirect to R2; test direct on a network that permits R2 |
| Interruptions | Slow upload, network failure, retries, 115-second proxy timeout and cancellation leave no workers sending after cleanup |

Do not deploy production until the Preview passes the real 200 MB transfer, signature, cache and content-safety checks. Vercel external-rewrite limits and downstream header behavior still require deployed verification; a successful local build does not establish them. If Preview cannot pass, stop the rollout and record the limitation. Do not replace the rewrite with a Function proxy or temporary chunk storage.

Monitor 403/413 responses, timeouts, retry rates and Vercel traffic without logging access keys or complete signed URLs. Users can turn proxy off immediately for new transfers if it has problems. Roll back a faulty deployment when necessary. Changing file transport modes does not require object-key changes or data migration.
