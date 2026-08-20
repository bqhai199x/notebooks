"use client";

import AttachmentTypeIcon from "./AttachmentTypeIcon";

function readableSize(size) {
  if (!size) return "";
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

  return (
    <div className="attachments">
      {attachments.map((attachment) => {
        if (attachment.kind === "link") {
          return (
            <a
              className="link-card"
              href={attachment.url}
              key={attachment.id}
              target="_blank"
              rel="noreferrer"
            >
              <AttachmentTypeIcon type="link" />
              <strong>{attachment.name}</strong>
              <small>{attachment.url}</small>
            </a>
          );
        }

        const url = attachmentUrls[attachment.id];
        if (attachment.kind === "image") {
          return url ? (
            <a
              className="image-card"
              href={url}
              key={attachment.id}
              target="_blank"
              rel="noreferrer"
            >
              <img src={url} alt={attachment.name} />
            </a>
          ) : (
            <div className="file-card" key={attachment.id}>
              <AttachmentTypeIcon type="file" />
              <strong>{attachment.name}</strong>
              <small>{attachment.file ? "Ready to upload" : "Loading image..."}</small>
            </div>
          );
        }

        const downloading = downloadingAttachments[attachment.id];
        return (
          <button
            className="file-card"
            type="button"
            key={attachment.id}
            onClick={() => onDownload?.(attachment)}
            disabled={downloading || !attachment.key}
            aria-label={attachment.key ? `Download ${attachment.name}` : `${attachment.name} will upload when saved`}
          >
            <AttachmentTypeIcon type="file" />
            <strong>{attachment.name}</strong>
            <small>
              {attachment.file
                ? "Ready to upload"
                : downloading
                  ? "Downloading..."
                  : readableSize(attachment.size)}
            </small>
          </button>
        );
      })}
    </div>
  );
}
