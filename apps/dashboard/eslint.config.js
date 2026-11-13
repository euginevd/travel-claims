import js from "@eslint/js";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    // The shared package is linted with each app that uses it, by this app's rules.
    ignores: [
      "dist",
      "coverage",
      "!node_modules/",
      "node_modules/*",
      "!node_modules/@undercover/",
      "node_modules/@undercover/*",
      "!node_modules/@undercover/web-core/",
    ],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  jsxA11y.flatConfigs.strict,
  reactHooks.configs.flat.recommended,
  {
    languageOptions: {
      globals: globals.browser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: { "@typescript-eslint/no-explicit-any": "error" },
  },
  { files: ["eslint.config.js"], extends: [tseslint.configs.disableTypeChecked] },
);
