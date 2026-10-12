import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Arrows, misc symbols and dingbats (check marks, stars), arrow-like symbols, and emoji (UTF-16 high surrogates D83C-D83E).
const SYMBOLS = "[\\u2190-\\u21FF\\u2600-\\u27BF\\u2B00-\\u2BFF\\uD83C-\\uD83E]";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // Arrows, dingbats (check marks etc.) and emoji belong in lucide-react icons, not in text. See CLAUDE.md.
    files: ["**/*.{ts,tsx,mjs}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...["Literal[value=/%s/]", "TemplateElement[value.raw=/%s/]", "JSXText[value=/%s/]"].map((selector) => ({
          selector: selector.replace(/%s/, SYMBOLS),
          message: "Use a lucide-react icon or plain words instead of arrow, symbol or emoji characters (see CLAUDE.md).",
        })),
      ],
    },
  },
]);

export default eslintConfig;
