// Single-key shortcuts (S, B, U, J, K and /) can be turned off, for anyone using speech input or
// who presses keys by accident (WCAG 2.1.4). The choice is kept in this browser only.
const KEY = "undercover.dashboard.shortcuts";

// The choice in this page; storage only keeps it for the next visit.
let on: boolean | null = null;

/** Whether single-key shortcuts are on: they are, unless turned off in this browser. */
export function shortcutsOn(): boolean {
  if (on === null) {
    try {
      on = window.localStorage.getItem(KEY) !== "off";
    } catch {
      on = true;
    }
  }
  return on;
}

/** Turns single-key shortcuts on or off; kept in this browser when storage allows. */
export function setShortcutsOn(value: boolean): void {
  on = value;
  try {
    if (value) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, "off");
  } catch {
    // Storage blocked: the choice lasts until the page reloads.
  }
}
