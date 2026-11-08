// The signed-in customer's ID token for this browser tab: kept in memory, and in sessionStorage
// so a reload keeps the sign-in (it clears when the tab closes). Storage can be unavailable
// (private windows, blocked site data), so every access is guarded and the portal still works.
const TOKEN_KEY = "undercover.customer.token";
let token: string | null = null;

function read(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value) window.sessionStorage.setItem(key, value);
    else window.sessionStorage.removeItem(key);
  } catch {
    // Storage blocked: the value lives in memory only.
  }
}

export function loadToken(): string | null {
  token ??= read(TOKEN_KEY);
  return token;
}

export function saveToken(value: string | null): void {
  token = value;
  write(TOKEN_KEY, value);
}
