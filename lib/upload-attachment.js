function cancelledUpload() {
  return new DOMException("Upload đã bị hủy.", "AbortError");
}

function uploadToDrive(url, file, contentType, onProgress, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelledUpload());
      return;
    }

    const xhr = new XMLHttpRequest();
    const onAbort = () => {
      xhr.abort();
      finish(reject, cancelledUpload());
    };
    const finish = (settle, value) => {
      signal?.removeEventListener("abort", onAbort);
      settle(value);
    };

    // Register progress before opening the request for cross-browser support.
    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          onProgress(Math.min(100, Math.round(event.loaded / event.total * 100)));
        }
      };
    }
    xhr.onload = () => {
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // A successful upload must still return a Drive file ID.
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        finish(resolve, data);
      } else {
        const message = typeof data?.error === "string" ? data.error : data?.error?.message;
        finish(reject, new Error(message || `Upload failed (${xhr.status}).`));
      }
    };
    xhr.onerror = () => finish(reject, new Error("Network error during upload. Check your connection."));
    xhr.onabort = () => finish(reject, cancelledUpload());
    xhr.ontimeout = () => finish(reject, new Error("Upload timed out."));

    try {
      xhr.open("PUT", url);
      xhr.setRequestHeader("Content-Type", contentType);
      // The resumable session URL authorizes this file upload; OAuth stays on the server.
      signal?.addEventListener("abort", onAbort, { once: true });
      xhr.send(file);
    } catch (error) {
      finish(reject, error);
    }
  });
}

export async function uploadAttachment({ file, callApi, onProgress, signal }) {
  if (signal?.aborted) throw cancelledUpload();

  // Every file, including small files and inline images, goes directly to Drive.
  const data = await callApi("/api/uploads", {
    method: "POST",
    signal,
    body: JSON.stringify({
      action: "initiate",
      name: file.name,
      contentType: file.type,
      size: file.size,
    }),
  });
  if (data.upload?.mode !== "resumable" || !data.upload.url || !data.attachment?.id) {
    throw new Error("Upload setup returned an invalid response.");
  }

  const googleFile = await uploadToDrive(
    data.upload.url,
    file,
    data.attachment.contentType || "application/octet-stream",
    onProgress,
    signal
  );
  if (typeof googleFile?.id !== "string" || !googleFile.id.trim()) {
    throw new Error("Google Drive did not confirm the uploaded file. Try again.");
  }
  if (signal?.aborted) {
    await callApi(`/api/uploads?key=${encodeURIComponent(googleFile.id)}`, { method: "DELETE" }).catch(() => {});
    throw cancelledUpload();
  }

  return { ...data.attachment, key: googleFile.id };
}
