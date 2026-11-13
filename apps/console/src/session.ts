import { createTokenStore } from "@undercover/web-core/session";

// The signed-in AI engineer's ID token for this browser tab.
export const { loadToken, saveToken } = createTokenStore("undercover.engineering.token");
