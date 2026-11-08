// The handler's access token for this browser tab: kept in memory, and in sessionStorage so a
// reload keeps the sign-in (it clears when the tab closes). Storage can be unavailable
// (private windows, blocked site data), so every access is guarded and the app still works.
const KEY = "undercover.token";
let memory: string | null = null;

export function loadToken(): string | null {
  if (memory) return memory;
  try {
    memory = window.sessionStorage.getItem(KEY);
  } catch {
    memory = null;
  }
  return memory;
}

export function saveToken(token: string | null): void {
  memory = token;
  try {
    if (token) window.sessionStorage.setItem(KEY, token);
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the token lives in memory only.
  }
}
