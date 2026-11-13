import { cognitoConfig, SignInChallenge } from "@undercover/web-core/cognito";
import { ApiError, createApi } from "./api";

const CONFIG = { clientId: "client-1", region: "ap-southeast-2" };

function answering(...replies: [number, unknown][]) {
  const targets: string[] = [];
  const fetchFn = (_url: string, init?: RequestInit) => {
    targets.push(new Headers(init?.headers).get("X-Amz-Target")?.split(".")[1] ?? "");
    const [status, body] = replies[targets.length - 1] ?? [500, {}];
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
  return { api: createApi(fetchFn, () => null, CONFIG), fetchFn, targets };
}

test("a password Cognito accepts is the token", async () => {
  const { api } = answering([200, { AuthenticationResult: { IdToken: "id-1" } }]);
  await expect(api.signIn("sam@undercover.example", "pw")).resolves.toBe("id-1");
});

test("a wrong password signs in as the api's 401 would", async () => {
  const { api } = answering([400, { __type: "NotAuthorizedException" }]);
  await expect(api.signIn("a@b.example", "wrong")).rejects.toEqual(
    new ApiError(401, "Sign-in failed."),
  );
});

test("an authenticator code is a step of its own, answered with Cognito's session", async () => {
  const { api, targets } = answering(
    [200, { ChallengeName: "SOFTWARE_TOKEN_MFA", Session: "s-1" }],
    [200, { AuthenticationResult: { IdToken: "id-2" } }],
  );
  const caught: unknown = await api.signIn("sam@undercover.example", "pw").catch((e: unknown) => e);
  expect(caught).toBeInstanceOf(SignInChallenge);
  const { challenge } = caught as SignInChallenge;
  await expect(api.answerChallenge(challenge, "123456")).resolves.toBe("id-2");
  expect(targets).toEqual(["InitiateAuth", "RespondToAuthChallenge"]);
});

test("a code can't be answered when the build signs in locally", async () => {
  const api = createApi(answering().fetchFn, () => null, null);
  await expect(
    api.answerChallenge({ kind: "mfa", label: "a", username: "a", session: "s" }, "123456"),
  ).rejects.toBeInstanceOf(ApiError);
});

test("without a client in the build, sign-in stays local", () => {
  expect(cognitoConfig({ VITE_COGNITO_REGION: "ap-southeast-2" } as ImportMetaEnv)).toBeNull();
  expect(cognitoConfig({} as ImportMetaEnv)).toBeNull();
});
