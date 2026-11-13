// A signed-in person's ID token for this browser tab: kept in memory, and in sessionStorage so a
// reload keeps the sign-in (it clears when the tab closes). Storage can be unavailable (private
// windows, blocked site data), so every access is guarded and the app still works.
export interface TokenStore {
  loadToken: () => string | null;
  saveToken: (value: string | null) => void;
}

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

/** One store per audience, each under its own storage key. */
export function createTokenStore(key: string): TokenStore {
  let token: string | null = null;
  return {
    loadToken: () => {
      token ??= read(key);
      return token;
    },
    saveToken: (value) => {
      token = value;
      write(key, value);
    },
  };
}
