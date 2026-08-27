"use client";

import AttachmentList from "./AttachmentList";
import AttachmentTypeIcon from "./AttachmentTypeIcon";
import RichTextEditor from "./RichTextEditor";
import { inlineImageAttachmentIds, richTextForDisplay } from "../../lib/rich-text";

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function ItemCard({
  item,
  index,
  isEditing,
  reordering,
  saving,
  uploading,
  onStartEdit,
  onDelete,
  attachmentUrls,
  downloadingAttachments,
  onDownloadAttachment,
  editDraft,
  setEditDraft,
  editAttachments,
  onRemoveEditAttachment,
  onSelectFiles,
  onCancelEdit,
  onSaveEdit,
  onSelectInlineImages,
}) {
  const itemContent = richTextForDisplay(item.content, item.contentFormat);
  const inlineImageIds = inlineImageAttachmentIds(itemContent);
  const displayedAttachments = item.attachments
    .filter((attachment) => !inlineImageIds.has(attachment.id));

  return (
    <article className={`item-card ${isEditing ? "editing" : ""}`} data-item-id={item.id}>
      <span
        className={`line-number item-drag-handle${isEditing || reordering ? " disabled" : ""}`}
        title="Drag to reorder"
      >
        {index + 1}
      </span>
      <div className="item-body">
        <div className="item-top">
          <div className="item-meta">
            <time>{formatDate(item.updatedAt)}</time>
          </div>
          <div>
            <button
              className="item-edit"
              type="button"
              aria-label="Edit item"
              onClick={() => onStartEdit(item)}
              disabled={saving || isEditing || reordering}
              title="Edit item"
            >
              <span className="edit-icon" aria-hidden="true" />
            </button>
            <button
              className="item-delete"
              type="button"
              aria-label="Delete item"
              onClick={() => onDelete(item)}
              disabled={saving || reordering}
              title="Delete item"
            >
              <svg className="delete-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 7h16M10 11v6M14 11v6M9 7V4h6v3M6 7l1 13h10l1-13" />
              </svg>
            </button>
          </div>
        </div>

        <div className="item-content">
          {!isEditing && (
            <>
              {item.content && (
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
            </>
          )}

          {isEditing && (
            <div className="edit-area">
              <RichTextEditor
                value={editDraft}
                onChange={setEditDraft}
                onSelectImages={onSelectInlineImages}
                onSelectFiles={onSelectFiles}
                imageUrls={attachmentUrls}
                disabled={saving || uploading}
                ariaLabel="Edit note"
              />
              {editAttachments.length > 0 && (
                <div className="edit-attachments">
                  {editAttachments.map((attachment) => (
                    <span className="edit-chip" key={attachment.id}>
                      <AttachmentTypeIcon type={attachment.kind} compact />
                      <span className="chip-name">{attachment.name}</span>
                      <button
                        type="button"
                        onClick={() => onRemoveEditAttachment(attachment)}
                        aria-label={`Remove ${attachment.name}`}
                      >
                        x
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="edit-actions">
                <button
                  className="button ghost compact"
                  type="button"
                  onClick={onCancelEdit}
                >
                  Cancel
                </button>
                <button
                  className="button primary compact"
                  type="button"
                  onClick={onSaveEdit}
                  disabled={saving || uploading}
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
