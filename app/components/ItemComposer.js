"use client";

import AttachmentTypeIcon from "./AttachmentTypeIcon";
import RichTextEditor from "./RichTextEditor";
import { richTextHasText } from "../../lib/rich-text";

export default function ItemComposer({
  expanded,
  onExpandedChange,
  draft,
  setDraft,
  pending = [],
  onRemovePending,
  onAddItem,
  onSelectInlineImages,
  onSelectFiles,
  attachmentUrls,
  saving,
  notice,
  editingItem = null,
  onCancelEdit,
  categoryName = "",
}) {
  const canSubmit = richTextHasText(draft) || pending.length > 0;

  const handleClose = () => {
    if (editingItem) {
      onCancelEdit?.();
    } else {
      onExpandedChange(false);
    }
  };

  return (
    <div className={`composer-dock${editingItem ? " composer-dock-editing" : ""}`}>
      {!expanded ? (
        <button
          type="button"
          className="composer-collapsed-trigger"
          onClick={() => onExpandedChange(true)}
          aria-label="Expand new note composer"
        >
          <div className="composer-collapsed-left">
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0, opacity: 0.75 }}
            >
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              <path d="m15 5 4 4" />
            </svg>
            <span>{categoryName ? `Ghi chú vào ${categoryName}...` : "Write a note, paste images or drop files..."}</span>
          </div>
          <div className="composer-trigger-actions">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </div>
        </button>
      ) : (
        <div className="composer-expanded-box">
          <RichTextEditor
            key="composer-editor"
            value={draft}
            onChange={setDraft}
            onSelectImages={onSelectInlineImages}
            onSelectFiles={onSelectFiles}
            imageUrls={attachmentUrls}
            placeholder={editingItem ? "Edit note content..." : "Write note content here..."}
            ariaLabel={editingItem ? "Edit note content" : "Add a new note"}
            disabled={false}
            collapsible={!editingItem}
            collapsed={false}
            onCollapsedChange={(nextCollapsed) => onExpandedChange(!nextCollapsed)}
            collapseControlsId="new-note-editor"
            autoFocus={true}
            autoFocusTrigger={editingItem ? `edit-${editingItem.id}` : "new-note"}
            onSubmit={canSubmit ? onAddItem : undefined}
          />

          <div className="composer-bottom-bar">
            <div className="composer-bottom-left">
              {categoryName && !editingItem && (
                <span className="composer-category-badge" title={`Đang ghi chú vào mục ${categoryName}`}>
                  #{categoryName}
                </span>
              )}
              {notice && <p className="composer-message">{notice}</p>}
              {pending.filter((att) => !att._inline && att.kind !== "image").length > 0 && (
                <div className="composer-chips-scroll">
                  {pending.filter((att) => !att._inline && att.kind !== "image").map((attachment) => (
                    <span className="attachment-chip" key={attachment.id}>
                      <AttachmentTypeIcon type={attachment.kind} filename={attachment.name} compact />
                      <span className="chip-name">{attachment.name}</span>
                      <button
                        type="button"
                        className="attachment-chip-remove"
                        aria-label={`Remove ${attachment.name}`}
                        onClick={() => onRemovePending(attachment)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="composer-button-group">
              <button
                type="button"
                className="btn-composer-icon btn-cancel"
                onClick={handleClose}
                title={editingItem ? "Cancel edit" : "Close"}
                aria-label={editingItem ? "Cancel edit" : "Close"}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
              <button
                type="button"
                className="btn-composer-icon btn-submit"
                onClick={onAddItem}
                disabled={!canSubmit}
                title={editingItem ? "Update note" : "Add note"}
                aria-label={editingItem ? "Update note" : "Add note"}
              >
                {editingItem ? (
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
