"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function CategoryTabs({
  categories = [],
  activeTabId,
  onSelectTab,
  itemCounts = {},
  onAddCategory,
  onRenameCategory,
  onDeleteCategory,
  onReorderCategories,
}) {
  const containerRef = useRef(null);
  const draggableListRef = useRef(null);
  const sortableRef = useRef(null);
  const [mounted, setMounted] = useState(false);

  const [isAdding, setIsAdding] = useState(false);
  const [newTabName, setNewTabName] = useState("");
  const [editingTabId, setEditingTabId] = useState(null);
  const [editingTabName, setEditingTabName] = useState("");
  const [menuState, setMenuState] = useState(null); // { tab, rect }
  const [deleteConfirmTab, setDeleteConfirmTab] = useState(null);
  const [deleteNotesChoice, setDeleteNotesChoice] = useState("transfer"); // "transfer" | "delete"

  const addInputRef = useRef(null);
  const editInputRef = useRef(null);
  const hoverTimerRef = useRef(null);
  const closeTimeoutRef = useRef(null);
  const touchTimerRef = useRef(null);
  const touchStartPosRef = useRef({ x: 0, y: 0 });
  const isLongPressRef = useRef(false);
  const isSortingRef = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const firstTab = useMemo(
    () => categories[0] || { id: "tab-1", name: "Ghi chú", isDefault: true },
    [categories[0]?.id, categories[0]?.name]
  );
  const otherTabs = useMemo(() => categories.slice(1), [categories]);

  // Initialize SortableJS only on otherTabs container
  useEffect(() => {
    const container = draggableListRef.current;
    if (!container || otherTabs.length < 1) return;

    let disposed = false;

    async function initSortable() {
      const module = await import("sortablejs");
      if (disposed) return;
      const Sortable = module.default;

      sortableRef.current = new Sortable(container, {
        animation: 200,
        easing: "cubic-bezier(0.25, 1, 0.5, 1)",
        draggable: ".category-tab-wrapper",
        ghostClass: "tab-sortable-ghost",
        chosenClass: "tab-sortable-chosen",
        fallbackClass: "tab-sortable-fallback",
        forceFallback: true,
        fallbackOnBody: true,
        direction: "horizontal",
        swapThreshold: 0.65,
        invertSwap: true,
        filter: ".category-tab-input-form, .category-tab-inline-input",
        preventOnFilter: false,
        fallbackTolerance: 5,
        delay: 150,
        delayOnTouchOnly: true,
        touchStartThreshold: 5,
        onStart() {
          isSortingRef.current = true;
          if (hoverTimerRef.current) {
            clearTimeout(hoverTimerRef.current);
            hoverTimerRef.current = null;
          }
          if (touchTimerRef.current) {
            clearTimeout(touchTimerRef.current);
            touchTimerRef.current = null;
          }
          setMenuState(null);
          if (typeof document !== "undefined") {
            document.body.classList.add("is-sorting-tabs");
          }
        },
        onEnd(evt) {
          if (typeof document !== "undefined") {
            document.body.classList.remove("is-sorting-tabs");
          }
          setTimeout(() => {
            isSortingRef.current = false;
          }, 120);

          if (evt.oldIndex === evt.newIndex || evt.oldIndex == null || evt.newIndex == null) return;
          const nextOthers = [...otherTabs];
          const [moved] = nextOthers.splice(evt.oldIndex, 1);
          nextOthers.splice(evt.newIndex, 0, moved);
          onReorderCategories?.([firstTab, ...nextOthers]);
        },
      });
    }

    void initSortable();

    return () => {
      disposed = true;
      sortableRef.current?.destroy();
    };
  }, [otherTabs, firstTab, onReorderCategories]);

  // Support horizontal scroll with mouse wheel on the scroll area
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (container.scrollWidth > container.clientWidth) {
        e.preventDefault();
        container.scrollLeft += e.deltaY;
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, []);

  // Close menus on outside click
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (!e.target.closest(".tab-portal-dropdown")) {
        setMenuState(null);
      }
    };
    window.addEventListener("pointerdown", handleOutsideClick);
    return () => window.removeEventListener("pointerdown", handleOutsideClick);
  }, []);

  // Focus add input when opened
  useEffect(() => {
    if (isAdding) {
      addInputRef.current?.focus();
    }
  }, [isAdding]);

  // Focus edit input when opened
  useEffect(() => {
    if (editingTabId) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingTabId]);

  const handleStartAdd = () => {
    setNewTabName("");
    setIsAdding(true);
  };

  const handleConfirmAdd = () => {
    const trimmed = newTabName.trim();
    if (trimmed) {
      onAddCategory?.(trimmed);
    }
    setIsAdding(false);
    setNewTabName("");
  };

  const handleStartEdit = (cat) => {
    setEditingTabId(cat.id);
    setEditingTabName(cat.name);
    setMenuState(null);
  };

  const handleConfirmEdit = () => {
    const trimmed = editingTabName.trim();
    if (trimmed && editingTabId) {
      onRenameCategory?.(editingTabId, trimmed);
    }
    setEditingTabId(null);
    setEditingTabName("");
  };

  const handleConfirmDelete = () => {
    if (deleteConfirmTab) {
      onDeleteCategory?.(deleteConfirmTab.id);
      setDeleteConfirmTab(null);
    }
  };

  // Hover handlers on PC: only active on pointer: fine devices
  const handleTabMouseEnter = (cat, e) => {
    // Only on desktop/mouse devices
    if (typeof window !== "undefined" && !window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      return;
    }

    // If sorting tabs or dragging a note card, don't trigger hover menu
    if (
      isSortingRef.current ||
      (typeof document !== "undefined" && (document.body.classList.contains("is-dragging-item") || document.body.classList.contains("is-sorting-tabs")))
    ) {
      return;
    }

    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }

    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }

    const currentTarget = e.currentTarget;
    hoverTimerRef.current = setTimeout(() => {
      if (
        isSortingRef.current ||
        (typeof document !== "undefined" && (document.body.classList.contains("is-dragging-item") || document.body.classList.contains("is-sorting-tabs")))
      ) {
        return;
      }
      const rect = currentTarget.getBoundingClientRect();
      setMenuState({ tab: cat, rect });
    }, 600);
  };

  const handleTabMouseLeave = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }

    closeTimeoutRef.current = setTimeout(() => {
      setMenuState(null);
    }, 250);
  };

  const handleMenuDropdownMouseEnter = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  };

  const handleMenuDropdownMouseLeave = () => {
    closeTimeoutRef.current = setTimeout(() => {
      setMenuState(null);
    }, 200);
  };

  // Touch / Mobile long-press handlers (450ms)
  const handleTouchStart = (cat, e) => {
    if (
      isSortingRef.current ||
      (typeof document !== "undefined" && document.body.classList.contains("is-sorting-tabs")) ||
      e.touches.length !== 1
    ) {
      return;
    }
    const touch = e.touches[0];
    touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };
    isLongPressRef.current = false;
    const targetElement = e.currentTarget;

    if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
    touchTimerRef.current = setTimeout(() => {
      if (
        isSortingRef.current ||
        (typeof document !== "undefined" && document.body.classList.contains("is-sorting-tabs"))
      ) {
        return;
      }
      isLongPressRef.current = true;
      try { navigator.vibrate?.(40); } catch {}
      const rect = targetElement.getBoundingClientRect();
      setMenuState({ tab: cat, rect });
    }, 450);
  };

  const handleTouchMove = (e) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - touchStartPosRef.current.x);
    const dy = Math.abs(touch.clientY - touchStartPosRef.current.y);
    if (dx > 8 || dy > 8) {
      if (touchTimerRef.current) {
        clearTimeout(touchTimerRef.current);
        touchTimerRef.current = null;
      }
    }
  };

  const handleTouchEnd = () => {
    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
  };

  const renderTabItem = (cat, isFixed = false) => {
    const isActive = cat.id === activeTabId;
    const count = itemCounts[cat.id] || 0;
    const isEditingThis = editingTabId === cat.id;

    if (isEditingThis) {
      return (
        <div key={cat.id} className="category-tab-wrapper">
          <form
            className="category-tab-input-form"
            onSubmit={(e) => {
              e.preventDefault();
              handleConfirmEdit();
            }}
          >
            <input
              ref={editInputRef}
              className="category-tab-inline-input"
              value={editingTabName}
              onChange={(e) => setEditingTabName(e.target.value)}
              onBlur={handleConfirmEdit}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditingTabId(null);
              }}
              maxLength={40}
            />
          </form>
        </div>
      );
    }

    return (
      <div
        key={cat.id}
        className={`category-tab-wrapper${isFixed ? " is-fixed" : ""}`}
        data-tab-id={cat.id}
        onMouseEnter={(e) => handleTabMouseEnter(cat, e)}
        onMouseLeave={handleTabMouseLeave}
        onTouchStart={(e) => handleTouchStart(cat, e)}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onContextMenu={(e) => {
          e.preventDefault();
        }}
      >
        <button
          type="button"
          className={`category-tab-btn${isActive ? " active" : ""}`}
          onClick={() => {
            if (
              isSortingRef.current ||
              (typeof document !== "undefined" && document.body.classList.contains("is-sorting-tabs"))
            ) {
              return;
            }
            if (isLongPressRef.current) {
              isLongPressRef.current = false;
              return;
            }
            onSelectTab?.(cat.id);
          }}
          onDoubleClick={(e) => {
            e.preventDefault();
            handleStartEdit(cat);
          }}
        >
          <span className="category-tab-name">{cat.name}</span>
          <span className={`category-tab-notify-badge${count === 0 ? " is-zero" : ""}`}>
            {count > 99 ? "99+" : count}
          </span>
        </button>
      </div>
    );
  };

  return (
    <>
      <div className="category-tabs-container">
        {/* Pinned / Fixed first tab with divider */}
        <div className="category-tab-fixed-area">
          {renderTabItem(firstTab, true)}
          <div className="category-tab-divider" aria-hidden="true" />
        </div>

        {/* Scrollable area for draggable subsequent tabs */}
        <div className="category-tabs-scroll-area" ref={containerRef}>
          <div className="category-tabs-draggable-list" ref={draggableListRef}>
            {otherTabs.map((cat) => renderTabItem(cat, false))}
          </div>

          {/* Add Tab Button / Input */}
          {isAdding ? (
            <form
              className="category-tab-input-form"
              onSubmit={(e) => {
                e.preventDefault();
                handleConfirmAdd();
              }}
            >
              <input
                ref={addInputRef}
                className="category-tab-inline-input"
                placeholder="Tên danh mục..."
                value={newTabName}
                onChange={(e) => setNewTabName(e.target.value)}
                onBlur={handleConfirmAdd}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setIsAdding(false);
                    setNewTabName("");
                  }
                }}
                maxLength={40}
              />
            </form>
          ) : (
            <button
              type="button"
              className="tab-add-btn"
              onClick={handleStartAdd}
              aria-label="Thêm danh mục mới"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Portal Dropdown Menu (Opens on 600ms hover on PC or long-press on mobile) */}
      {mounted && menuState && createPortal(
        <div
          className="tab-portal-dropdown"
          style={{
            position: "fixed",
            top: `${Math.min(window.innerHeight - 100, menuState.rect.bottom + 4)}px`,
            left: `${Math.min(window.innerWidth - 150, Math.max(8, menuState.rect.left))}px`,
            zIndex: 9999,
          }}
          onMouseEnter={handleMenuDropdownMouseEnter}
          onMouseLeave={handleMenuDropdownMouseLeave}
        >
          <button
            type="button"
            className="tab-menu-item"
            onClick={(e) => {
              e.stopPropagation();
              handleStartEdit(menuState.tab);
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              <path d="m15 5 4 4" />
            </svg>
            <span>Đổi tên</span>
          </button>

          {!menuState.tab.isDefault && menuState.tab.id !== "tab-1" && (
            <button
              type="button"
              className="tab-menu-item tab-menu-item-danger"
              onClick={(e) => {
                e.stopPropagation();
                setDeleteConfirmTab(menuState.tab);
                setDeleteNotesChoice("transfer");
                setMenuState(null);
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              </svg>
              <span>Xoá danh mục</span>
            </button>
          )}
        </div>,
        document.body
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmTab && (
        <div className="tab-delete-modal-overlay" onClick={() => setDeleteConfirmTab(null)}>
          <div className="tab-delete-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="tab-delete-title">Xác nhận xoá danh mục</h3>
            <p className="tab-delete-desc">
              Bạn có chắc chắn muốn xoá danh mục <strong>&ldquo;{deleteConfirmTab.name}&rdquo;</strong>?
            </p>

            {(itemCounts[deleteConfirmTab.id] || 0) > 0 ? (
              <div className="tab-delete-options">
                <div className="tab-delete-options-title">
                  Mục này đang có <strong>{itemCounts[deleteConfirmTab.id]} ghi chú</strong>. Hãy chọn cách xử lý:
                </div>

                <label
                  className={`tab-delete-option-label ${deleteNotesChoice === "transfer" ? "selected" : ""}`}
                  onClick={() => setDeleteNotesChoice("transfer")}
                >
                  <input
                    type="radio"
                    name="delete-notes-choice"
                    value="transfer"
                    checked={deleteNotesChoice === "transfer"}
                    onChange={() => setDeleteNotesChoice("transfer")}
                  />
                  <div className="tab-delete-option-content">
                    <span className="tab-delete-option-name">
                      Chuyển ghi chú về mục &ldquo;{firstTab.name}&rdquo;
                    </span>
                    <span className="tab-delete-option-hint">
                      Giữ nguyên dữ liệu, toàn bộ ghi chú sẽ được chuyển sang {firstTab.name}.
                    </span>
                  </div>
                </label>

                <label
                  className={`tab-delete-option-label danger ${deleteNotesChoice === "delete" ? "selected danger" : ""}`}
                  onClick={() => setDeleteNotesChoice("delete")}
                >
                  <input
                    type="radio"
                    name="delete-notes-choice"
                    value="delete"
                    checked={deleteNotesChoice === "delete"}
                    onChange={() => setDeleteNotesChoice("delete")}
                  />
                  <div className="tab-delete-option-content">
                    <span className="tab-delete-option-name tab-text-danger">
                      Xoá tất cả ghi chú trong mục này
                    </span>
                    <span className="tab-delete-option-hint">
                      Xoá vĩnh viễn {itemCounts[deleteConfirmTab.id]} ghi chú và tệp đính kèm liên quan.
                    </span>
                  </div>
                </label>
              </div>
            ) : (
              <p className="tab-delete-empty-note">
                (Danh mục này hiện không có ghi chú nào)
              </p>
            )}

            <div className="tab-delete-actions">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setDeleteConfirmTab(null)}
              >
                Huỷ
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => {
                  const shouldDeleteNotes = deleteNotesChoice === "delete" && (itemCounts[deleteConfirmTab.id] || 0) > 0;
                  onDeleteCategory?.(deleteConfirmTab.id, shouldDeleteNotes);
                  setDeleteConfirmTab(null);
                }}
              >
                {deleteNotesChoice === "delete" && (itemCounts[deleteConfirmTab.id] || 0) > 0
                  ? "Xoá danh mục và toàn bộ ghi chú"
                  : `Xoá và chuyển về ${firstTab.name}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
