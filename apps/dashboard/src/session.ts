import { createTokenStore } from "@undercover/web-core/session";

// The signed-in handler's ID token for this browser tab.
export const { loadToken, saveToken } = createTokenStore("undercover.staff.token");
