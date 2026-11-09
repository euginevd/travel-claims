import { ApiError, createApi } from "./api";
import { fakeFetch, PRIYA } from "./testing";

test("talks only to the engineering routes, with the token", async () => {
  const fetchFn = fakeFetch({ "GET /api/engineering/me": () => [200, PRIYA] });
  const api = createApi(fetchFn, () => "token-e");
  expect(await api.me()).toEqual(PRIYA);
  expect(fetchFn.calls[0]).toMatchObject({ path: "/api/engineering/me", auth: "Bearer token-e" });
});

test("the test account signs in as the engineer, with no password", async () => {
  const fetchFn = fakeFetch({
    "POST /api/engineering/dev/test-sign-in": () => [200, { id_token: "t", expires_in: 3600 }],
  });
  expect(await createApi(fetchFn, () => null).testSignIn()).toBe("t");
  expect(fetchFn.calls[0]?.body).toEqual({ account: "engineer" });
});

test("turns the api's detail or validation messages into the error", async () => {
  const fetchFn = fakeFetch({
    "GET /api/engineering/runs": () => [409, { detail: "Busy" }],
    "POST /api/engineering/runs": () => [422, { detail: [{ msg: "a" }, { msg: "b" }] }],
  });
  const api = createApi(fetchFn, () => "t");
  await expect(api.listRuns()).rejects.toEqual(new ApiError(409, "Busy"));
  await expect(
    api.startRun({ label_set: "evaluation", size: "tiny", concurrency: 5 }),
  ).rejects.toEqual(new ApiError(422, "a. b"));
});

test("an answer of the wrong shape is a plain error, not a crash later", async () => {
  const fetchFn = fakeFetch({ "GET /api/engineering/me": () => [200, { nope: true }] });
  await expect(createApi(fetchFn, () => "t").me()).rejects.toBeInstanceOf(ApiError);
});
