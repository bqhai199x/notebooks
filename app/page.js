"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import UnlockCard from "./components/UnlockCard";
import ItemCard from "./components/ItemCard";
import ItemComposer from "./components/ItemComposer";
import PullToRefreshIndicator from "./components/PullToRefreshIndicator";
import {
  emptyRichText,
  inlineImageAttachmentIds,
  normalizeQuillDelta,
  QUILL_DELTA_FORMAT,
  removeInlineImages,
  replaceInlineImageAttachmentIds,
  richTextForDisplay,
  richTextHasText,
  serializeQuillDelta,
} from "../lib/rich-text";

const ACCESS_KEY_STORAGE = "notes-access-key";
const MAX_ATTACHMENTS = 10;
const PULL_THRESHOLD = 52;
const REFRESHING_HEIGHT = 40;
const MAX_PULL_DISTANCE = 75;

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
}

function orderItems(items) {
  return Array.isArray(items) ? [...items] : [];
}

function itemsInOrder(items, ids) {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const usedIds = new Set();
  const ordered = [];

  ids.forEach((id) => {
    const item = itemsById.get(id);
    if (item && !usedIds.has(id)) {
      ordered.push(item);
      usedIds.add(id);
    }
  });

  items.forEach((item) => {
    if (!usedIds.has(item.id)) ordered.push(item);
  });

  return ordered;
}

function sameItemOrder(left, right) {
  return left.length === right.length && left.every((item, index) => item.id === right[index]?.id);
}

async function putFileToUrl(url, headers, body) {
  let result;
  try {
    result = await fetch(url, { method: "PUT", headers, body });
  } catch {
    throw new Error("Cannot reach storage endpoint. Check your network connection.");
  }
  if (result.ok) return result;
  if (result.status === 403) {
    throw new Error("Storage service rejected the upload. Check your permissions.");
  }
  throw new Error(`Upload failed (${result.status}).`);
}

function uploadWithXHR(url, method, headers, body, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    if (signal) {
      if (signal.aborted) {
        return reject(new Error("Upload đã bị hủy."));
      }
      signal.addEventListener("abort", () => {
        xhr.abort();
        reject(new Error("Upload đã bị hủy."));
      });
    }
    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        if (value !== undefined && value !== null) {
          xhr.setRequestHeader(key, value);
        }
      }
    }
    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
          onProgress(percent, event.loaded, event.total);
        }
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          resolve(xhr.responseText);
        }
      } else {
        let errMsg = `Upload failed (${xhr.status})`;
        try {
          const errJson = JSON.parse(xhr.responseText);
          if (errJson.error) errMsg = errJson.error;
        } catch {}
        reject(new Error(errMsg));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload. Check your connection."));
    xhr.onabort = () => reject(new Error("Upload đã bị hủy."));
    xhr.ontimeout = () => reject(new Error("Upload timed out."));
    xhr.send(body);
  });
}

