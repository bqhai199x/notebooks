"use client";

import { useState } from "react";
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

  const itemContent = richTextForDisplay(item.content, item.contentFormat);
  const inlineImageIds = inlineImageAttachmentIds(itemContent);
  const hasVisibleContent = richTextHasText(itemContent) || inlineImageIds.size > 0;
  const displayedAttachments = item.attachments.filter(
    (attachment) => !inlineImageIds.has(attachment.id)
  );

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

  return (
    <article
      className={`item-card${isEditing ? " editing" : ""}`}
      data-item-id={item.id}
    >
      <div className="item-card-header">
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
        <div className="item-card-content">
          {hasVisibleContent && (
            <RichTextEditor
              value={itemContent}
              imageUrls={attachmentUrls}
              readOnly
              ariaLabel="Note content"
            />
          )}

          {displayedAttachments.length > 0 && (
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
