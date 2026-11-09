/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The UnderCover project page; the local one on port 5172 when unset. */
  readonly VITE_PROJECT_URL?: string;
  /** "true" in a local image, whose sign-in page offers the seeded handlers. */
  readonly VITE_LOCAL_SIGN_IN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
