"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import AttachmentList from "./AttachmentList";
import RichTextEditor from "./RichTextEditor";
import ShareModal from "./ShareModal";
import { inlineImageAttachmentIds, richTextForDisplay, richTextHasText } from "../../lib/rich-text";

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function ItemCard({
  item,
  index,
  isEditing = false,
  reordering,
  saving,
  uploading,
  onStartEdit,
  onDelete,
  attachmentUrls,
  downloadingAttachments,
  onDownloadAttachment,
  spaceId = "default",
  onUpdateShare,
}) {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const contentRef = useRef(null);

  const itemContent = useMemo(() => {
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
  }, [item.content, item.contentFormat, item.attachments]);

  const inlineImageIds = useMemo(() => inlineImageAttachmentIds(itemContent), [itemContent]);
  const hasVisibleContent = richTextHasText(itemContent) || inlineImageIds.size > 0;
  const displayedAttachments = useMemo(() => (
    (item.attachments || []).filter(
      (attachment) => attachment.kind !== "image" && !inlineImageIds.has(attachment.id)
    )
  ), [item.attachments, inlineImageIds]);

  useEffect(() => {
    const el = contentRef.current;

    const checkCanExpand = () => {
      if (hasVisibleContent && (displayedAttachments.length > 0 || inlineImageIds.size > 0)) {
        setCanExpand(true);
        return;
      }
      if (!hasVisibleContent) {
        setCanExpand(displayedAttachments.length > 1);
        return;
      }
      const text = itemContent?.ops
        ? itemContent.ops.map((op) => (typeof op.insert === "string" ? op.insert : "")).join("")
        : "";
      const lineCount = text.split("\n").filter((l) => l.trim().length > 0).length;
      if (lineCount > 2 || text.trim().length > 90) {
        setCanExpand(true);
        return;
      }
      if (!el) return;
      if (el.scrollHeight > 54 || el.offsetHeight > 54) {
        setCanExpand(true);
      } else if (!isExpanded) {
        setCanExpand(false);
      }
    };

    checkCanExpand();
    const timer = setTimeout(checkCanExpand, 120);

    let observer = null;
    if (el) {
      observer = new ResizeObserver(checkCanExpand);
      observer.observe(el);
    }

    return () => {
      clearTimeout(timer);
      observer?.disconnect();
    };
  }, [hasVisibleContent, itemContent, displayedAttachments.length, inlineImageIds.size, isExpanded]);

  const EXPANDED_STORAGE_KEY = "notes-expanded-map";

  useEffect(() => {
    if (!item?.id) return;
    try {
      const raw = localStorage.getItem(EXPANDED_STORAGE_KEY);
      if (raw) {
        const map = JSON.parse(raw);
        if (typeof map[item.id] === "boolean") {
          setIsExpanded(map[item.id]);
        }
      }
    } catch {}
  }, [item?.id]);

  const setExpandedWithStorage = (nextVal) => {
    setIsExpanded((prev) => {
      const next = typeof nextVal === "function" ? nextVal(prev) : nextVal;
      if (item?.id) {
        try {
          const raw = localStorage.getItem(EXPANDED_STORAGE_KEY);
          const map = raw ? JSON.parse(raw) : {};
          map[item.id] = next;
          localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify(map));
          localStorage.setItem("notes-last-expand-state", next ? "expanded" : "collapsed");
        } catch {}
      }
      return next;
    });
  };

  const handleCopyText = async () => {
    try {
      const text = itemContent?.ops
        ? itemContent.ops.map((op) => (typeof op.insert === "string" ? op.insert : "")).join("")
        : "";
      if (text) {
        await navigator.clipboard.writeText(text.trim());
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      // ignore clipboard error
    }
  };

  const handleHeaderClick = (e) => {
    if (!canExpand) return;
    if (e.target.closest(".item-header-actions, .item-drag-handle")) return;
    setExpandedWithStorage((prev) => !prev);
  };

  const handleContentClick = (e) => {
    if (!canExpand || isExpanded) return;
    if (e.target.closest("a, button")) return;
    setExpandedWithStorage(true);
  };

  const isPreview = canExpand && !isExpanded;

  const effectiveImageUrls = useMemo(() => {
    const urls = { ...attachmentUrls };
    if (item.attachments && Array.isArray(item.attachments)) {
      for (const att of item.attachments) {
        if (att?.thumbnail) {
          if (!isExpanded) {
            urls[att.id] = att.thumbnail;
          } else if (!urls[att.id]) {
            urls[att.id] = att.thumbnail;
          }
        }
      }
    }
    return urls;
  }, [attachmentUrls, item.attachments, isExpanded]);

  return (
    <article
      className={`item-card${isEditing ? " editing" : ""}${isExpanded ? " expanded" : ""}`}
      data-item-id={item.id}
    >
      <div
        className={`item-card-header${canExpand ? " can-expand" : ""}`}
        onClick={handleHeaderClick}
        title={canExpand ? (isExpanded ? "Click title to collapse" : "Click title to expand") : undefined}
      >
        <div className="item-header-left">
          <span
            className={`item-drag-handle${reordering ? " disabled" : ""}`}
            title="Drag to reorder"
            aria-label="Drag to reorder note"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="9" cy="5" r="1" />
              <circle cx="9" cy="12" r="1" />
              <circle cx="9" cy="19" r="1" />
              <circle cx="15" cy="5" r="1" />
              <circle cx="15" cy="12" r="1" />
              <circle cx="15" cy="19" r="1" />
            </svg>
          </span>
          <span className="item-timestamp">{formatDate(item.createdAt)}</span>
        </div>

        <div className="item-header-actions">
          {canExpand && (
            <button
              type="button"
              className={`item-action-btn btn-expand${isExpanded ? " active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                setExpandedWithStorage((prev) => !prev);
              }}
              title={isExpanded ? "Thu gọn ghi chú" : "Mở rộng ghi chú"}
              aria-label={isExpanded ? "Thu gọn ghi chú" : "Mở rộng ghi chú"}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                {isExpanded ? (
                  <polyline points="18 15 12 9 6 15" />
                ) : (
                  <polyline points="6 9 12 15 18 9" />
                )}
              </svg>
            </button>
          )}

          <button
            type="button"
            className={`item-action-btn btn-share${item.share?.enabled ? (item.share?.allowEdit ? " is-shared-edit" : " is-shared-readonly") : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              setShowShareModal(true);
            }}
            title={item.share?.enabled ? (item.share?.allowEdit ? "Đang chia sẻ (Cho phép chỉnh sửa)" : "Đang chia sẻ (Chỉ xem)") : "Chia sẻ ghi chú"}
            aria-label={item.share?.enabled ? (item.share?.allowEdit ? "Đang chia sẻ (Cho phép chỉnh sửa)" : "Đang chia sẻ (Chỉ xem)") : "Chia sẻ ghi chú"}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
          </button>

          <button
            type="button"
            className="item-action-btn"
            onClick={handleCopyText}
            title={copied ? "Copied!" : "Copy text"}
            aria-label="Copy text"
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

          <button
            type="button"
            className="item-action-btn"
            onClick={(e) => {
              e.stopPropagation();
              onStartEdit(item);
            }}
            disabled={isEditing}
            title="Edit note"
            aria-label="Edit note"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              <path d="m15 5 4 4" />
            </svg>
          </button>

          <button
            type="button"
            className="item-action-btn btn-delete"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(item);
            }}
            disabled={isEditing}
            title="Delete note"
            aria-label="Delete note"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" />
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </button>
        </div>
      </div>

      <div className="item-card-body">
        <div
          ref={contentRef}
          className={`item-card-content${isPreview ? " is-preview" : ""}${isExpanded ? " is-expanded" : ""}`}
          onClick={handleContentClick}
          title={isPreview ? "Click to expand" : undefined}
        >
          {hasVisibleContent && (
            <RichTextEditor
              value={itemContent}
              imageUrls={effectiveImageUrls}
              readOnly
              ariaLabel="Note content"
            />
          )}


          {(!hasVisibleContent || isExpanded) && displayedAttachments.length > 0 && (
            <AttachmentList
              attachments={displayedAttachments}
              attachmentUrls={attachmentUrls}
              downloadingAttachments={downloadingAttachments}
              onDownload={onDownloadAttachment}
            />
          )}
        </div>
      </div>

      {showShareModal && (
        <ShareModal
          item={item}
          spaceId={spaceId}
          onClose={() => setShowShareModal(false)}
          onUpdateShare={onUpdateShare}
        />
      )}
    </article>
  );
}
