// On AWS: sign-in through the audience's Cognito user pool when the build names its client.
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface CognitoConfig {
  readonly clientId: string;
  readonly region: string;
}

/** A step Cognito asks for after the password: a code from an authenticator app, or, the first
 * time, adding the account to one. `label` is the email the person signed in with. */
export type CognitoChallenge =
  | { kind: "mfa"; label: string; username: string; session: string }
  | {
      kind: "mfa-setup";
      label: string;
      username: string;
      session: string;
      secret: string;
      uri: string;
    };

export type CognitoFailure = { status: number; message: string };

export type CognitoResult = { token: string } | { challenge: CognitoChallenge } | CognitoFailure;

interface CognitoAnswer {
  AuthenticationResult?: { IdToken?: unknown };
  ChallengeName?: unknown;
  ChallengeParameters?: { USER_ID_FOR_SRP?: unknown };
  Session?: unknown;
  SecretCode?: unknown;
  Status?: unknown;
  __type?: unknown;
}

// The name authenticator apps show beside the code.
const ISSUER = "UnderCover";

const FAILED: CognitoFailure = { status: 401, message: "Sign-in failed." };
const DOWN: CognitoFailure = {
  status: 503,
  message: "Sign-in isn't answering. Try again shortly.",
};
const EXPIRED: CognitoFailure = {
  status: 401,
  message: "That sign-in has expired. Start again with your email and password.",
};
const WRONG_CODE: CognitoFailure = {
  status: 400,
  message: "That code doesn't match. Enter the newest 6-digit code from your authenticator app.",
};

export function cognitoConfig(env: ImportMetaEnv): CognitoConfig | null {
  const clientId = env.VITE_COGNITO_CLIENT_ID;
  const region = env.VITE_COGNITO_REGION;
  return clientId && region ? { clientId, region } : null;
}

async function send(
  fetchFn: Fetch,
  config: CognitoConfig,
  action: string,
  body: object,
): Promise<{ response: Response; answer: CognitoAnswer | null }> {
  const response = await fetchFn(`https://cognito-idp.${config.region}.amazonaws.com/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": `AWSCognitoIdentityProviderService.${action}`,
    },
    body: JSON.stringify(body),
  });
  const answer = (await response.json().catch(() => null)) as CognitoAnswer | null;
  return { response, answer };
}

// After the password, a failed step is a wrong code or an expired session, not a wrong password.
function failure(response: Response, answer: CognitoAnswer | null, step: boolean): CognitoFailure {
  if (response.status >= 500) return DOWN;
  const type = typeof answer?.__type === "string" ? answer.__type : "";
  if (type.endsWith("CodeMismatchException") || type.endsWith("EnableSoftwareTokenMFAException")) {
    return WRONG_CODE;
  }
  if (step && (type.endsWith("NotAuthorizedException") || type.endsWith("ExpiredCodeException"))) {
    return EXPIRED;
  }
  return FAILED;
}

// What an InitiateAuth or RespondToAuthChallenge answer means: a token, the next step, or why not.
async function outcome(
  fetchFn: Fetch,
  config: CognitoConfig,
  label: string,
  sent: { response: Response; answer: CognitoAnswer | null },
  step: boolean,
): Promise<CognitoResult> {
  const { response, answer } = sent;
  if (!response.ok) return failure(response, answer, step);
  const token = answer?.AuthenticationResult?.IdToken;
  if (typeof token === "string") return { token };
  const name = answer?.ChallengeName;
  const session = answer?.Session;
  const srpUser = answer?.ChallengeParameters?.USER_ID_FOR_SRP;
  const username = typeof srpUser === "string" ? srpUser : label;
  if (name === "NEW_PASSWORD_REQUIRED") {
    return { status: 403, message: "This account needs a new password: ask an admin to set one." };
  }
  if (typeof session === "string" && name === "SOFTWARE_TOKEN_MFA") {
    return { challenge: { kind: "mfa", label, username, session } };
  }
  if (typeof session === "string" && name === "MFA_SETUP") {
    const added = await send(fetchFn, config, "AssociateSoftwareToken", { Session: session });
    const secret = added.answer?.SecretCode;
    const next = added.answer?.Session;
    if (!added.response.ok || typeof secret !== "string" || typeof next !== "string") {
      return failure(added.response, added.answer, true);
    }
    const account = encodeURIComponent(`${ISSUER}:${label}`);
    const uri = `otpauth://totp/${account}?secret=${secret}&issuer=${ISSUER}`;
    return { challenge: { kind: "mfa-setup", label, username, session: next, secret, uri } };
  }
  return {
    status: 403,
    message: "This account needs a sign-in step this page doesn't offer. Ask an admin to check it.",
  };
}

// Cognito's own API: email and password over TLS, answered with the ID token the api checks or
// the step it needs next.
export async function cognitoSignIn(
  fetchFn: Fetch,
  config: CognitoConfig,
  email: string,
  password: string,
): Promise<CognitoResult> {
  const sent = await send(fetchFn, config, "InitiateAuth", {
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId: config.clientId,
    AuthParameters: { USERNAME: email, PASSWORD: password },
  });
  return outcome(fetchFn, config, email, sent, false);
}

// The authenticator app's 6-digit code for a challenge: checked, then traded for the ID token.
export async function cognitoAnswer(
  fetchFn: Fetch,
  config: CognitoConfig,
  challenge: CognitoChallenge,
  code: string,
): Promise<CognitoResult> {
  const { label, username } = challenge;
  if (challenge.kind === "mfa") {
    const sent = await send(fetchFn, config, "RespondToAuthChallenge", {
      ChallengeName: "SOFTWARE_TOKEN_MFA",
      ClientId: config.clientId,
      Session: challenge.session,
      ChallengeResponses: { USERNAME: username, SOFTWARE_TOKEN_MFA_CODE: code.trim() },
    });
    return outcome(fetchFn, config, label, sent, true);
  }
  const verified = await send(fetchFn, config, "VerifySoftwareToken", {
    Session: challenge.session,
    UserCode: code.trim(),
    FriendlyDeviceName: ISSUER,
  });
  const session = verified.answer?.Session;
  if (!verified.response.ok || verified.answer?.Status !== "SUCCESS") {
    return verified.response.ok ? WRONG_CODE : failure(verified.response, verified.answer, true);
  }
  if (typeof session !== "string") return EXPIRED;
  const sent = await send(fetchFn, config, "RespondToAuthChallenge", {
    ChallengeName: "MFA_SETUP",
    ClientId: config.clientId,
    Session: session,
    ChallengeResponses: { USERNAME: username },
  });
  return outcome(fetchFn, config, label, sent, true);
}

/** Thrown by an api's signIn when Cognito wants a code before it gives a token. */
export class SignInChallenge extends Error {
  readonly challenge: CognitoChallenge;

  constructor(challenge: CognitoChallenge) {
    super("Sign-in needs a code from an authenticator app.");
    this.name = "SignInChallenge";
    this.challenge = challenge;
  }
}
