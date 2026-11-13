import {
  cognitoAnswer,
  cognitoConfig,
  cognitoSignIn,
  SignInChallenge,
  type CognitoChallenge,
} from "@undercover/web-core/cognito";
import { ApiError, createApi } from "./api";

const CONFIG = { clientId: "client-1", region: "ap-southeast-2" };

// Cognito answers each call in turn, and every request is kept to check what was sent.
function answering(...replies: [number, unknown][]) {
  const calls: { target: string; body: Record<string, unknown> }[] = [];
  const fetchFn = (url: string, init?: RequestInit) => {
    expect(url).toBe("https://cognito-idp.ap-southeast-2.amazonaws.com/");
    calls.push({
      target: new Headers(init?.headers).get("X-Amz-Target") ?? "",
      body: JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<
        string,
        unknown
      >,
    });
    const [status, body] = replies[calls.length - 1] ?? [500, {}];
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
  return { fetchFn, calls };
}

const MFA: CognitoChallenge = {
  kind: "mfa",
  label: "dana@undercover.example",
  username: "sub-1",
  session: "s-1",
};

test("asks the region's Cognito with the client, email and password", async () => {
  const { fetchFn, calls } = answering([200, { AuthenticationResult: { IdToken: "id-1" } }]);
  await expect(cognitoSignIn(fetchFn, CONFIG, "a@b.example", "pw")).resolves.toEqual({
    token: "id-1",
  });
  expect(calls[0]).toEqual({
    target: "AWSCognitoIdentityProviderService.InitiateAuth",
    body: {
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: "client-1",
      AuthParameters: { USERNAME: "a@b.example", PASSWORD: "pw" },
    },
  });
});

test("a wrong password signs in as the api's 401 would", async () => {
  const { fetchFn } = answering([400, { __type: "NotAuthorizedException" }]);
  const api = createApi(fetchFn, () => null, CONFIG);
  await expect(api.signIn("a@b.example", "wrong")).rejects.toEqual(
    new ApiError(401, "Sign-in failed."),
  );
});

test("Cognito being down says to try again shortly", async () => {
  const { fetchFn } = answering([503, {}]);
  await expect(cognitoSignIn(fetchFn, CONFIG, "a@b.example", "pw")).resolves.toEqual({
    status: 503,
    message: "Sign-in isn't answering. Try again shortly.",
  });
});

test("an account that must change its password says so", async () => {
  const { fetchFn } = answering([200, { ChallengeName: "NEW_PASSWORD_REQUIRED", Session: "s" }]);
  await expect(cognitoSignIn(fetchFn, CONFIG, "a@b.example", "pw")).resolves.toEqual({
    status: 403,
    message: "This account needs a new password: ask an admin to set one.",
  });
});

test("a step the page doesn't offer is a clear error, not a password prompt", async () => {
  const { fetchFn } = answering([200, { ChallengeName: "SMS_MFA", Session: "s" }]);
  const api = createApi(fetchFn, () => null, CONFIG);
  await expect(api.signIn("a@b.example", "pw")).rejects.toEqual(
    new ApiError(
      403,
      "This account needs a sign-in step this page doesn't offer. Ask an admin to check it.",
    ),
  );
});

test("an authenticator code is asked for, then sent with Cognito's session", async () => {
  const { fetchFn, calls } = answering(
    [
      200,
      {
        ChallengeName: "SOFTWARE_TOKEN_MFA",
        Session: "s-1",
        ChallengeParameters: { USER_ID_FOR_SRP: "sub-1" },
      },
    ],
    [200, { AuthenticationResult: { IdToken: "id-2" } }],
  );
  const api = createApi(fetchFn, () => null, CONFIG);
  const caught: unknown = await api
    .signIn("dana@undercover.example", "pw")
    .catch((e: unknown) => e);
  expect(caught).toBeInstanceOf(SignInChallenge);
  const { challenge } = caught as SignInChallenge;
  expect(challenge).toEqual(MFA);
  await expect(api.answerChallenge(challenge, " 123456 ")).resolves.toBe("id-2");
  expect(calls[1]).toEqual({
    target: "AWSCognitoIdentityProviderService.RespondToAuthChallenge",
    body: {
      ChallengeName: "SOFTWARE_TOKEN_MFA",
      ClientId: "client-1",
      Session: "s-1",
      ChallengeResponses: { USERNAME: "sub-1", SOFTWARE_TOKEN_MFA_CODE: "123456" },
    },
  });
});

test("a wrong code says so, and an expired session says to start again", async () => {
  const wrong = answering([400, { __type: "CodeMismatchException" }]);
  await expect(cognitoAnswer(wrong.fetchFn, CONFIG, MFA, "000000")).resolves.toMatchObject({
    status: 400,
    message: expect.stringContaining("doesn't match") as unknown,
  });
  const expired = answering([400, { __type: "NotAuthorizedException" }]);
  await expect(cognitoAnswer(expired.fetchFn, CONFIG, MFA, "123456")).resolves.toMatchObject({
    message: "That sign-in has expired. Start again with your email and password.",
  });
});

test("first sign-in with MFA required adds an authenticator app, then signs in", async () => {
  const { fetchFn, calls } = answering(
    [200, { ChallengeName: "MFA_SETUP", Session: "s-1" }],
    [200, { SecretCode: "ABC234", Session: "s-2" }],
    [200, { Status: "SUCCESS", Session: "s-3" }],
    [200, { AuthenticationResult: { IdToken: "id-3" } }],
  );
  const started = await cognitoSignIn(fetchFn, CONFIG, "dana@undercover.example", "pw");
  expect(started).toEqual({
    challenge: {
      kind: "mfa-setup",
      label: "dana@undercover.example",
      username: "dana@undercover.example",
      session: "s-2",
      secret: "ABC234",
      uri: "otpauth://totp/UnderCover%3Adana%40undercover.example?secret=ABC234&issuer=UnderCover",
    },
  });
  if (!("challenge" in started)) throw new Error("expected a challenge");
  await expect(cognitoAnswer(fetchFn, CONFIG, started.challenge, "654321")).resolves.toEqual({
    token: "id-3",
  });
  expect(calls.map((call) => call.target.split(".")[1])).toEqual([
    "InitiateAuth",
    "AssociateSoftwareToken",
    "VerifySoftwareToken",
    "RespondToAuthChallenge",
  ]);
  expect(calls[1]?.body).toEqual({ Session: "s-1" });
  expect(calls[2]?.body).toEqual({
    Session: "s-2",
    UserCode: "654321",
    FriendlyDeviceName: "UnderCover",
  });
  expect(calls[3]?.body).toEqual({
    ChallengeName: "MFA_SETUP",
    ClientId: "client-1",
    Session: "s-3",
    ChallengeResponses: { USERNAME: "dana@undercover.example" },
  });
});

test("a setup code Cognito doesn't accept is a wrong code", async () => {
  const setup: CognitoChallenge = {
    ...MFA,
    kind: "mfa-setup",
    secret: "ABC234",
    uri: "otpauth://totp/x",
  };
  const unverified = answering([200, { Status: "ERROR" }]);
  await expect(cognitoAnswer(unverified.fetchFn, CONFIG, setup, "1")).resolves.toMatchObject({
    status: 400,
  });
  const refused = answering([400, { __type: "EnableSoftwareTokenMFAException" }]);
  await expect(cognitoAnswer(refused.fetchFn, CONFIG, setup, "1")).resolves.toMatchObject({
    status: 400,
  });
  const noSession = answering([200, { Status: "SUCCESS" }]);
  await expect(cognitoAnswer(noSession.fetchFn, CONFIG, setup, "1")).resolves.toMatchObject({
    message: expect.stringContaining("expired") as unknown,
  });
});

test("adding the app fails closed when Cognito doesn't give a secret", async () => {
  const { fetchFn } = answering([200, { ChallengeName: "MFA_SETUP", Session: "s-1" }], [200, {}]);
  await expect(cognitoSignIn(fetchFn, CONFIG, "a@b.example", "pw")).resolves.toMatchObject({
    status: 401,
  });
});

test("a code can't be answered when the build signs in locally", async () => {
  const api = createApi(answering().fetchFn, () => null, null);
  await expect(api.answerChallenge(MFA, "123456")).rejects.toBeInstanceOf(ApiError);
});

test("without a client in the build, sign-in stays local", () => {
  expect(cognitoConfig({ VITE_COGNITO_REGION: "ap-southeast-2" } as ImportMetaEnv)).toBeNull();
  expect(cognitoConfig({} as ImportMetaEnv)).toBeNull();
  expect(
    cognitoConfig({
      VITE_COGNITO_REGION: "ap-southeast-2",
      VITE_COGNITO_CLIENT_ID: "c",
    } as ImportMetaEnv),
  ).toEqual({ clientId: "c", region: "ap-southeast-2" });
});
