"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const ACCESS_KEY_STORAGE = "notes-access-key";
const MAX_ATTACHMENTS = 10;

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function readableSize(size) {
  if (!size) return "";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function orderItems(items) {
  return [...items].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

async function putFileToS3(url, headers, body) {
  let result;
  try {
    result = await fetch(url, { method: "PUT", headers, body });
  } catch {
    throw new Error("Cannot reach S3. Check the bucket CORS configuration and your network connection.");
  }
  if (result.ok) return result;
  if (result.status === 403) {
    throw new Error("S3 rejected the upload. Check the bucket CORS and IAM settings.");
  }
  throw new Error(`S3 upload failed (${result.status}).`);
}

async function uploadMultipartToS3(file, upload) {
  const completedParts = new Array(upload.parts.length);
  let nextPartIndex = 0;
  const workerCount = Math.min(3, upload.parts.length);

  async function uploadNextPart() {
    while (nextPartIndex < upload.parts.length) {
      const partIndex = nextPartIndex;
      nextPartIndex += 1;
      const part = upload.parts[partIndex];
      const start = partIndex * upload.partSize;
      const result = await putFileToS3(part.url, part.headers, file.slice(start, start + upload.partSize));
      const eTag = result.headers.get("ETag");
      if (!eTag) throw new Error("S3 did not return an ETag. Add ETag to the bucket CORS exposed headers.");
      completedParts[partIndex] = { partNumber: part.partNumber, eTag };
    }
  }

  await Promise.all(Array.from({ length: workerCount }, uploadNextPart));
  return completedParts;
}

export default function Home() {
  const [items, setItems] = useState([]);
  const [accessKey, setAccessKey] = useState("");
  const [accessInput, setAccessInput] = useState("");
  const [locked, setLocked] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState([]);
  const [linkInput, setLinkInput] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState("");
  const [editAttachments, setEditAttachments] = useState([]);
  const [editLinkInput, setEditLinkInput] = useState("");
  const [attachmentUrls, setAttachmentUrls] = useState({});
  const [downloadingAttachments, setDownloadingAttachments] = useState({});
  const fileInput = useRef(null);
  const editFileInput = useRef(null);
  const editTextarea = useRef(null);
  const objectUrls = useRef(new Set());
  const failedAttachments = useRef(new Set());

  const editingItem = useMemo(
    () => items.find((item) => item.id === editingId) ?? null,
    [items, editingId],
  );

  function revokeUrl(url) {
    if (!url) return;
    URL.revokeObjectURL(url);
    objectUrls.current.delete(url);
  }

  function clearAttachmentUrls() {
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.current.clear();
    failedAttachments.current.clear();
    setAttachmentUrls({});
  }

  function removeAttachmentUrls(attachments) {
    const ids = new Set(attachments.map((attachment) => attachment.id));
    setAttachmentUrls((current) => {
      const next = { ...current };
      ids.forEach((attachmentId) => {
        revokeUrl(next[attachmentId]);
        delete next[attachmentId];
      });
      return next;
    });
  }

  async function callApi(path, options = {}, key = accessKey) {
    const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
    const response = await fetch(path, {
      ...options,
      headers: {
        "x-notes-access-key": key,
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 401) {
        localStorage.removeItem(ACCESS_KEY_STORAGE);
        setLocked(true);
      }
      throw new Error(payload.error || "Something went wrong.");
    }
    return payload;
  }

  function upsertItem(nextItem) {
    setItems((current) => orderItems([
      nextItem,
      ...current.filter((item) => item.id !== nextItem.id),
    ]));
  }

  async function loadItems(key = accessKey) {
    if (!key) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setNotice("");
    try {
      const data = await callApi("/api/items", {}, key);
      setItems(orderItems(data.items));
      setLocked(false);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadAttachment(attachment) {
    const query = new URLSearchParams({ key: attachment.key });
    const response = await fetch(`/api/files?${query.toString()}`, {
      headers: { "x-notes-access-key": accessKey },
    });
    if (!response.ok) throw new Error("Could not load attachment.");
    const url = URL.createObjectURL(await response.blob());
    objectUrls.current.add(url);
    return url;
  }

  async function downloadAttachment(attachment) {
    if (!attachment.key || downloadingAttachments[attachment.id]) return;
    setDownloadingAttachments((current) => ({ ...current, [attachment.id]: true }));
    setNotice("");

    try {
      const query = new URLSearchParams({ key: attachment.key, download: "1" });
      const response = await fetch(`/api/files?${query.toString()}`, {
        headers: { "x-notes-access-key": accessKey },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || typeof payload.url !== "string") {
        throw new Error(payload.error || "Could not prepare attachment download.");
      }
      const link = document.createElement("a");
      link.href = payload.url;
      link.download = attachment.name || "download";
      link.rel = "noreferrer";
      document.body.append(link);
      link.click();
      link.remove();
    } catch (error) {
      setNotice(error.message || "Could not download attachment.");
    } finally {
      setDownloadingAttachments((current) => {
        const next = { ...current };
        delete next[attachment.id];
        return next;
      });
    }
  }

  useEffect(() => {
    const savedKey = localStorage.getItem(ACCESS_KEY_STORAGE);
    if (savedKey) {
      setAccessKey(savedKey);
      loadItems(savedKey);
    } else {
      setLoading(false);
    }

    return () => {
      objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    if (locked || !accessKey) return;
    let cancelled = false;
    const missing = [...items.flatMap((item) => item.attachments), ...editAttachments]
      .filter((attachment) => (
        attachment.kind === "image"
        && attachment.key
        && !attachmentUrls[attachment.id]
        && !failedAttachments.current.has(attachment.id)
      ));

    if (!missing.length) return;

    Promise.all(missing.map(async (attachment) => {
      try {
        return [attachment.id, await loadAttachment(attachment)];
      } catch {
        failedAttachments.current.add(attachment.id);
        return null;
      }
    })).then((loaded) => {
      if (cancelled) {
        loaded.filter(Boolean).forEach(([, url]) => revokeUrl(url));
        return;
      }
      setAttachmentUrls((current) => ({
        ...current,
        ...Object.fromEntries(loaded.filter(Boolean)),
      }));
    });

    return () => { cancelled = true; };
  }, [items, editAttachments, accessKey, locked, attachmentUrls]);

  useEffect(() => {
    const textarea = editTextarea.current;
    if (!textarea || !editingId) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 320)}px`;
  }, [editingId, editDraft]);

  async function unlock(event) {
    event.preventDefault();
    const key = accessInput.trim();
    if (!key) return;
    setAccessKey(key);
    localStorage.setItem(ACCESS_KEY_STORAGE, key);
    await loadItems(key);
  }

  async function discardPending(pendingItems, key = accessKey) {
    await Promise.all(pendingItems.filter((item) => item.key).map(async (item) => {
      try {
        await callApi(`/api/uploads?key=${encodeURIComponent(item.key)}`, { method: "DELETE" }, key);
      } catch {
        // A discarded draft is never saved to the list.
      }
    }));
  }

  async function addItem() {
    if (saving || uploading) return;
    const content = draft.trim();
    if (!content && pending.length === 0) return;

    setSaving(true);
    setNotice("");
    try {
      const data = await callApi("/api/items", {
        method: "POST",
        body: JSON.stringify({ content, attachments: pending }),
      });
      upsertItem(data.item);
      setDraft("");
      setPending([]);
      setLinkInput("");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setSaving(false);
    }
  }

  function startEdit(item) {
    setEditingId(item.id);
    setEditDraft(item.content);
    setEditAttachments(item.attachments.map((attachment) => ({ ...attachment })));
    setEditLinkInput("");
    setNotice("");
  }

  function finishEdit() {
    setEditingId(null);
    setEditDraft("");
    setEditAttachments([]);
    setEditLinkInput("");
  }

  async function cancelEdit() {
    const newAttachments = editAttachments.filter((attachment) => attachment._new);
    await discardPending(newAttachments);
    removeAttachmentUrls(newAttachments);
    finishEdit();
  }

  async function removeEditAttachment(attachment) {
    setEditAttachments((current) => current.filter((item) => item.id !== attachment.id));
    if (attachment._new && attachment.key) {
      await discardPending([attachment]);
      removeAttachmentUrls([attachment]);
    }
  }

  async function saveEdit() {
    if (!editingItem || saving) return;
    const content = editDraft.trim();
    if (!content && editAttachments.length === 0) {
      setNotice("Item is empty.");
      return;
    }

    setSaving(true);
    setNotice("");
    try {
      const data = await callApi("/api/items", {
        method: "PATCH",
        body: JSON.stringify({
          action: "edit-item",
          id: editingItem.id,
          content,
          attachments: editAttachments.map(({ _new, ...attachment }) => attachment),
        }),
      });
      const removedAttachments = editingItem.attachments.filter((attachment) => (
        attachment.key && !editAttachments.some((next) => next.key === attachment.key)
      ));
      removeAttachmentUrls(removedAttachments);
      upsertItem(data.item);
      finishEdit();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteItem(item) {
    if (!window.confirm("Delete this item and its attachments?")) return;
    setSaving(true);
    setNotice("");
    try {
      await callApi("/api/items", {
        method: "PATCH",
        body: JSON.stringify({ action: "delete-item", id: item.id }),
      });
      removeAttachmentUrls(item.attachments);
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      if (editingId === item.id) void cancelEdit();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function uploadFiles(event, target = "new") {
    const currentAttachments = target === "edit" ? editAttachments : pending;
    const available = MAX_ATTACHMENTS - currentAttachments.length;
    const selectedFiles = Array.from(event.target.files || []);
    const files = selectedFiles.slice(0, available);
    event.target.value = "";
    if (!files.length) return;

    setUploading(true);
    setNotice("");
    const uploaded = [];
    try {
      for (const file of files) {
        const data = await callApi("/api/uploads", {
          method: "POST",
          body: JSON.stringify({
            action: "initiate",
            name: file.name,
            contentType: file.type,
            size: file.size,
          }),
        });

        try {
          if (data.upload?.mode === "single") {
            await putFileToS3(data.upload.url, data.upload.headers, file);
          } else if (data.upload?.mode === "multipart") {
            const parts = await uploadMultipartToS3(file, data.upload);
            await callApi("/api/uploads", {
              method: "POST",
              body: JSON.stringify({
                action: "complete",
                key: data.attachment.key,
                uploadId: data.upload.uploadId,
                parts,
              }),
            });
          } else {
            throw new Error("Upload setup returned an invalid response.");
          }
          uploaded.push(data.attachment);
        } catch (error) {
          if (data.upload?.mode === "multipart") {
            await callApi("/api/uploads", {
              method: "POST",
              body: JSON.stringify({
                action: "abort",
                key: data.attachment.key,
                uploadId: data.upload.uploadId,
              }),
            }).catch(() => {});
          } else if (data.attachment?.key) {
            await callApi(`/api/uploads?key=${encodeURIComponent(data.attachment.key)}`, { method: "DELETE" }).catch(() => {});
          }
          throw error;
        }
      }
      if (target === "edit") {
        setEditAttachments((current) => [
          ...current,
          ...uploaded.map((attachment) => ({ ...attachment, _new: true })),
        ]);
      } else {
        setPending((current) => [...current, ...uploaded]);
      }
      if (available < selectedFiles.length) setNotice("Attachment limit reached.");
    } catch (error) {
      await Promise.allSettled(uploaded.map((attachment) => (
        callApi(`/api/uploads?key=${encodeURIComponent(attachment.key)}`, { method: "DELETE" })
      )));
      setNotice(error.message);
    } finally {
      setUploading(false);
    }
  }

  function addLink(target = "new") {
    const currentAttachments = target === "edit" ? editAttachments : pending;
    const input = target === "edit" ? editLinkInput : linkInput;
    if (currentAttachments.length >= MAX_ATTACHMENTS) {
      setNotice("Attachment limit reached.");
      return;
    }
    const rawUrl = input.trim();
    if (!rawUrl) return;

    try {
      const url = new URL(rawUrl);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      const attachment = { id: makeId(), kind: "link", url: url.toString(), name: url.hostname };
      if (target === "edit") {
        setEditAttachments((current) => [...current, attachment]);
        setEditLinkInput("");
      } else {
        setPending((current) => [...current, attachment]);
        setLinkInput("");
      }
    } catch {
      setNotice("Use a valid http(s) link.");
    }
  }

  async function removePending(attachment) {
    setPending((current) => current.filter((item) => item.id !== attachment.id));
    if (!attachment.key) return;
    try {
      await callApi(`/api/uploads?key=${encodeURIComponent(attachment.key)}`, { method: "DELETE" });
    } catch {
      setNotice("Could not remove file.");
    }
  }

  function lock() {
    void discardPending(pending);
    localStorage.removeItem(ACCESS_KEY_STORAGE);
    clearAttachmentUrls();
    setAccessKey("");
    setAccessInput("");
    setItems([]);
    setDraft("");
    setPending([]);
    void cancelEdit();
    setLocked(true);
    setNotice("");
  }

  if (locked) {
    return (
      <main className="unlock-page">
        <section className="unlock-card">
          <div className="brand-mark" aria-hidden="true">*</div>
          <p className="eyebrow">NOTES</p>
          <h1>Private notes</h1>
          <p className="muted">Enter your key to continue.</p>
          <form onSubmit={unlock} className="unlock-form">
            <label htmlFor="access-key">Access key</label>
            <input id="access-key" type="password" autoComplete="current-password" value={accessInput} onChange={(event) => setAccessInput(event.target.value)} placeholder="Your key" required />
            <button className="button primary" type="submit" disabled={loading}>{loading ? "Opening..." : "Open"}</button>
          </form>
          {notice && <p className="form-message">{notice}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="app-brand"><span className="brand-orbit" aria-hidden="true" /><h1>Notes</h1><small>{items.length} items</small></div>
        <button className="button ghost" type="button" onClick={lock}>Lock</button>
      </header>

      <section className="notes-surface">
        <div className="items-list">
          {loading && <p className="empty-state">Loading...</p>}
          {!loading && items.length === 0 && <div className="empty-items"></div>}
          {items.map((item, index) => (
            <article className={`item-card ${editingId === item.id ? "editing" : ""}`} key={item.id}>
              <span className="line-number">{index + 1}</span>
              <div className="item-body">
                <div className="item-top"><time>{formatDate(item.updatedAt)}</time><div><button className="item-edit" type="button" aria-label="Edit item" onClick={() => startEdit(item)} disabled={saving || editingId === item.id} title="Edit item"><span className="edit-icon" aria-hidden="true" /></button><button className="item-delete" type="button" onClick={() => deleteItem(item)} disabled={saving} title="Delete item">x</button></div></div>
                {item.content && <p className={editingId === item.id ? "current-content" : ""}>{item.content}</p>}
                {(editingId === item.id ? editAttachments : item.attachments).length > 0 && <div className="attachments">
                  {(editingId === item.id ? editAttachments : item.attachments).map((attachment) => {
                    if (attachment.kind === "link") return <a className="link-card" href={attachment.url} key={attachment.id} target="_blank" rel="noreferrer"><span>Link</span><strong>{attachment.name}</strong><small>{attachment.url}</small></a>;
                    const url = attachmentUrls[attachment.id];
                    if (attachment.kind === "image") return url ? <a className="image-card" href={url} key={attachment.id} target="_blank" rel="noreferrer"><img src={url} alt={attachment.name} /></a> : <div className="file-card" key={attachment.id}>Loading image...</div>;
                    const downloading = downloadingAttachments[attachment.id];
                    return <button className="file-card" type="button" key={attachment.id} onClick={() => void downloadAttachment(attachment)} disabled={downloading} aria-label={`Download ${attachment.name}`}><span>File</span><strong>{attachment.name}</strong><small>{downloading ? "Downloading..." : readableSize(attachment.size)}</small></button>;
                  })}
                </div>}
                {editingId === item.id && (
                  <div className="edit-area">
                    <textarea ref={editTextarea} value={editDraft} maxLength={20_000} onChange={(event) => setEditDraft(event.target.value)} aria-label="Edit note" />
                    {editAttachments.length > 0 && <div className="edit-attachments">{editAttachments.map((attachment) => <span className="edit-chip" key={attachment.id}><span className="chip-type">{attachment.kind === "link" ? "Link" : attachment.kind === "image" ? "Image" : "File"}</span><span className="chip-name">{attachment.name}</span><button type="button" onClick={() => removeEditAttachment(attachment)} aria-label={`Remove ${attachment.name}`}>x</button></span>)}</div>}
                    <div className="edit-tools">
                      <input ref={editFileInput} type="file" multiple hidden onChange={(event) => uploadFiles(event, "edit")} />
                      <button className="button ghost compact science-button" type="button" onClick={() => editFileInput.current?.click()} disabled={uploading || saving}><span className="science-icon atom" aria-hidden="true" />Files</button>
                      <input className="link-input" value={editLinkInput} onChange={(event) => setEditLinkInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addLink("edit"); } }} placeholder="Paste link" aria-label="Paste link" />
                      <button className="button ghost compact science-button" type="button" onClick={() => addLink("edit")}> <span className="science-icon molecule" aria-hidden="true" />Link</button>
                    </div>
                    <div className="edit-actions"><button className="button ghost compact" type="button" onClick={() => void cancelEdit()}>Cancel</button><button className="button primary compact" type="button" onClick={saveEdit} disabled={saving || uploading}>Save</button></div>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>

        <div className="composer">
          {pending.length > 0 && <div className="pending-attachments">{pending.map((attachment) => <span className="pending-chip" key={attachment.id}><span className="chip-type">{attachment.kind === "link" ? "Link" : attachment.kind === "image" ? "Image" : "File"}</span><span className="chip-name">{attachment.name}</span><button type="button" aria-label={`Remove ${attachment.name}`} onClick={() => removePending(attachment)}>x</button></span>)}</div>}
          <div className="composer-label"><span className="science-icon orbit" aria-hidden="true" />New item</div>
          <textarea value={draft} maxLength={20_000} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); addItem(); } }} placeholder="Write a note..." aria-label="Add a note" />
          <div className="composer-toolbar">
            <div className="attachment-actions">
              <input ref={fileInput} type="file" multiple hidden onChange={uploadFiles} />
              <button className="button ghost compact science-button" type="button" onClick={() => fileInput.current?.click()} disabled={uploading || saving} title="Attach files"><span className="science-icon atom" aria-hidden="true" />{uploading ? "Uploading..." : "Files"}</button>
              <input className="link-input" value={linkInput} onChange={(event) => setLinkInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addLink(); } }} placeholder="Paste link" aria-label="Paste link" />
              <button className="button ghost compact science-button" type="button" onClick={addLink}><span className="science-icon molecule" aria-hidden="true" />Link</button>
            </div>
            <button className="button primary science-button" type="button" onClick={addItem} disabled={saving || uploading || (!draft.trim() && pending.length === 0)}><span className="science-icon plus" aria-hidden="true" />{saving ? "Saving..." : "Add"}</button>
          </div>
          {notice && <p className="composer-message">{notice}</p>}
        </div>
      </section>
    </main>
  );
}
