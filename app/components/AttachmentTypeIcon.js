"use client";

export default function AttachmentTypeIcon({ type, compact = false }) {
  const className = compact ? "attachment-preview-icon" : "attachment-type-icon";

  if (type === "link") {
    return (
      <span className={className} aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="M10.5 13.5a4.25 4.25 0 0 0 6.01.01l2-2a4.25 4.25 0 0 0-6.01-6.01l-1.14 1.14" />
          <path d="M13.5 10.5a4.25 4.25 0 0 0-6.01-.01l-2 2a4.25 4.25 0 0 0 6.01 6.01l1.14-1.14" />
        </svg>
      </span>
    );
  }

  if (type === "image") {
    return (
      <span className={className} aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
          <path d="m5.5 16 4.5-4.5 3 3 2-2 3.5 3.5M8 9.5h.01" />
        </svg>
      </span>
    );
  }

  return (
    <span className={className} aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <path d="M6.5 3.5h7l4 4v13h-11z" />
        <path d="M13.5 3.5v4h4M9 14h6M9 17h4.5" />
      </svg>
    </span>
  );
}
