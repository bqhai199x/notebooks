"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import UnlockCard from "./components/UnlockCard";
import ItemCard from "./components/ItemCard";
import ItemComposer from "./components/ItemComposer";

const ACCESS_KEY_STORAGE = "notes-access-key";
const MAX_ATTACHMENTS = 10;

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
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
  const loadingAttachments = useRef(new Set());
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
    loadingAttachments.current.clear();
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

    const allAttachments = [
      ...items.flatMap((item) => item.attachments),
      ...editAttachments,
    ];

    const missing = allAttachments.filter((attachment) => (
      attachment.kind === "image"
      && attachment.key
      && !attachmentUrls[attachment.id]
      && !loadingAttachments.current.has(attachment.id)
      && !failedAttachments.current.has(attachment.id)
    ));

    if (!missing.length) return;

    missing.forEach((att) => loadingAttachments.current.add(att.id));

    let cancelled = false;
    Promise.all(missing.map(async (attachment) => {
      try {
        const url = await loadAttachment(attachment);
        return [attachment.id, url];
      } catch {
        failedAttachments.current.add(attachment.id);
        return null;
      } finally {
        loadingAttachments.current.delete(attachment.id);
      }
    })).then((loaded) => {
      if (cancelled) {
        loaded.filter(Boolean).forEach(([, url]) => revokeUrl(url));
        return;
      }
      const newEntries = loaded.filter(Boolean);
      if (newEntries.length > 0) {
        setAttachmentUrls((current) => ({
          ...current,
          ...Object.fromEntries(newEntries),
        }));
      }
    });

    return () => { cancelled = true; };
  }, [items, editAttachments, accessKey, locked]);

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
      <UnlockCard
        accessInput={accessInput}
        setAccessInput={setAccessInput}
        unlock={unlock}
        loading={loading}
        notice={notice}
      />
    );
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="app-brand">
          <span className="brand-orbit" aria-hidden="true" />
          <h1>Notes</h1>
          <small>{items.length} items</small>
        </div>
        <button className="button ghost" type="button" onClick={lock}>
          Lock
        </button>
      </header>

      <section className="notes-surface">
        <div className="items-list">
          {loading && <p className="empty-state">Loading...</p>}
          {!loading && items.length === 0 && <div className="empty-items" />}
          {items.map((item, index) => (
            <ItemCard
              key={item.id}
              item={item}
              index={index}
              isEditing={editingId === item.id}
              saving={saving}
              uploading={uploading}
              onStartEdit={startEdit}
              onDelete={deleteItem}
              attachmentUrls={attachmentUrls}
              downloadingAttachments={downloadingAttachments}
              onDownloadAttachment={downloadAttachment}
              editDraft={editDraft}
              setEditDraft={setEditDraft}
              editAttachments={editAttachments}
              onRemoveEditAttachment={removeEditAttachment}
              editFileInputRef={editFileInput}
              onSelectFiles={selectFiles}
              editLinkInput={editLinkInput}
              setEditLinkInput={setEditLinkInput}
              editLinkInputVisible={editLinkInputVisible}
              editLinkInputRef={editLinkInputRef}
              onHandleLinkButton={handleLinkButton}
              onCloseLinkInput={closeLinkInput}
              onAddLink={addLink}
              onCancelEdit={cancelEdit}
              onSaveEdit={saveEdit}
              editTextareaRef={editTextarea}
            />
          ))}
        </div>

        <ItemComposer
          draft={draft}
          setDraft={setDraft}
          pending={pending}
          onRemovePending={removePending}
          onAddItem={addItem}
          saving={saving}
          uploading={uploading}
          fileInputRef={fileInput}
          onSelectFiles={selectFiles}
          linkInput={linkInput}
          setLinkInput={setLinkInput}
          linkInputVisible={linkInputVisible}
          linkInputRef={linkInputRef}
          onHandleLinkButton={handleLinkButton}
          onCloseLinkInput={closeLinkInput}
          onAddLink={addLink}
          notice={notice}
        />
      </section>
    </main>
  );
}
