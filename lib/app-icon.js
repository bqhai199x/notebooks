import { ImageResponse } from "next/og";

export function createAppIcon({ width, height }) {
  return new ImageResponse(
    (
      <svg width={width} height={height} viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
          <rect width="512" height="512" fill="#4A875A" />
          <circle cx="256" cy="256" r="220" fill="#3D774D" />

          {/* Notebook */}
          <rect x="125" y="105" width="245" height="302" rx="18" fill="#D5E8DC" />

          {/* Notebook spine */}
          <path d="M143 105 H170 V407 H143 Q125 407 125 389 V123 Q125 105 143 105 Z" fill="#9FC5AC" />

          {/* Binding */}
          <g stroke="#FFFFFF" strokeWidth="12" strokeLinecap="round">
            <line x1="105" y1="155" x2="145" y2="155" />
            <line x1="105" y1="215" x2="145" y2="215" />
            <line x1="105" y1="275" x2="145" y2="275" />
            <line x1="105" y1="335" x2="145" y2="335" />
          </g>

          {/* Writing lines */}
          <g stroke="#4A875A" strokeWidth="11" strokeLinecap="round" opacity="0.8">
            <line x1="200" y1="170" x2="320" y2="170" />
            <line x1="200" y1="220" x2="300" y2="220" />
            <line x1="200" y1="270" x2="285" y2="270" />
            <line x1="200" y1="320" x2="260" y2="320" />
          </g>

          {/* Pen */}
          <g transform="rotate(38 340 310)">
            {/* Pen body */}
            <path d="M337 175 H343 Q355 175 355 187 V375 H325 V187 Q325 175 337 175 Z" fill="#FFFFFF" stroke="#356945" strokeWidth="5" strokeLinejoin="round" />

            {/* Pen detail */}
            <rect x="334" y="200" width="12" height="150" rx="6" fill="#4A875A" />

            {/* Pen tip */}
            <path d="M325 375 H355 L340 410 Z" fill="#D5E8DC" stroke="#356945" strokeWidth="5" strokeLinejoin="round" />

            {/* Pen point */}
            <circle cx="340" cy="410" r="5" fill="#356945" />
          </g>
        </svg>
    ),
    { width, height },
  );
}
