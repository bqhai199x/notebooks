"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "notes-file-transport";
const listeners = new Set();
let state;

function normalized(value) {
  return value === "proxy" ? "proxy" : "direct";
}

export function getFileTransportState() {
  if (!state) {
    let saved;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch {}
    state = { transport: normalized(saved) };
  }
  return state;
}

function update(value) {
  const transport = normalized(value);
  if (getFileTransportState().transport === transport) return;
  state = { transport };
  listeners.forEach((listener) => listener());
}

export function setFileTransport(value) {
  const transport = normalized(value);
  try { localStorage.setItem(STORAGE_KEY, transport); } catch {}
  update(transport);
}

function onStorage(event) {
  if (event.key === STORAGE_KEY || event.key === null) {
    try { if (event.storageArea && event.storageArea !== localStorage) return; } catch {}
    update(event.newValue);
  }
}

function subscribe(listener) {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener("storage", onStorage);
  };
}

// A null server snapshot gates remote previews until localStorage has been read.
export function useFileTransport() {
  return useSyncExternalStore(subscribe, getFileTransportState, () => null);
}
