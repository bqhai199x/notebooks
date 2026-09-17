export const QUILL_DELTA_FORMAT = "quill-delta";
export const MAX_RICH_TEXT_CHARACTERS = 20_000;
export const MAX_RICH_TEXT_SERIALIZED_LENGTH = 100_000;

const BOOLEAN_INLINE_ATTRIBUTES = new Set([
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
]);
const BOOLEAN_BLOCK_ATTRIBUTES = new Set(["blockquote", "code-block"]);
const FONT_VALUES = new Set(["serif", "monospace"]);
const SIZE_VALUES = new Set(["small", "large", "huge"]);
const SCRIPT_VALUES = new Set(["sub", "super"]);
const LIST_VALUES = new Set(["ordered", "bullet", "checked", "unchecked"]);
const ALIGN_VALUES = new Set(["center", "right", "justify"]);
const LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:", "sms:"]);

export function emptyRichText() {
  return { ops: [{ insert: "\n" }] };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeLink(value) {
  if (typeof value !== "string" || !value || value.length > 2_000) return null;
  if (value === "about:blank") return value;

  try {
    let raw = value.trim();
    if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/.test(raw) && !/^[a-zA-Z]+:\/\//.test(raw)) {
      raw = `https://${raw}`;
    }
    const url = new URL(raw);
    return LINK_PROTOCOLS.has(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeColor(value) {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) return null;
  return value.toLowerCase();
}

function normalizeAttributes(value) {
  if (value == null) return null;
  if (!isPlainObject(value)) throw new Error("Invalid text formatting.");

  const attributes = {};
  for (const [name, rawValue] of Object.entries(value)) {
    if (BOOLEAN_INLINE_ATTRIBUTES.has(name)) {
      if (rawValue !== true) throw new Error("Invalid text formatting.");
      attributes[name] = true;
      continue;
    }

    if (name === "link") {
      const link = normalizeLink(rawValue);
      if (!link) throw new Error("Invalid link.");
      attributes.link = link;
      continue;
    }

    if (name === "color" || name === "background") {
      const color = normalizeColor(rawValue);
      if (!color) throw new Error("Invalid text formatting.");
      attributes[name] = color;
    } else if (name === "font") {
      if (!FONT_VALUES.has(rawValue)) throw new Error("Invalid text formatting.");
      attributes.font = rawValue;
    } else if (name === "size") {
      if (!SIZE_VALUES.has(rawValue)) throw new Error("Invalid text formatting.");
      attributes.size = rawValue;
    } else if (name === "script") {
      if (!SCRIPT_VALUES.has(rawValue)) throw new Error("Invalid text formatting.");
      attributes.script = rawValue;
    } else if (name === "header") {
      if (!Number.isInteger(rawValue) || rawValue < 1 || rawValue > 6) {
        throw new Error("Invalid text formatting.");
      }
      attributes.header = rawValue;
    } else if (name === "list") {
      if (!LIST_VALUES.has(rawValue)) throw new Error("Invalid text formatting.");
      attributes.list = rawValue;
    } else if (name === "indent") {
      if (!Number.isInteger(rawValue) || rawValue < 1 || rawValue > 8) {
        throw new Error("Invalid text formatting.");
      }
      attributes.indent = rawValue;
    } else if (BOOLEAN_BLOCK_ATTRIBUTES.has(name)) {
      if (rawValue !== true) throw new Error("Invalid text formatting.");
      attributes[name] = true;
    } else if (name === "align") {
      if (!ALIGN_VALUES.has(rawValue)) throw new Error("Invalid text formatting.");
      attributes.align = rawValue;
    } else if (name === "direction") {
      if (rawValue !== "rtl") throw new Error("Invalid text formatting.");
      attributes.direction = rawValue;
    } else {
      throw new Error("Invalid text formatting.");
    }
  }

  return Object.keys(attributes).length ? attributes : null;
}

function sanitizeAttributes(value) {
  if (!isPlainObject(value)) return null;

  const attributes = {};
  BOOLEAN_INLINE_ATTRIBUTES.forEach((name) => {
    if (value[name] === true) attributes[name] = true;
  });

  const link = normalizeLink(value.link);
  if (link) attributes.link = link;

  const color = normalizeColor(value.color);
  if (color) attributes.color = color;

  const background = normalizeColor(value.background);
  if (background) attributes.background = background;

  if (FONT_VALUES.has(value.font)) attributes.font = value.font;
  if (SIZE_VALUES.has(value.size)) attributes.size = value.size;
  if (SCRIPT_VALUES.has(value.script)) attributes.script = value.script;
  if (Number.isInteger(value.header) && value.header >= 1 && value.header <= 6) {
    attributes.header = value.header;
  }
  if (LIST_VALUES.has(value.list)) attributes.list = value.list;
  BOOLEAN_BLOCK_ATTRIBUTES.forEach((name) => {
    if (value[name] === true) attributes[name] = true;
  });
  if (Number.isInteger(value.indent) && value.indent >= 1 && value.indent <= 8) {
    attributes.indent = value.indent;
  }
  if (ALIGN_VALUES.has(value.align)) attributes.align = value.align;
  if (value.direction === "rtl") attributes.direction = value.direction;

  return Object.keys(attributes).length ? attributes : null;
}

function normalizeS3Image(value) {
  if (!isPlainObject(value) || !isPlainObject(value.s3Image) || Object.keys(value).length !== 1) {
    throw new Error("Invalid embedded image.");
  }

  const attachmentId = value.s3Image.attachmentId;
  if (typeof attachmentId !== "string" || !attachmentId || attachmentId.length > 180) {
    throw new Error("Invalid embedded image.");
  }

  const image = { attachmentId };
  if (typeof value.s3Image.alt === "string" && value.s3Image.alt) {
    image.alt = value.s3Image.alt.slice(0, 240);
  }
  return image;
}

export function normalizeQuillDelta(value) {
  if (!isPlainObject(value) || !Array.isArray(value.ops) || value.ops.length > 20_000) {
    throw new Error("Invalid rich text.");
  }

  let textLength = 0;
  const ops = value.ops.map((operation) => {
    if (!isPlainObject(operation) || !("insert" in operation)) {
      throw new Error("Invalid rich text.");
    }

    const attributes = normalizeAttributes(operation.attributes);
    if (typeof operation.insert === "string") {
      textLength += operation.insert.length;

      return {
        insert: operation.insert,
        ...(attributes ? { attributes } : {}),
      };
    }

    if (attributes) throw new Error("Invalid embedded image.");
    return { insert: { s3Image: normalizeS3Image(operation.insert) } };
  });

  if (!ops.length) return emptyRichText();
  const finalInsert = ops.at(-1)?.insert;
  const finalNewline = typeof finalInsert === "string" && finalInsert.endsWith("\n") ? 1 : 0;
  if (textLength - finalNewline > MAX_RICH_TEXT_CHARACTERS) throw new Error("Note is too long.");
  return { ops };
}

export function sanitizeQuillDelta(value) {
  if (!isPlainObject(value) || !Array.isArray(value.ops)) return emptyRichText();

  const inputOps = value.ops.slice(0, 20_000);
  const terminalInsert = inputOps.at(-1)?.insert;
  const hasTerminalNewline = typeof terminalInsert === "string" && terminalInsert.endsWith("\n");
  let remainingCharacters = MAX_RICH_TEXT_CHARACTERS;
  const ops = [];

  inputOps.forEach((operation, index) => {
    if (!isPlainObject(operation)) return;

    if (typeof operation.insert === "string") {
      const isTerminalOperation = hasTerminalNewline && index === inputOps.length - 1;
      const text = isTerminalOperation ? operation.insert.slice(0, -1) : operation.insert;
      const insert = text.slice(0, Math.max(0, remainingCharacters));
      remainingCharacters -= insert.length;
      const withTerminalNewline = isTerminalOperation ? `${insert}\n` : insert;
      if (!withTerminalNewline) return;

      const attributes = sanitizeAttributes(operation.attributes);
      ops.push({
        insert: withTerminalNewline,
        ...(attributes ? { attributes } : {}),
      });
      return;
    }

    try {
      ops.push({ insert: { s3Image: normalizeS3Image(operation.insert) } });
    } catch {
      // Only the custom S3 image blot is allowed as an embedded value.
    }
  });

  return normalizeQuillDelta(ops.length ? { ops } : emptyRichText());
}

export function serializeQuillDelta(value) {
  const delta = normalizeQuillDelta(value);
  const serialized = JSON.stringify(delta);
  if (serialized.length > MAX_RICH_TEXT_SERIALIZED_LENGTH) {
    throw new Error("Note is too long.");
  }
  return serialized;
}

export function parseQuillDelta(content) {
  if (typeof content !== "string" || content.length > MAX_RICH_TEXT_SERIALIZED_LENGTH) {
    throw new Error("Invalid rich text.");
  }
  return normalizeQuillDelta(JSON.parse(content));
}

export function plainTextToRichText(content) {
  const text = typeof content === "string" ? content.slice(0, MAX_RICH_TEXT_CHARACTERS) : "";
  return { ops: [{ insert: text.endsWith("\n") ? text : `${text}\n` }] };
}

export function richTextForDisplay(content, contentFormat) {
  if (contentFormat !== QUILL_DELTA_FORMAT) return plainTextToRichText(content);

  try {
    return parseQuillDelta(content);
  } catch {
    return plainTextToRichText(content);
  }
}

export function normalizeStoredContent(content, contentFormat) {
  if (contentFormat === QUILL_DELTA_FORMAT) {
    try {
      return {
        content: serializeQuillDelta(parseQuillDelta(content)),
        contentFormat: QUILL_DELTA_FORMAT,
      };
    } catch {
      // Invalid historical data is treated as plain text rather than executable markup.
    }
  }

  return {
    content: typeof content === "string" ? content.slice(0, MAX_RICH_TEXT_CHARACTERS) : "",
    contentFormat: null,
  };
}

export function prepareRichTextContent(content, contentFormat) {
  if (contentFormat === QUILL_DELTA_FORMAT) {
    const delta = parseQuillDelta(content);
    return {
      content: serializeQuillDelta(delta),
      contentFormat: QUILL_DELTA_FORMAT,
      delta,
    };
  }

  if (contentFormat != null) throw new Error("Invalid content format.");
  if (typeof content !== "string" || content.length > MAX_RICH_TEXT_CHARACTERS) {
    throw new Error("Invalid content.");
  }

  return {
    content: content.trim(),
    contentFormat: null,
    delta: null,
  };
}

export function richTextHasText(value) {
  return normalizeQuillDelta(value).ops.some((operation) => (
    typeof operation.insert === "string" && operation.insert.trim().length > 0
  ));
}

export function inlineImageAttachmentIds(value) {
  const ids = new Set();
  normalizeQuillDelta(value).ops.forEach((operation) => {
    if (isPlainObject(operation.insert) && operation.insert.s3Image?.attachmentId) {
      ids.add(operation.insert.s3Image.attachmentId);
    }
  });
  return ids;
}

export function replaceInlineImageAttachmentIds(value, idMap) {
  const delta = normalizeQuillDelta(value);
  const replacement = idMap instanceof Map ? idMap : new Map(Object.entries(idMap || {}));

  return {
    ops: delta.ops.map((operation) => {
      if (!isPlainObject(operation.insert) || !operation.insert.s3Image) return operation;

      const image = operation.insert.s3Image;
      const attachmentId = replacement.get(image.attachmentId) || image.attachmentId;
      return {
        insert: {
          s3Image: {
            ...image,
            attachmentId,
          },
        },
      };
    }),
  };
}

export function removeInlineImages(value, attachmentIds) {
  const delta = normalizeQuillDelta(value);
  const removed = attachmentIds instanceof Set ? attachmentIds : new Set(attachmentIds);
  const ops = delta.ops.filter((operation) => (
    !isPlainObject(operation.insert)
    || !operation.insert.s3Image
    || !removed.has(operation.insert.s3Image.attachmentId)
  ));

  return ops.length ? { ops } : emptyRichText();
}
