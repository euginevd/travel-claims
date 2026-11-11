// Tier 2: sign-in through the audience's Cognito user pool when the build names its client.
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface CognitoConfig {
  readonly clientId: string;
  readonly region: string;
}

export type CognitoResult = { token: string } | { status: number; message: string };

export function cognitoConfig(env: ImportMetaEnv = import.meta.env): CognitoConfig | null {
  const clientId = env.VITE_COGNITO_CLIENT_ID;
  const region = env.VITE_COGNITO_REGION;
  return clientId && region ? { clientId, region } : null;
}

// Cognito's own API: email and password over TLS, answered with the ID token the api checks.
export async function cognitoSignIn(
  fetchFn: Fetch,
  config: CognitoConfig,
  email: string,
  password: string,
): Promise<CognitoResult> {
  const response = await fetchFn(`https://cognito-idp.${config.region}.amazonaws.com/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
    },
    body: JSON.stringify({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: config.clientId,
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }),
  });
  const answer = (await response.json().catch(() => null)) as {
    AuthenticationResult?: { IdToken?: unknown };
    ChallengeName?: unknown;
  } | null;
  const token = answer?.AuthenticationResult?.IdToken;
  if (response.ok && typeof token === "string") return { token };
  if (response.ok && answer?.ChallengeName) {
    return { status: 403, message: "This account needs a new password: ask an admin to set one." };
  }
  return response.status >= 500
    ? { status: 503, message: "Sign-in isn't answering. Try again shortly." }
    : { status: 401, message: "Sign-in failed." };
}
