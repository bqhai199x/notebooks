"use client";

import { useState } from "react";

export default function UnlockCard({
  accessInput,
  setAccessInput,
  unlock,
  loading,
  notice,
}) {
  const [showKey, setShowKey] = useState(false);

  return (
    <main className="unlock-page">
      <section className="unlock-card">
        <div className="vault-icon-badge" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>

        <h1 className="unlock-title">Private Notes</h1>
        <p className="unlock-subtitle">Enter your secret key to unlock your encrypted space.</p>

        <form onSubmit={unlock} className="unlock-form">
          <label className="unlock-label" htmlFor="access-key">
            Access Key
          </label>
          <div className="unlock-input-wrap">
            <span className="unlock-key-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="7.5" cy="15.5" r="5.5" />
                <path d="m21 2-9.6 9.6" />
                <path d="m15.5 7.5 3 3L22 7l-3-3" />
              </svg>
            </span>
            <input
              id="access-key"
              type={showKey ? "text" : "password"}
              autoComplete="current-password"
              value={accessInput}
              onChange={(event) => setAccessInput(event.target.value)}
              placeholder="Enter your key..."
              className="unlock-input"
              required
              autoFocus
            />
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              style={{ position: "absolute", right: "6px", width: "28px", height: "28px" }}
              onClick={() => setShowKey(!showKey)}
              title={showKey ? "Hide key" : "Show key"}
              tabIndex={-1}
            >
              {showKey ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                  <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                  <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                  <line x1="2" x2="22" y1="2" y2="22" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>

          <button className="btn btn-primary unlock-button" type="submit" disabled={loading}>
            {loading ? (
              <>
                <span className="spinner-icon" />
                <span>Unlocking...</span>
              </>
            ) : (
              <span>Unlock Space</span>
            )}
          </button>
        </form>

        {notice && (
          <div className="unlock-notice" role="alert">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" x2="12" y1="8" y2="12" />
              <line x1="12" x2="12.01" y1="16" y2="16" />
            </svg>
            <span>{notice}</span>
          </div>
        )}
      </section>
    </main>
  );
}
