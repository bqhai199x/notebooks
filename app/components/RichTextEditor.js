"use client";

import { useEffect, useRef } from "react";
import { emptyRichText, normalizeQuillDelta, sanitizeQuillDelta } from "../../lib/rich-text";

const EMPTY_IMAGE_SRC = "about:blank";
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

      node.setAttribute("src", EMPTY_IMAGE_SRC);
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
  icons.file = [
    '<svg viewBox="0 0 18 18" aria-hidden="true">',
    '<path class="ql-stroke" d="M4.5 2.5h5l4 4v9H4.5z" />',
    '<path class="ql-stroke" d="M9.5 2.5v4h4" />',
    '<path class="ql-stroke" d="M9 13V8" />',
    '<path class="ql-stroke" d="m6.8 10.2L9 8l2.2 2.2" />',
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
  return JSON.stringify(left) === JSON.stringify(right);
}

function hydrateImageSources(root, imageUrls) {
  if (!root) return;

  root.querySelectorAll("img.ql-s3-image[data-attachment-id]").forEach((image) => {
    const attachmentId = image.getAttribute("data-attachment-id");
    const source = attachmentId ? imageUrls?.[attachmentId] : null;
    const nextSource = source || EMPTY_IMAGE_SRC;
    if (image.getAttribute("src") !== nextSource) {
      image.setAttribute("src", nextSource);
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
    ...TOOLBAR_GROUPS,
    ["link", "image", "file", "clean", ...(collapsible ? ["collapse"] : [])],
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
}) {
  const hostRef = useRef(null);
  const quillRef = useRef(null);
  const imageInputRef = useRef(null);
  const attachmentInputRef = useRef(null);
  const imageRangeRef = useRef(null);
  const insertImagesRef = useRef(null);
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
  autoFocusRef.current = autoFocus;

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
          editor.insertEmbed(index, "s3Image", {
            attachmentId: attachment.id,
            ...(attachment.name ? { alt: attachment.name } : {}),
          }, "user");
          index += 1;
        });
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

      stopImageDrop = (event) => {
        const files = Array.from(event.dataTransfer?.files || []);
        if (files.some((file) => file?.type?.startsWith("image/"))) {
          event.stopPropagation();
        }
      };
      editor.root.addEventListener("drop", stopImageDrop);

      // Suppress keyboard popup on toolbar interaction
      let suppressFocus = false;
      let suppressTimer = null;

      const triggerSuppress = () => {
        suppressFocus = true;
        if (suppressTimer) clearTimeout(suppressTimer);
        suppressTimer = setTimeout(() => {
          suppressFocus = false;
        }, 400);
      };

      const toolbarContainer = editor.getModule("toolbar")?.container;
      if (toolbarContainer) {
        toolbarContainer.addEventListener("touchstart", triggerSuppress, { passive: true, capture: true });
        toolbarContainer.addEventListener("mousedown", triggerSuppress, { capture: true });
        toolbarContainer.addEventListener("pointerdown", triggerSuppress, { capture: true });
      }

      const origFocus = editor.focus.bind(editor);
      editor.focus = (...args) => {
        if (suppressFocus) return;
        return origFocus(...args);
      };

      if (editor.root) {
        const origRootFocus = editor.root.focus.bind(editor.root);
        editor.root.focus = (...args) => {
          if (suppressFocus) return;
          return origRootFocus(...args);
        };
      }

      // Reposition picker options on click so they are never hidden under content/keyboard
      const handlePickerClick = (e) => {
        const label = e.target.closest(".ql-picker-label");
        if (!label) return;
        const picker = label.closest(".ql-picker");
        const options = picker?.querySelector(".ql-picker-options");
        if (!picker || !options) return;

        const isAlign = picker.classList.contains("ql-align");

        requestAnimationFrame(() => {
          const isExpanded = picker.classList.contains("ql-expanded");
          toolbarContainer?.classList.toggle("ql-has-expanded-picker", isExpanded);
          if (!isExpanded) return;

          const rect = label.getBoundingClientRect();
          options.style.position = "fixed";
          options.style.zIndex = "999999";
          options.style.right = "auto";

          if (isAlign) {
            options.style.width = "38px";
            options.style.minWidth = "38px";
            options.style.maxWidth = "38px";
          } else {
            options.style.width = "auto";
            options.style.minWidth = "120px";
            options.style.maxWidth = "200px";
          }

          const vHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
          const spaceBelow = vHeight - rect.bottom;
          if (spaceBelow < 220) {
            options.style.top = "auto";
            options.style.bottom = `${Math.max(8, window.innerHeight - rect.top + 4)}px`;
          } else {
            options.style.top = `${rect.bottom + 4}px`;
            options.style.bottom = "auto";
          }
          const left = Math.max(8, Math.min(rect.left, window.innerWidth - (isAlign ? 46 : 180)));
          options.style.left = `${left}px`;
        });
      };

      toolbarContainer?.addEventListener("click", handlePickerClick);

      editor.on("text-change", () => {
        const contents = sanitizeQuillDelta(editor.getContents());
        if (!sameContents(editor.getContents(), contents)) {
          editor.setContents(contents, "silent");
        }
        onChangeRef.current?.(contents);
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
      if (editor?.root && stopImageDrop) editor.root.removeEventListener("drop", stopImageDrop);
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

    const nextValue = normalizeQuillDelta(value || emptyRichText());
    if (!sameContents(editor.getContents(), nextValue)) {
      editor.setContents(nextValue, "silent");
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
