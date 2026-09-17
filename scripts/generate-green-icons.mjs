import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

// SVG with rounded squircle clipping (rx=115 on 512x512 ~ 22.5% corner radius)
const greenRoundedSvg = `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="squircle">
      <rect width="512" height="512" rx="64" ry="64" />
    </clipPath>
  </defs>

  <g clip-path="url(#squircle)">
    <!-- Base green background -->
    <rect width="512" height="512" fill="#4A875A" />
    <circle cx="256" cy="256" r="220" fill="#3D774D" />

    <!-- Notebook -->
    <rect x="125" y="105" width="245" height="302" rx="18" fill="#D5E8DC" />

    <!-- Notebook spine -->
    <path d="M143 105 H170 V407 H143 Q125 407 125 389 V123 Q125 105 143 105 Z" fill="#9FC5AC" />

    <!-- Binding -->
    <g stroke="#FFFFFF" stroke-width="12" stroke-linecap="round">
      <line x1="105" y1="155" x2="145" y2="155" />
      <line x1="105" y1="215" x2="145" y2="215" />
      <line x1="105" y1="275" x2="145" y2="275" />
      <line x1="105" y1="335" x2="145" y2="335" />
    </g>

    <!-- Writing lines -->
    <g stroke="#4A875A" stroke-width="11" stroke-linecap="round" opacity="0.8">
      <line x1="200" y1="170" x2="320" y2="170" />
      <line x1="200" y1="220" x2="300" y2="220" />
      <line x1="200" y1="270" x2="285" y2="270" />
      <line x1="200" y1="320" x2="260" y2="320" />
    </g>

    <!-- Pen -->
    <g transform="rotate(38 340 310)">
      <!-- Pen body -->
      <path d="M337 175 H343 Q355 175 355 187 V375 H325 V187 Q325 175 337 175 Z" fill="#FFFFFF" stroke="#356945" stroke-width="5" stroke-linejoin="round" />

      <!-- Pen detail -->
      <rect x="334" y="200" width="12" height="150" rx="6" fill="#4A875A" />

      <!-- Pen tip -->
      <path d="M325 375 H355 L340 410 Z" fill="#D5E8DC" stroke="#356945" stroke-width="5" stroke-linejoin="round" />

      <!-- Pen point -->
      <circle cx="340" cy="410" r="5" fill="#356945" />
    </g>
  </g>
</svg>`;

function createIcoFile(pngImages) {
  const count = pngImages.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(count, 4); // number of images

  let offset = 6 + 16 * count;
  const entries = [];
  for (const { width, height, buffer } of pngImages) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(width >= 256 ? 0 : width, 0);
    entry.writeUInt8(height >= 256 ? 0 : height, 1);
    entry.writeUInt8(0, 2); // color count
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(buffer.length, 8); // image byte size
    entry.writeUInt32LE(offset, 12); // image offset
    entries.push(entry);
    offset += buffer.length;
  }

  return Buffer.concat([header, ...entries, ...pngImages.map(img => img.buffer)]);
}

async function main() {
  const root = path.resolve(".");
  const publicDir = path.join(root, "public");
  const appDir = path.join(root, "app");
  if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

  const svgBuffer = Buffer.from(greenRoundedSvg);

  // 1. High-res icons with rounded squircle
  await sharp(svgBuffer).resize(512, 512).png().toFile(path.join(publicDir, "icon-512.png"));
  await sharp(svgBuffer).resize(512, 512).png().toFile(path.join(publicDir, "icon.png"));
  await sharp(svgBuffer).resize(192, 192).png().toFile(path.join(publicDir, "icon-192.png"));
  await sharp(svgBuffer).resize(180, 180).png().toFile(path.join(publicDir, "apple-touch-icon.png"));
  await sharp(svgBuffer).resize(120, 120).png().toFile(path.join(publicDir, "google-app-logo.png"));

  // 2. Favicons
  const png16 = await sharp(svgBuffer).resize(16, 16).png().toBuffer();
  const png32 = await sharp(svgBuffer).resize(32, 32).png().toBuffer();
  const png48 = await sharp(svgBuffer).resize(48, 48).png().toBuffer();

  fs.writeFileSync(path.join(publicDir, "favicon-16x16.png"), png16);
  fs.writeFileSync(path.join(publicDir, "favicon-32x32.png"), png32);
  fs.writeFileSync(path.join(publicDir, "favicon.png"), png48);

  // 3. Multi-resolution favicon.ico (16, 32, 48)
  const icoBuffer = createIcoFile([
    { width: 16, height: 16, buffer: png16 },
    { width: 32, height: 32, buffer: png32 },
    { width: 48, height: 48, buffer: png48 },
  ]);
  fs.writeFileSync(path.join(publicDir, "favicon.ico"), icoBuffer);
  fs.writeFileSync(path.join(appDir, "favicon.ico"), icoBuffer);

  // 4. Next.js app/icon.png & app/apple-icon.png
  fs.copyFileSync(path.join(publicDir, "icon-512.png"), path.join(appDir, "icon.png"));
  fs.copyFileSync(path.join(publicDir, "apple-touch-icon.png"), path.join(appDir, "apple-icon.png"));

  console.log("Successfully generated all rounded green notebook icons and favicon.ico!");
}

main().catch(err => {
  console.error("Error generating rounded icons:", err);
  process.exit(1);
});
