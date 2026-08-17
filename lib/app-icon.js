import { ImageResponse } from "next/og";

export function createAppIcon({ width, height }) {
  return new ImageResponse(
    (
      <svg width={width} height={height} viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
        <rect width="512" height="512" fill="#4a875a" />
        <circle cx="256" cy="256" r="220" fill="#3d774d" />
        <g fill="none" stroke="#ffffff" strokeWidth="18" opacity="0.94">
          <ellipse cx="256" cy="256" rx="176" ry="79" transform="rotate(-28 256 256)" />
          <ellipse cx="256" cy="256" rx="176" ry="79" transform="rotate(32 256 256)" />
          <ellipse cx="256" cy="256" rx="176" ry="79" transform="rotate(92 256 256)" />
        </g>
        <circle cx="256" cy="256" r="56" fill="#eaf4ec" />
        <circle cx="256" cy="256" r="22" fill="#4a875a" />
        <circle cx="115" cy="192" r="16" fill="#eaf4ec" />
        <circle cx="391" cy="318" r="16" fill="#eaf4ec" />
      </svg>
    ),
    { width, height },
  );
}
