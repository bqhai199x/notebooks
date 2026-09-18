# Notes (Cloudflare R2 Edition)

A responsive private list app for desktop and mobile. Notes, images, and attachments are stored in a private **Cloudflare R2** bucket. The Next.js app continues to run on Vercel.

Each access key maps to one isolated space at `spaces/<spaceId>/items.json`. Attachments use unique object keys below that space. The browser uploads multipart parts and downloads files directly from R2 through short-lived signed URLs, so file bytes do not pass through Vercel.

## Setup

```powershell
Copy-Item .env.example .env.local
npm.cmd install
npm.cmd run dev
```

Create a private R2 bucket and an API token limited to that bucket, then set `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` in `.env.local`. Set `NOTES_ACCESS_KEY` before starting the app.

The default maximum upload size is 1 GiB. Uploads use 16 MiB multipart parts, retry failed parts up to three times, and can be cancelled from the UI.

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
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Add any production custom domain or Vercel preview domain that will upload directly to R2. Signed download URLs expire after five minutes; a URL already issued can remain usable until it expires after a share link is revoked.

Also configure an R2 lifecycle rule that aborts incomplete multipart uploads after one day. This releases storage from uploads interrupted by a closed browser tab.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `R2_ENDPOINT` | Account S3 endpoint: `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_BUCKET` | Private R2 bucket name |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 API token credentials, server-only |
| `NOTES_ACCESS_KEY` / `NOTES_ACCESS_KEYS` | Unlock key(s) and isolated spaces |
| `MAX_UPLOAD_BYTES` | Attachment size limit, default 1 GiB |
| `R2_UPLOAD_PART_BYTES` | Optional multipart part size, default 16 MiB |
| `NOTES_READ_ONLY` | Set to `true` to allow reads while blocking writes and uploads |

## Deploying on Vercel

Add the R2 variables and access key variables in Vercel Project Settings. Add the deployed Vercel domain to the R2 CORS policy. The R2 credential values are server secrets and must never use the `NEXT_PUBLIC_` prefix.
