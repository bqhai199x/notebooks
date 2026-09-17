"use client";

import { useState, useEffect, useRef } from "react";

export default function ShareModal({
  item,
  spaceId = "default",
  onClose,
  onUpdateShare,
}) {
  const [enabled, setEnabled] = useState(Boolean(item.share?.enabled));
  const [allowEdit, setAllowEdit] = useState(Boolean(item.share?.allowEdit));
  const [token, setToken] = useState(item.share?.token || "");
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingAction, setSavingAction] = useState(null);
  const initialCopiedRef = useRef(false);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const shareUrl = token && enabled
    ? `${origin}/share/${item.id}?space=${encodeURIComponent(spaceId || "default")}&token=${encodeURIComponent(token)}`
    : "";

  const copyToClipboard = async (text) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  // If item was already shared, auto-copy link when modal opens
  useEffect(() => {
    async function initShare() {
      if (initialCopiedRef.current) return;
      initialCopiedRef.current = true;

      if (item.share?.enabled && item.share?.token) {
        const url = `${origin}/share/${item.id}?space=${encodeURIComponent(spaceId || "default")}&token=${encodeURIComponent(item.share.token)}`;
        await copyToClipboard(url);
      }
    }

    void initShare();
  }, [item.id, item.share, origin, spaceId]);

  const handleToggleEnabled = async () => {
    const prevEnabled = enabled;
    const nextEnabled = !enabled;
    setEnabled(nextEnabled);
    setSaving(true);
    setSavingAction("toggle-share");
    try {
      const updated = await onUpdateShare({
        id: item.id,
        enabled: nextEnabled,
        allowEdit,
      });
      if (updated?.share) {
        setEnabled(Boolean(updated.share.enabled));
        setToken(updated.share.token);
        if (nextEnabled && updated.share.token) {
          const url = `${origin}/share/${item.id}?space=${encodeURIComponent(spaceId || "default")}&token=${encodeURIComponent(updated.share.token)}`;
          await copyToClipboard(url);
        }
      } else {
        setEnabled(prevEnabled);
      }
    } catch {
      setEnabled(prevEnabled);
    } finally {
      setSaving(false);
      setSavingAction(null);
    }
  };

  const handleToggleAllowEdit = async () => {
    const prevAllowEdit = allowEdit;
    const nextAllowEdit = !allowEdit;
    setAllowEdit(nextAllowEdit);
    setSaving(true);
    setSavingAction("toggle-edit");
    try {
      const updated = await onUpdateShare({
        id: item.id,
        enabled: true,
        allowEdit: nextAllowEdit,
      });
      if (updated?.share) {
        setAllowEdit(Boolean(updated.share.allowEdit));
      } else {
        setAllowEdit(prevAllowEdit);
      }
    } catch {
      setAllowEdit(prevAllowEdit);
    } finally {
      setSaving(false);
      setSavingAction(null);
    }
  };

  const handleRegenerateToken = async () => {
    if (!window.confirm("Tạo link mới sẽ làm vô hiệu hóa tất cả các link đã chia sẻ trước đó. Bạn có chắc chắn?")) return;
    setSaving(true);
    setSavingAction("regenerate");
    try {
      const updated = await onUpdateShare({
        id: item.id,
        enabled: true,
        allowEdit,
        regenerateToken: true,
      });
      if (updated?.share?.token) {
        setToken(updated.share.token);
        setEnabled(true);
        const url = `${origin}/share/${item.id}?space=${encodeURIComponent(spaceId || "default")}&token=${encodeURIComponent(updated.share.token)}`;
        await copyToClipboard(url);
      }
    } finally {
      setSaving(false);
      setSavingAction(null);
    }
  };

  return (
    <div className="share-modal-backdrop" onClick={onClose}>
      <div className="share-modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="share-modal-header">
          <div className="share-modal-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
            <h3>Chia sẻ ghi chú</h3>
          </div>
          <button
            type="button"
            className="share-modal-close-btn"
            onClick={onClose}
            aria-label="Đóng"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="share-modal-body">
          {/* Main switch: Enable/disable share link */}
          <div className="share-option-row">
            <div className="share-option-info">
              <span className="share-option-label">Chia sẻ liên kết</span>
              <span className="share-option-desc">
                {enabled ? "Bất kỳ ai có link đều có thể truy cập ghi chú này" : "Đã tắt chia sẻ (link trước đó bị vô hiệu)"}
              </span>
            </div>
            <div className="share-toggle-container">
              <label className={`toggle-switch${savingAction === "toggle-share" ? " is-loading" : ""}`}>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={handleToggleEnabled}
                  disabled={saving}
                />
                <span className="toggle-slider">
                  <span className="toggle-thumb">
                    {savingAction === "toggle-share" && <span className="toggle-spinner-icon" />}
                  </span>
                </span>
              </label>
            </div>
          </div>

          {(enabled || savingAction === "toggle-share") && (
            <>
              {/* Option: Allow editing */}
              <div className="share-option-row">
                <div className="share-option-info">
                  <span className="share-option-label">Cho phép chỉnh sửa</span>
                  <span className="share-option-desc">
                    {allowEdit ? "Người nhận có thể sửa nội dung ghi chú" : "Người nhận chỉ có quyền đọc (Read-only)"}
                  </span>
                </div>
                <div className="share-toggle-container">
                  <label className={`toggle-switch${savingAction === "toggle-edit" ? " is-loading" : ""}`}>
                    <input
                      type="checkbox"
                      checked={allowEdit}
                      onChange={handleToggleAllowEdit}
                      disabled={saving}
                    />
                    <span className="toggle-slider">
                      <span className="toggle-thumb">
                        {savingAction === "toggle-edit" && <span className="toggle-spinner-icon" />}
                      </span>
                    </span>
                  </label>
                </div>
              </div>

              {/* Link Box */}
              <div className="share-link-section">
                <div className="share-link-box">
                  <input
                    type="text"
                    readOnly
                    value={shareUrl}
                    className="share-link-input"
                    onFocus={(e) => e.target.select()}
                  />
                  <button
                    type="button"
                    className={`share-copy-btn${copied ? " copied" : ""}`}
                    onClick={() => copyToClipboard(shareUrl)}
                    disabled={saving}
                  >
                    {copied ? (
                      <>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span>Đã chép</span>
                      </>
                    ) : (
                      <>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                        </svg>
                        <span>Sao chép</span>
                      </>
                    )}
                  </button>
                </div>
                {copied && <span className="share-copy-notice">Đã sao chép link vào clipboard!</span>}
              </div>

              {/* Regenerate Token (Revoke old links) */}
              <div className="share-regenerate-section">
                <button
                  type="button"
                  className={`share-regenerate-btn${savingAction === "regenerate" ? " is-loading" : ""}`}
                  onClick={handleRegenerateToken}
                  disabled={saving}
                >
                  {savingAction === "regenerate" ? (
                    <svg className="composer-upload-spinner" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                      <path d="M21 3v5h-5" />
                      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                      <path d="M8 16H3v5" />
                    </svg>
                  )}
                  <span>{savingAction === "regenerate" ? "Đang tạo..." : "Tạo link mới (Hủy link cũ)"}</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
