import { parseFileTransport } from "./file-transport";

const PART_CONCURRENCY = 2;
const PART_RETRIES = 3;
const PROXY_TIMEOUT_MS = 115_000;

// Shared by every upload in this tab, including uploads from different notes.
let activeParts = 0;
const waitingParts = [];

function cancelledUpload() {
  return new DOMException("Upload đã bị hủy.", "AbortError");
}

function drainParts() {
  while (activeParts < PART_CONCURRENCY && waitingParts.length) waitingParts.shift()();
}

function acquirePart(signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(cancelledUpload());
    const onAbort = () => {
      const index = waitingParts.indexOf(start);
      if (index !== -1) waitingParts.splice(index, 1);
      reject(cancelledUpload());
    };
    const start = () => {
      signal.removeEventListener("abort", onAbort);
      activeParts++;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        activeParts--;
        drainParts();
      });
    };
    signal.addEventListener("abort", onAbort, { once: true });
    waitingParts.push(start);
    drainParts();
  });
}

function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(cancelledUpload());
    const onAbort = () => {
      clearTimeout(timer);
      reject(cancelledUpload());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function putPart(url, part, onProgress, signal, transport) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(cancelledUpload());
    const xhr = new XMLHttpRequest();
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () => {
      xhr.abort();
      finish(reject, cancelledUpload());
    };

    xhr.upload.onprogress = (event) => {
      if (!settled && event.lengthComputable) onProgress?.(event.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) finish(resolve);
      else finish(reject, new Error(`Part upload failed (${xhr.status}).`));
    };
    xhr.onerror = () => finish(reject, new Error("Network error during upload. Check your connection."));
    xhr.onabort = () => finish(reject, cancelledUpload());
    xhr.ontimeout = () => finish(reject, new Error("Upload timed out."));

    try {
      // Untyped Blob: no Content-Type header absent from the signature.
      xhr.open("PUT", url);
      if (transport === "proxy") xhr.timeout = PROXY_TIMEOUT_MS;
      signal.addEventListener("abort", onAbort, { once: true });
      xhr.send(part);
    } catch (error) {
      finish(reject, error);
    }
  });
}

async function signPart(callApi, sessionId, partNumber, signal) {
  const data = await callApi("/api/uploads", {
    method: "POST",
    signal,
    body: JSON.stringify({ action: "sign-parts", sessionId, partNumbers: [partNumber] }),
  });
  const part = data.parts?.[0];
  if (data.parts?.length !== 1 || part.partNumber !== partNumber || typeof part.url !== "string") {
    throw new Error("Upload setup returned an invalid part URL.");
  }
  return part.url;
}

export async function uploadAttachment({ file, callApi, onProgress, signal, transport = "direct" }) {
  transport = parseFileTransport(transport);
  if (signal?.aborted) throw cancelledUpload();

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const uploadSignal = controller.signal;
  let upload;
  let workers = [];
  let firstError;

  try {
    // Receive the session ID even if cancelled during initiation, so it can be aborted.
    const initiated = await callApi("/api/uploads", {
      method: "POST",
      body: JSON.stringify({
        action: "initiate",
        name: file.name,
        contentType: file.type,
        size: file.size,
        transport,
      }),
    });
    upload = initiated.upload;
    if (uploadSignal.aborted) throw cancelledUpload();
    if (
      upload?.mode !== "multipart"
      || typeof upload.sessionId !== "string"
      || !Number.isSafeInteger(upload.partSize) || upload.partSize <= 0
      || !Number.isSafeInteger(upload.totalParts) || upload.totalParts <= 0
      || upload.totalParts !== Math.ceil(file.size / upload.partSize)
      || !initiated.attachment?.id
    ) {
      throw new Error("Upload setup returned an invalid response.");
    }
    // Older sessions default to direct. This value stays fixed for every retry.
    const sessionTransport = parseFileTransport(upload.transport);
    const progressByPart = new Map();
    const reportProgress = () => {
      if (uploadSignal.aborted) return;
      const uploadedBytes = [...progressByPart.values()].reduce((total, bytes) => total + bytes, 0);
      onProgress?.(Math.min(99, Math.round((uploadedBytes / file.size) * 100)));
    };

    let nextPart = 1;
    async function worker() {
      try {
        while (nextPart <= upload.totalParts) {
          if (uploadSignal.aborted) throw cancelledUpload();
          const partNumber = nextPart++;
          const start = (partNumber - 1) * upload.partSize;
          const end = Math.min(start + upload.partSize, file.size);
          const part = file.slice(start, end, "");

          for (let attempt = 0; attempt < PART_RETRIES; attempt++) {
            try {
              const release = await acquirePart(uploadSignal);
              try {
                if (uploadSignal.aborted) throw cancelledUpload();
                const url = await signPart(callApi, upload.sessionId, partNumber, uploadSignal);
                await putPart(url, part, (loaded) => {
                  progressByPart.set(partNumber, Math.min(loaded, end - start));
                  reportProgress();
                }, uploadSignal, sessionTransport);
              } finally {
                release();
              }
              progressByPart.set(partNumber, end - start);
              reportProgress();
              break;
            } catch (error) {
              if (uploadSignal.aborted || error?.name === "AbortError") throw cancelledUpload();
              progressByPart.set(partNumber, 0);
              reportProgress();
              if (attempt === PART_RETRIES - 1) throw error;
              await pause(250 * (attempt + 1), uploadSignal);
            }
          }
        }
      } catch (error) {
        firstError ??= error;
        controller.abort();
        throw error;
      }
    }

    workers = Array.from({ length: Math.min(PART_CONCURRENCY, upload.totalParts) }, worker);
    await Promise.allSettled(workers);
    if (firstError) throw firstError;
    if (uploadSignal.aborted) throw cancelledUpload();
    const completed = await callApi("/api/uploads", {
      method: "POST",
      // Like initiation, finish receiving the result before cancellation cleanup.
      body: JSON.stringify({ action: "complete", sessionId: upload.sessionId }),
    });
    if (uploadSignal.aborted) throw cancelledUpload();
    if (!completed.attachment?.key) throw new Error("R2 did not confirm the uploaded file. Try again.");
    onProgress?.(100);
    return completed.attachment;
  } catch (error) {
    controller.abort();
    await Promise.allSettled(workers);
    if (typeof upload?.sessionId === "string") {
      await callApi("/api/uploads", {
        method: "POST",
        body: JSON.stringify({ action: "abort", sessionId: upload.sessionId }),
      }).catch(() => {});
    }
    throw firstError || error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}
