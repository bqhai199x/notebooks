"use client";

import { useState, useRef, useEffect } from "react";
import AttachmentList from "./AttachmentList";
import RichTextEditor from "./RichTextEditor";
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
}) {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const contentRef = useRef(null);

  const itemContent = richTextForDisplay(item.content, item.contentFormat);
  const inlineImageIds = inlineImageAttachmentIds(itemContent);
  const hasVisibleContent = richTextHasText(itemContent) || inlineImageIds.size > 0;
  const displayedAttachments = item.attachments.filter(
    (attachment) => !inlineImageIds.has(attachment.id)
  );

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const checkCanExpand = () => {
      if (displayedAttachments.length > 0 || inlineImageIds.size > 0) {
        setCanExpand(true);
        return;
      }
      if (el.scrollHeight > 60) {
        setCanExpand(true);
      } else {
        setCanExpand(false);
      }
    };

    checkCanExpand();
    const timer = setTimeout(checkCanExpand, 120);

    const observer = new ResizeObserver(checkCanExpand);
    observer.observe(el);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [itemContent, displayedAttachments.length, inlineImageIds.size]);

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
              title={isExpanded ? "Collapse note" : "Expand note"}
              aria-label={isExpanded ? "Collapse note" : "Expand note"}
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
            className="item-action-btn"
            onClick={handleCopyText}
            title={copied ? "Copied!" : "Copy note text"}
            aria-label="Copy note text"
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
            className={`item-action-btn${isEditing ? " active" : ""}`}
            onClick={() => onStartEdit(item)}
            disabled={saving || reordering}
            title={isEditing ? "Currently editing in composer" : "Edit note"}
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
            onClick={() => onDelete(item)}
            disabled={saving || reordering}
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
              imageUrls={attachmentUrls}
              readOnly
              ariaLabel="Note content"
            />
          )}

          {isPreview && displayedAttachments.length > 0 && (
            <div className="item-preview-attachment-badge">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
              <span>{displayedAttachments.length} {displayedAttachments.length === 1 ? "file" : "files"}</span>
            </div>
          )}

          {isExpanded && displayedAttachments.length > 0 && (
            <AttachmentList
              attachments={displayedAttachments}
              attachmentUrls={attachmentUrls}
              downloadingAttachments={downloadingAttachments}
              onDownload={onDownloadAttachment}
            />
          )}
        </div>
      </div>
    </article>
  );
}
