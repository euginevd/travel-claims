import { ApiError, createApi } from "./api";
import { fakeFetch, SUMMARY } from "./testing";

test("sends the token and reads the answer", async () => {
  const fetchFn = fakeFetch({ "GET /api/claims": () => [200, [SUMMARY]] });
  const api = createApi(fetchFn, () => "token-1");
  await expect(api.listClaims()).resolves.toEqual([SUMMARY]);
  expect(fetchFn.calls[0]?.auth).toBe("Bearer token-1");
});

test("sends no token when signed out, and posts JSON", async () => {
  const fetchFn = fakeFetch({ "POST /api/dev/sign-in": () => [200, { access_token: "t" }] });
  const api = createApi(fetchFn, () => null);
  await expect(api.signIn("a@b.example", "pw")).resolves.toBe("t");
  expect(fetchFn.calls[0]).toMatchObject({
    auth: null,
    body: { email: "a@b.example", password: "pw" },
  });
});

test("escapes the claim id in paths", async () => {
  const fetchFn = fakeFetch({});
  const api = createApi(fetchFn, () => "t");
  await expect(api.getClaim("CLM/1")).rejects.toThrow("Not found");
  expect(fetchFn.calls[0]?.path).toBe("/api/claims/CLM%2F1");
});

test("turns the api's detail into the error message", async () => {
  const fetchFn = fakeFetch({
    "POST /api/claims/CLM-1001/sign-off": () => [403, { detail: "Only Dana can sign off." }],
  });
  const error = await createApi(fetchFn, () => "t")
    .signOff("CLM-1001")
    .catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ status: 403, message: "Only Dana can sign off." });
});

test("falls back to a plain message when the error isn't JSON", async () => {
  const fetchFn = () => Promise.resolve(new Response("Bad gateway", { status: 502 }));
  await expect(createApi(fetchFn, () => "t").me()).rejects.toMatchObject({
    status: 502,
    message: "Something went wrong talking to the server. Please try again.",
  });
});

test("posts a send-back note", async () => {
  const fetchFn = fakeFetch({
    "POST /api/claims/CLM-1001/send-back": () => [200, { ok: true }],
  });
  await createApi(fetchFn, () => "t").sendBack("CLM-1001", "Check the receipts");
  expect(fetchFn.calls[0]?.body).toEqual({ note: "Check the receipts" });
});
