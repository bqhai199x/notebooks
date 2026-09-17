"use client";

import { useState, useEffect, useRef, useMemo, use } from "react";
import RichTextEditor from "../../components/RichTextEditor";
import AttachmentList from "../../components/AttachmentList";
import AttachmentTypeIcon from "../../components/AttachmentTypeIcon";
import {
  inlineImageAttachmentIds,
  richTextForDisplay,
  richTextHasText,
  emptyRichText,
} from "../../../lib/rich-text";

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function SharePage({ params, searchParams }) {
  const unwrappedParams = use(params);
  const unwrappedSearch = use(searchParams);

  const searchObj = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const activeId = unwrappedParams?.id || (typeof window !== "undefined" ? window.location.pathname.split("/").filter(Boolean).pop() : "");
  const activeToken = unwrappedSearch?.token || searchObj?.get("token") || "";
  const activeSpace = unwrappedSearch?.space || searchObj?.get("space") || "default";

  const [loading, setLoading] = useState(true);
  const [item, setItem] = useState(null);
  const [allowEdit, setAllowEdit] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(() => emptyRichText());
  const [editAttachments, setEditAttachments] = useState([]);
  const [saving, setSaving] = useState(false);
  const [downloadingAttachments, setDownloadingAttachments] = useState({});

  useEffect(() => {
    async function loadSharedNote() {
      if (!activeId || !activeToken) {
        setError("Liên kết chia sẻ không hợp lệ hoặc thiếu thông tin xác thực.");
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(
          `/api/share?id=${encodeURIComponent(activeId)}&token=${encodeURIComponent(activeToken)}&space=${encodeURIComponent(activeSpace)}`
        );
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Không thể tải ghi chú.");
        } else {
          setItem(data.item);
          setAllowEdit(Boolean(data.allowEdit));
        }
      } catch {
        setError("Không thể kết nối đến máy chủ. Vui lòng thử lại sau.");
      } finally {
        setLoading(false);
      }
    }

    void loadSharedNote();
  }, [activeId, activeToken, activeSpace]);

  useEffect(() => {
    const preventChromeDrop = (e) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
    };
    window.addEventListener("dragover", preventChromeDrop, false);
    window.addEventListener("drop", preventChromeDrop, false);
    return () => {
      window.removeEventListener("dragover", preventChromeDrop, false);
      window.removeEventListener("drop", preventChromeDrop, false);
    };
  }, []);

  const itemContent = useMemo(() => {
    if (!item) return null;
    const base = richTextForDisplay(item.content, item.contentFormat);
    const existingInlineIds = inlineImageAttachmentIds(base);
    const missingImages = (item.attachments || []).filter(
      (att) => att.kind === "image" && !existingInlineIds.has(att.id)
    );
    if (!missingImages.length) return base;

    const ops = [...(base.ops || [])];
    const lastOp = ops[ops.length - 1];
    if (lastOp && typeof lastOp.insert === "string" && !lastOp.insert.endsWith("\n")) {
      ops[ops.length - 1] = { ...lastOp, insert: `${lastOp.insert}\n` };
    }
    missingImages.forEach((img) => {
      ops.push({ insert: { s3Image: { attachmentId: img.id, alt: img.name || "Image" } } });
      ops.push({ insert: "\n" });
    });
    return { ops };
  }, [item]);

  const inlineImageIds = useMemo(() => (itemContent ? inlineImageAttachmentIds(itemContent) : new Set()), [itemContent]);
  const hasVisibleContent = itemContent ? (richTextHasText(itemContent) || inlineImageIds.size > 0) : false;
  const displayedAttachments = useMemo(() => (
    item?.attachments
      ? item.attachments.filter((att) => att.kind !== "image" && !inlineImageIds.has(att.id))
      : []
  ), [item, inlineImageIds]);

  // Map attachment keys to the secure share files endpoint
  const attachmentUrls = {};
  if (item?.attachments && activeId && activeToken) {
    for (const att of item.attachments) {
      if (att.key) {
        attachmentUrls[att.id] = `/api/share/files?key=${encodeURIComponent(att.key)}&id=${encodeURIComponent(activeId)}&token=${encodeURIComponent(activeToken)}&space=${encodeURIComponent(activeSpace)}`;
      }
    }
  }

  const handleCopyText = async () => {
    try {
      const text = itemContent?.ops
        ? itemContent.ops.map((op) => (typeof op.insert === "string" ? op.insert : "")).join("")
        : "";
      if (text) {
        await navigator.clipboard.writeText(text.trim());
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // Ignore
    }
  };

  const handleDownloadAttachment = async (attachment) => {
    if (!attachment?.key || downloadingAttachments[attachment.id]) return;
    setDownloadingAttachments((prev) => ({ ...prev, [attachment.id]: true }));
    const downloadUrl = `/api/share/files?key=${encodeURIComponent(attachment.key)}&id=${encodeURIComponent(activeId)}&token=${encodeURIComponent(activeToken)}&space=${encodeURIComponent(activeSpace)}&download=1`;
    try {
      const res = await fetch(downloadUrl);
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = attachment.name || "download";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
    } catch {
      // Fallback direct download
      window.location.href = downloadUrl;
    } finally {
      setDownloadingAttachments((prev) => {
        const next = { ...prev };
        delete next[attachment.id];
        return next;
      });
    }
  };

  const startEdit = () => {
    setEditDraft(itemContent || emptyRichText());
    setEditAttachments(displayedAttachments);
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setEditDraft(emptyRichText());
    setEditAttachments([]);
  };

  const removeEditAttachment = (attachmentId) => {
    setEditAttachments((current) => current.filter((att) => att.id !== attachmentId));
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      const inlineIds = inlineImageAttachmentIds(editDraft);
      const remainingImages = (item?.attachments || []).filter((att) => att.kind === "image" && inlineIds.has(att.id));
      const nextAttachments = [...remainingImages, ...editAttachments];

      const res = await fetch("/api/share", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: activeId,
          token: activeToken,
          space: activeSpace,
          content: editDraft,
          contentFormat: "quill-delta",
          attachments: nextAttachments,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Không thể lưu thay đổi.");
      } else {
        setItem(data.item);
        setIsEditing(false);
        setEditAttachments([]);
      }
    } catch {
      alert("Lỗi kết nối. Không thể lưu thay đổi.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="shared-page-container">
        <div className="shared-loading">
          <div className="spinner" />
          <p>Đang tải ghi chú...</p>
        </div>
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="shared-page-container">
        <div className="shared-error-card">
          <div className="shared-error-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h2>Không thể xem ghi chú</h2>
          <p>{error || "Liên kết chia sẻ không tồn tại hoặc đã bị thu hồi."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="shared-page-container">
      <div className="shared-note-wrapper">
        {/* Header */}
        <header className="shared-header">
          <div className="shared-header-left">
            <span className="shared-timestamp">{formatDate(item.updatedAt || item.createdAt)}</span>
          </div>

          <div className="shared-header-actions">
            {allowEdit && !isEditing && (
              <button
                type="button"
                className="shared-action-btn btn-edit"
                onClick={startEdit}
                title="Chỉnh sửa ghi chú"
                aria-label="Chỉnh sửa ghi chú"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                  <path d="m15 5 4 4" />
                </svg>
              </button>
            )}

            {isEditing && (
              <>
                <button
                  type="button"
                  className="shared-action-btn btn-cancel"
                  onClick={cancelEdit}
                  disabled={saving}
                  title="Hủy chỉnh sửa"
                  aria-label="Hủy chỉnh sửa"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>

                <button
                  type="button"
                  className="shared-action-btn btn-save"
                  onClick={saveEdit}
                  disabled={saving}
                  title={saving ? "Đang lưu..." : "Lưu thay đổi"}
                  aria-label="Lưu thay đổi"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </button>
              </>
            )}

            {!isEditing && (
              <button
                type="button"
                className="shared-action-btn btn-copy"
                onClick={handleCopyText}
                title={copied ? "Đã sao chép!" : "Sao chép nội dung"}
                aria-label="Sao chép nội dung"
              >
                {copied ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                  </svg>
                )}
              </button>
            )}
          </div>
        </header>

        {/* Note Body (Full Screen, No expand/sort/delete) */}
        <main className="shared-content-card">
          {isEditing ? (
            <div className="shared-edit-container">
              <RichTextEditor
                value={editDraft}
                onChange={setEditDraft}
                imageUrls={attachmentUrls}
                autoFocus
                placeholder="Nhập nội dung ghi chú..."
              />
              {editAttachments.length > 0 && (
                <div className="composer-chips-scroll" style={{ padding: "6px 20px 12px", flexShrink: 0 }}>
                  {editAttachments.map((attachment) => (
                    <span className="attachment-chip" key={attachment.id}>
                      <AttachmentTypeIcon type={attachment.kind} filename={attachment.name} compact />
                      <span className="chip-name">{attachment.name}</span>
                      <button
                        type="button"
                        className="attachment-chip-remove"
                        aria-label={`Xóa ${attachment.name}`}
                        onClick={() => removeEditAttachment(attachment.id)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="shared-display-container">
              {hasVisibleContent && (
                <RichTextEditor
                  value={itemContent}
                  imageUrls={attachmentUrls}
                  readOnly
                  ariaLabel="Nội dung ghi chú"
                />
              )}

              {displayedAttachments.length > 0 && (
                <AttachmentList
                  attachments={displayedAttachments}
                  attachmentUrls={attachmentUrls}
                  downloadingAttachments={downloadingAttachments}
                  onDownload={handleDownloadAttachment}
                />
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
