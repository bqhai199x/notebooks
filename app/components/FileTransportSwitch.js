"use client";

import { setFileTransport, useFileTransport } from "../../lib/use-file-transport";

export default function FileTransportSwitch() {
  const state = useFileTransport();

  return (
    <label className="btn btn-ghost btn-sm file-transport-control" title="Dùng proxy cho tệp">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="9" y="3" width="6" height="6" rx="1" />
        <rect x="3" y="15" width="6" height="6" rx="1" />
        <rect x="15" y="15" width="6" height="6" rx="1" />
        <path d="M12 9v3M6 15v-3h12v3" />
      </svg>
      <span className="toggle-switch">
        <input
          type="checkbox"
          role="switch"
          checked={state?.transport === "proxy"}
          disabled={!state}
          onChange={(event) => setFileTransport(event.target.checked ? "proxy" : "direct")}
          aria-label="Dùng proxy cho tệp"
        />
        <span className="toggle-slider" aria-hidden="true">
          <span className="toggle-thumb" />
        </span>
      </span>
    </label>
  );
}
