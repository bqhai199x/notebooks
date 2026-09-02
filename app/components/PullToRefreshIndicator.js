"use client";

export default function PullToRefreshIndicator({
  pullDistance = 0,
  threshold = 50,
  isRefreshing = false,
  isPulling = false,
}) {
  const visible = pullDistance > 0 || isRefreshing;
  if (!visible) return null;

  const isReady = pullDistance >= threshold;
  const rotateDeg = isReady ? 180 : Math.min(180, (pullDistance / threshold) * 180);
  const opacity = isRefreshing ? 1 : Math.min(1, pullDistance / (threshold * 0.5));

  return (
    <div
      className={`ptr-container ${isPulling ? "ptr-pulling" : ""} ${isRefreshing ? "ptr-refreshing" : ""}`}
      style={{
        height: `${pullDistance}px`,
        opacity,
      }}
      aria-hidden={!visible}
    >
      <div className="ptr-content">
        <span className="ptr-icon-wrap">
          {isRefreshing ? (
            <span className="ptr-spinner" aria-hidden="true" />
          ) : (
            <span
              className="ptr-arrow"
              style={{ transform: `rotate(${rotateDeg}deg)` }}
              aria-hidden="true"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <polyline points="19 12 12 19 5 12" />
              </svg>
            </span>
          )}
        </span>
        <span>
          {isRefreshing
            ? "Refreshing..."
            : isReady
              ? "Release to refresh"
              : "Pull down to refresh"}
        </span>
      </div>
    </div>
  );
}
