"use client";

import { useEffect, useRef } from "react";
import { emptyRichText, normalizeQuillDelta, sanitizeQuillDelta } from "../../lib/rich-text";

const EMPTY_IMAGE_SRC = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3C/svg%3E";
let registeredQuill = null;

function registerS3ImageBlot(Quill) {
  if (registeredQuill === Quill) return;

  const Image = Quill.import("formats/image");
  const icons = Quill.import("ui/icons");

  class S3Image extends Image {
    static blotName = "s3Image";

    static className = "ql-s3-image";

    static create(value) {
      const node = super.create();
      const attachmentId = typeof value?.attachmentId === "string" ? value.attachmentId : "";
      const alt = typeof value?.alt === "string" ? value.alt : "";
      const src = typeof value?.src === "string" && value.src && value.src !== "about:blank"
        ? value.src
        : (value?.previewUrl || EMPTY_IMAGE_SRC);

      node.setAttribute("src", src);
      node.setAttribute("data-attachment-id", attachmentId);
      node.setAttribute("alt", alt);
      return node;
    }

    static formats() {
      return {};
    }

    static value(node) {
      const attachmentId = node.getAttribute("data-attachment-id") || "";
      const alt = node.getAttribute("alt") || "";
      return {
        attachmentId,
        ...(alt ? { alt } : {}),
      };
    }
  }

  Quill.register(S3Image, true);

  const Link = Quill.import("formats/link");
  class CustomLink extends Link {
    static create(value) {
      const node = super.create(value);
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
      return node;
    }
  }
  Quill.register(CustomLink, true);

  icons.file = [
    '<svg viewBox="0 0 18 18" aria-hidden="true">',
    '<path class="ql-stroke" d="M15.5 11.5v3a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 2.5 14.5v-3" />',
    '<polyline class="ql-stroke" points="12.5 6 9 2.5 5.5 6" />',
    '<line class="ql-stroke" x1="9" y1="2.5" x2="9" y2="11.5" />',
    "</svg>",
  ].join("");
  icons.collapse = [
    '<svg viewBox="0 0 18 18" aria-hidden="true">',
    '<path class="ql-stroke" d="m4.5 7 4.5 4.5L13.5 7" />',
    "</svg>",
  ].join("");
  registeredQuill = Quill;
}

function sameContents(left, right) {
  if (left === right) return true;
  if (!left || !right) return false;
  try {
    const leftOps = Array.isArray(left?.ops) ? left.ops : (normalizeQuillDelta(left || emptyRichText()).ops || []);
    const rightOps = Array.isArray(right?.ops) ? right.ops : (normalizeQuillDelta(right || emptyRichText()).ops || []);
    return JSON.stringify(leftOps) === JSON.stringify(rightOps);
  } catch {
    return false;
  }
}

function hydrateImageSources(root, imageUrls) {
  if (!root) return;

  root.querySelectorAll("img.ql-s3-image[data-attachment-id]").forEach((image) => {
    const attachmentId = image.getAttribute("data-attachment-id");
    const source = attachmentId ? imageUrls?.[attachmentId] : null;
    if (source) {
      if (image.getAttribute("src") !== source) {
        image.setAttribute("src", source);
      }
    } else {
      const currentSrc = image.getAttribute("src");
      if (!currentSrc || (!currentSrc.startsWith("blob:") && !currentSrc.startsWith("data:image/"))) {
        image.setAttribute("src", EMPTY_IMAGE_SRC);
      }
    }
  });
}

const TOOLBAR_GROUPS = [
  [{ header: [false, 1, 2, 3, 4, 5, 6] }],
  ["bold", "italic", "underline", "strike", "code"],
  [{ color: [] }, { background: [] }],
  [{ script: "sub" }, { script: "super" }],
  ["blockquote"],
  [{ list: "ordered" }, { list: "bullet" }, { list: "check" }],
  [{ indent: "-1" }, { indent: "+1" }],
  [{ direction: "rtl" }, { align: [] }],
];

function toolbarFor(collapsible) {
  return [
    ["file"],
    ...TOOLBAR_GROUPS,
    ["link", "image", "clean", ...(collapsible ? ["collapse"] : [])],
  ];
}

function updateCollapseButton(editor, collapsed, controlsId) {
  const button = editor?.getModule("toolbar")?.container?.querySelector("button.ql-collapse");
  if (!button) return;

  const isExpanded = !collapsed;
  button.setAttribute("aria-label", isExpanded ? "Collapse note editor" : "Expand note editor");
  button.setAttribute("aria-expanded", String(isExpanded));
  button.setAttribute("title", isExpanded ? "Collapse editor" : "Expand editor");
  if (controlsId) {
    button.setAttribute("aria-controls", controlsId);
  } else {
    button.removeAttribute("aria-controls");
  }
}

