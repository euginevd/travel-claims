import { ApiError, BAD_RESPONSE, createApi } from "./api";
import { fakeFetch, MY_SUMMARY, myClaim } from "./testing";

test("sends the token and reads the answer", async () => {
  const fetchFn = fakeFetch({ "GET /api/customer/claims": () => [200, [MY_SUMMARY]] });
  const api = createApi(fetchFn, () => "token-1");
  await expect(api.myClaims()).resolves.toEqual([MY_SUMMARY]);
  expect(fetchFn.calls[0]?.auth).toBe("Bearer token-1");
});

test("signs in on the customers' route, with no token and as JSON", async () => {
  const fetchFn = fakeFetch({
    "POST /api/customer/dev/sign-in": () => [200, { id_token: "t", expires_in: 3600 }],
  });
  const api = createApi(fetchFn, () => null);
  await expect(api.signIn("a@b.example", "pw")).resolves.toBe("t");
  expect(fetchFn.calls[0]).toMatchObject({
    auth: null,
    body: { email: "a@b.example", password: "pw" },
  });
});

test("only ever calls the customers' routes", async () => {
  const fetchFn = fakeFetch({});
  const api = createApi(fetchFn, () => "t");
  await Promise.allSettled([api.myProfile(), api.myPolicies(), api.myClaim("CLM/1")]);
  expect(fetchFn.calls.map((c) => c.path)).toEqual([
    "/api/customer/profile",
    "/api/customer/policies",
    "/api/customer/claims/CLM%2F1",
  ]);
});

test("turns the api's detail into the error message", async () => {
  const fetchFn = fakeFetch({
    "GET /api/customer/claims/CLM-1": () => [404, { detail: "Claim CLM-1 not found" }],
  });
  const api = createApi(fetchFn, () => "t");
  await expect(api.myClaim("CLM-1")).rejects.toThrow("Claim CLM-1 not found");
});

test("falls back to a plain message when the error isn't JSON", async () => {
  const fetchFn = () => Promise.resolve(new Response("oops", { status: 500 }));
  const api = createApi(fetchFn, () => "t");
  await expect(api.myClaims()).rejects.toThrow("Something went wrong");
});

test("an answer of the wrong shape is a plain error, not a crash later", async () => {
  const fetchFn = fakeFetch({ "GET /api/customer/claims/CLM-1": () => [200, { claim_id: 1 }] });
  const api = createApi(fetchFn, () => "t");
  const error = await api.myClaim("CLM-1").catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).status).toBe(BAD_RESPONSE);
});

test("FastAPI's validation messages are joined into the error", async () => {
  const fetchFn = fakeFetch({
    "POST /api/customer/claims": () => [
      422,
      { detail: [{ msg: "Story is too long" }, { msg: "Pick a policy" }] },
    ],
  });
  const api = createApi(fetchFn, () => "t");
  const made = api.makeClaim({ ...myClaim(), policy_id: "POL-1", summary: "x" });
  await expect(made).rejects.toThrow("Story is too long. Pick a policy");
});
