"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import UnlockCard from "./components/UnlockCard";
import ItemCard from "./components/ItemCard";
import ItemComposer from "./components/ItemComposer";
import PullToRefreshIndicator from "./components/PullToRefreshIndicator";

const ACCESS_KEY_STORAGE = "notes-access-key";
const MAX_ATTACHMENTS = 10;
const PULL_THRESHOLD = 52;
const REFRESHING_HEIGHT = 40;
const MAX_PULL_DISTANCE = 75;

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
  const [pullDistance, setPullDistance] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  const fileInput = useRef(null);
  const editFileInput = useRef(null);
  const linkInputRef = useRef(null);
  const editLinkInputRef = useRef(null);
  const editTextarea = useRef(null);
  const itemsListRef = useRef(null);
  const objectUrls = useRef(new Set());
  const loadingAttachments = useRef(new Set());
  const failedAttachments = useRef(new Set());
  const dragCounterRef = useRef(0);

  const pullDistanceRef = useRef(0);
  const isRefreshingRef = useRef(false);
  const isEditingRef = useRef(false);
  const savingRef = useRef(false);
  const uploadingRef = useRef(false);
  const accessKeyRef = useRef("");
  const hasVibratedRef = useRef(false);

  pullDistanceRef.current = pullDistance;
  isRefreshingRef.current = isRefreshing;
  isEditingRef.current = Boolean(editingId);
  savingRef.current = saving;
  uploadingRef.current = uploading;
  accessKeyRef.current = accessKey;

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

  async function loadItems(key = accessKey, isPull = false) {
    if (!key) {
      setLoading(false);
      return;
    }

    if (!isPull) {
      setLoading(true);
    }
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

  useEffect(() => {
    const container = itemsListRef.current;
    if (!container || locked) return;

    let startY = 0;
    let startX = 0;
    let isTracking = false;

    const handleTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      if (isRefreshingRef.current || isEditingRef.current || savingRef.current || uploadingRef.current) return;

      if (container.scrollTop <= 0) {
        startY = e.touches[0].clientY;
        startX = e.touches[0].clientX;
        isTracking = true;
        hasVibratedRef.current = false;
      }
    };

    const handleTouchMove = (e) => {
      if (!isTracking) return;

      if (container.scrollTop > 0) {
        isTracking = false;
        setIsPulling(false);
        setPullDistance(0);
        return;
      }

      const currentY = e.touches[0].clientY;
      const currentX = e.touches[0].clientX;
      const deltaY = currentY - startY;
      const deltaX = currentX - startX;

      if (deltaY > 0 && Math.abs(deltaY) > Math.abs(deltaX)) {
        if (e.cancelable) {
          e.preventDefault();
        }
        setIsPulling(true);
        const dampened = Math.min(MAX_PULL_DISTANCE, deltaY * 0.45);
        setPullDistance(dampened);

        if (dampened >= PULL_THRESHOLD && !hasVibratedRef.current) {
          hasVibratedRef.current = true;
          try {
            navigator.vibrate?.(10);
          } catch {}
        }
      } else if (deltaY < 0) {
        isTracking = false;
        setIsPulling(false);
        setPullDistance(0);
      }
    };

    const handleTouchEnd = async () => {
      if (!isTracking) return;
      isTracking = false;
      setIsPulling(false);

      if (pullDistanceRef.current >= PULL_THRESHOLD && !isRefreshingRef.current && accessKeyRef.current) {
        setIsRefreshing(true);
        setPullDistance(REFRESHING_HEIGHT);
        try {
          await loadItems(accessKeyRef.current, true);
        } finally {
          setIsRefreshing(false);
          setPullDistance(0);
        }
      } else {
        setPullDistance(0);
      }
    };

    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchmove", handleTouchMove, { passive: false });
    container.addEventListener("touchend", handleTouchEnd, { passive: true });
    container.addEventListener("touchcancel", handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
      container.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [locked]);

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

  function handleAddFiles(filesList, target = editingId ? "edit" : "new") {
    const filesArray = Array.from(filesList || []);
    if (!filesArray.length) return;

    const currentAttachments = target === "edit" ? editAttachments : pending;
    const available = MAX_ATTACHMENTS - currentAttachments.length;
    if (available <= 0) {
      setNotice("Attachment limit reached.");
      return;
    }

    const files = filesArray.slice(0, available);
    setNotice("");
    if (target === "edit") {
      setEditAttachments((current) => [...current, ...files.map(selectedFileAttachment)]);
    } else {
      setPending((current) => [...current, ...files.map(selectedFileAttachment)]);
    }
    if (filesArray.length > available) {
      setNotice("Attachment limit reached.");
    }
  }

  function selectFiles(event, target = "new") {
    handleAddFiles(event.target.files, target);
    event.target.value = "";
  }

  useEffect(() => {
    if (locked) {
      setIsDraggingFile(false);
      dragCounterRef.current = 0;
      return;
    }

    const hasFiles = (e) => {
      if (!e.dataTransfer) return false;
      const types = Array.from(e.dataTransfer.types || []);
      return types.includes("Files");
    };

    const handleDragEnter = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragCounterRef.current += 1;
      setIsDraggingFile(true);
    };

    const handleDragOver = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    };

    const handleDragLeave = (e) => {
      if (!hasFiles(e)) return;
      dragCounterRef.current -= 1;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setIsDraggingFile(false);
      }
    };

    const handleDrop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDraggingFile(false);

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleAddFiles(e.dataTransfer.files);
      }
    };

    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);

    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);
    };
  }, [locked, editingId, editAttachments, pending]);

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
    setPullDistance(0);
    setIsPulling(false);
    setIsRefreshing(false);
    setIsDraggingFile(false);
    dragCounterRef.current = 0;
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
        {isDraggingFile && (
          <div className="drop-overlay" aria-hidden="true">
            <div className="drop-overlay-icon">
              <svg viewBox="0 0 24 24">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <div className="drop-overlay-title">Drop files to attach</div>
            <div className="drop-overlay-subtitle">
              {editingId ? "Adding to editing note" : "Adding to new note"} (max 10 attachments)
            </div>
          </div>
        )}
        <div className="items-list" ref={itemsListRef}>
          <PullToRefreshIndicator
            pullDistance={pullDistance}
            threshold={PULL_THRESHOLD}
            isRefreshing={isRefreshing}
            isPulling={isPulling}
          />
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
