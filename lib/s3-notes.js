import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

const PRESIGNED_UPLOAD_TTL_SECONDS = 15 * 60;
const MULTIPART_THRESHOLD_BYTES = 16 * 1024 * 1024;
const MIN_MULTIPART_PART_BYTES = 8 * 1024 * 1024;
const MAX_MULTIPART_PARTS = 10_000;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}.`);
  return value;
}

let cachedS3Client = null;
let cachedRegion = null;

function getS3Client() {
  const region = requiredEnv("AWS_REGION");
  if (!cachedS3Client || cachedRegion !== region) {
    cachedS3Client = new S3Client({ region });
    cachedRegion = region;
  }
  return cachedS3Client;
}

function storage() {
  const uploadsPrefix = (process.env.S3_UPLOAD_PREFIX || "notes/uploads")
    .replace(/^\/+|\/+$/g, "");

  return {
    s3: getS3Client(),
    bucket: requiredEnv("S3_BUCKET"),
    sessionsKey: process.env.S3_NOTES_KEY || "notes/sessions.json",
    uploadsPrefix,
  };
}

async function bodyToText(body) {
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function dateOrNow(value) {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime())
    ? value
    : new Date().toISOString();
}

function normalizeAttachment(attachment) {
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
  };
}

function normalizeMessage(message) {
  const attachments = Array.isArray(message?.attachments)
    ? message.attachments.map(normalizeAttachment).filter(Boolean)
    : [];

  return {
    id: typeof message?.id === "string" ? message.id : randomUUID(),
    content: typeof message?.content === "string" ? message.content.slice(0, 20_000) : "",
    attachments,
    createdAt: dateOrNow(message?.createdAt),
    updatedAt: dateOrNow(message?.updatedAt ?? message?.createdAt),
  };
}

function normalizeSessions(value) {
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

function migrateLegacyNotes(notes) {
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

function normalizeItems(value) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item) => item && typeof item.id === "string")
    .map(normalizeMessage)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function sessionsToItems(sessions) {
  return normalizeSessions(sessions)
    .flatMap((session) => session.messages)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function assertUploadKey(key, uploadsPrefix) {
  if (typeof key !== "string" || !key.startsWith(`${uploadsPrefix}/`)) {
    throw new Error("Invalid file.");
  }
}

function contentDisposition(name, inline = false) {
  const encodedName = encodeURIComponent(name || "download");
  return `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodedName}`;
}

function attachmentDetails({ id, name, contentType, size, uploadsPrefix }) {
  const safeName = (name || "file")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .slice(0, 120) || "file";
  const type = typeof contentType === "string" && contentType.trim() && !/[\r\n]/.test(contentType)
    ? contentType.trim().slice(0, 160)
    : "application/octet-stream";
  const key = `${uploadsPrefix}/${id}-${safeName}`;

  return {
    id,
    key,
    name: safeName,
    contentType: type,
    size,
    kind: type.startsWith("image/") ? "image" : "file",
  };
}

function multipartPartSize(size) {
  const neededForPartLimit = Math.ceil(size / MAX_MULTIPART_PARTS);
  const bytes = Math.max(MIN_MULTIPART_PART_BYTES, neededForPartLimit);
  const mib = 1024 * 1024;
  return Math.ceil(bytes / mib) * mib;
}

export async function getSessions() {
  const { s3, bucket, sessionsKey } = storage();

  try {
    const result = await s3.send(new GetObjectCommand({
      Bucket: bucket,
      Key: sessionsKey,
    }));
    const document = JSON.parse(await bodyToText(result.Body));
    return normalizeSessions(document.sessions ?? migrateLegacyNotes(document.notes));
  } catch (error) {
    if (error instanceof NoSuchKey || error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) {
      return [];
    }
    if (error instanceof SyntaxError) {
      throw new Error("Invalid notes data.");
    }
    throw error;
  }
}

export async function saveSessions(sessions) {
  const { s3, bucket, sessionsKey } = storage();
  const document = JSON.stringify({
    version: 2,
    updatedAt: new Date().toISOString(),
    sessions: normalizeSessions(sessions),
  }, null, 2);

  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: sessionsKey,
    Body: document,
    ContentType: "application/json; charset=utf-8",
    CacheControl: "no-store",
    ServerSideEncryption: "AES256",
  }));
}

export async function getItemsWithMeta() {
  const { s3, bucket, sessionsKey } = storage();

  try {
    const result = await s3.send(new GetObjectCommand({
      Bucket: bucket,
      Key: sessionsKey,
    }));
    const document = JSON.parse(await bodyToText(result.Body));
    const eTag = result.ETag;

    let items = [];
    if (Array.isArray(document.items)) items = normalizeItems(document.items);
    else if (Array.isArray(document.sessions)) items = sessionsToItems(document.sessions);
    else items = sessionsToItems(migrateLegacyNotes(document.notes));

    return { items, eTag };
  } catch (error) {
    if (error instanceof NoSuchKey || error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) {
      return { items: [], eTag: null };
    }
    if (error instanceof SyntaxError) throw new Error("Invalid notes data.");
    throw error;
  }
}

export async function getItems() {
  const { items } = await getItemsWithMeta();
  return items;
}

export async function saveItems(items, options = {}) {
  const { s3, bucket, sessionsKey } = storage();
  const document = JSON.stringify({
    version: 3,
    updatedAt: new Date().toISOString(),
    items: normalizeItems(items),
  }, null, 2);

  const commandInput = {
    Bucket: bucket,
    Key: sessionsKey,
    Body: document,
    ContentType: "application/json; charset=utf-8",
    CacheControl: "no-store",
    ServerSideEncryption: "AES256",
  };

  if (options.expectedETag) {
    commandInput.IfMatch = options.expectedETag;
  }

  const result = await s3.send(new PutObjectCommand(commandInput));
  return { eTag: result.ETag };
}

export async function putAttachment({ id, name, contentType, data, size }) {
  const { s3, bucket, uploadsPrefix } = storage();
  const attachment = attachmentDetails({ id, name, contentType, size, uploadsPrefix });

  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: attachment.key,
    Body: data,
    ContentType: attachment.contentType,
    ContentDisposition: contentDisposition(attachment.name, attachment.kind === "image"),
    ServerSideEncryption: "AES256",
  }));

  return attachment;
}

export async function createAttachmentUpload({ id, name, contentType, size }) {
  const { s3, bucket, uploadsPrefix } = storage();
  const attachment = attachmentDetails({ id, name, contentType, size, uploadsPrefix });
  const contentDispositionHeader = contentDisposition(attachment.name, attachment.kind === "image");

  if (size <= MULTIPART_THRESHOLD_BYTES) {
    const url = await getSignedUrl(s3, new PutObjectCommand({
      Bucket: bucket,
      Key: attachment.key,
      ContentType: attachment.contentType,
      ContentDisposition: contentDispositionHeader,
      ServerSideEncryption: "AES256",
    }), { expiresIn: PRESIGNED_UPLOAD_TTL_SECONDS });

    return {
      attachment,
      upload: {
        mode: "single",
        url,
        headers: {
          "Content-Type": attachment.contentType,
          "Content-Disposition": contentDispositionHeader,
          "x-amz-server-side-encryption": "AES256",
        },
      },
    };
  }

  const multipart = await s3.send(new CreateMultipartUploadCommand({
    Bucket: bucket,
    Key: attachment.key,
    ContentType: attachment.contentType,
    ContentDisposition: contentDispositionHeader,
    ServerSideEncryption: "AES256",
  }));
  if (!multipart.UploadId) throw new Error("S3 did not create an upload ID.");

  const partSize = multipartPartSize(size);
  const partCount = Math.ceil(size / partSize);
  const parts = await Promise.all(Array.from({ length: partCount }, async (_, index) => ({
    partNumber: index + 1,
    url: await getSignedUrl(s3, new UploadPartCommand({
      Bucket: bucket,
      Key: attachment.key,
      UploadId: multipart.UploadId,
      PartNumber: index + 1,
    }), { expiresIn: PRESIGNED_UPLOAD_TTL_SECONDS }),
  })));

  return {
    attachment,
    upload: {
      mode: "multipart",
      uploadId: multipart.UploadId,
      partSize,
      parts,
    },
  };
}

export async function completeAttachmentUpload({ key, uploadId, parts }) {
  const { s3, bucket, uploadsPrefix } = storage();
  assertUploadKey(key, uploadsPrefix);

  const completedParts = parts
    .map(({ partNumber, eTag }) => ({ PartNumber: partNumber, ETag: eTag }))
    .sort((a, b) => a.PartNumber - b.PartNumber);

  await s3.send(new CompleteMultipartUploadCommand({
    Bucket: bucket,
    Key: key,
    UploadId: uploadId,
    MultipartUpload: { Parts: completedParts },
  }));
}

export async function abortAttachmentUpload({ key, uploadId }) {
  const { s3, bucket, uploadsPrefix } = storage();
  assertUploadKey(key, uploadsPrefix);

  await s3.send(new AbortMultipartUploadCommand({
    Bucket: bucket,
    Key: key,
    UploadId: uploadId,
  }));
}

export async function getAttachment({ key }) {
  const { s3, bucket, uploadsPrefix } = storage();
  assertUploadKey(key, uploadsPrefix);

  const result = await s3.send(new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  }));

  return {
    body: result.Body,
    contentType: result.ContentType || "application/octet-stream",
    contentLength: result.ContentLength,
    contentDisposition: result.ContentDisposition,
    eTag: result.ETag,
  };
}

export async function getAttachmentDownloadUrl({ key }) {
  const { s3, bucket, uploadsPrefix } = storage();
  assertUploadKey(key, uploadsPrefix);

  return getSignedUrl(s3, new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  }), { expiresIn: PRESIGNED_UPLOAD_TTL_SECONDS });
}

export async function deleteAttachments(keys) {
  const { s3, bucket, uploadsPrefix } = storage();
  const validKeys = [...new Set(keys)]
    .filter((key) => typeof key === "string" && key.startsWith(`${uploadsPrefix}/`));

  if (!validKeys.length) return;

  for (let start = 0; start < validKeys.length; start += 1000) {
    await s3.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: validKeys.slice(start, start + 1000).map((Key) => ({ Key })) },
    }));
  }
}
