/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** On AWS: the audience's Cognito web client and region; local sign-in when unset. */
  readonly VITE_COGNITO_CLIENT_ID?: string;
  readonly VITE_COGNITO_REGION?: string;
  /** On AWS with company sign-in: the pool's hosted sign-in domain; off when unset. */
  readonly VITE_STAFF_SSO_DOMAIN?: string;
  /** The UnderCover project page; the local one on port 5172 when unset. */
  readonly VITE_PROJECT_URL?: string;
  /** "true" in a local image, whose sign-in page offers the seeded handlers. */
  readonly VITE_LOCAL_SIGN_IN?: string;
  readonly VITE_TEST_SIGN_IN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
