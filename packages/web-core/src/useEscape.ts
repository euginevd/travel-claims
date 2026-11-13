import { useEffect, type RefObject } from "react";

// Escape closes a panel only while focus is inside it, so a page's own Escape (a menu, a
// dialog) is left alone and two open panels don't both close.
export function useEscape(panel: RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const element = panel.current;
    if (!element) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    element.addEventListener("keydown", onKey);
    return () => {
      element.removeEventListener("keydown", onKey);
    };
  }, [panel, onClose]);
}
