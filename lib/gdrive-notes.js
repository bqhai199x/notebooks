import { google } from "googleapis";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { normalizeStoredContent } from "./rich-text";

let cachedDriveClient = null;
const resolvedSpaceCache = new Map();

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}.`);
  return value;
}

export function getDriveClient() {
  if (cachedDriveClient) return cachedDriveClient;

  // 1. OAuth 2.0 (Khuyên dùng cho tài khoản cá nhân @gmail.com)
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (clientId && clientSecret && refreshToken) {
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    cachedDriveClient = google.drive({ version: "v3", auth: oauth2Client });
    return cachedDriveClient;
  }

  // 2. Service Account thông qua biến môi trường (cho Workspace / Shared Drive)
  const saEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let saKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (saEmail && saKey) {
    saKey = saKey.replace(/\\n/g, "\n");
    const auth = new google.auth.JWT({
      email: saEmail,
      key: saKey,
      scopes: ["https://www.googleapis.com/auth/drive"],
    });
    cachedDriveClient = google.drive({ version: "v3", auth });
    return cachedDriveClient;
  }

  // 3. Service Account thông qua file credentials.json
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (keyFile) {
    const auth = new google.auth.GoogleAuth({
      keyFile,
      scopes: ["https://www.googleapis.com/auth/drive"],
    });
    cachedDriveClient = google.drive({ version: "v3", auth });
    return cachedDriveClient;
  }

  throw new Error(
    "Missing Google Drive API credentials. Please configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN in .env.local."
  );
}

function getRootFolderId() {
  return requiredEnv("GOOGLE_DRIVE_FOLDER_ID").trim();
}

async function resolveSpace(drive, spaceId = null) {
  const rootFolderId = getRootFolderId();
  const safeSpace = spaceId && spaceId !== "default"
    ? spaceId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64)
    : "default";

  const cacheKey = `${rootFolderId}::${safeSpace}`;
  let spaceInfo = resolvedSpaceCache.get(cacheKey);
  if (spaceInfo) return spaceInfo;

  const isDefault = safeSpace === "default";
  const uploadsFolderName = isDefault ? "uploads" : `uploads_${safeSpace}`;
  const sessionsFileName = isDefault ? "sessions.json" : `sessions_${safeSpace}.json`;

  // 1. Tìm uploads folder và sessions.json trong 1 query duy nhất
  const combinedQuery = `'${rootFolderId}' in parents and (name = '${uploadsFolderName}' or name = '${sessionsFileName}') and trashed = false`;
  const listRes = await drive.files.list({
    q: combinedQuery,
    fields: "files(id, name, mimeType)",
    spaces: "drive",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const files = listRes.data.files || [];
  const uploadsFolder = files.find(
    (f) => f.name === uploadsFolderName && f.mimeType === "application/vnd.google-apps.folder"
  );
  const sessionsFile = files.find((f) => f.name === sessionsFileName);

  let uploadsFolderId = uploadsFolder ? uploadsFolder.id : null;
  if (!uploadsFolderId) {
    const createFolder = await drive.files.create({
      requestBody: {
        name: uploadsFolderName,
        mimeType: "application/vnd.google-apps.folder",
        parents: [rootFolderId],
      },
      fields: "id",
      supportsAllDrives: true,
    });
    uploadsFolderId = createFolder.data.id;
  }

  const sessionsFileId = sessionsFile ? sessionsFile.id : null;

  spaceInfo = {
    safeSpace,
    rootFolderId,
    uploadsFolderId,
    sessionsFileName,
    sessionsFileId,
  };

  resolvedSpaceCache.set(cacheKey, spaceInfo);
  return spaceInfo;
}

function dateOrNow(value) {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime())
    ? value
    : new Date().toISOString();
}

export function contentDisposition(name, inline = false) {
  const safeAscii = (name || "download").replace(/[^\x20-\x7E]/g, "_").replace(/"/g, '\\"');
  const encodedName = encodeURIComponent(name || "download");
  return `${inline ? "inline" : "attachment"}; filename="${safeAscii}"; filename*=UTF-8''${encodedName}`;
}

export function normalizeAttachment(attachment) {
  if (!attachment || typeof attachment !== "object") return null;

  if (attachment.kind === "link" && typeof attachment.url === "string") {
    try {
      const url = new URL(attachment.url);
      if (!["http:", "https:"].includes(url.protocol)) return null;
      return {
        id: typeof attachment.id === "string" ? attachment.id : randomUUID(),
        kind: "link",
        url: url.toString(),
        name: typeof attachment.name === "string" ? attachment.name.slice(0, 180) : url.hostname,
      };
    } catch {
      return null;
    }
  }

  if (typeof attachment.key !== "string") return null;
  const contentType = typeof attachment.contentType === "string"
    ? attachment.contentType.slice(0, 160)
    : "application/octet-stream";

  return {
    id: typeof attachment.id === "string" ? attachment.id : randomUUID(),
    kind: contentType.startsWith("image/") ? "image" : "file",
    key: attachment.key,
    name: typeof attachment.name === "string" ? attachment.name.slice(0, 180) : "Attachment",
    contentType,
    size: Number.isFinite(attachment.size) ? Math.max(0, attachment.size) : 0,
    ...(typeof attachment.thumbnail === "string" && attachment.thumbnail.startsWith("data:image/")
      ? { thumbnail: attachment.thumbnail.slice(0, 60_000) }
      : {}),
  };
}

export function normalizeShare(share) {
  if (!share || typeof share !== "object") return undefined;
  return {
    enabled: Boolean(share.enabled),
    allowEdit: Boolean(share.allowEdit),
    token: typeof share.token === "string" ? share.token : "",
    updatedAt: typeof share.updatedAt === "string" ? share.updatedAt : undefined,
  };
}

export function normalizeMessage(message) {
  const attachments = Array.isArray(message?.attachments)
    ? message.attachments.map(normalizeAttachment).filter(Boolean)
    : [];
  const { content, contentFormat } = normalizeStoredContent(
    message?.content,
    message?.contentFormat
  );

  return {
    id: typeof message?.id === "string" ? message.id : randomUUID(),
    content,
    contentFormat,
    attachments,
    createdAt: dateOrNow(message?.createdAt),
    updatedAt: dateOrNow(message?.updatedAt ?? message?.createdAt),
    ...(message?.share ? { share: normalizeShare(message.share) } : {}),
  };
}

export function normalizeSessions(value) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((session) => session && typeof session.id === "string")
    .map((session) => ({
      id: session.id,
      title: typeof session.title === "string" ? session.title.slice(0, 120) : "New list",
      createdAt: dateOrNow(session.createdAt),
      updatedAt: dateOrNow(session.updatedAt),
      messages: Array.isArray(session.messages)
        ? session.messages.map(normalizeMessage)
        : [],
    }))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export function migrateLegacyNotes(notes) {
  if (!Array.isArray(notes)) return [];
  return notes.map((note) => ({
    id: typeof note.id === "string" ? note.id : randomUUID(),
    title: typeof note.title === "string" ? note.title : "New list",
    createdAt: dateOrNow(note.createdAt),
    updatedAt: dateOrNow(note.updatedAt),
    messages: note.content ? [{
      id: randomUUID(),
      content: String(note.content).slice(0, 20_000),
      attachments: [],
      createdAt: dateOrNow(note.updatedAt),
    }] : [],
  }));
}

export function normalizeItems(value) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item) => item && typeof item.id === "string")
    .map(normalizeMessage);
}

export function sessionsToItems(sessions) {
  return normalizeSessions(sessions)
    .flatMap((session) => session.messages)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export async function getItemsWithMeta(spaceId = null) {
  const drive = getDriveClient();
  const space = await resolveSpace(drive, spaceId);

  if (!space.sessionsFileId) {
    return { items: [], eTag: null };
  }

  try {
    const [metaRes, contentRes] = await Promise.all([
      drive.files.get({
        fileId: space.sessionsFileId,
        fields: "id, md5Checksum, version, modifiedTime",
        supportsAllDrives: true,
      }),
      drive.files.get({
        fileId: space.sessionsFileId,
        alt: "media",
        supportsAllDrives: true,
      }, { responseType: "text" }),
    ]);

    const rawData = contentRes.data;
    const text = typeof rawData === "string" ? rawData : JSON.stringify(rawData);
    const document = JSON.parse(text);
    const eTag = metaRes.headers?.etag || metaRes.data.md5Checksum || String(metaRes.data.version || Date.now());

    let items = [];
    if (Array.isArray(document.items)) items = normalizeItems(document.items);
    else if (Array.isArray(document.sessions)) items = sessionsToItems(document.sessions);
    else items = sessionsToItems(migrateLegacyNotes(document.notes));

    return { items, eTag };
  } catch (error) {
    if (error?.code === 404 || error?.status === 404) {
      space.sessionsFileId = null;
      return { items: [], eTag: null };
    }
    if (error instanceof SyntaxError) throw new Error("Invalid notes data.");
    throw error;
  }
}

export async function getItems(spaceId = null) {
  const { items } = await getItemsWithMeta(spaceId);
  return items;
}

export async function saveItems(items, options = {}, spaceId = null) {
  const drive = getDriveClient();
  const space = await resolveSpace(drive, spaceId);

  const document = JSON.stringify({
    version: 3,
    updatedAt: new Date().toISOString(),
    items: normalizeItems(items),
  }, null, 2);

  const stream = Readable.from([document]);

  if (!space.sessionsFileId) {
    const res = await drive.files.create({
      requestBody: {
        name: space.sessionsFileName,
        parents: [space.rootFolderId],
        mimeType: "application/json",
      },
      media: {
        mimeType: "application/json; charset=utf-8",
        body: stream,
      },
      fields: "id, md5Checksum, version, modifiedTime",
      supportsAllDrives: true,
    });
    space.sessionsFileId = res.data.id;
    return { eTag: res.headers?.etag || res.data.md5Checksum || String(res.data.version || Date.now()) };
  }

  const headers = {};
  if (options.expectedETag) {
    headers["If-Match"] = options.expectedETag;
  }

  try {
    const res = await drive.files.update({
      fileId: space.sessionsFileId,
      media: {
        mimeType: "application/json; charset=utf-8",
        body: stream,
      },
      fields: "id, md5Checksum, version, modifiedTime",
      supportsAllDrives: true,
    }, {
      headers,
    });

    return { eTag: res.headers?.etag || res.data.md5Checksum || String(res.data.version || Date.now()) };
  } catch (error) {
    const status = error?.status || error?.code || error?.response?.status;
    if (status === 412) {
      const err = new Error("PreconditionFailed");
      err.name = "PreconditionFailed";
      err.status = 412;
      err.$metadata = { httpStatusCode: 412 };
      throw err;
    }
    throw error;
  }
}

export async function getSessions(spaceId = null) {
  const items = await getItems(spaceId);
  return [{
    id: "default-session",
    title: "All Notes",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: items,
  }];
}

export async function saveSessions(sessions, spaceId = null) {
  const items = sessionsToItems(sessions);
  await saveItems(items, {}, spaceId);
}

export async function uploadAttachmentDirect({ id, name, contentType, data, size, spaceId = null }) {
  const drive = getDriveClient();
  const space = await resolveSpace(drive, spaceId);

  const safeName = (name || "file")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .slice(0, 120) || "file";
  const type = typeof contentType === "string" && contentType.trim()
    ? contentType.trim().slice(0, 160)
    : "application/octet-stream";

  const stream = typeof data?.pipe === "function" ? data : Readable.from([Buffer.from(data)]);

  const res = await drive.files.create({
    requestBody: {
      name: `${id}-${safeName}`,
      parents: [space.uploadsFolderId],
      description: id,
    },
    media: {
      mimeType: type,
      body: stream,
    },
    fields: "id, name, mimeType, size",
    supportsAllDrives: true,
  });

  const createdFile = res.data;
  return {
    id,
    key: createdFile.id,
    name: safeName,
    contentType: type,
    size: createdFile.size ? Number(createdFile.size) : size,
    kind: type.startsWith("image/") ? "image" : "file",
  };
}

export async function createAttachmentUpload({ id, name, contentType, size, spaceId = null, origin = null }) {
  const drive = getDriveClient();
  const space = await resolveSpace(drive, spaceId);

  const safeName = (name || "file")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .slice(0, 120) || "file";
  const type = typeof contentType === "string" && contentType.trim()
    ? contentType.trim().slice(0, 160)
    : "application/octet-stream";

  const authClient = drive.context._options.auth;
  let accessToken = "";
  if (authClient) {
    if (typeof authClient.getAccessToken === "function") {
      const tokenObj = await authClient.getAccessToken();
      accessToken = tokenObj?.token || tokenObj || "";
    } else if (typeof authClient.authorize === "function") {
      const credentials = await authClient.authorize();
      accessToken = credentials?.access_token || "";
    }
  }

  const metadata = {
    name: `${id}-${safeName}`,
    parents: [space.uploadsFolderId],
    description: id,
  };

  const headers = {
    "Authorization": `Bearer ${accessToken}`,
    "Content-Type": "application/json; charset=UTF-8",
    "X-Upload-Content-Type": type,
    "X-Upload-Content-Length": String(size),
  };
  if (origin) {
    headers["Origin"] = origin;
  }

  const sessionRes = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true",
    {
      method: "POST",
      headers,
      body: JSON.stringify(metadata),
    }
  );

  const sessionUrl = sessionRes.headers.get("location");
  if (!sessionRes.ok || !sessionUrl) {
    const errText = await sessionRes.text().catch(() => "");
    throw new Error(`Google Drive upload session error (${sessionRes.status}): ${errText}`);
  }

  return {
    attachment: {
      id,
      key: "",
      name: safeName,
      contentType: type,
      size,
      kind: type.startsWith("image/") ? "image" : "file",
    },
    upload: {
      mode: "resumable",
      url: sessionUrl,
      accessToken,
    },
  };
}

export async function completeAttachmentUpload() {
  return true;
}

export async function abortAttachmentUpload({ key }) {
  if (key) {
    await deleteAttachments([key]);
  }
}

export async function getAttachmentMeta({ key, spaceId = null }) {
  const drive = getDriveClient();
  const metaRes = await drive.files.get({
    fileId: key,
    fields: "id, name, mimeType, size, md5Checksum",
    supportsAllDrives: true,
  });
  return {
    eTag: metaRes.data.md5Checksum || undefined,
    mimeType: metaRes.data.mimeType || "application/octet-stream",
    size: metaRes.data.size ? Number(metaRes.data.size) : undefined,
  };
}

export async function getAttachment({ key, spaceId = null }) {
  const drive = getDriveClient();

  const [metaRes, contentRes] = await Promise.all([
    drive.files.get({
      fileId: key,
      fields: "id, name, mimeType, size, md5Checksum",
      supportsAllDrives: true,
    }),
    drive.files.get({
      fileId: key,
      alt: "media",
      supportsAllDrives: true,
    }, { responseType: "stream" }),
  ]);

  const file = metaRes.data;
  const isImage = file.mimeType?.startsWith("image/");
  const safeName = (file.name || "file").replace(/^[0-9a-fA-F-]{36}-/, "");

  return {
    body: contentRes.data,
    contentType: file.mimeType || "application/octet-stream",
    contentLength: file.size ? Number(file.size) : undefined,
    contentDisposition: contentDisposition(safeName, isImage),
    safeName,
    eTag: file.md5Checksum || undefined,
  };
}

export async function getAttachmentDownloadUrl({ key, spaceId = null }) {
  return `/api/files?key=${encodeURIComponent(key)}&download=1`;
}

export async function deleteAttachments(keys, spaceId = null) {
  const drive = getDriveClient();
  const validKeys = [...new Set(keys)].filter((k) => typeof k === "string" && k.trim());

  await Promise.allSettled(
    validKeys.map((fileId) =>
      drive.files.delete({
        fileId,
        supportsAllDrives: true,
      }).catch((err) => {
        if (err?.code !== 404 && err?.status !== 404) {
          console.error(`Google Drive delete error for ${fileId}:`, err.message);
        }
      })
    )
  );
}