async function createThumbnail(file, maxDim = 120, quality = 0.65) {
  if (!file || typeof window === "undefined" || !file.type?.startsWith("image/")) return null;
  try {
    const bitmap = await createImageBitmap(file);
    let { width, height } = bitmap;
    if (width > maxDim || height > maxDim) {
      if (width > height) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return canvas.toDataURL("image/webp", quality) || canvas.toDataURL("image/jpeg", quality);
  } catch {
    return null;
  }
}

function selectedFileAttachment(file, inline = false) {
  const attachment = {
    id: makeId(),
    kind: file.type?.startsWith("image/") ? "image" : "file",
    name: file.name || "file",
    contentType: file.type,
    size: file.size,
    file,
    ...(inline ? { _inline: true } : {}),
  };
  if (file.type?.startsWith("image/")) {
    void createThumbnail(file).then((thumb) => {
      if (thumb) attachment.thumbnail = thumb;
    });
  }
  return attachment;
}

function persistedAttachment(attachment) {
  const { file, _inline, _previewUrl, ...value } = attachment;
  return value;
}

export default function Home() {
  const [items, setItems] = useState([]);
  const [accessKey, setAccessKey] = useState("");
  const [accessInput, setAccessInput] = useState("");
  const [locked, setLocked] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState(() => emptyRichText());
  const [pending, setPending] = useState([]);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [currentSpaceId, setCurrentSpaceId] = useState("default");
  const [editingId, setEditingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [editDraft, setEditDraft] = useState(() => emptyRichText());
  const [editAttachments, setEditAttachments] = useState([]);
  const [attachmentUrls, setAttachmentUrls] = useState({});
  const [downloadingAttachments, setDownloadingAttachments] = useState({});
  const [pullDistance, setPullDistance] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);


  const itemsListRef = useRef(null);
  const itemsRef = useRef([]);
  const objectUrls = useRef(new Set());
  const loadingAttachments = useRef(new Set());
  const failedAttachments = useRef(new Set());
  const dragCounterRef = useRef(0);
  const isInternalDragRef = useRef(false);
  const pendingRef = useRef([]);
  const editAttachmentsRef = useRef([]);
  const draftRef = useRef(draft);
  const editDraftRef = useRef(editDraft);
  const syncAbortControllers = useRef(new Map());

  useEffect(() => {
    const onDragStart = () => {
      isInternalDragRef.current = true;
    };
    const onDragEnd = () => {
      isInternalDragRef.current = false;
    };
    const preventChromeDrop = (e) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
    };
    window.addEventListener("dragstart", onDragStart, { capture: true });
    window.addEventListener("dragend", onDragEnd, { capture: true });
    window.addEventListener("dragover", preventChromeDrop, false);
    window.addEventListener("drop", preventChromeDrop, false);
    return () => {
      window.removeEventListener("dragstart", onDragStart, { capture: true });
      window.removeEventListener("dragend", onDragEnd, { capture: true });
      window.removeEventListener("dragover", preventChromeDrop, false);
      window.removeEventListener("drop", preventChromeDrop, false);
    };
  }, []);
  const discardedInlineAttachments = useRef({ new: new Map(), edit: new Map() });

  const pullDistanceRef = useRef(0);
  const isRefreshingRef = useRef(false);
  const isEditingRef = useRef(false);
  const savingRef = useRef(false);
  const reorderingRef = useRef(false);
  const accessKeyRef = useRef("");
  const hasVibratedRef = useRef(false);

  pullDistanceRef.current = pullDistance;
  isRefreshingRef.current = isRefreshing;
  isEditingRef.current = Boolean(editingId);
  savingRef.current = saving;
  accessKeyRef.current = accessKey;
  itemsRef.current = items;
  pendingRef.current = pending;
  editAttachmentsRef.current = editAttachments;
  reorderingRef.current = reordering;
  draftRef.current = draft;
  editDraftRef.current = editDraft;

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

  const UNSYNCED_CACHE_KEY = "notes-unsynced-cache";

  function getStoredUnsyncedItems() {
    try {
      const raw = localStorage.getItem(UNSYNCED_CACHE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function persistUnsyncedItem(item) {
    try {
      const current = getStoredUnsyncedItems().filter((it) => it.id !== item.id);
      const serializable = {
        id: item.id,
        content: item.content,
        contentFormat: item.contentFormat,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        attachments: (item.attachments || []).filter((a) => !a.file),
        _rawDraft: item._rawDraft,
        _syncStatus: "error",
        _syncError: item._syncError,
        _previousItem: item._previousItem,
      };
      current.unshift(serializable);
      localStorage.setItem(UNSYNCED_CACHE_KEY, JSON.stringify(current));
    } catch {}
  }

  function removeStoredUnsyncedItem(itemId) {
    try {
      const remaining = getStoredUnsyncedItems().filter((it) => it.id !== itemId);
      if (remaining.length > 0) {
        localStorage.setItem(UNSYNCED_CACHE_KEY, JSON.stringify(remaining));
      } else {
        localStorage.removeItem(UNSYNCED_CACHE_KEY);
      }
    } catch {}
  }

  function attachmentsForTarget(target) {
    return target === "edit" ? editAttachmentsRef.current : pendingRef.current;
  }

  function discardedAttachmentsForTarget(target) {
    return discardedInlineAttachments.current[target === "edit" ? "edit" : "new"];
  }

  function setAttachmentsForTarget(target, nextAttachments) {
    if (target === "edit") {
      editAttachmentsRef.current = nextAttachments;
      setEditAttachments(nextAttachments);
    } else {
      pendingRef.current = nextAttachments;
      setPending(nextAttachments);
    }
  }

  function attachmentsUsedByContent(attachments, content) {
    const inlineIds = inlineImageAttachmentIds(content);
    return attachments.filter((attachment) => !attachment._inline || inlineIds.has(attachment.id));
  }

  function removeUnusedInlineAttachments(target, content) {
    const inlineIds = inlineImageAttachmentIds(content);
    const current = attachmentsForTarget(target);
    const removed = current.filter((attachment) => attachment._inline && !inlineIds.has(attachment.id));
    const discarded = discardedAttachmentsForTarget(target);
    removed.forEach((attachment) => discarded.set(attachment.id, attachment));

    const restored = [...inlineIds]
      .filter((attachmentId) => !current.some((attachment) => attachment.id === attachmentId))
      .map((attachmentId) => discarded.get(attachmentId))
      .filter(Boolean);
    restored.forEach((attachment) => discarded.delete(attachment.id));

    if (removed.length || restored.length) {
      setAttachmentsForTarget(target, [
        ...current.filter((attachment) => !removed.includes(attachment)),
        ...restored,
      ]);
    }
  }

  function handleRichTextChange(content, target = "new") {
    if (target === "edit") {
      setEditDraft(content);
    } else {
      setDraft(content);
    }
    removeUnusedInlineAttachments(target, content);
  }

  function addInlineImages(filesList, target = "new") {
    const files = Array.from(filesList || []).filter((file) => file?.type?.startsWith("image/"));
    if (!files.length) return [];

    if (target === "new") {
      setComposerExpanded(true);
    }

    const current = attachmentsForTarget(target);
    const available = MAX_ATTACHMENTS - current.length;
    if (available <= 0) {
      setNotice("Attachment limit reached.");
      return [];
    }

    const attachments = files.slice(0, available).map((file) => selectedFileAttachment(file, true));
    const imagePreviews = {};
    attachments.forEach((attachment) => {
      const previewUrl = URL.createObjectURL(attachment.file);
      objectUrls.current.add(previewUrl);
      imagePreviews[attachment.id] = previewUrl;
      attachment._previewUrl = previewUrl;
    });

    setAttachmentsForTarget(target, [...current, ...attachments]);
    setAttachmentUrls((currentUrls) => ({ ...currentUrls, ...imagePreviews }));
    setNotice(files.length > available ? "Attachment limit reached." : "");
    return attachments;
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
    setItems((current) => {
      const currentIndex = current.findIndex((item) => item.id === nextItem.id);
      const nextItems = currentIndex === -1
        ? [nextItem, ...current]
        : current.map((item) => (item.id === nextItem.id ? nextItem : item));
      itemsRef.current = nextItems;
      return nextItems;
    });
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
      const fetchedItems = orderItems(data.items);
      const unsynced = getStoredUnsyncedItems();
      const unsyncedIds = new Set(unsynced.map((u) => u.id));
      const nextItems = [
        ...unsynced,
        ...fetchedItems.filter((it) => !unsyncedIds.has(it.id)),
      ];
      itemsRef.current = nextItems;
      setItems(nextItems);
      if (data.spaceId) {
        setCurrentSpaceId(data.spaceId);
      }
      setLocked(false);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function persistItemOrder(itemId, orderedIds) {
    if (
      savingRef.current
      || isEditingRef.current
      || reorderingRef.current
    ) return;

    const previousItems = itemsRef.current;
    const nextItems = itemsInOrder(previousItems, orderedIds);
    if (!nextItems.some((item) => item.id === itemId) || sameItemOrder(previousItems, nextItems)) {
      return;
    }

    const movedItemIndex = nextItems.findIndex((item) => item.id === itemId);
    const beforeId = nextItems[movedItemIndex + 1]?.id ?? null;
    reorderingRef.current = true;
    itemsRef.current = nextItems;
    setReordering(true);
    setItems(nextItems);
    setNotice("");

    try {
      const data = await callApi("/api/items", {
        method: "PATCH",
        body: JSON.stringify({ action: "reorder-item", id: itemId, beforeId }),
      });
      const savedItems = Array.isArray(data.items) ? orderItems(data.items) : nextItems;
      itemsRef.current = savedItems;
      setItems(savedItems);
    } catch (error) {
      itemsRef.current = previousItems;
      setItems(previousItems);
      setNotice(error.message || "Could not save the new note order.");
    } finally {
      reorderingRef.current = false;
      setReordering(false);
    }
  }

  useEffect(() => {
    const container = itemsListRef.current;
    if (
      !container
      || locked
      || items.length < 2
      || editingId
      || saving
      || reordering
    ) {
      return undefined;
    }

    let disposed = false;
    let sortable = null;

    async function attachSortable() {
      const module = await import("sortablejs");
      if (disposed) return;

      const Sortable = module.default;
      sortable = new Sortable(container, {
        animation: 150,
        draggable: ".item-card[data-item-id]",
        handle: ".item-drag-handle",
        ghostClass: "item-card-sortable-ghost",
        chosenClass: "item-card-sortable-chosen",
        dragClass: "item-card-sortable-drag",
        delay: 120,
        delayOnTouchOnly: true,
        touchStartThreshold: 4,
        fallbackOnBody: true,
        onEnd(event) {
          const itemId = event.item?.dataset.itemId;
          const orderedIds = Array.from(container.querySelectorAll(".item-card[data-item-id]"))
            .map((element) => element.dataset.itemId)
            .filter(Boolean);
          if (itemId) void persistItemOrder(itemId, orderedIds);
        },
      });
    }

    void attachSortable();
    return () => {
      disposed = true;
      sortable?.destroy();
    };
  }, [locked, items.length, editingId, saving, reordering]);

  useEffect(() => {
    const container = itemsListRef.current;
    if (!container || locked) return;

    let startY = 0;
    let startX = 0;
    let isTracking = false;

    const handleTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      if (isRefreshingRef.current || isEditingRef.current || savingRef.current) return;
      if (e.target instanceof Element && e.target.closest(".item-drag-handle")) return;

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
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    objectUrls.current.add(url);

    if (!attachment.thumbnail && (attachment.contentType?.startsWith("image/") || attachment.kind === "image")) {
      void createThumbnail(blob).then((thumb) => {
        if (thumb) {
          attachment.thumbnail = thumb;
          setItems((current) => current.map((it) => {
            if (it.attachments?.some((a) => a.id === attachment.id)) {
              return {
                ...it,
                attachments: it.attachments.map((a) => a.id === attachment.id ? { ...a, thumbnail: thumb } : a),
              };
            }
            return it;
          }));
        }
      });
    }

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

    try {
      const savedComposer = localStorage.getItem("notes-composer-expanded");
      if (savedComposer !== null) {
        setComposerExpanded(savedComposer === "true");
      }
    } catch {}

    const handleBeforeUnload = (e) => {
      if (itemsRef.current.some((it) => it._syncStatus === "syncing")) {
        e.preventDefault();
        e.returnValue = "";
        return "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
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

    async function fetchWithConcurrency(itemsToFetch, limit, worker) {
      const executing = new Set();
      for (const itemToFetch of itemsToFetch) {
        if (cancelled) break;
        const p = Promise.resolve().then(() => worker(itemToFetch));
        executing.add(p);
        const clean = () => executing.delete(p);
        p.then(clean, clean);
        if (executing.size >= limit) {
          await Promise.race(executing);
        }
      }
      await Promise.all(executing);
    }

    void fetchWithConcurrency(missing, 4, async (attachment) => {
      try {
        const url = await loadAttachment(attachment);
        if (!cancelled && url) {
          setAttachmentUrls((current) => ({
            ...current,
            [attachment.id]: url,
          }));
        }
      } catch {
        failedAttachments.current.add(attachment.id);
      } finally {
        loadingAttachments.current.delete(attachment.id);
      }
    });

    return () => { cancelled = true; };
  }, [items, editAttachments, accessKey, locked]);

  async function unlock(event) {
    event.preventDefault();
    const key = accessInput.trim();
    if (!key) return;
    setAccessKey(key);
    localStorage.setItem(ACCESS_KEY_STORAGE, key);
    await loadItems(key);
  }


  async function uploadAttachment(file, onProgress, signal) {
    if (signal?.aborted) throw new Error("Upload đã bị hủy.");

    // Với file <= 20 MB: upload trực tiếp qua FormData lên API server (nhanh, ổn định, không bị lỗi CORS trình duyệt)
    if (file.size <= 20 * 1024 * 1024) {
      const formData = new FormData();
      formData.append("file", file);

      const data = await uploadWithXHR(
        "/api/uploads",
        "POST",
        { "x-notes-access-key": accessKey },
        formData,
        onProgress,
        signal
      );
      return data.attachment;
    }

    // Với file lớn (> 20 MB): Sử dụng Google Drive Resumable Upload
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
      if (data.upload?.mode === "resumable") {
        const headers = {
          "Content-Type": file.type || "application/octet-stream",
        };
        if (data.upload.accessToken) {
          headers["Authorization"] = `Bearer ${data.upload.accessToken}`;
        }
        const googleFile = await uploadWithXHR(
          data.upload.url,
          "PUT",
          headers,
          file,
          onProgress,
          signal
        );
        if (googleFile?.id) {
          data.attachment.key = googleFile.id;
        }
        await callApi("/api/uploads", {
          method: "POST",
          body: JSON.stringify({ action: "complete" }),
        }).catch(() => {});
        return data.attachment;
      }
      throw new Error("Upload setup returned an invalid response.");
    } catch (error) {
      if (data.attachment?.key) {
        await callApi(`/api/uploads?key=${encodeURIComponent(data.attachment.key)}`, { method: "DELETE" }).catch(() => {});
      }
      throw error;
    }
  }

  async function uploadSelectedFilesForNote(noteId, attachments, signal) {
    const uploaded = [];
    const completed = [];
    const filesToUpload = attachments.filter((a) => a.file);
    const totalFiles = filesToUpload.length;
    let fileIndex = 0;

    const setNoteProgress = (progress) => {
      setItems((current) => current.map((it) => (it.id === noteId ? {
        ...it,
        _uploadProgress: progress,
      } : it)));
    };

    try {
      for (const attachment of attachments) {
        if (signal?.aborted) throw new Error("Upload đã bị hủy.");
        if (!attachment.file) {
          completed.push({ sourceId: attachment.id, attachment });
          continue;
        }
        fileIndex += 1;
        setNoteProgress({
          percent: 0,
          current: fileIndex,
          total: totalFiles,
          name: attachment.file.name,
        });

        const storedAttachment = await uploadAttachment(attachment.file, (percent) => {
          setNoteProgress({
            percent,
            current: fileIndex,
            total: totalFiles,
            name: attachment.file.name,
          });
        }, signal);

        uploaded.push(storedAttachment);
        let thumbnail = attachment.thumbnail;
        if (!thumbnail && attachment.file?.type?.startsWith("image/")) {
          thumbnail = await createThumbnail(attachment.file);
        }
        completed.push({
          sourceId: attachment.id,
          attachment: {
            ...storedAttachment,
            ...(thumbnail ? { thumbnail } : {}),
            ...(attachment._inline ? { _inline: true } : {}),
          },
        });
      }
      return { completed, uploaded };
    } catch (error) {
      await Promise.allSettled(uploaded.map((attachment) => (
        callApi(`/api/uploads?key=${encodeURIComponent(attachment.key)}`, { method: "DELETE" })
      )));
      throw error;
    } finally {
      setNoteProgress(null);
    }
  }

  async function deleteUploadedAttachments(attachments) {
    await Promise.allSettled(attachments.map((attachment) => (
      callApi(`/api/uploads?key=${encodeURIComponent(attachment.key)}`, { method: "DELETE" })
    )));
  }

  async function runSyncNewItem(optimisticId, noteDraft, notePending) {
    const abortController = new AbortController();
    syncAbortControllers.current.set(optimisticId, abortController);
    let uploaded = [];

    try {
      const uploadResult = await uploadSelectedFilesForNote(
        optimisticId,
        notePending,
        abortController.signal
      );
      uploaded = uploadResult.uploaded;

      const attachmentIds = new Map(uploadResult.completed.map(({ sourceId, attachment }) => [sourceId, attachment.id]));
      const savedContent = replaceInlineImageAttachmentIds(noteDraft, attachmentIds);
      const savedImageIds = inlineImageAttachmentIds(savedContent);
      const savedAttachments = uploadResult.completed
        .map(({ attachment }) => attachment)
        .filter((attachment) => !attachment._inline || savedImageIds.has(attachment.id))
        .map(persistedAttachment);

      const data = await callApi("/api/items", {
        method: "POST",
        body: JSON.stringify({
          content: serializeQuillDelta(savedContent),
          contentFormat: QUILL_DELTA_FORMAT,
          attachments: savedAttachments,
        }),
      });

      setItems((current) => current.map((item) => (item.id === optimisticId ? {
        ...data.item,
        _syncStatus: "synced",
        _uploadProgress: null,
      } : item)));
      itemsRef.current = itemsRef.current.map((item) => (item.id === optimisticId ? data.item : item));
      removeStoredUnsyncedItem(optimisticId);

      removeAttachmentUrls(notePending.filter((att) => att.file));
    } catch (error) {
      await deleteUploadedAttachments(uploaded);

      if (abortController.signal.aborted) {
        removeStoredUnsyncedItem(optimisticId);
        setItems((current) => current.filter((item) => item.id !== optimisticId));
        itemsRef.current = itemsRef.current.filter((item) => item.id !== optimisticId);
        removeAttachmentUrls(notePending.filter((att) => att.file));
        setNotice("Đã hủy tải lên ghi chú.");
      } else {
        const errorItem = {
          id: optimisticId,
          content: serializeQuillDelta(noteDraft),
          contentFormat: QUILL_DELTA_FORMAT,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          _rawDraft: noteDraft,
          _rawPending: notePending,
          _syncStatus: "error",
          _syncError: error.message || "Lỗi lưu ghi chú lên Google Drive.",
          _uploadProgress: null,
        };
        persistUnsyncedItem(errorItem);
        setItems((current) => current.map((item) => (item.id === optimisticId ? {
          ...item,
          ...errorItem,
        } : item)));
      }
    } finally {
      syncAbortControllers.current.delete(optimisticId);
    }
  }

  async function addItem() {
    const activeAttachments = attachmentsUsedByContent(pendingRef.current, draft);
    if (!richTextHasText(draft) && activeAttachments.length === 0) return;

    const optimisticId = makeId();
    const now = new Date().toISOString();

    const currentDraft = draft;
    const currentPending = [...activeAttachments];

    const optimisticItem = {
      id: optimisticId,
      content: serializeQuillDelta(currentDraft),
      contentFormat: QUILL_DELTA_FORMAT,
      attachments: currentPending.map((att) => ({
        id: att.id,
        kind: att.kind,
        key: att.key || "",
        name: att.name,
        contentType: att.contentType,
        size: att.size,
        thumbnail: att.thumbnail,
        _inline: att._inline,
        _previewUrl: att._previewUrl,
      })),
      createdAt: now,
      updatedAt: now,
      _syncStatus: "syncing",
      _uploadProgress: currentPending.some((a) => a.file) ? {
        percent: 0,
        current: 1,
        total: currentPending.filter((a) => a.file).length,
        name: currentPending.find((a) => a.file)?.name || "tệp tin",
      } : null,
      _rawPending: currentPending,
      _rawDraft: currentDraft,
    };

    // Render ngay lập tức lên giao diện với độ trễ 0ms!
    setItems((current) => [optimisticItem, ...current]);
    itemsRef.current = [optimisticItem, ...itemsRef.current];

    // Reset composer ngay lập tức
    setDraft(emptyRichText());
    setAttachmentsForTarget("new", []);
    discardedAttachmentsForTarget("new").clear();
    setComposerExpanded(false);
    setNotice("");

    // Tiến hành đồng bộ ngầm
    void runSyncNewItem(optimisticId, currentDraft, currentPending);
  }

  function startEdit(item) {
    const content = richTextForDisplay(item.content, item.contentFormat);
    const inlineImageIds = inlineImageAttachmentIds(content);
    setEditingId(item.id);
    setComposerExpanded(true);
    setEditDraft(content);
    discardedAttachmentsForTarget("edit").clear();
    setAttachmentsForTarget("edit", item.attachments.map((attachment) => ({
      ...attachment,
      ...(inlineImageIds.has(attachment.id) ? { _inline: true } : {}),
    })));
    setNotice("");
  }

  function finishEdit() {
    removeAttachmentUrls([
      ...editAttachmentsRef.current,
      ...discardedAttachmentsForTarget("edit").values(),
    ].filter((attachment) => attachment.file));
    discardedAttachmentsForTarget("edit").clear();
    setEditingId(null);
    setEditDraft(emptyRichText());
    setAttachmentsForTarget("edit", []);
    setComposerExpanded(false);
  }

  function cancelEdit() {
    finishEdit();
  }

  function removeEditAttachment(attachment) {
    const current = editAttachmentsRef.current;
    setAttachmentsForTarget("edit", current.filter((item) => item.id !== attachment.id));
    discardedAttachmentsForTarget("edit").delete(attachment.id);
    if (attachment._inline) {
      setEditDraft((content) => removeInlineImages(content, [attachment.id]));
    }
    removeAttachmentUrls([attachment]);
  }

  async function runSyncEditItem(editId, noteDraft, noteAttachments, previousItem) {
    const abortController = new AbortController();
    syncAbortControllers.current.set(editId, abortController);
    let uploaded = [];

    try {
      const uploadResult = await uploadSelectedFilesForNote(
        editId,
        noteAttachments,
        abortController.signal
      );
      uploaded = uploadResult.uploaded;

      const attachmentIds = new Map(uploadResult.completed.map(({ sourceId, attachment }) => [sourceId, attachment.id]));
      const savedContent = replaceInlineImageAttachmentIds(noteDraft, attachmentIds);
      const savedImageIds = inlineImageAttachmentIds(savedContent);
      const savedAttachments = uploadResult.completed
        .map(({ attachment }) => attachment)
        .filter((attachment) => !attachment._inline || savedImageIds.has(attachment.id))
        .map(persistedAttachment);

      const data = await callApi("/api/items", {
        method: "PATCH",
        body: JSON.stringify({
          action: "edit-item",
          id: editId,
          content: serializeQuillDelta(savedContent),
          contentFormat: QUILL_DELTA_FORMAT,
          attachments: savedAttachments,
        }),
      });

      setItems((current) => current.map((item) => (item.id === editId ? {
        ...data.item,
        _syncStatus: "synced",
        _uploadProgress: null,
      } : item)));
      itemsRef.current = itemsRef.current.map((item) => (item.id === editId ? data.item : item));
      removeStoredUnsyncedItem(editId);

      const removedAttachments = (previousItem.attachments || []).filter((attachment) => (
        attachment.key && !savedAttachments.some((next) => next.key === attachment.key)
      ));
      removeAttachmentUrls(removedAttachments);
      removeAttachmentUrls(noteAttachments.filter((att) => att.file));
    } catch (error) {
      await deleteUploadedAttachments(uploaded);

      if (abortController.signal.aborted) {
        removeStoredUnsyncedItem(editId);
        setItems((current) => current.map((item) => (item.id === editId ? previousItem : item)));
        itemsRef.current = itemsRef.current.map((item) => (item.id === editId ? previousItem : item));
        setNotice("Đã hủy chỉnh sửa ghi chú.");
      } else {
        const errorItem = {
          id: editId,
          content: serializeQuillDelta(noteDraft),
          contentFormat: QUILL_DELTA_FORMAT,
          createdAt: previousItem.createdAt,
          updatedAt: new Date().toISOString(),
          _rawDraft: noteDraft,
          _rawPending: noteAttachments,
          _previousItem: previousItem,
          _syncStatus: "error",
          _syncError: error.message || "Không thể lưu thay đổi lên Google Drive.",
          _uploadProgress: null,
        };
        persistUnsyncedItem(errorItem);
        setItems((current) => current.map((item) => (item.id === editId ? {
          ...item,
          ...errorItem,
        } : item)));
      }
    } finally {
      syncAbortControllers.current.delete(editId);
    }
  }

  async function saveEdit() {
    if (!editingItem) return;
    const activeAttachments = attachmentsUsedByContent(editAttachmentsRef.current, editDraft);
    if (!richTextHasText(editDraft) && activeAttachments.length === 0) {
      setNotice("Item is empty.");
      return;
    }

    const editId = editingItem.id;
    const previousItem = { ...editingItem };
    const currentDraft = editDraft;
    const currentAttachments = [...activeAttachments];

    // Cập nhật lạc quan ngay lập tức (0ms)
    setItems((current) => current.map((item) => {
      if (item.id === editId) {
        return {
          ...item,
          content: serializeQuillDelta(currentDraft),
          contentFormat: QUILL_DELTA_FORMAT,
          attachments: currentAttachments.map((att) => ({
            id: att.id,
            kind: att.kind,
            key: att.key || "",
            name: att.name,
            contentType: att.contentType,
            size: att.size,
            thumbnail: att.thumbnail,
            _inline: att._inline,
            _previewUrl: att._previewUrl,
          })),
          updatedAt: new Date().toISOString(),
          _syncStatus: "syncing",
          _uploadProgress: currentAttachments.some((a) => a.file) ? {
            percent: 0,
            current: 1,
            total: currentAttachments.filter((a) => a.file).length,
            name: currentAttachments.find((a) => a.file)?.name || "tệp tin",
          } : null,
          _rawPending: currentAttachments,
          _rawDraft: currentDraft,
          _previousItem: previousItem,
        };
      }
      return item;
    }));

    finishEdit();

    void runSyncEditItem(editId, currentDraft, currentAttachments, previousItem);
  }

  function cancelNoteSync(itemId) {
    const controller = syncAbortControllers.current.get(itemId);
    if (controller) {
      controller.abort();
      syncAbortControllers.current.delete(itemId);
    }
  }

  function retryNoteSync(itemId) {
    const targetItem = itemsRef.current.find((it) => it.id === itemId);
    if (!targetItem) return;

    setItems((current) => current.map((it) => (it.id === itemId ? {
      ...it,
      _syncStatus: "syncing",
      _syncError: null,
      _uploadProgress: targetItem._rawPending?.some((a) => a.file) ? {
        percent: 0,
        current: 1,
        total: targetItem._rawPending.filter((a) => a.file).length,
        name: targetItem._rawPending.find((a) => a.file)?.name || "tệp tin",
      } : null,
    } : it)));

    if (targetItem._previousItem) {
      void runSyncEditItem(itemId, targetItem._rawDraft, targetItem._rawPending, targetItem._previousItem);
    } else {
      void runSyncNewItem(itemId, targetItem._rawDraft, targetItem._rawPending);
    }
  }

  function discardNoteSync(itemId) {
    cancelNoteSync(itemId);
    removeStoredUnsyncedItem(itemId);
    const targetItem = itemsRef.current.find((it) => it.id === itemId);
    if (!targetItem) return;

    if (targetItem._rawPending) {
      removeAttachmentUrls(targetItem._rawPending.filter((att) => att.file));
    }

    if (targetItem._previousItem) {
      setItems((current) => current.map((it) => (it.id === itemId ? targetItem._previousItem : it)));
      itemsRef.current = itemsRef.current.map((it) => (it.id === itemId ? targetItem._previousItem : it));
    } else {
      setItems((current) => current.filter((it) => it.id !== itemId));
      itemsRef.current = itemsRef.current.filter((it) => it.id !== itemId);
    }
  }

  async function deleteItem(item) {
    if (!window.confirm("Delete this item and its attachments?")) return;
    setDeletingId(item.id);
    setSaving(true);
    setNotice("");
    try {
      await callApi("/api/items", {
        method: "PATCH",
        body: JSON.stringify({ action: "delete-item", id: item.id }),
      });
      removeAttachmentUrls(item.attachments);
      try {
        const raw = localStorage.getItem("notes-expanded-map");
        if (raw) {
          const map = JSON.parse(raw);
          delete map[item.id];
          localStorage.setItem("notes-expanded-map", JSON.stringify(map));
        }
      } catch {}
      setItems((current) => {
        const nextItems = current.filter((entry) => entry.id !== item.id);
        itemsRef.current = nextItems;
        return nextItems;
      });
      if (editingId === item.id) cancelEdit();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setDeletingId(null);
      setSaving(false);
    }
  }

  async function updateItemShare(shareConfig) {
    const data = await callApi("/api/items", {
      method: "PATCH",
      body: JSON.stringify({
        action: "update-share",
        ...shareConfig,
      }),
    });
    if (data.item) {
      setItems((current) => {
        const next = current.map((entry) => entry.id === data.item.id ? data.item : entry);
        itemsRef.current = next;
        return next;
      });
      return data.item;
    }
    throw new Error(data.error || "Không thể cập nhật chia sẻ.");
  }

  function handleAddFiles(filesList, target = editingId ? "edit" : "new") {
    const filesArray = Array.from(filesList || []);
    if (!filesArray.length) return;

    if (target === "new") {
      setComposerExpanded(true);
      try {
        localStorage.setItem("notes-composer-expanded", "true");
      } catch {}
    }

    const imageFiles = filesArray.filter((file) => file?.type?.startsWith("image/"));
    const nonImageFiles = filesArray.filter((file) => !file?.type?.startsWith("image/"));

    // 1. Tệp đính kèm là ảnh thì là 1 phần của content (chèn trực tiếp inline vào editor)
    if (imageFiles.length > 0) {
      const inlineAttachments = addInlineImages(imageFiles, target);
      if (inlineAttachments.length > 0) {
        const currentDraft = target === "edit" ? editDraftRef.current : draftRef.current;
        const currentOps = [...(normalizeQuillDelta(currentDraft).ops || [])];
        const lastOp = currentOps[currentOps.length - 1];
        if (lastOp && typeof lastOp.insert === "string" && !lastOp.insert.endsWith("\n")) {
          currentOps[currentOps.length - 1] = { ...lastOp, insert: `${lastOp.insert}\n` };
        }
        inlineAttachments.forEach((att) => {
          currentOps.push({ insert: { s3Image: { attachmentId: att.id, alt: att.name || "Image" } } });
          currentOps.push({ insert: "\n" });
        });
        const nextContent = { ops: currentOps };
        if (target === "edit") {
          setEditDraft(nextContent);
        } else {
          setDraft(nextContent);
        }
      }
    }

    // 2. Chỉ tệp không phải ảnh mới tách riêng ra danh sách tệp đính kèm
    if (nonImageFiles.length > 0) {
      const currentAttachments = attachmentsForTarget(target);
      const available = MAX_ATTACHMENTS - currentAttachments.length;
      if (available <= 0) {
        setNotice("Attachment limit reached.");
        return;
      }

      const files = nonImageFiles.slice(0, available);
      setNotice("");
      setAttachmentsForTarget(target, [...currentAttachments, ...files.map((f) => selectedFileAttachment(f, false))]);
      if (nonImageFiles.length > available) {
        setNotice("Attachment limit reached.");
      }
    }
  }

  useEffect(() => {
    const hasFiles = (e) => {
      if (!e.dataTransfer) return false;
      const types = Array.from(e.dataTransfer.types || []);
      return types.includes("Files");
    };

    const handleDragEnter = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (isInternalDragRef.current || locked) return;
      dragCounterRef.current += 1;
      setIsDraggingFile(true);
    };

    const handleDragOver = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (isInternalDragRef.current || locked) return;
      e.dataTransfer.dropEffect = "copy";
    };

    const handleDragLeave = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (isInternalDragRef.current || locked) return;
      dragCounterRef.current -= 1;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setIsDraggingFile(false);
      }
    };

    const handleDrop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); // Luôn preventDefault để Chrome không bao giờ mở file trong tab
      dragCounterRef.current = 0;
      setIsDraggingFile(false);

      if (isInternalDragRef.current || locked) return;

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

  function removePending(attachment) {
    const current = pendingRef.current;
    setAttachmentsForTarget("new", current.filter((item) => item.id !== attachment.id));
    discardedAttachmentsForTarget("new").delete(attachment.id);
    if (attachment._inline) {
      setDraft((content) => removeInlineImages(content, [attachment.id]));
    }
    removeAttachmentUrls([attachment]);
  }

  function lock() {
    syncAbortControllers.current.forEach((controller) => controller.abort());
    syncAbortControllers.current.clear();
    localStorage.removeItem(ACCESS_KEY_STORAGE);
    clearAttachmentUrls();
    setAccessKey("");
    setAccessInput("");
    itemsRef.current = [];
    setItems([]);
    reorderingRef.current = false;
    setReordering(false);
    setDraft(emptyRichText());
    setAttachmentsForTarget("new", []);
    discardedAttachmentsForTarget("new").clear();
    setComposerExpanded(false);
    cancelEdit();
    setLocked(true);
    setNotice("");
    setPullDistance(0);
    setIsPulling(false);
    setIsRefreshing(false);
    setIsDraggingFile(false);
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
          <div className="brand-icon-box" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
              <path d="M6 6h10" />
              <path d="M6 10h10" />
            </svg>
          </div>
          <h1 className="brand-title">Notes</h1>
          <span className="brand-badge">{items.length}</span>
        </div>

        <div className="header-actions">
          <button className="btn btn-ghost btn-sm" type="button" onClick={lock} title="Lock and exit">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span>Lock</span>
          </button>
        </div>
      </header>

      <section className="notes-surface">
        {isDraggingFile && (
          <div className="drop-overlay" aria-hidden="true">
            <div className="drop-overlay-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <div className="drop-overlay-title">Drop files to attach</div>
            <div className="drop-overlay-subtitle">
              {editingId ? "Attaching to active note" : "Attaching to new note"} (max 10 attachments)
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

          {loading && (
            <div className="empty-state-loading">
              <span className="spinner-icon" />
              <span>Loading notes...</span>
            </div>
          )}

          {!loading && items.length === 0 && (
            <div className="empty-items">
              <div className="empty-icon-wrap" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="12" y1="18" x2="12" y2="12" />
                  <line x1="9" y1="15" x2="15" y2="15" />
                </svg>
              </div>
              <h2>No notes yet</h2>
              <p>Start writing notes, attaching files or pasting images using the composer below.</p>
            </div>
          )}

          {items.map((item, index) => (
            <ItemCard
              key={item.id}
              item={item}
              index={index}
              isEditing={editingId === item.id}
              isDeleting={deletingId === item.id}
              reordering={reordering}
              saving={saving}
              onStartEdit={startEdit}
              onDelete={deleteItem}
              attachmentUrls={attachmentUrls}
              downloadingAttachments={downloadingAttachments}
              onDownloadAttachment={downloadAttachment}
              spaceId={currentSpaceId}
              onUpdateShare={updateItemShare}
              onCancelSync={cancelNoteSync}
              onRetrySync={retryNoteSync}
              onDiscardSync={discardNoteSync}
            />
          ))}
        </div>

        <ItemComposer
          expanded={composerExpanded}
          onExpandedChange={(next) => {
            try {
              localStorage.setItem("notes-composer-expanded", String(next));
            } catch {}
            if (!next && editingId) {
              cancelEdit();
            } else {
              setComposerExpanded(next);
            }
          }}
          draft={editingItem ? editDraft : draft}
          setDraft={(content) => handleRichTextChange(content, editingItem ? "edit" : "new")}
          pending={editingItem ? editAttachments : pending}
          onRemovePending={editingItem ? removeEditAttachment : removePending}
          onAddItem={editingItem ? saveEdit : addItem}
          onSelectInlineImages={(files) => addInlineImages(files, editingItem ? "edit" : "new")}
          attachmentUrls={attachmentUrls}
          saving={saving}
          onSelectFiles={(files) => handleAddFiles(files, editingItem ? "edit" : "new")}
          notice={notice}
          editingItem={editingItem}
          onCancelEdit={cancelEdit}
        />
      </section>
    </main>
  );
}
