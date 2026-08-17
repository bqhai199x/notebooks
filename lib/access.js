import { timingSafeEqual } from "node:crypto";

export function hasAccess(request) {
  const expected = process.env.NOTES_ACCESS_KEY;
  const received = request.headers.get("x-notes-access-key") || "";

  if (!expected) return false;

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length
    && timingSafeEqual(expectedBuffer, receivedBuffer);
}

export function accessIsConfigured() {
  return Boolean(process.env.NOTES_ACCESS_KEY);
}
