// On AWS with company sign-in: IAM Identity Center through the pool's hosted page, by the
// authorization code flow with PKCE (the client has no secret), ending with the same ID token
// the email-and-password sign-in gives.
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface SsoConfig {
  readonly domain: string;
  readonly clientId: string;
  readonly redirectUri: string;
}

// Where the verifier and state wait while the person is at the hosted page: this tab only.
export interface SsoStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type SsoResult = { token: string } | { status: number; message: string };

export const PROVIDER = "IdentityCenter";
const VERIFIER_KEY = "undercover.sso.verifier";
const STATE_KEY = "undercover.sso.state";

export function ssoConfig(
  env: ImportMetaEnv = import.meta.env,
  origin: string = window.location.origin,
): SsoConfig | null {
  const domain = env.VITE_STAFF_SSO_DOMAIN;
  const clientId = env.VITE_COGNITO_CLIENT_ID;
  return domain && clientId ? { domain, clientId, redirectUri: `${origin}/` } : null;
}

function base64url(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// 32 random bytes: a PKCE verifier (43 characters) or a state value.
export function randomValue(source: Crypto = crypto): string {
  const bytes = new Uint8Array(32);
  source.getRandomValues(bytes);
  return base64url(bytes);
}

// PKCE's S256 challenge: the verifier's SHA-256, base64url without padding.
export async function challengeFor(verifier: string, source: Crypto = crypto): Promise<string> {
  const digest = await source.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

// The hosted page's address, straight to Identity Center; the verifier and state are kept.
export async function authorizeUrl(
  config: SsoConfig,
  store: SsoStore,
  source: Crypto = crypto,
): Promise<string> {
  const verifier = randomValue(source);
  const state = randomValue(source);
  store.setItem(VERIFIER_KEY, verifier);
  store.setItem(STATE_KEY, state);
  const query = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: "openid email profile",
    identity_provider: PROVIDER,
    state,
    code_challenge: await challengeFor(verifier, source),
    code_challenge_method: "S256",
  });
  return `https://${config.domain}/oauth2/authorize?${query.toString()}`;
}

// Back from the hosted page: the code exchanged for the ID token, or why not. Null when the
// address isn't a return from it. The verifier and state are used once.
export async function finishSignIn(
  fetchFn: Fetch,
  config: SsoConfig,
  search: string,
  store: SsoStore,
): Promise<SsoResult | null> {
  const params = new URLSearchParams(search);
  const code = params.get("code");
  if (!code && !params.get("error")) return null;
  const verifier = store.getItem(VERIFIER_KEY);
  const expected = store.getItem(STATE_KEY);
  store.removeItem(VERIFIER_KEY);
  store.removeItem(STATE_KEY);
  if (!code) return { status: 401, message: "Company sign-in was cancelled or refused." };
  if (!verifier || !expected || params.get("state") !== expected) {
    return { status: 401, message: "That sign-in didn't start on this page. Try again." };
  }
  const response = await fetchFn(`https://${config.domain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.clientId,
      code,
      redirect_uri: config.redirectUri,
      code_verifier: verifier,
    }).toString(),
  });
  const answer = (await response.json().catch(() => null)) as { id_token?: unknown } | null;
  const token = answer?.id_token;
  if (response.ok && typeof token === "string") return { token };
  return response.status >= 500
    ? { status: 503, message: "Sign-in isn't answering. Try again shortly." }
    : { status: 401, message: "Company sign-in failed." };
}

// The tab's sessionStorage, or memory when storage is blocked (the sign-in then can't survive
// the trip to the hosted page, so it fails closed with a clear message).
export function tabStore(): SsoStore {
  const memory = new Map<string, string>();
  try {
    const storage = window.sessionStorage;
    storage.getItem(STATE_KEY);
    return storage;
  } catch {
    return {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => {
        memory.set(key, value);
      },
      removeItem: (key) => {
        memory.delete(key);
      },
    };
  }
}
