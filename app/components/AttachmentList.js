"use client";

import AttachmentTypeIcon from "./AttachmentTypeIcon";

function readableSize(size) {
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AttachmentList({
  attachments = [],
  attachmentUrls = {},
  downloadingAttachments = {},
  onDownload,
}) {
  if (!attachments.length) return null;

  const imageAttachments = attachments.filter((att) => att.kind === "image");
  const otherAttachments = attachments.filter((att) => att.kind !== "image");

  return (
    <div className="attachments-wrapper">
      {/* Non-image attachments (files & links) */}
      {otherAttachments.length > 0 && (
        <div className="attachments-grid">
          {otherAttachments.map((attachment) => {
            if (attachment.kind === "link") {
              return (
                <a
                  className="attachment-file-card"
                  href={attachment.url}
                  key={attachment.id}
                  target="_blank"
                  rel="noreferrer"
                  title={attachment.url}
                >
                  <div className="attachment-icon-pill">
                    <AttachmentTypeIcon type="link" />
                  </div>
                  <div className="attachment-details">
                    <strong>{attachment.name || "Link"}</strong>
                    <small>{attachment.url}</small>
                  </div>
                  <span className="attachment-download-icon" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </span>
                </a>
              );
            }

            const downloading = downloadingAttachments[attachment.id];
            return (
              <button
                className="attachment-file-card"
                type="button"
                key={attachment.id}
                onClick={() => onDownload?.(attachment)}
                disabled={downloading || !attachment.key}
                title={attachment.key ? `Download ${attachment.name}` : `${attachment.name} (ready to upload)`}
              >
                <div className="attachment-icon-pill">
                  <AttachmentTypeIcon type="file" filename={attachment.name} />
                </div>
                <div className="attachment-details">
                  <strong>{attachment.name}</strong>
                  <small>
                    {attachment.file
                      ? "Pending upload"
                      : downloading
                        ? "Downloading..."
                        : readableSize(attachment.size)}
                  </small>
                </div>
                <span className="attachment-download-icon" aria-hidden="true">
                  {downloading ? (
                    <span className="spinner-icon" />
                  ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Image attachments gallery */}
      {imageAttachments.length > 0 && (
        <div className="attachment-images-grid">
          {imageAttachments.map((attachment) => {
            const url = attachmentUrls[attachment.id];
            if (url) {
              return (
                <a
                  className="attachment-image-card"
                  href={url}
                  key={attachment.id}
                  target="_blank"
                  rel="noreferrer"
                  title="Click to view full size"
                >
                  <img src={url} alt={attachment.name || "Attached image"} loading="lazy" />
                </a>
              );
            }

            return (
              <div className="attachment-file-card" key={attachment.id}>
                <div className="attachment-icon-pill">
                  <AttachmentTypeIcon type="image" />
                </div>
                <div className="attachment-details">
                  <strong>{attachment.name}</strong>
                  <small>{attachment.file ? "Ready to upload" : "Loading preview..."}</small>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
