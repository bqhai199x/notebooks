import { randomUUID } from "node:crypto";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { parseFileTransport } from "./file-transport";
import { proxyAttachmentUrl } from "./r2-file-proxy.mjs";
import {
  contentDisposition,
  normalizeCategories,
  normalizeItems,
  readStoredData,
  readStoredItems,
  safeSpaceId,
} from "./notes-data";

const DEFAULT_PART_SIZE = 8 * 1024 * 1024;
const PRESIGNED_UPLOAD_TTL_SECONDS = 15 * 60;
const PRESIGNED_DOWNLOAD_TTL_SECONDS = 5 * 60;
let cachedClient;

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}.`);
  return value;
}

function bucketName() {
  return requiredEnv("R2_BUCKET");
}

export function getR2Client() {
  if (cachedClient) return cachedClient;
  cachedClient = new S3Client({
    region: "auto",
    endpoint: requiredEnv("R2_ENDPOINT"),
    forcePathStyle: true,
    // The browser supplies each part after signing; do not checksum an empty body.
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: requiredEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv("R2_SECRET_ACCESS_KEY"),
    },
  });
  return cachedClient;
}

function statusOf(error) {
  return error?.$metadata?.httpStatusCode || error?.status || error?.statusCode || error?.code;
}

function notFound(error) {
  return statusOf(error) === 404 || error?.name === "NoSuchKey" || error?.Code === "NoSuchKey";
}

function preconditionFailed(error) {
  return statusOf(error) === 412 || error?.name === "PreconditionFailed" || error?.Code === "PreconditionFailed";
}

function preconditionError() {
  const error = new Error("PreconditionFailed");
  error.name = "PreconditionFailed";
  error.status = 412;
  error.$metadata = { httpStatusCode: 412 };
  return error;
}

function itemsKey(spaceId) {
  return `${safeSpaceId(spaceId)}/items.json`;
}

function attachmentPrefix(spaceId) {
  return `${safeSpaceId(spaceId)}/attachments/`;
}

function uploadSessionKey(spaceId, sessionId) {
  return `${safeSpaceId(spaceId)}/upload-sessions/${sessionId}.json`;
}

function safeFileName(name) {
  return (typeof name === "string" ? name : "file")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .trim()
    .slice(0, 180) || "file";
}

function safeContentType(contentType) {
  return typeof contentType === "string" && contentType.trim()
    ? contentType.trim().slice(0, 160)
    : "application/octet-stream";
}

function isUploadSessionId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{16,128}$/.test(value);
}

export function attachmentKeyFor(spaceId, attachmentId) {
  if (typeof attachmentId !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(attachmentId)) {
    throw new Error("Invalid attachment identifier.");
  }
  return `${attachmentPrefix(spaceId)}${attachmentId}`;
}

export function attachmentKeyBelongsToSpace(key, spaceId) {
  if (typeof key !== "string") return false;
  const prefix = attachmentPrefix(spaceId);
  const suffix = key.slice(prefix.length);
  return key.startsWith(prefix) && /^[a-zA-Z0-9_-]{8,128}$/.test(suffix);
}

export function storageIsReadOnly() {
  return ["1", "true", "yes", "on"].includes(String(process.env.NOTES_READ_ONLY || "").trim().toLowerCase());
}

export function uploadPartSize() {
  const configured = Number(process.env.R2_UPLOAD_PART_BYTES);
  if (!Number.isSafeInteger(configured) || configured < 5 * 1024 * 1024 || configured > 512 * 1024 * 1024) {
    return DEFAULT_PART_SIZE;
  }
  return configured;
}

async function bodyText(body) {
  if (!body) return "";
  if (typeof body.transformToString === "function") return body.transformToString();
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function putJson(key, value) {
  await getR2Client().send(new PutObjectCommand({
    Bucket: bucketName(),
    Key: key,
    Body: JSON.stringify(value),
    ContentType: "application/json; charset=utf-8",
    CacheControl: "no-store",
  }));
}

async function readUploadSession(sessionId, spaceId) {
  if (!isUploadSessionId(sessionId)) throw new Error("Invalid upload session.");
  try {
    const response = await getR2Client().send(new GetObjectCommand({
      Bucket: bucketName(),
      Key: uploadSessionKey(spaceId, sessionId),
    }));
    const session = JSON.parse(await bodyText(response.Body));
    if (!session || session.spaceId !== safeSpaceId(spaceId) || !attachmentKeyBelongsToSpace(session.key, spaceId)) {
      throw new Error("Invalid upload session.");
    }
    return session;
  } catch (error) {
    if (notFound(error)) {
      const missing = new Error("Upload session expired. Start the upload again.");
      missing.status = 404;
      throw missing;
    }
    if (error instanceof SyntaxError) throw new Error("Invalid upload session.");
    throw error;
  }
}

async function saveUploadSession(session) {
  await putJson(uploadSessionKey(session.spaceId, session.id), session);
}

export async function getItemsWithMeta(spaceId = null) {
  try {
    const response = await getR2Client().send(new GetObjectCommand({
      Bucket: bucketName(),
      Key: itemsKey(spaceId),
    }));
    const document = JSON.parse(await bodyText(response.Body));
    const data = readStoredData(document);
    return {
      items: data.items,
      categories: data.categories,
      eTag: response.ETag || undefined,
    };
  } catch (error) {
    if (notFound(error)) return { items: [], categories: normalizeCategories([]), eTag: null };
    if (error instanceof SyntaxError) throw new Error("Invalid notes data.");
    throw error;
  }
}

export async function getItems(spaceId = null) {
  const { items } = await getItemsWithMeta(spaceId);
  return items;
}

export async function saveItems(itemsOrData, options = {}, spaceId = null) {
  if (storageIsReadOnly()) {
    const error = new Error("Notes are temporarily read-only.");
    error.status = 503;
    throw error;
  }
  let items = [];
  let categories = undefined;
  if (Array.isArray(itemsOrData)) {
    items = itemsOrData;
    categories = options.categories;
  } else if (itemsOrData && typeof itemsOrData === "object") {
    items = itemsOrData.items || [];
    categories = itemsOrData.categories;
  }

  const isNew = !options.expectedETag;
  try {
    const response = await getR2Client().send(new PutObjectCommand({
      Bucket: bucketName(),
      Key: itemsKey(spaceId),
      Body: JSON.stringify({
        version: 4,
        updatedAt: new Date().toISOString(),
        categories: normalizeCategories(categories),
        items: normalizeItems(items),
      }, null, 2),
      ContentType: "application/json; charset=utf-8",
      CacheControl: "no-store",
      ...(isNew ? { IfNoneMatch: "*" } : { IfMatch: options.expectedETag }),
    }));
    return { eTag: response.ETag || undefined };
  } catch (error) {
    if (preconditionFailed(error)) throw preconditionError();
    throw error;
  }
}

export async function createAttachmentUpload({ id = randomUUID(), name, contentType, size, spaceId = null, transport = "direct" }) {
  transport = parseFileTransport(transport);
  if (storageIsReadOnly()) throw new Error("Notes are temporarily read-only.");
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error("Invalid file size.");
  const attachmentId = typeof id === "string" && /^[a-zA-Z0-9_-]{8,128}$/.test(id) ? id : randomUUID();
  const space = safeSpaceId(spaceId);
  const attachment = {
    id: attachmentId,
    key: attachmentKeyFor(space, attachmentId),
    name: safeFileName(name),
    contentType: safeContentType(contentType),
    size,
  };
  const partSize = uploadPartSize();
  const totalParts = Math.ceil(size / partSize);
  if (totalParts > 10_000) throw new Error("File is too large for multipart upload.");

  const created = await getR2Client().send(new CreateMultipartUploadCommand({
    Bucket: bucketName(),
    Key: attachment.key,
    ContentType: attachment.contentType,
    ContentDisposition: contentDisposition(attachment.name, attachment.contentType.startsWith("image/")),
    CacheControl: "private, max-age=86400, stale-while-revalidate=604800",
  }));
  if (!created.UploadId) throw new Error("Could not start upload.");

  const session = {
    id: randomUUID(),
    spaceId: space,
    uploadId: created.UploadId,
    key: attachment.key,
    attachment,
    partSize,
    totalParts,
    transport,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  try {
    await saveUploadSession(session);
  } catch (error) {
    await getR2Client().send(new AbortMultipartUploadCommand({
      Bucket: bucketName(),
      Key: session.key,
      UploadId: session.uploadId,
    })).catch(() => {});
    throw error;
  }
  return {
    attachment: { ...attachment, kind: attachment.contentType.startsWith("image/") ? "image" : "file" },
    upload: {
      mode: "multipart",
      sessionId: session.id,
      partSize,
      totalParts,
      transport,
    },
  };
}

export async function signAttachmentParts({ sessionId, partNumbers, spaceId = null }) {
  const session = await readUploadSession(sessionId, spaceId);
  const transport = parseFileTransport(session.transport);
  if (session.status !== "pending") throw new Error("This upload is already complete.");
  if (!Array.isArray(partNumbers)) throw new Error("Invalid upload parts.");
  const uniqueParts = [...new Set(partNumbers)]
    .filter((part) => Number.isSafeInteger(part) && part >= 1 && part <= session.totalParts);
  if (!Array.isArray(partNumbers) || uniqueParts.length !== partNumbers.length || uniqueParts.length === 0 || uniqueParts.length > 100) {
    throw new Error("Invalid upload parts.");
  }

  const client = getR2Client();
  const parts = await Promise.all(uniqueParts.map(async (partNumber) => {
    const url = await getSignedUrl(client, new UploadPartCommand({
      Bucket: bucketName(),
      Key: session.key,
      UploadId: session.uploadId,
      PartNumber: partNumber,
    }), { expiresIn: PRESIGNED_UPLOAD_TTL_SECONDS });
    return { partNumber, url: transport === "proxy" ? proxyAttachmentUrl(url) : url };
  }));
  return { parts, expiresIn: PRESIGNED_UPLOAD_TTL_SECONDS };
}

export async function completeAttachmentUpload({ sessionId, spaceId = null }) {
  const session = await readUploadSession(sessionId, spaceId);
  const client = getR2Client();

  if (session.status === "completed") {
    const meta = await getAttachmentMeta({ key: session.key, spaceId });
    if (meta.size === session.attachment.size) return { ...session.attachment, kind: session.attachment.contentType.startsWith("image/") ? "image" : "file" };
  }

  let listed;
  try {
    listed = await client.send(new ListPartsCommand({
      Bucket: bucketName(),
      Key: session.key,
      UploadId: session.uploadId,
    }));
  } catch (error) {
    if (notFound(error)) {
      const meta = await getAttachmentMeta({ key: session.key, spaceId }).catch(() => null);
      if (meta?.size === session.attachment.size) {
        await getR2Client().send(new DeleteObjectCommand({
          Bucket: bucketName(),
          Key: uploadSessionKey(spaceId, session.id),
        })).catch(() => {});
        return { ...session.attachment, kind: session.attachment.contentType.startsWith("image/") ? "image" : "file" };
      }
    }
    throw error;
  }

  const parts = listed.Parts || [];
  if (parts.length !== session.totalParts || parts.some((part, index) => part.PartNumber !== index + 1 || !part.ETag)) {
    throw new Error("Upload is incomplete. Please retry the missing parts.");
  }
  const actualSize = parts.reduce((total, part) => total + Number(part.Size || 0), 0);
  if (actualSize !== session.attachment.size) throw new Error("Uploaded file size does not match the selected file.");

  await client.send(new CompleteMultipartUploadCommand({
    Bucket: bucketName(),
    Key: session.key,
    UploadId: session.uploadId,
    MultipartUpload: {
      Parts: parts.map((part) => ({ PartNumber: part.PartNumber, ETag: part.ETag })),
    },
  }));
  const meta = await getAttachmentMeta({ key: session.key, spaceId });
  if (meta.size !== session.attachment.size) throw new Error("Upload verification failed.");

  await getR2Client().send(new DeleteObjectCommand({
    Bucket: bucketName(),
    Key: uploadSessionKey(spaceId, session.id),
  })).catch(() => {});
  return { ...session.attachment, kind: session.attachment.contentType.startsWith("image/") ? "image" : "file" };
}

export async function abortAttachmentUpload({ sessionId, spaceId = null }) {
  const session = await readUploadSession(sessionId, spaceId);
  if (session.status === "pending") {
    await getR2Client().send(new AbortMultipartUploadCommand({
      Bucket: bucketName(),
      Key: session.key,
      UploadId: session.uploadId,
    })).catch((error) => {
      if (!notFound(error)) throw error;
    });
  } else {
    await deleteUnreferencedAttachments([session.key], spaceId);
  }
  await getR2Client().send(new DeleteObjectCommand({
    Bucket: bucketName(),
    Key: uploadSessionKey(spaceId, session.id),
  }));
}

export async function getAttachmentMeta({ key, spaceId = null }) {
  if (!attachmentKeyBelongsToSpace(key, spaceId)) throw new Error("Invalid attachment key.");
  const result = await getR2Client().send(new HeadObjectCommand({
    Bucket: bucketName(),
    Key: key,
  }));
  return {
    eTag: result.ETag || undefined,
    mimeType: result.ContentType || "application/octet-stream",
    size: Number.isFinite(result.ContentLength) ? result.ContentLength : undefined,
  };
}

export async function getAttachmentDownloadUrl({ key, name, contentType, download = false, spaceId = null, transport = "direct" }) {
  transport = parseFileTransport(transport);
  if (!attachmentKeyBelongsToSpace(key, spaceId)) throw new Error("Invalid attachment key.");
  const url = await getSignedUrl(getR2Client(), new GetObjectCommand({
    Bucket: bucketName(),
    Key: key,
    ...(download ? { ResponseContentDisposition: contentDisposition(name, false) } : {}),
    ...(contentType ? { ResponseContentType: contentType } : {}),
    ...(transport === "proxy" ? { ResponseCacheControl: "private, no-store" } : {}),
  }), { expiresIn: PRESIGNED_DOWNLOAD_TTL_SECONDS });
  return transport === "proxy" ? proxyAttachmentUrl(url) : url;
}

export async function deleteAttachments(keys, spaceId = null) {
  if (storageIsReadOnly()) return;
  const validKeys = [...new Set(keys)].filter((key) => attachmentKeyBelongsToSpace(key, spaceId));
  if (!validKeys.length) return;
  await getR2Client().send(new DeleteObjectsCommand({
    Bucket: bucketName(),
    Delete: { Objects: validKeys.map((Key) => ({ Key })), Quiet: true },
  }));
}

export async function deleteUnreferencedAttachments(keys, spaceId = null) {
  const referenced = new Set((await getItems(spaceId))
    .flatMap((item) => item.attachments || [])
    .map((attachment) => attachment.key)
    .filter(Boolean));
  await deleteAttachments(keys.filter((key) => !referenced.has(key)), spaceId);
}
