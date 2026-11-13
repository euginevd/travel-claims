import { createTokenStore } from "@undercover/web-core/session";

// The signed-in customer's ID token for this browser tab.
export const { loadToken, saveToken } = createTokenStore("undercover.customer.token");
