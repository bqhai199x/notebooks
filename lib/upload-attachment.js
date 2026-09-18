const PART_CONCURRENCY = 3;
const PART_RETRIES = 3;

function cancelledUpload() {
  return new DOMException("Upload đã bị hủy.", "AbortError");
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function putPart(url, part, onProgress, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelledUpload());
      return;
    }
    const xhr = new XMLHttpRequest();
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () => {
      xhr.abort();
      finish(reject, cancelledUpload());
    };

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) finish(resolve);
      else finish(reject, new Error(`Part upload failed (${xhr.status}).`));
    };
    xhr.onerror = () => finish(reject, new Error("Network error during upload. Check your connection."));
    xhr.onabort = () => finish(reject, cancelledUpload());
    xhr.ontimeout = () => finish(reject, new Error("Upload timed out."));

    try {
      // The presigned URL already authorizes the request. Use an untyped Blob so
      // browsers do not add a Content-Type header that is absent from the signature.
      xhr.open("PUT", url);
      signal?.addEventListener("abort", onAbort, { once: true });
      xhr.send(part);
    } catch (error) {
      finish(reject, error);
    }
  });
}

async function signParts(callApi, sessionId, partNumbers, signal) {
  const data = await callApi("/api/uploads", {
    method: "POST",
    signal,
    body: JSON.stringify({ action: "sign-parts", sessionId, partNumbers }),
  });
  const urls = new Map((data.parts || []).map((part) => [part.partNumber, part.url]));
  if (urls.size !== partNumbers.length || partNumbers.some((part) => typeof urls.get(part) !== "string")) {
    throw new Error("Upload setup returned invalid part URLs.");
  }
  return urls;
}

export async function uploadAttachment({ file, callApi, onProgress, signal }) {
  if (signal?.aborted) throw cancelledUpload();

  const initiated = await callApi("/api/uploads", {
    method: "POST",
    signal,
    body: JSON.stringify({
      action: "initiate",
      name: file.name,
      contentType: file.type,
      size: file.size,
    }),
  });
  const upload = initiated.upload;
  if (
    upload?.mode !== "multipart"
    || typeof upload.sessionId !== "string"
    || !Number.isSafeInteger(upload.partSize)
    || !Number.isSafeInteger(upload.totalParts)
    || !initiated.attachment?.id
  ) {
    throw new Error("Upload setup returned an invalid response.");
  }

  const partNumbers = Array.from({ length: upload.totalParts }, (_, index) => index + 1);
  let initialUrls;
  try {
    initialUrls = await signParts(callApi, upload.sessionId, partNumbers, signal);
    const progressByPart = new Map();
    const partSize = upload.partSize;
    const reportProgress = () => {
      const uploadedBytes = [...progressByPart.values()].reduce((total, bytes) => total + bytes, 0);
      onProgress?.(Math.min(100, Math.round((uploadedBytes / file.size) * 100)));
    };

    let nextIndex = 0;
    async function worker() {
      while (true) {
        if (signal?.aborted) throw cancelledUpload();
        const partNumber = partNumbers[nextIndex++];
        if (!partNumber) return;
        const start = (partNumber - 1) * partSize;
        const end = Math.min(start + partSize, file.size);
        const part = file.slice(start, end, "");
        let url = initialUrls.get(partNumber);

        for (let attempt = 0; attempt < PART_RETRIES; attempt++) {
          try {
            await putPart(url, part, (loaded) => {
              progressByPart.set(partNumber, loaded);
              reportProgress();
            }, signal);
            progressByPart.set(partNumber, end - start);
            reportProgress();
            break;
          } catch (error) {
            if (error?.name === "AbortError" || signal?.aborted) throw cancelledUpload();
            if (attempt === PART_RETRIES - 1) throw error;
            progressByPart.set(partNumber, 0);
            reportProgress();
            await pause(250 * (attempt + 1));
            url = (await signParts(callApi, upload.sessionId, [partNumber], signal)).get(partNumber);
          }
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, partNumbers.length) }, worker));
    if (signal?.aborted) throw cancelledUpload();
    const completed = await callApi("/api/uploads", {
      method: "POST",
      signal,
      body: JSON.stringify({ action: "complete", sessionId: upload.sessionId }),
    });
    if (!completed.attachment?.key) throw new Error("R2 did not confirm the uploaded file. Try again.");
    onProgress?.(100);
    return completed.attachment;
  } catch (error) {
    await callApi("/api/uploads", {
      method: "POST",
      body: JSON.stringify({ action: "abort", sessionId: upload.sessionId }),
    }).catch(() => {});
    throw error;
  }
}
