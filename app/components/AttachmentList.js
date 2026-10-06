"use client";

import { useState } from "react";
import AttachmentTypeIcon from "./AttachmentTypeIcon";

function readableSize(size) {
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds) {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return "";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const remM = m % 60;
    return `${h}:${String(remM).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function AttachmentList({
  attachments = [],
  attachmentUrls = {},
  downloadingAttachments = {},
  onDownload,
  onPlayVideo,
}) {
  const fileAttachments = attachments.filter((att) => att.kind !== "image");
  const [playingVideoIds, setPlayingVideoIds] = useState(new Set());
  const [loadingVideoIds, setLoadingVideoIds] = useState(new Set());

  if (!fileAttachments.length) return null;

  const handleStartPlay = async (attachment) => {
    const id = attachment.id;
    if (attachmentUrls[id]) {
      setPlayingVideoIds((prev) => new Set(prev).add(id));
      return;
    }

    if (onPlayVideo) {
      setLoadingVideoIds((prev) => new Set(prev).add(id));
      try {
        await onPlayVideo(attachment);
        setPlayingVideoIds((prev) => new Set(prev).add(id));
      } catch (err) {
        console.error("Error playing video:", err);
      } finally {
        setLoadingVideoIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    }
  };

  const handleStopPlay = (id) => {
    setPlayingVideoIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  return (
    <div className="attachments-wrapper">
      <div className="attachments-grid">
        {fileAttachments.map((attachment) => {
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

          const isVideo = attachment.kind === "video" || attachment.contentType?.startsWith("video/");

          if (isVideo) {
            const isPlaying = playingVideoIds.has(attachment.id);
            const isLoading = loadingVideoIds.has(attachment.id);
            const videoUrl = attachmentUrls[attachment.id] || (attachment.file ? URL.createObjectURL(attachment.file) : null);
            const downloading = downloadingAttachments[attachment.id];

            return (
              <div className="attachment-video-container" key={attachment.id}>
                {isPlaying && videoUrl ? (
                  <div className="attachment-video-player-box">
                    <div className="attachment-video-player-header">
                      <span className="attachment-video-name">{attachment.name}</span>
                      <button
                        type="button"
                        className="attachment-video-close-btn"
                        onClick={() => handleStopPlay(attachment.id)}
                        title="Đóng video (quay lại ảnh bìa)"
                        aria-label="Đóng video"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                    <video
                      controls
                      autoPlay
                      playsInline
                      className="attachment-inline-video"
                      src={videoUrl}
                      poster={attachment.thumbnail || undefined}
                    />
                  </div>
                ) : (
                  <div className="attachment-video-preview-card">
                    <div
                      className="attachment-video-thumbnail-box"
                      onClick={() => handleStartPlay(attachment)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleStartPlay(attachment);
                        }
                      }}
                      title="Bấm để phát video"
                    >
                      {attachment.thumbnail ? (
                        <img
                          src={attachment.thumbnail}
                          alt={attachment.name}
                          className="attachment-video-poster"
                        />
                      ) : (
                        <div className="attachment-video-poster-placeholder">
                          <AttachmentTypeIcon type="video" filename={attachment.name} />
                        </div>
                      )}

                      <div className="attachment-video-play-overlay">
                        {isLoading ? (
                          <div className="attachment-video-loading-spinner" />
                        ) : (
                          <div className="attachment-video-play-button" aria-label="Phát video">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                              <polygon points="6 3 20 12 6 21 6 3" />
                            </svg>
                          </div>
                        )}
                      </div>

                      <div className="attachment-video-badge">
                        {formatDuration(attachment.duration) ? (
                          <span>{formatDuration(attachment.duration)} • {readableSize(attachment.size)}</span>
                        ) : (
                          <span>{readableSize(attachment.size)}</span>
                        )}
                      </div>
                    </div>

                    <div className="attachment-video-meta">
                      <div className="attachment-video-info">
                        <strong className="attachment-video-title" title={attachment.name}>
                          {attachment.name}
                        </strong>
                        {formatDuration(attachment.duration) ? (
                          <span className="attachment-video-sub">{formatDuration(attachment.duration)}</span>
                        ) : null}
                      </div>

                      <button
                        type="button"
                        className={`attachment-video-dl-btn${downloading ? " is-downloading" : ""}`}
                        onClick={() => onDownload?.(attachment)}
                        disabled={downloading || !attachment.key}
                        title={`Tải xuống ${attachment.name}`}
                        aria-label={`Tải xuống ${attachment.name}`}
                      >
                        {downloading ? (
                          <span className="spinner-icon" />
                        ) : (
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          }

          const downloading = downloadingAttachments[attachment.id];
          return (
            <button
              className={`attachment-file-card${downloading ? " is-downloading" : ""}`}
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
    </div>
  );
}
