import { ApiError, createApi } from "./api";
import { cognitoConfig, cognitoSignIn } from "@undercover/web-core/cognito";

const CONFIG = { clientId: "client-1", region: "ap-southeast-2" };

function answering(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit; body: string }[] = [];
  const fetchFn = (url: string, init?: RequestInit) => {
    calls.push({ url, init, body: typeof init?.body === "string" ? init.body : "" });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
  return { fetchFn, calls };
}

test("asks the region's Cognito with the client, email and password", async () => {
  const { fetchFn, calls } = answering(200, { AuthenticationResult: { IdToken: "id-1" } });
  await expect(cognitoSignIn(fetchFn, CONFIG, "a@b.example", "pw")).resolves.toEqual({
    token: "id-1",
  });
  expect(calls[0]?.url).toBe("https://cognito-idp.ap-southeast-2.amazonaws.com/");
  expect(new Headers(calls[0]?.init?.headers).get("X-Amz-Target")).toBe(
    "AWSCognitoIdentityProviderService.InitiateAuth",
  );
  expect(JSON.parse(calls[0]?.body ?? "")).toEqual({
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId: "client-1",
    AuthParameters: { USERNAME: "a@b.example", PASSWORD: "pw" },
  });
});

test("a wrong password signs in as the api's 401 would", async () => {
  const { fetchFn } = answering(400, { __type: "NotAuthorizedException" });
  const api = createApi(fetchFn, () => null, CONFIG);
  await expect(api.signIn("a@b.example", "wrong")).rejects.toEqual(
    new ApiError(401, "Sign-in failed."),
  );
});

test("an account that must change its password says so", async () => {
  const { fetchFn } = answering(200, { ChallengeName: "NEW_PASSWORD_REQUIRED" });
  await expect(cognitoSignIn(fetchFn, CONFIG, "a@b.example", "pw")).resolves.toMatchObject({
    status: 403,
  });
});

test("without a client in the build, sign-in stays local", () => {
  expect(cognitoConfig({ VITE_COGNITO_REGION: "ap-southeast-2" } as ImportMetaEnv)).toBeNull();
  expect(cognitoConfig({} as ImportMetaEnv)).toBeNull();
});

test("a second sign-in step is refused clearly: the customer pool asks for none", async () => {
  const { fetchFn } = answering(200, { ChallengeName: "SOFTWARE_TOKEN_MFA", Session: "s-1" });
  const api = createApi(fetchFn, () => null, CONFIG);
  await expect(api.signIn("a@b.example", "pw")).rejects.toEqual(
    new ApiError(403, "This account needs a sign-in step the portal doesn't offer."),
  );
});
