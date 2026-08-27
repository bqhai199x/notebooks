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
  uploading,
  notice,
}) {
  return (
    <div className={`composer${expanded ? "" : " composer-collapsed"}`}>
      <div className="composer-content">
        {expanded && (
          <>
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
          </>
        )}
        <RichTextEditor
          value={draft}
          onChange={setDraft}
          onSelectImages={onSelectInlineImages}
          onSelectFiles={onSelectFiles}
          imageUrls={attachmentUrls}
          placeholder="Write a note..."
          ariaLabel="Add a note"
          disabled={saving || uploading}
          collapsible
          collapsed={!expanded}
          onCollapsedChange={(nextCollapsed) => onExpandedChange(!nextCollapsed)}
          collapseControlsId="new-note-editor"
        />
        {expanded && (
          <>
            <div className="composer-toolbar">
              <button
                className="button primary science-button"
                type="button"
                onClick={onAddItem}
                disabled={saving || uploading || (!richTextHasText(draft) && pending.length === 0)}
              >
                <span className="science-icon plus" aria-hidden="true" />
                {saving ? "Saving..." : "Add"}
              </button>
            </div>
            {notice && <p className="composer-message">{notice}</p>}
          </>
        )}
      </div>
    </div>
  );
}
