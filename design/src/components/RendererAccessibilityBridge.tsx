import { useEffect } from "react";

const CLOSE_CONTEXT_MENU_EVENT = "mdm:close-context-menus";
const SCREEN_READER_SIGNAL_EVENT = "mdm:screen-reader-active";

let generatedId = 0;

function isVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return !element.hidden && style.display !== "none" && style.visibility !== "hidden";
}

function focusableElements(root: Element): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
    )
  ).filter((element) => isVisible(element) && element.getAttribute("aria-hidden") !== "true");
}

function textLabel(element: Element): string {
  return (element.querySelector<HTMLElement>(".sidebar-item-label")?.textContent ?? element.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function menuItems(menu: HTMLElement): HTMLButtonElement[] {
  return Array.from(menu.querySelectorAll<HTMLButtonElement>("button.context-menu-item")).filter(
    (item) => !item.disabled && item.getAttribute("aria-disabled") !== "true"
  );
}

/**
 * Keeps the renderer's existing shared surfaces accessible without changing
 * the product state machine or individual feature dialogs in this lane.
 */
export default function RendererAccessibilityBridge() {
  useEffect(() => {
    const trackedDialogs = new Map<Element, HTMLElement | null>();
    const trackedPalettes = new Map<Element, HTMLElement | null>();
    const trackedMenus = new Map<Element, HTMLElement | null>();
    let typeahead = "";
    let typeaheadTimer: number | undefined;

    function activeDialog(): HTMLElement | null {
      const overlays = Array.from(document.querySelectorAll<HTMLElement>(".dialog-overlay")).filter(isVisible);
      return overlays.at(-1)?.querySelector<HTMLElement>(".dialog") ?? null;
    }

    function activePalette(): HTMLElement | null {
      const overlays = Array.from(document.querySelectorAll<HTMLElement>(".palette-overlay")).filter(isVisible);
      return overlays.at(-1)?.querySelector<HTMLElement>(".command-palette") ?? null;
    }

    function activeMenu(): HTMLElement | null {
      const menus = Array.from(document.querySelectorAll<HTMLElement>(".context-menu")).filter(isVisible);
      return menus.at(-1) ?? null;
    }

    function decorateDialog(overlay: HTMLElement) {
      const dialog = overlay.querySelector<HTMLElement>(".dialog");
      if (!dialog) return;

      if (!trackedDialogs.has(overlay)) {
        const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        trackedDialogs.set(overlay, restore);
      }

      const title = dialog.querySelector<HTMLElement>(".dialog-header-title");
      const body = dialog.querySelector<HTMLElement>(".dialog-body");
      if (title && !title.id) title.id = `mdm-dialog-title-${++generatedId}`;
      if (body && !body.id) body.id = `mdm-dialog-body-${++generatedId}`;

      dialog.setAttribute("role", dialog.getAttribute("role") || "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.tabIndex = -1;
      if (title && !dialog.hasAttribute("aria-labelledby")) dialog.setAttribute("aria-labelledby", title.id);
      if (body && !dialog.hasAttribute("aria-describedby")) dialog.setAttribute("aria-describedby", body.id);

      overlay.setAttribute("aria-hidden", "false");
      if (dialog.dataset.mdmInitialFocus !== "true") {
        dialog.dataset.mdmInitialFocus = "true";
        window.requestAnimationFrame(() => {
          if (!dialog.isConnected || !isVisible(dialog)) return;
          const first = focusableElements(dialog)[0] ?? dialog;
          if (!dialog.contains(document.activeElement)) first.focus();
        });
      }
    }

    function decoratePalette(overlay: HTMLElement) {
      const palette = overlay.querySelector<HTMLElement>(".command-palette");
      if (!palette) return;

      if (!trackedPalettes.has(overlay)) {
        const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        trackedPalettes.set(overlay, restore);
      }

      const title = palette.querySelector<HTMLElement>("h2");
      if (title && !title.id) title.id = `mdm-palette-title-${++generatedId}`;
      palette.setAttribute("role", palette.getAttribute("role") || "dialog");
      palette.setAttribute("aria-modal", "true");
      palette.tabIndex = -1;
      if (title) palette.setAttribute("aria-labelledby", title.id);
      overlay.setAttribute("aria-hidden", "false");

      if (palette.dataset.mdmInitialFocus !== "true") {
        palette.dataset.mdmInitialFocus = "true";
        window.requestAnimationFrame(() => {
          if (!palette.isConnected || !isVisible(palette)) return;
          if (!palette.contains(document.activeElement)) (focusableElements(palette)[0] ?? palette).focus();
        });
      }
    }

    function decorateMenu(menu: HTMLElement) {
      if (!trackedMenus.has(menu)) {
        const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        trackedMenus.set(menu, restore);
      }

      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-label", menu.getAttribute("aria-label") || "Context menu");
      menu.tabIndex = -1;

      menu.querySelectorAll<HTMLElement>(".context-menu-item").forEach((item) => {
        item.setAttribute("role", "menuitem");
        item.tabIndex = -1;
        item.setAttribute("aria-disabled", String((item as HTMLButtonElement).disabled));

        const shortcut = item.dataset.shortcut;
        if (shortcut) {
          item.setAttribute("aria-keyshortcuts", shortcut);
          if (!item.querySelector(".context-menu-shortcut")) {
            const shortcutNode = document.createElement("span");
            shortcutNode.className = "context-menu-shortcut";
            shortcutNode.textContent = shortcut;
            shortcutNode.setAttribute("aria-hidden", "true");
            item.append(shortcutNode);
          }
        }
      });
      menu.querySelectorAll<HTMLElement>(".context-menu-separator").forEach((separator) => {
        separator.setAttribute("role", "separator");
      });

      if (menu.dataset.mdmInitialFocus !== "true") {
        menu.dataset.mdmInitialFocus = "true";
        window.requestAnimationFrame(() => {
          if (!menu.isConnected || !isVisible(menu)) return;
          // Row menus own an input-first interaction contract.  Do not replace
          // their local filter focus with the first action button.
          const search = menu.querySelector<HTMLInputElement>('input[type="search"]');
          (search ?? menuItems(menu)[0] ?? menu).focus();
        });
      }
    }

    function decorateSidebar() {
      document.querySelectorAll<HTMLElement>(".sidebar").forEach((sidebar) => {
        sidebar.setAttribute("aria-label", "Download navigation");
        sidebar.querySelectorAll<HTMLElement>("[role='button']").forEach((item) => {
          const label = textLabel(item);
          if (label) item.setAttribute("aria-label", label);
          item.tabIndex = 0;
          if (item.classList.contains("active")) item.setAttribute("aria-current", "page");
          else item.removeAttribute("aria-current");

          const chevron = item.querySelector<HTMLButtonElement>(".sidebar-chevron-btn");
          if (chevron) {
            const expanded = chevron.getAttribute("aria-label") === "Collapse" || chevron.getAttribute("aria-expanded") === "true";
            chevron.setAttribute("aria-label", `${label}: ${expanded ? "Collapse" : "Expand"}`);
            chevron.setAttribute("aria-expanded", String(expanded));
            item.setAttribute("aria-expanded", String(expanded));
            const children = item.parentElement?.querySelector<HTMLElement>(".sidebar-children");
            if (children) {
              if (!children.id) children.id = `mdm-sidebar-group-${++generatedId}`;
              item.setAttribute("aria-controls", children.id);
            }
          }
        });
      });
    }

    function scan() {
      document.querySelectorAll<HTMLElement>(".dialog-overlay").forEach(decorateDialog);
      document.querySelectorAll<HTMLElement>(".palette-overlay").forEach(decoratePalette);
      document.querySelectorAll<HTMLElement>(".context-menu").forEach(decorateMenu);
      decorateSidebar();

      for (const [overlay, restore] of trackedDialogs) {
        if (overlay.isConnected) continue;
        trackedDialogs.delete(overlay);
        if (restore?.isConnected && restore !== document.body) restore.focus();
      }
      for (const [overlay, restore] of trackedPalettes) {
        if (overlay.isConnected) continue;
        trackedPalettes.delete(overlay);
        if (restore?.isConnected && restore !== document.body) restore.focus();
      }
      for (const [menu, restore] of trackedMenus) {
        if (menu.isConnected) continue;
        trackedMenus.delete(menu);
        if (restore?.isConnected && restore !== document.body) restore.focus();
      }
      window.dispatchEvent(new CustomEvent(SCREEN_READER_SIGNAL_EVENT, {
        detail: {
          active: document.documentElement.dataset.screenReaderActive === "true"
            || document.body?.dataset.screenReaderActive === "true",
        },
      }));
    }

    function closeContextMenus() {
      if (!activeMenu()) return;
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    }

    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const menu = target?.closest<HTMLElement>(".context-menu") ?? activeMenu();

      const palette = activePalette();
      if (palette && (target === palette || target?.closest(".command-palette") === palette)) {
        if (event.key === "Tab") {
          const focusables = focusableElements(palette);
          if (focusables.length === 0) {
            event.preventDefault();
            palette.focus();
            return;
          }
          const first = focusables[0];
          const last = focusables.at(-1)!;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
        return;
      }

      if (menu && isVisible(menu) && (target === menu || menu.contains(target))) {
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
        const items = menuItems(menu);
        const currentIndex = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));

        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const delta = event.key === "ArrowDown" ? 1 : -1;
          items[(currentIndex + delta + items.length) % items.length]?.focus();
          return;
        }
        if (event.key === "Home" || event.key === "End") {
          event.preventDefault();
          (event.key === "Home" ? items[0] : items.at(-1))?.focus();
          return;
        }
        if ((event.key === "Enter" || event.key === " ") && document.activeElement instanceof HTMLButtonElement) {
          event.preventDefault();
          document.activeElement.click();
          return;
        }
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          typeahead += event.key.toLocaleLowerCase();
          window.clearTimeout(typeaheadTimer);
          typeaheadTimer = window.setTimeout(() => {
            typeahead = "";
          }, 700);
          const match = items.find((candidate) =>
            candidate.textContent?.replace(/\s+/g, " ").trim().toLocaleLowerCase().startsWith(typeahead)
          );
          match?.focus();
        }
        return;
      }

      const dialog = activeDialog();
      if (dialog && event.key === "Escape" && !dialog.contains(target)) {
        event.preventDefault();
        dialog.querySelector<HTMLButtonElement>(".dialog-close-btn")?.click();
      }
      if (dialog && event.key === "Tab") {
        const focusables = focusableElements(dialog);
        if (focusables.length === 0) {
          event.preventDefault();
          dialog.focus();
          return;
        }
        const first = focusables[0];
        const last = focusables.at(-1)!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    function containModalFocus(event: FocusEvent) {
      const modal = activePalette() ?? activeDialog();
      const target = event.target instanceof Node ? event.target : null;
      if (modal && target && !modal.contains(target)) {
        (focusableElements(modal)[0] ?? modal).focus();
      }
    }

    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("focusin", containModalFocus, true);
    window.addEventListener(CLOSE_CONTEXT_MENU_EVENT, closeContextMenus);
    scan();

    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("focusin", containModalFocus, true);
      window.removeEventListener(CLOSE_CONTEXT_MENU_EVENT, closeContextMenus);
      window.clearTimeout(typeaheadTimer);
    };
  }, []);

  return null;
}
