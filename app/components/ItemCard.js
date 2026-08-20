"use client";

import AttachmentList from "./AttachmentList";
import AttachmentTypeIcon from "./AttachmentTypeIcon";

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
  editFileInputRef,
  onSelectFiles,
  editLinkInput,
  setEditLinkInput,
  editLinkInputVisible,
  editLinkInputRef,
  onHandleLinkButton,
  onCloseLinkInput,
  onAddLink,
  onCancelEdit,
  onSaveEdit,
  editTextareaRef,
}) {
  const displayedAttachments = isEditing ? editAttachments : item.attachments;

  return (
    <article className={`item-card ${isEditing ? "editing" : ""}`}>
      <span className="line-number">{index + 1}</span>
      <div className="item-body">
        <div className="item-top">
          <time>{formatDate(item.updatedAt)}</time>
          <div>
            <button
              className="item-edit"
              type="button"
              aria-label="Edit item"
              onClick={() => onStartEdit(item)}
              disabled={saving || isEditing}
              title="Edit item"
            >
              <span className="edit-icon" aria-hidden="true" />
            </button>
            <button
              className="item-delete"
              type="button"
              aria-label="Delete item"
              onClick={() => onDelete(item)}
              disabled={saving}
              title="Delete item"
            >
              <svg className="delete-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 7h16M10 11v6M14 11v6M9 7V4h6v3M6 7l1 13h10l1-13" />
              </svg>
            </button>
          </div>
        </div>

        <div className="item-content">
          {item.content && (
            <p className={isEditing ? "current-content" : ""}>{item.content}</p>
          )}

          {displayedAttachments.length > 0 && (
            <AttachmentList
              attachments={displayedAttachments}
              attachmentUrls={attachmentUrls}
              downloadingAttachments={downloadingAttachments}
              onDownload={onDownloadAttachment}
            />
          )}

          {isEditing && (
            <div className="edit-area">
              <textarea
                ref={editTextareaRef}
                value={editDraft}
                maxLength={20_000}
                onChange={(event) => setEditDraft(event.target.value)}
                aria-label="Edit note"
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
              <div className="edit-toolbar">
                <div className="edit-tools">
                  <input
                    ref={editFileInputRef}
                    type="file"
                    multiple
                    hidden
                    onChange={(event) => onSelectFiles(event, "edit")}
                  />
                  <button
                    className="button ghost compact science-button"
                    type="button"
                    onClick={() => editFileInputRef.current?.click()}
                    disabled={uploading || saving}
                  >
                    <span className="science-icon atom" aria-hidden="true" />
                    Files
                  </button>
                  {editLinkInputVisible && (
                    <div className="link-input-wrap">
                      <input
                        ref={editLinkInputRef}
                        className="link-input"
                        value={editLinkInput}
                        onChange={(event) => setEditLinkInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            onAddLink("edit");
                          }
                        }}
                        placeholder="Paste link"
                        aria-label="Paste link"
                      />
                      <button
                        className="link-input-close"
                        type="button"
                        onClick={() => onCloseLinkInput("edit")}
                        aria-label="Close link input"
                      >
                        ×
                      </button>
                    </div>
                  )}
                  <button
                    className="button ghost compact science-button"
                    type="button"
                    onClick={() => onHandleLinkButton("edit")}
                    disabled={uploading || saving}
                    aria-expanded={editLinkInputVisible}
                  >
                    <span className="science-icon molecule" aria-hidden="true" />
                    {editLinkInputVisible ? "Add" : "Link"}
                  </button>
                </div>
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
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
