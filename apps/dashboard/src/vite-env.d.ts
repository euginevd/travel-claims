/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" in a local image, whose sign-in page offers the seeded handlers. */
  readonly VITE_LOCAL_SIGN_IN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
