export function parseFileTransport(value = "direct") {
  if (value === "direct" || value === "proxy") return value;
  const error = new Error("Invalid file transport. Use direct or proxy.");
  error.status = 400;
  throw error;
}
