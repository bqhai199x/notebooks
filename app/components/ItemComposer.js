"use client";

import AttachmentTypeIcon from "./AttachmentTypeIcon";

export default function ItemComposer({
  draft,
  setDraft,
  pending = [],
  onRemovePending,
  onAddItem,
  saving,
  uploading,
  fileInputRef,
  onSelectFiles,
  linkInput,
  setLinkInput,
  linkInputVisible,
  linkInputRef,
  onHandleLinkButton,
  onCloseLinkInput,
  onAddLink,
  notice,
}) {
  return (
    <div className="composer">
      {pending.length > 0 && (
        <div className="pending-attachments">
          {pending.map((attachment) => (
            <span className="pending-chip" key={attachment.id}>
              <AttachmentTypeIcon type={attachment.kind} compact />
              <span className="chip-name">{attachment.name}</span>
              <button
                type="button"
                aria-label={`Remove ${attachment.name}`}
                onClick={() => onRemovePending(attachment)}
              >
                x
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="composer-label">
        <span className="science-icon orbit" aria-hidden="true" />
        New item
      </div>
      <textarea
        value={draft}
        maxLength={20_000}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onAddItem();
          }
        }}
        placeholder="Write a note..."
        aria-label="Add a note"
      />
      <div className="composer-toolbar">
        <div className="attachment-actions">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(event) => onSelectFiles(event, "new")}
          />
          <button
            className="button ghost compact science-button"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || saving}
            title="Attach files"
          >
            <span className="science-icon atom" aria-hidden="true" />
            {uploading ? "Uploading..." : "Files"}
          </button>
          {linkInputVisible && (
            <div className="link-input-wrap">
              <input
                ref={linkInputRef}
                className="link-input"
                value={linkInput}
                onChange={(event) => setLinkInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onAddLink("new");
                  }
                }}
                placeholder="Paste link"
                aria-label="Paste link"
              />
              <button
                className="link-input-close"
                type="button"
                onClick={() => onCloseLinkInput("new")}
                aria-label="Close link input"
              >
                ×
              </button>
            </div>
          )}
          <button
            className="button ghost compact science-button"
            type="button"
            onClick={() => onHandleLinkButton("new")}
            disabled={uploading || saving}
            aria-expanded={linkInputVisible}
          >
            <span className="science-icon molecule" aria-hidden="true" />
            {linkInputVisible ? "Add" : "Link"}
          </button>
        </div>
        <button
          className="button primary science-button"
          type="button"
          onClick={onAddItem}
          disabled={saving || uploading || (!draft.trim() && pending.length === 0)}
        >
          <span className="science-icon plus" aria-hidden="true" />
          {saving ? "Saving..." : "Add"}
        </button>
      </div>
      {notice && <p className="composer-message">{notice}</p>}
    </div>
  );
}
