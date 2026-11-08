import { ApiError, BAD_RESPONSE, createApi } from "./api";
import { claim, fakeFetch, SUMMARY } from "./testing";

test("sends the token and reads the answer", async () => {
  const fetchFn = fakeFetch({ "GET /api/staff/claims": () => [200, [SUMMARY]] });
  const api = createApi(fetchFn, () => "token-1");
  await expect(api.listClaims()).resolves.toEqual([SUMMARY]);
  expect(fetchFn.calls[0]?.auth).toBe("Bearer token-1");
});

test("sends no token when signed out, and posts JSON", async () => {
  const fetchFn = fakeFetch({
    "POST /api/staff/dev/sign-in": () => [200, { id_token: "t", expires_in: 3600 }],
  });
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
  expect(fetchFn.calls[0]?.path).toBe("/api/staff/claims/CLM%2F1");
});

test("turns the api's detail into the error message", async () => {
  const fetchFn = fakeFetch({
    "POST /api/staff/claims/CLM-1001/sign-off": () => [403, { detail: "Only Dana can sign off." }],
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
    "POST /api/staff/claims/CLM-1001/send-back": () => [200, claim({ status: "in_progress" })],
  });
  await createApi(fetchFn, () => "t").sendBack("CLM-1001", "Check the receipts");
  expect(fetchFn.calls[0]?.body).toEqual({ note: "Check the receipts" });
});

test("an answer of the wrong shape is a plain error, not a crash later", async () => {
  const fetchFn = fakeFetch({ "GET /api/staff/claims/CLM-1001": () => [200, { claim_id: 7 }] });
  const failure = createApi(fetchFn, () => "t").getClaim("CLM-1001");
  await expect(failure).rejects.toMatchObject({ status: BAD_RESPONSE });
  await expect(failure).rejects.toThrow("didn't expect");
});

test("FastAPI's validation messages are joined into the error", async () => {
  const fetchFn = fakeFetch({
    "POST /api/staff/dev/sign-in": () => [
      422,
      { detail: [{ msg: "Bad email" }, { msg: "Too short" }] },
    ],
  });
  await expect(createApi(fetchFn, () => null).signIn("x", "y")).rejects.toThrow(
    "Bad email. Too short",
  );
});
