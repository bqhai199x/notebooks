"use client";

import { useEffect, useRef, useState } from "react";
import FileTransportSwitch from "./FileTransportSwitch";

export default function HeaderActions({ onLock }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(e) {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <>
      {/* Desktop view: direct buttons */}
      <div className="header-actions header-actions-desktop">
        <FileTransportSwitch />
        <button
          className="btn btn-ghost btn-sm btn-icon-only"
          type="button"
          onClick={onLock}
          title="Khoá ứng dụng"
          aria-label="Khoá ứng dụng"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </button>
      </div>

      {/* Mobile view: ultra-compact dropdown (icons only, no labels) */}
      <div className="header-actions header-actions-mobile" ref={menuRef}>
        <button
          className={`btn btn-ghost btn-sm btn-icon-only header-mobile-menu-trigger${isOpen ? " open" : ""}`}
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          title="Tuỳ chọn"
          aria-label="Tuỳ chọn"
          aria-expanded={isOpen}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {isOpen && (
          <div className="header-menu-dropdown header-menu-icons-only">
            {/* Proxy switch: icon + toggle slider */}
            <FileTransportSwitch />

            <div className="header-menu-divider-vertical" aria-hidden="true" />

            {/* Lock app: lock icon button */}
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-icon-only header-menu-lock-btn"
              onClick={() => {
                setIsOpen(false);
                onLock?.();
              }}
              title="Khoá ứng dụng"
              aria-label="Khoá ứng dụng"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </>
  );
}