const FORMATS = [
  "font",
  "size",
  "header",
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "color",
  "background",
  "script",
  "list",
  "indent",
  "blockquote",
  "direction",
  "align",
  "link",
  "s3Image",
];

export default function RichTextEditor({
  value,
  onChange,
  onSelectImages,
  onSelectFiles,
  imageUrls,
  placeholder = "Write a note...",
  disabled = false,
  readOnly = false,
  ariaLabel,
  collapsible = false,
  collapsed = false,
  onCollapsedChange,
  collapseControlsId,
  autoFocus = false,
  autoFocusTrigger,
  onSubmit,
}) {
  const hostRef = useRef(null);
  const quillRef = useRef(null);
  const imageInputRef = useRef(null);
  const attachmentInputRef = useRef(null);
  const imageRangeRef = useRef(null);
  const insertImagesRef = useRef(null);
  const lastEmittedValueRef = useRef(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onSelectImagesRef = useRef(onSelectImages);
  const onSelectFilesRef = useRef(onSelectFiles);
  const imageUrlsRef = useRef(imageUrls);
  const disabledRef = useRef(disabled);
  const collapsedRef = useRef(Boolean(collapsed));
  const onCollapsedChangeRef = useRef(onCollapsedChange);
  const collapseControlsIdRef = useRef(collapseControlsId);
  const autoFocusRef = useRef(autoFocus);
  const onSubmitRef = useRef(onSubmit);
  autoFocusRef.current = autoFocus;
  onSubmitRef.current = onSubmit;

  valueRef.current = value;
  onChangeRef.current = onChange;
  onSelectImagesRef.current = onSelectImages;
  onSelectFilesRef.current = onSelectFiles;
  imageUrlsRef.current = imageUrls;
  disabledRef.current = disabled;
  collapsedRef.current = Boolean(collapsed);
  onCollapsedChangeRef.current = onCollapsedChange;
  collapseControlsIdRef.current = collapseControlsId;

  const isCollapsed = Boolean(collapsible && collapsed);

  useEffect(() => {
    let disposed = false;
    let editor = null;
    let stopImageDrop = null;
    let handlePaste = null;
    let pickersObserver = null;

    async function createEditor() {
      const module = await import("quill");
      if (disposed || !hostRef.current) return;

      const Quill = module.default;
      registerS3ImageBlot(Quill);

      editor = new Quill(hostRef.current, {
        theme: "snow",
        placeholder: readOnly ? "" : placeholder,
        readOnly,
        bounds: hostRef.current,
        formats: FORMATS,
        modules: readOnly
          ? { toolbar: false, history: false, uploader: false }
          : {
            toolbar: {
              container: toolbarFor(collapsible),
              handlers: {
                image() {
                  if (!disabledRef.current && this.quill.isEnabled()) {
                    imageRangeRef.current = this.quill.getSelection(true)
                      || { index: this.quill.getLength(), length: 0 };
                    imageInputRef.current?.click();
                  }
                },
                file() {
                  if (!disabledRef.current && this.quill.isEnabled()) {
                    attachmentInputRef.current?.click();
                  }
                },
                collapse() {
                  const nextCollapsed = !collapsedRef.current;
                  if (nextCollapsed) this.quill.blur();
                  onCollapsedChangeRef.current?.(nextCollapsed);
                },
              },
            },
            uploader: { mimetypes: ["image/*"] },
          },
      });
      quillRef.current = editor;
      editor.setContents(normalizeQuillDelta(valueRef.current || emptyRichText()), "silent");
      hydrateImageSources(editor.root, imageUrlsRef.current);
      if (ariaLabel) editor.root.setAttribute("aria-label", ariaLabel);

      const fileButton = editor.getModule("toolbar")?.container?.querySelector("button.ql-file");
      if (fileButton) {
        fileButton.setAttribute("aria-label", "Attach files");
        fileButton.setAttribute("title", "Attach files");
      }
      const imageButton = editor.getModule("toolbar")?.container?.querySelector("button.ql-image");
      if (imageButton) {
        imageButton.setAttribute("aria-label", "Upload image");
        imageButton.setAttribute("title", "Upload image");
      }
      updateCollapseButton(editor, collapsedRef.current, collapseControlsIdRef.current);

      if (readOnly) {
        editor.disable();
        return;
      }

      editor.enable(!disabledRef.current);

      editor.keyboard.addBinding({
        key: 13,
        shortKey: true,
        handler: () => {
          if (onSubmitRef.current) {
            onSubmitRef.current();
            return false;
          }
          return true;
        },
      });

      const insertImages = async (range, files) => {
        const images = Array.from(files || []).filter((file) => file?.type?.startsWith("image/"));
        if (!images.length || disposed || !editor.isEnabled()) return;

        const selected = await onSelectImagesRef.current?.(images);
        if (disposed || !Array.isArray(selected) || !selected.length) return;

        const selection = range || editor.getSelection(true) || { index: editor.getLength(), length: 0 };
        let index = selection.index;
        if (selection.length) editor.deleteText(index, selection.length, "user");

        selected.forEach((attachment) => {
          if (!attachment?.id) return;
          const previewUrl = attachment._previewUrl || imageUrlsRef.current?.[attachment.id] || "";
          editor.insertEmbed(index, "s3Image", {
            attachmentId: attachment.id,
            ...(attachment.name ? { alt: attachment.name } : {}),
            ...(previewUrl ? { src: previewUrl, previewUrl } : {}),
          }, "user");
          index += 1;
        });
        if (editor.root?.querySelector("img, .ql-s3-image")) {
          editor.root.classList.remove("ql-blank");
        }
        editor.setSelection(index, 0, "silent");
      };
      insertImagesRef.current = insertImages;

      const uploader = editor.getModule("uploader");
      if (uploader) {
        uploader.upload = (range, files) => {
          void insertImages(range, files);
        };
      }

      const Delta = Quill.import("delta");
      editor.clipboard.addMatcher("IMG", () => new Delta());

      // Auto-link: when pasting plain text containing URLs, convert them into hyperlinks
      editor.clipboard.addMatcher(Node.TEXT_NODE, (node, delta) => {
        const text = typeof node?.data === "string" ? node.data : (typeof node?.textContent === "string" ? node.textContent : "");
        if (!text) return delta;
        const hasLink = delta?.ops?.some((op) => op.attributes?.link);
        if (hasLink) return delta;
        if (node.parentElement?.tagName === "A") return delta;

        const regex = /(?:https?:\/\/|www\.)[^\s<>"]+/gi;
        if (!regex.test(text)) return delta;

        const newDelta = new Delta();
        let lastIndex = 0;
        let match;
        regex.lastIndex = 0;
        while ((match = regex.exec(text)) !== null) {
          const rawUrl = match[0];
          const matchIndex = match.index;
          if (matchIndex > lastIndex) {
            newDelta.insert(text.slice(lastIndex, matchIndex));
          }

          let cleanUrl = rawUrl;
          let trailing = "";
          const trailingMatch = cleanUrl.match(/[.,;:!?)]+$/);
          if (trailingMatch) {
            trailing = trailingMatch[0];
            cleanUrl = cleanUrl.slice(0, -trailing.length);
          }

          const href = /^https?:\/\//i.test(cleanUrl) ? cleanUrl : `https://${cleanUrl}`;
          newDelta.insert(cleanUrl, { link: href });
          if (trailing) {
            newDelta.insert(trailing);
          }
          lastIndex = matchIndex + rawUrl.length;
        }
        if (lastIndex < text.length) {
          newDelta.insert(text.slice(lastIndex));
        }
        return newDelta;
      });

      // Smart link: when user pastes a URL (single URL or onto selected text)
      handlePaste = (event) => {
        if (event.clipboardData?.files?.length > 0) return;
        const pastedText = event.clipboardData?.getData("text/plain");
        if (!pastedText) return;

        const trimmed = pastedText.trim();
        const isSingleUrl = /^(?:https?:\/\/|www\.)[^\s<>"]+$/i.test(trimmed);

        if (isSingleUrl) {
          event.preventDefault();
          event.stopPropagation();

          let cleanUrl = trimmed;
          const trailingMatch = cleanUrl.match(/[.,;:!?)]+$/);
          if (trailingMatch) {
            cleanUrl = cleanUrl.slice(0, -trailingMatch[0].length);
          }
          const targetHref = /^https?:\/\//i.test(cleanUrl) ? cleanUrl : `https://${cleanUrl}`;

          const selection = editor.getSelection();
          if (selection && selection.length > 0) {
            editor.formatText(selection.index, selection.length, "link", targetHref, "user");
            editor.setSelection(selection.index + selection.length, 0, "user");
          } else {
            const index = selection ? selection.index : editor.getLength() - 1;
            editor.insertText(index, cleanUrl, { link: targetHref }, "user");
            editor.setSelection(index + cleanUrl.length, 0, "user");
          }
          return;
        }
      };
      editor.root.addEventListener("paste", handlePaste, { capture: true });

      stopImageDrop = (event) => {
        const files = Array.from(event.dataTransfer?.files || []);
        if (files.length > 0) {
          event.stopImmediatePropagation();
        }
      };
      editor.root.addEventListener("drop", stopImageDrop, { capture: true });

      // Suppress keyboard popup on toolbar interaction for touch devices
      let suppressFocus = false;
      let suppressTimer = null;

      const triggerSuppress = (e) => {
        // Only suppress keyboard popup for touch interactions, never for desktop mouse clicks
        if (e?.pointerType === "mouse") return;
        suppressFocus = true;
        if (suppressTimer) clearTimeout(suppressTimer);
        suppressTimer = setTimeout(() => {
          suppressFocus = false;
        }, 400);
      };

      const toolbarContainer = editor.getModule("toolbar")?.container;
      if (toolbarContainer) {
        toolbarContainer.addEventListener("touchstart", triggerSuppress, { passive: true, capture: true });
        toolbarContainer.addEventListener("pointerdown", triggerSuppress, { capture: true });

        // Prevent mouse clicks on toolbar controls from stealing focus / clearing editor selection
        toolbarContainer.addEventListener("mousedown", (e) => {
          if (e.pointerType === "touch") {
            triggerSuppress(e);
            return;
          }
          const target = e.target.closest("button, .ql-picker-label, .ql-picker-item, .ql-picker-options");
          if (target) {
            e.preventDefault();
          }
        });
      }

      const origFocus = editor.focus.bind(editor);
      editor.focus = (...args) => {
        if (suppressFocus) {
          // Quill keeps savedRange current even for silent moves (e.g. Enter).
          // Restore it only if a touch toolbar interaction moved focus away.
          const rangeToRestore = editor.selection?.savedRange;
          if (!editor.hasFocus() && rangeToRestore) {
            try {
              editor.selection.setRange(rangeToRestore, false, "silent");
            } catch {}
          }
          return;
        }
        return origFocus(...args);
      };

      if (editor.root) {
        const origRootFocus = editor.root.focus.bind(editor.root);
        editor.root.focus = (...args) => {
          if (suppressFocus) return;
          return origRootFocus(...args);
        };
      }

      // Reposition picker options on change so they are never hidden under content/keyboard
      const updatePickers = () => {
        if (!toolbarContainer) return;
        const pickers = toolbarContainer.querySelectorAll(".ql-picker");

        pickers.forEach((picker) => {
          const isExpanded = picker.classList.contains("ql-expanded");
          const options = picker.querySelector(".ql-picker-options");
          const label = picker.querySelector(".ql-picker-label");
          if (!options || !label) return;

          if (isExpanded) {
            const isAlign = picker.classList.contains("ql-align") || picker.classList.contains("ql-icon-picker");
            const isColor = picker.classList.contains("ql-color") || picker.classList.contains("ql-background") || picker.classList.contains("ql-color-picker");
            const optWidth = isAlign ? 38 : (isColor ? 152 : 130);

            options.style.position = "fixed";
            options.style.zIndex = "999999";
            options.style.width = `${optWidth}px`;
            options.style.minWidth = `${optWidth}px`;
            options.style.maxWidth = `${optWidth}px`;

            const rect = label.getBoundingClientRect();
            const vHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
            const spaceBelow = vHeight - rect.bottom;

            if (spaceBelow < 220) {
              options.style.top = "auto";
              options.style.bottom = `${Math.max(8, window.innerHeight - rect.top + 4)}px`;
            } else {
              options.style.top = `${rect.bottom + 4}px`;
              options.style.bottom = "auto";
            }

            const maxLeft = window.innerWidth - optWidth - 8;
            const left = Math.max(8, Math.min(rect.left, maxLeft));
            options.style.left = `${left}px`;
            options.style.right = "auto";
          } else {
            options.style.position = "";
            options.style.top = "";
            options.style.bottom = "";
            options.style.left = "";
            options.style.right = "";
            options.style.zIndex = "";
            options.style.width = "";
            options.style.minWidth = "";
            options.style.maxWidth = "";
          }
        });
      };

      pickersObserver = new MutationObserver(updatePickers);
      if (toolbarContainer) {
        toolbarContainer.querySelectorAll(".ql-picker").forEach((p) => {
          pickersObserver.observe(p, { attributes: true, attributeFilter: ["class"] });
        });
        toolbarContainer.addEventListener("scroll", () => {
          toolbarContainer.querySelectorAll(".ql-picker.ql-expanded").forEach((p) => {
            p.classList.remove("ql-expanded");
          });
        }, { passive: true });
      }

      editor.on("text-change", (delta, oldDelta, source) => {
        if (editor.root?.querySelector("img, .ql-s3-image")) {
          editor.root.classList.remove("ql-blank");
        }
        if (source === "user") {
          const contents = sanitizeQuillDelta(editor.getContents());
          lastEmittedValueRef.current = contents;
          onChangeRef.current?.(contents);
        }
      });

      if (autoFocusRef.current && !readOnly && !disabledRef.current) {
        setTimeout(() => {
          if (disposed) return;
          try {
            editor.focus();
            editor.root?.focus();
            const length = editor.getLength();
            editor.setSelection(length, length);
          } catch {}
        }, 100);
      }
    }

    void createEditor();

    return () => {
      disposed = true;
      pickersObserver?.disconnect();
      if (editor?.root && stopImageDrop) editor.root.removeEventListener("drop", stopImageDrop);
      if (editor?.root && handlePaste) editor.root.removeEventListener("paste", handlePaste, { capture: true });
      editor?.getModule("toolbar")?.container?.remove();
      if (insertImagesRef.current) insertImagesRef.current = null;
      if (quillRef.current === editor) quillRef.current = null;
      if (hostRef.current) hostRef.current.replaceChildren();
    };
  }, [placeholder, readOnly, collapsible]);

  useEffect(() => {
    const editor = quillRef.current;
    if (!editor || readOnly || disabled || isCollapsed) return;
    if (autoFocus || autoFocusTrigger) {
      const timer = setTimeout(() => {
        try {
          editor.focus();
          editor.root?.focus();
          const length = editor.getLength();
          editor.setSelection(length, length);
        } catch {}
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [autoFocus, autoFocusTrigger, isCollapsed, readOnly, disabled]);

  useEffect(() => {
    const editor = quillRef.current;
    if (!editor) return;

    if (lastEmittedValueRef.current && sameContents(lastEmittedValueRef.current, value)) {
      hydrateImageSources(editor.root, imageUrls);
      return;
    }

    const nextValue = normalizeQuillDelta(value || emptyRichText());
    if (!sameContents(editor.getContents(), nextValue)) {
      const range = editor.getSelection();
      editor.setContents(nextValue, "silent");
      if (range && editor.hasFocus()) {
        try {
          editor.setSelection(range.index, range.length, "silent");
        } catch {}
      }
    }
    hydrateImageSources(editor.root, imageUrls);
  }, [value, imageUrls]);

  useEffect(() => {
    const editor = quillRef.current;
    if (!editor) return;
    editor.enable(!readOnly && !disabled);
  }, [disabled, readOnly]);

  useEffect(() => {
    const editor = quillRef.current;
    updateCollapseButton(editor, Boolean(collapsed), collapseControlsId);
    if (collapsible && collapsed) editor?.blur();
  }, [collapsed, collapsible, collapseControlsId]);

  return (
    <div
      className={`rich-text ${readOnly ? "rich-text-viewer" : "rich-text-editor"}${collapsible ? " rich-text-collapsible" : ""}${isCollapsed ? " rich-text-collapsed" : ""}`}
    >
      <div
        ref={hostRef}
        id={collapseControlsId}
        className="rich-text-host"
        aria-label={ariaLabel}
        aria-hidden={isCollapsed || undefined}
      />
      {!readOnly && (
        <>
          <input
            ref={imageInputRef}
            className="rich-text-file-input"
            type="file"
            accept="image/*"
            multiple
            hidden
            disabled={disabled}
            onChange={(event) => {
              const files = event.target.files;
              const range = imageRangeRef.current;
              imageRangeRef.current = null;
              void insertImagesRef.current?.(range, files);
              event.target.value = "";
            }}
          />
          <input
            ref={attachmentInputRef}
            className="rich-text-file-input"
            type="file"
            multiple
            hidden
            disabled={disabled}
            onChange={(event) => {
              onSelectFilesRef.current?.(event.target.files);
              event.target.value = "";
            }}
          />
        </>
      )}
    </div>
  );
}
