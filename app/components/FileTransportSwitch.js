"use client";

import { useEffect, useId, useRef, useState } from "react";
import { setFileTransport, useFileTransport } from "../../lib/use-file-transport";

export default function FileTransportSwitch() {
  const state = useFileTransport();
  const descriptionId = useId();
  const previous = useRef(state);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    if (previous.current && state && previous.current !== state) setChanged(true);
    previous.current = state;
  }, [state]);

  return (
    <div className="file-transport-control">
      <label className="file-transport-label">
        <input
          type="checkbox"
          role="switch"
          checked={state?.transport === "proxy"}
          disabled={!state}
          onChange={(event) => setFileTransport(event.target.checked ? "proxy" : "direct")}
          aria-describedby={descriptionId}
        />
        <span>Dùng proxy cho tệp</span>
      </label>
      <small id={descriptionId}>Bật khi mạng không truy cập được R2. Áp dụng trên trình duyệt này.</small>
      <small role="status">{changed ? "Chế độ mới áp dụng cho lượt truyền tiếp theo." : ""}</small>
    </div>
  );
}
