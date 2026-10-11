"use client";

import { useEffect } from "react";

export default function ErrorBoundary({ error, reset }) {
  useEffect(() => {
    console.error("Application error:", error);
  }, [error]);

  return (
    <main className="unlock-page">
      <section className="unlock-card" style={{ maxWidth: 440 }}>
        <div className="vault-icon-badge" aria-hidden="true" style={{ background: "rgba(239, 68, 68, 0.1)", color: "#ef4444" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>

        <h1 className="unlock-title">Không thể tải ứng dụng</h1>
        <p className="unlock-subtitle" style={{ color: "var(--color-muted, #64748b)" }}>
          {error?.message || "Trình duyệt không thể khởi chạy ứng dụng hoặc đã xảy ra lỗi không tương thích."}
        </p>

        <button
          className="btn btn-primary unlock-button"
          type="button"
          onClick={() => reset()}
          style={{ marginTop: "1.25rem" }}
        >
          <span>Thử lại</span>
        </button>
      </section>
    </main>
  );
}
