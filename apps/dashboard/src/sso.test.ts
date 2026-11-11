import {
  authorizeUrl,
  challengeFor,
  finishSignIn,
  randomValue,
  ssoConfig,
  tabStore,
  type SsoStore,
} from "./sso";

const CONFIG = {
  domain: "travel-claims-dev-staff-1.auth.ap-southeast-2.amazoncognito.com",
  clientId: "client-1",
  redirectUri: "https://dashboard.example/",
};
const source = globalThis.crypto;

function memoryStore(): SsoStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

function answering(status: number, body: unknown) {
  const calls: { url: string; body: string }[] = [];
  const fetchFn = (url: string, init?: RequestInit) => {
    calls.push({ url, body: typeof init?.body === "string" ? init.body : "" });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
  return { fetchFn, calls };
}

test("company sign-in is on only when the build names the hosted domain", () => {
  expect(ssoConfig({ VITE_COGNITO_CLIENT_ID: "client-1" } as ImportMetaEnv, "https://a")).toBe(
    null,
  );
  expect(
    ssoConfig(
      { VITE_COGNITO_CLIENT_ID: "client-1", VITE_STAFF_SSO_DOMAIN: CONFIG.domain } as ImportMetaEnv,
      "https://dashboard.example",
    ),
  ).toEqual(CONFIG);
});

test("the challenge is the S256 of the verifier, base64url without padding", async () => {
  // Checked with: printf %s <verifier> | openssl dgst -sha256 -binary | base64 (url-safe, no =).
  await expect(challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r0wW1gFWFOEjXk", source)).resolves.toBe(
    "RCtbqyFn6Dv6GL6UC4xrWL6mHZBJowIOtGzu8O97GYg",
  );
  const value = randomValue(source);
  expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(randomValue(source)).not.toBe(value);
});

test("the hosted page is asked for a code with PKCE, straight to Identity Center", async () => {
  const store = memoryStore();
  const url = new URL(await authorizeUrl(CONFIG, store, source));
  expect(`${url.origin}${url.pathname}`).toBe(`https://${CONFIG.domain}/oauth2/authorize`);
  const query = url.searchParams;
  expect(query.get("response_type")).toBe("code");
  expect(query.get("client_id")).toBe("client-1");
  expect(query.get("redirect_uri")).toBe(CONFIG.redirectUri);
  expect(query.get("identity_provider")).toBe("IdentityCenter");
  expect(query.get("code_challenge_method")).toBe("S256");
  expect(query.get("state")).toBe(store.values.get("undercover.sso.state"));
  const verifier = store.values.get("undercover.sso.verifier") ?? "";
  expect(query.get("code_challenge")).toBe(await challengeFor(verifier, source));
});

async function started() {
  const store = memoryStore();
  const url = new URL(await authorizeUrl(CONFIG, store, source));
  return { store, state: url.searchParams.get("state") ?? "" };
}

test("the code is exchanged with the verifier for the ID token, once", async () => {
  const { store, state } = await started();
  const verifier = store.values.get("undercover.sso.verifier");
  const { fetchFn, calls } = answering(200, { id_token: "id-1", access_token: "a" });
  await expect(finishSignIn(fetchFn, CONFIG, `?code=c-1&state=${state}`, store)).resolves.toEqual({
    token: "id-1",
  });
  expect(calls[0]?.url).toBe(`https://${CONFIG.domain}/oauth2/token`);
  const sent = new URLSearchParams(calls[0]?.body);
  expect(Object.fromEntries(sent)).toEqual({
    grant_type: "authorization_code",
    client_id: "client-1",
    code: "c-1",
    redirect_uri: CONFIG.redirectUri,
    code_verifier: verifier,
  });
  expect(store.values.size).toBe(0);
});

test("a return with another state is refused without asking for a token", async () => {
  const { store } = await started();
  const { fetchFn, calls } = answering(200, { id_token: "id-1" });
  await expect(finishSignIn(fetchFn, CONFIG, "?code=c-1&state=forged", store)).resolves.toEqual({
    status: 401,
    message: "That sign-in didn't start on this page. Try again.",
  });
  expect(calls).toEqual([]);
});

test("a cancelled sign-in, a refused code and a down endpoint each say so", async () => {
  const cancelled = await started();
  await expect(
    finishSignIn(answering(200, {}).fetchFn, CONFIG, "?error=access_denied", cancelled.store),
  ).resolves.toEqual({ status: 401, message: "Company sign-in was cancelled or refused." });

  const refused = await started();
  const search = `?code=c&state=${refused.state}`;
  await expect(
    finishSignIn(answering(400, { error: "invalid_grant" }).fetchFn, CONFIG, search, refused.store),
  ).resolves.toEqual({ status: 401, message: "Company sign-in failed." });

  const down = await started();
  await expect(
    finishSignIn(answering(502, null).fetchFn, CONFIG, `?code=c&state=${down.state}`, down.store),
  ).resolves.toEqual({ status: 503, message: "Sign-in isn't answering. Try again shortly." });
});

test("an ordinary address isn't a return from the hosted page", async () => {
  await expect(
    finishSignIn(answering(200, {}).fetchFn, CONFIG, "?q=1", memoryStore()),
  ).resolves.toBe(null);
});

test("the tab's store falls back to memory when storage is blocked", () => {
  expect(tabStore()).toBe(window.sessionStorage);
  const spy = vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
    throw new Error("blocked");
  });
  const store = tabStore();
  store.setItem("k", "v");
  expect(store.getItem("k")).toBe("v");
  store.removeItem("k");
  expect(store.getItem("k")).toBe(null);
  spy.mockRestore();
});
