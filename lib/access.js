import { createHash, timingSafeEqual } from "node:crypto";

function safeCompare(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function hashKeyToSpace(key) {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export function parseConfiguredKeys() {
  const keyMap = new Map();

  const envValues = [
    process.env.NOTES_ACCESS_KEYS,
    process.env.NOTES_ACCESS_KEY,
  ].filter(Boolean);

  if (envValues.length === 0) return keyMap;

  const isSingleLegacy = !process.env.NOTES_ACCESS_KEYS && process.env.NOTES_ACCESS_KEY
    && !process.env.NOTES_ACCESS_KEY.includes(",")
    && !process.env.NOTES_ACCESS_KEY.includes("\n")
    && !process.env.NOTES_ACCESS_KEY.includes(";")
    && !process.env.NOTES_ACCESS_KEY.trim().startsWith("{");

  if (isSingleLegacy) {
    const singleKey = process.env.NOTES_ACCESS_KEY.trim();
    if (singleKey) {
      keyMap.set(singleKey, "default");
      return keyMap;
    }
  }

  for (const raw of envValues) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") {
          for (const [k, v] of Object.entries(parsed)) {
            const keyStr = String(k).trim();
            const spaceStr = typeof v === "string" && v.trim() ? v.trim() : hashKeyToSpace(keyStr);
            if (keyStr) keyMap.set(keyStr, spaceStr);
          }
          continue;
        }
      } catch {
        // Fallback to delimiter parsing
      }
    }

    const entries = trimmed.split(/[\r\n,;]+/).map((s) => s.trim()).filter(Boolean);
    for (const entry of entries) {
      const colonIdx = entry.indexOf(":");
      if (colonIdx > 0 && colonIdx < entry.length - 1) {
        const spacePart = entry.slice(0, colonIdx).trim();
        const keyPart = entry.slice(colonIdx + 1).trim();
        if (keyPart) {
          keyMap.set(keyPart, spacePart || hashKeyToSpace(keyPart));
        }
      } else {
        keyMap.set(entry, hashKeyToSpace(entry));
      }
    }
  }

  return keyMap;
}

export function getAccessInfo(request) {
  const received = request.headers.get("x-notes-access-key") || "";
  if (!received) return { authorized: false, spaceId: null };

  const keyMap = parseConfiguredKeys();
  if (keyMap.size === 0) return { authorized: false, spaceId: null };

  for (const [key, spaceId] of keyMap.entries()) {
    if (safeCompare(key, received)) {
      return { authorized: true, spaceId };
    }
  }

  return { authorized: false, spaceId: null };
}

export function hasAccess(request) {
  return getAccessInfo(request).authorized;
}

export function getAccessSpace(request) {
  return getAccessInfo(request).spaceId;
}

export function accessIsConfigured() {
  return parseConfiguredKeys().size > 0;
}
