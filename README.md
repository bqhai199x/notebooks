# Notes (Google Drive Edition)

A responsive private list app for desktop and mobile. One flat list contains rich-text notes, files, images, and links, backed by **Google Drive API v3**.

Attachments are stored until their item is deleted. The browser retrieves each attachment through the authenticated app API, so there are no expiring attachment links in the UI.

Data is stored as a JSON file (`sessions.json`) and an `uploads/` folder in your designated Google Drive folder.

## Features
- **Google Drive Storage**: Uses personal Google Drive (15 GB free) via OAuth 2.0 or Google Workspace Shared Drive via Service Account.
- **Rich-text with Quill**: Embed images, checklists, formatting, and file attachments without leaking Base64 strings.
- **Optimistic Concurrency Control**: Prevents accidental overwrites using ETag / If-Match.
- **Multi-space / Multi-key isolation**: Easily partition notes into different spaces (e.g. Work, Personal) using different access keys.
- **Shareable notes**: Generate share links with customizable read or edit permissions.

## Quick Setup (Local Development)

```powershell
Copy-Item .env.example .env.local
npm.cmd install
```

### 1. Google Cloud Console Setup
1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a new project.
2. In **APIs & Services > Library**, search for **Google Drive API** and click **Enable**.
3. In **APIs & Services > OAuth consent screen**:
   - Choose **External** user type.
   - Enter App name and your email address.
   - In the **Test users** step, add your own Google email.
   - *(Optional tip: click "Publish App" so your refresh token never expires after 7 days)*.
4. In **APIs & Services > Credentials**:
   - Click **Create Credentials > OAuth client ID**.
   - Application type: **Desktop app**.
   - Copy the generated **Client ID** and **Client Secret**.

### 2. Google Drive Folder
1. Open [Google Drive](https://drive.google.com/) and create a folder for your notes (e.g. `MyNotesData`).
2. Copy the Folder ID from the URL (`https://drive.google.com/drive/folders/<GOOGLE_DRIVE_FOLDER_ID>`).
3. Set `GOOGLE_DRIVE_FOLDER_ID` in `.env.local`.

### 3. Generate Refresh Token
Run the built-in CLI assistant:

```bash
npm.cmd run auth:gdrive
```
Follow the terminal prompt: enter your Client ID & Client Secret, authenticate in the browser, and the script will automatically save your `GOOGLE_REFRESH_TOKEN` into `.env.local`!

### 4. Start the App
```bash
npm.cmd run dev
```
Open `http://localhost:3000` and unlock your notebook using the `NOTES_ACCESS_KEY` configured in `.env.local`.

---

## Environment Variables

| Variable | Description |
| :--- | :--- |
| `GOOGLE_DRIVE_FOLDER_ID` | ID of the Google Drive folder to store notes and uploads |
| `GOOGLE_CLIENT_ID` | OAuth 2.0 Client ID from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 Client Secret from Google Cloud Console |
| `GOOGLE_REFRESH_TOKEN` | OAuth 2.0 Refresh Token generated via `npm run auth:gdrive` |
| `NOTES_ACCESS_KEY` | Secret passcode to unlock the app |
| `NOTES_ACCESS_KEYS` | (Optional) Multiple access keys mapped to distinct spaces |
| `MAX_UPLOAD_BYTES` | Maximum size of an uploaded attachment in bytes (default: 1 GB) |

### Single or Multiple Access Keys & Data Spaces

1. **Single key (Default)**:
   ```text
   NOTES_ACCESS_KEY=my-secret-key
   ```
   Uses `sessions.json` and `uploads/` folder in your Drive folder.

2. **Multiple keys with auto-partitioned spaces**:
   ```text
   NOTES_ACCESS_KEYS=secretKeyA,secretKeyB,secretKeyC
   ```
   Each key gets its own isolated files and folders in Google Drive (`sessions_<spaceId>.json` and `uploads_<spaceId>/`).

3. **Multiple keys with custom named spaces**:
   ```text
   NOTES_ACCESS_KEYS=work:work-secret-123, personal:personal-secret-456
   ```

---

## Deploy to Vercel

1. Push this project to GitHub.
2. Import the repository into Vercel.
3. In **Project Settings > Environment Variables**, add:
   - `GOOGLE_DRIVE_FOLDER_ID`
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REFRESH_TOKEN`
   - `NOTES_ACCESS_KEY`
4. Deploy!
