# Notes

A responsive private list app for desktop and mobile. One flat list contains rich-text notes, files, images, and links.

Attachments are stored until their item is deleted. The browser retrieves each attachment through the authenticated app API, so there are no expiring attachment links in the UI.

Uploads go directly from the device to S3. The app API first verifies the access key and issues a short-lived signed URL, so Vercel Functions never receive the file body. Files larger than 16 MB use S3 multipart upload automatically.

Notes use Quill. Images added from its toolbar, paste, or drag-and-drop are represented by an attachment ID in the stored Quill Delta; the editor never stores Base64, blob URLs, or expiring signed URLs. A temporary browser blob preview is used before saving, then the original file is uploaded directly to S3 with the same attachment pipeline as regular files.

## iPhone and iPad home-screen app

Open the deployed site in Safari, tap **Share**, then choose **Add to Home Screen**. It opens in standalone mode with a dedicated Notes icon, app title, theme color, safe-area viewport, and pull-to-refresh.

## Local setup

```powershell
cd s3-notes
Copy-Item .env.example .env.local
npm install
npm run dev
```

Fill in `.env.local` before opening `http://localhost:3000`.

## Vercel environment variables

Add these in **Project Settings > Environment Variables**:

```text
AWS_REGION=ap-southeast-1
S3_BUCKET=your-private-bucket
S3_NOTES_KEY=notes/sessions.json
S3_UPLOAD_PREFIX=notes/uploads
MAX_UPLOAD_BYTES=1073741824
NOTES_ACCESS_KEY=a-long-random-secret
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

### Single or Multiple Access Keys & Data Spaces

You can configure single or multiple access keys. Each key accesses an isolated data space in S3:

1. **Single key (Default / Legacy)**:
   ```text
   NOTES_ACCESS_KEY=my-secret-key
   ```
   Uses standard `notes/sessions.json` and `notes/uploads/*`.

2. **Multiple keys with auto-partitioned spaces**:
   ```text
   NOTES_ACCESS_KEYS=secretKeyA,secretKeyB,secretKeyC
   ```
   Each key gets its own isolated space in S3.

3. **Multiple keys with custom named spaces**:
   ```text
   NOTES_ACCESS_KEYS=work:work-secret-123, personal:personal-secret-456
   ```
   Or using JSON:
   ```text
   NOTES_ACCESS_KEYS={"work-secret-123": "work", "personal-secret-456": "personal"}
   ```
   Data is stored under `notes/spaces/<spaceId>/sessions.json` and `notes/spaces/<spaceId>/uploads/*`.

## Required IAM policy

Replace `your-private-bucket` if needed:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload"],
      "Resource": [
        "arn:aws:s3:::your-private-bucket/notes/*"
      ]
    }
  ]
}
```

The bucket remains private. The API verifies the access key before issuing every signed upload URL. Add this S3 CORS rule for browser and native-mobile uploads:

```json
[
  {
    "AllowedHeaders": ["content-type", "content-disposition", "x-amz-server-side-encryption"],
    "AllowedMethods": ["PUT"],
    "AllowedOrigins": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

`MAX_UPLOAD_BYTES` is the per-file cap in bytes; it defaults to 1 GiB when omitted. There is no extension or MIME whitelist. Signed URLs expire after 15 minutes.

`AllowedOrigins: ["*"]` is compatible with any browser, local network host, and native app. It does not make the bucket public: a valid, short-lived signed URL is still required. If the app only runs on fixed web domains, replacing `*` with those exact origins is stricter.

For housekeeping, add an S3 lifecycle rule that aborts incomplete multipart uploads after one day.

## Deploy

Push `s3-notes` to a Git repository, import it into Vercel, set the variables above, configure the bucket CORS rule, then deploy.

This design is best for a personal list or a small shared group. Multiple simultaneous writers can overwrite each other; use an authenticated database for collaborative editing at scale.
