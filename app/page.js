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

function selectedFileAttachment(file) {
  return {
    id: makeId(),
    kind: file.type.startsWith("image/") ? "image" : "file",
    name: file.name || "file",
    contentType: file.type,
    size: file.size,
    file,
  };
}

function AttachmentTypeIcon({ type, compact = false }) {
  const className = compact ? "attachment-preview-icon" : "attachment-type-icon";

  if (type === "link") {
    return (
      <span className={className} aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="M10.5 13.5a4.25 4.25 0 0 0 6.01.01l2-2a4.25 4.25 0 0 0-6.01-6.01l-1.14 1.14" />
          <path d="M13.5 10.5a4.25 4.25 0 0 0-6.01-.01l-2 2a4.25 4.25 0 0 0 6.01 6.01l1.14-1.14" />
        </svg>
      </span>
    );
  }

  if (type === "image") {
    return (
      <span className={className} aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
          <path d="m5.5 16 4.5-4.5 3 3 2-2 3.5 3.5M8 9.5h.01" />
        </svg>
      </span>
    );
  }

  return (
    <span className={className} aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <path d="M6.5 3.5h7l4 4v13h-11z" />
        <path d="M13.5 3.5v4h4M9 14h6M9 17h4.5" />
      </svg>
    </span>
  );
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
  const [linkInputVisible, setLinkInputVisible] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState("");
  const [editAttachments, setEditAttachments] = useState([]);
  const [editLinkInput, setEditLinkInput] = useState("");
  const [editLinkInputVisible, setEditLinkInputVisible] = useState(false);
  const [attachmentUrls, setAttachmentUrls] = useState({});
  const [downloadingAttachments, setDownloadingAttachments] = useState({});
  const fileInput = useRef(null);
  const editFileInput = useRef(null);
  const linkInputRef = useRef(null);
  const editLinkInputRef = useRef(null);
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

  async function uploadAttachment(file) {
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
      return data.attachment;
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

  async function uploadSelectedFiles(attachments) {
    const uploaded = [];
    const completed = [];
    try {
      for (const attachment of attachments) {
        if (!attachment.file) {
          completed.push(attachment);
          continue;
        }
        const storedAttachment = await uploadAttachment(attachment.file);
        uploaded.push(storedAttachment);
        completed.push(storedAttachment);
      }
      return { attachments: completed, uploaded };
    } catch (error) {
      await Promise.allSettled(uploaded.map((attachment) => (
        callApi(`/api/uploads?key=${encodeURIComponent(attachment.key)}`, { method: "DELETE" })
      )));
      throw error;
    }
  }

  async function deleteUploadedAttachments(attachments) {
    await Promise.allSettled(attachments.map((attachment) => (
      callApi(`/api/uploads?key=${encodeURIComponent(attachment.key)}`, { method: "DELETE" })
    )));
  }

  async function addItem() {
    if (saving || uploading) return;
    const content = draft.trim();
    if (!content && pending.length === 0) return;

    setSaving(true);
    setUploading(pending.some((attachment) => attachment.file));
    setNotice("");
    let uploaded = [];
    try {
      const completed = await uploadSelectedFiles(pending);
      uploaded = completed.uploaded;
      const data = await callApi("/api/items", {
        method: "POST",
        body: JSON.stringify({ content, attachments: completed.attachments }),
      });
      upsertItem(data.item);
      setDraft("");
      setPending([]);
      setLinkInput("");
      setLinkInputVisible(false);
    } catch (error) {
      await deleteUploadedAttachments(uploaded);
      setNotice(error.message);
    } finally {
      setSaving(false);
      setUploading(false);
    }
  }

  function startEdit(item) {
    setEditingId(item.id);
    setEditDraft(item.content);
    setEditAttachments(item.attachments.map((attachment) => ({ ...attachment })));
    setEditLinkInput("");
    setEditLinkInputVisible(false);
    setNotice("");
  }

  function finishEdit() {
    setEditingId(null);
    setEditDraft("");
    setEditAttachments([]);
    setEditLinkInput("");
    setEditLinkInputVisible(false);
  }

  function cancelEdit() {
    finishEdit();
  }

  function removeEditAttachment(attachment) {
    setEditAttachments((current) => current.filter((item) => item.id !== attachment.id));
  }

  async function saveEdit() {
    if (!editingItem || saving) return;
    const content = editDraft.trim();
    if (!content && editAttachments.length === 0) {
      setNotice("Item is empty.");
      return;
    }

    setSaving(true);
    setUploading(editAttachments.some((attachment) => attachment.file));
    setNotice("");
    let uploaded = [];
    try {
      const completed = await uploadSelectedFiles(editAttachments);
      uploaded = completed.uploaded;
      const savedAttachments = completed.attachments.map(({ file, _new, ...attachment }) => attachment);
      const data = await callApi("/api/items", {
        method: "PATCH",
        body: JSON.stringify({
          action: "edit-item",
          id: editingItem.id,
          content,
          attachments: savedAttachments,
        }),
      });
      const removedAttachments = editingItem.attachments.filter((attachment) => (
        attachment.key && !savedAttachments.some((next) => next.key === attachment.key)
      ));
      removeAttachmentUrls(removedAttachments);
      upsertItem(data.item);
      finishEdit();
    } catch (error) {
      await deleteUploadedAttachments(uploaded);
      setNotice(error.message);
    } finally {
      setSaving(false);
      setUploading(false);
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
      if (editingId === item.id) cancelEdit();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setSaving(false);
    }
  }

  function selectFiles(event, target = "new") {
    const currentAttachments = target === "edit" ? editAttachments : pending;
    const available = MAX_ATTACHMENTS - currentAttachments.length;
    const selectedFiles = Array.from(event.target.files || []);
    const files = selectedFiles.slice(0, available);
    event.target.value = "";
    if (!files.length) return;

    setNotice("");
    if (target === "edit") {
      setEditAttachments((current) => [...current, ...files.map(selectedFileAttachment)]);
    } else {
      setPending((current) => [...current, ...files.map(selectedFileAttachment)]);
    }
    if (available < selectedFiles.length) setNotice("Attachment limit reached.");
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
        setEditLinkInputVisible(false);
      } else {
        setPending((current) => [...current, attachment]);
        setLinkInput("");
        setLinkInputVisible(false);
      }
    } catch {
      setNotice("Use a valid http(s) link.");
    }
  }

  function revealLinkInput(target = "new") {
    if (target === "edit") {
      setEditLinkInputVisible(true);
      requestAnimationFrame(() => editLinkInputRef.current?.focus());
    } else {
      setLinkInputVisible(true);
      requestAnimationFrame(() => linkInputRef.current?.focus());
    }
  }

  function handleLinkButton(target = "new") {
    const visible = target === "edit" ? editLinkInputVisible : linkInputVisible;
    if (!visible) {
      revealLinkInput(target);
      return;
    }
    addLink(target);
  }

  function closeLinkInput(target = "new") {
    if (target === "edit") {
      setEditLinkInput("");
      setEditLinkInputVisible(false);
    } else {
      setLinkInput("");
      setLinkInputVisible(false);
    }
  }

  function removePending(attachment) {
    setPending((current) => current.filter((item) => item.id !== attachment.id));
  }

  function lock() {
    localStorage.removeItem(ACCESS_KEY_STORAGE);
    clearAttachmentUrls();
    setAccessKey("");
    setAccessInput("");
    setItems([]);
    setDraft("");
    setPending([]);
    setLinkInput("");
    setLinkInputVisible(false);
    cancelEdit();
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
                <div className="item-top"><time>{formatDate(item.updatedAt)}</time><div><button className="item-edit" type="button" aria-label="Edit item" onClick={() => startEdit(item)} disabled={saving || editingId === item.id} title="Edit item"><span className="edit-icon" aria-hidden="true" /></button><button className="item-delete" type="button" aria-label="Delete item" onClick={() => deleteItem(item)} disabled={saving} title="Delete item"><svg className="delete-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M9 7V4h6v3M6 7l1 13h10l1-13" /></svg></button></div></div>
                <div className="item-content">
                  {item.content && <p className={editingId === item.id ? "current-content" : ""}>{item.content}</p>}
                  {(editingId === item.id ? editAttachments : item.attachments).length > 0 && <div className="attachments">
                    {(editingId === item.id ? editAttachments : item.attachments).map((attachment) => {
                      if (attachment.kind === "link") return <a className="link-card" href={attachment.url} key={attachment.id} target="_blank" rel="noreferrer"><AttachmentTypeIcon type="link" /><strong>{attachment.name}</strong><small>{attachment.url}</small></a>;
                      const url = attachmentUrls[attachment.id];
                      if (attachment.kind === "image") return url ? <a className="image-card" href={url} key={attachment.id} target="_blank" rel="noreferrer"><img src={url} alt={attachment.name} /></a> : <div className="file-card" key={attachment.id}><AttachmentTypeIcon type="file" /><strong>{attachment.name}</strong><small>{attachment.file ? "Ready to upload" : "Loading image..."}</small></div>;
                      const downloading = downloadingAttachments[attachment.id];
                      return <button className="file-card" type="button" key={attachment.id} onClick={() => void downloadAttachment(attachment)} disabled={downloading || !attachment.key} aria-label={attachment.key ? `Download ${attachment.name}` : `${attachment.name} will upload when saved`}><AttachmentTypeIcon type="file" /><strong>{attachment.name}</strong><small>{attachment.file ? "Ready to upload" : downloading ? "Downloading..." : readableSize(attachment.size)}</small></button>;
                    })}
                  </div>}
                  {editingId === item.id && (
                    <div className="edit-area">
                      <textarea ref={editTextarea} value={editDraft} maxLength={20_000} onChange={(event) => setEditDraft(event.target.value)} aria-label="Edit note" />
                      {editAttachments.length > 0 && <div className="edit-attachments">{editAttachments.map((attachment) => <span className="edit-chip" key={attachment.id}><AttachmentTypeIcon type={attachment.kind} compact /><span className="chip-name">{attachment.name}</span><button type="button" onClick={() => removeEditAttachment(attachment)} aria-label={`Remove ${attachment.name}`}>x</button></span>)}</div>}
                      <div className="edit-toolbar">
                        <div className="edit-tools">
                          <input ref={editFileInput} type="file" multiple hidden onChange={(event) => selectFiles(event, "edit")} />
                          <button className="button ghost compact science-button" type="button" onClick={() => editFileInput.current?.click()} disabled={uploading || saving}><span className="science-icon atom" aria-hidden="true" />Files</button>
                          {editLinkInputVisible && <div className="link-input-wrap"><input ref={editLinkInputRef} className="link-input" value={editLinkInput} onChange={(event) => setEditLinkInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addLink("edit"); } }} placeholder="Paste link" aria-label="Paste link" /><button className="link-input-close" type="button" onClick={() => closeLinkInput("edit")} aria-label="Close link input">×</button></div>}
                          <button className="button ghost compact science-button" type="button" onClick={() => handleLinkButton("edit")} disabled={uploading || saving} aria-expanded={editLinkInputVisible}><span className="science-icon molecule" aria-hidden="true" />{editLinkInputVisible ? "Add" : "Link"}</button>
                        </div>
                        <div className="edit-actions"><button className="button ghost compact" type="button" onClick={() => void cancelEdit()}>Cancel</button><button className="button primary compact" type="button" onClick={saveEdit} disabled={saving || uploading}>Save</button></div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>

        <div className="composer">
          {pending.length > 0 && <div className="pending-attachments">{pending.map((attachment) => <span className="pending-chip" key={attachment.id}><AttachmentTypeIcon type={attachment.kind} compact /><span className="chip-name">{attachment.name}</span><button type="button" aria-label={`Remove ${attachment.name}`} onClick={() => removePending(attachment)}>x</button></span>)}</div>}
          <div className="composer-label"><span className="science-icon orbit" aria-hidden="true" />New item</div>
          <textarea value={draft} maxLength={20_000} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); addItem(); } }} placeholder="Write a note..." aria-label="Add a note" />
          <div className="composer-toolbar">
            <div className="attachment-actions">
              <input ref={fileInput} type="file" multiple hidden onChange={selectFiles} />
              <button className="button ghost compact science-button" type="button" onClick={() => fileInput.current?.click()} disabled={uploading || saving} title="Attach files"><span className="science-icon atom" aria-hidden="true" />{uploading ? "Uploading..." : "Files"}</button>
              {linkInputVisible && <div className="link-input-wrap"><input ref={linkInputRef} className="link-input" value={linkInput} onChange={(event) => setLinkInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addLink(); } }} placeholder="Paste link" aria-label="Paste link" /><button className="link-input-close" type="button" onClick={() => closeLinkInput()} aria-label="Close link input">×</button></div>}
              <button className="button ghost compact science-button" type="button" onClick={() => handleLinkButton()} disabled={uploading || saving} aria-expanded={linkInputVisible}><span className="science-icon molecule" aria-hidden="true" />{linkInputVisible ? "Add" : "Link"}</button>
            </div>
            <button className="button primary science-button" type="button" onClick={addItem} disabled={saving || uploading || (!draft.trim() && pending.length === 0)}><span className="science-icon plus" aria-hidden="true" />{saving ? "Saving..." : "Add"}</button>
          </div>
          {notice && <p className="composer-message">{notice}</p>}
        </div>
      </section>
    </main>
  );
}
