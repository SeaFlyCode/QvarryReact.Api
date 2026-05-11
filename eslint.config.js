const tseslint = require("@typescript-eslint/eslint-plugin");
const tsparser = require("@typescript-eslint/parser");
const prettierConfig = require("eslint-config-prettier");

module.exports = [
  // Global ignores
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "scripts/**",
      "logs/**",
      "*.js",
      "!eslint.config.js",
    ],
  },

  // TypeScript source files
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: "module",
        project: "./tsconfig.json",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      // TypeScript recommended rules
      ...tseslint.configs.recommended.rules,

      // Errors
      "no-console": "off",
      "no-debugger": "error",
      "no-duplicate-imports": "error",
      "no-unused-expressions": "off",

      // TypeScript specific
      // NOTE (audit Phase E §5.3) : tentative de passage en `error` a remonté
      // 684 violations (~660 `no-explicit-any` + 24 `no-unused-vars`). Hors
      // scope ROI haut — un chantier dédié est nécessaire pour les
      // remplacer par `unknown` / types précis avant de monter la sévérité.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/no-empty-function": "warn",
      "@typescript-eslint/no-empty-interface": "off",
      "@typescript-eslint/ban-ts-comment": "warn",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-var-requires": "off",
      "@typescript-eslint/no-unused-expressions": "warn",
      "@typescript-eslint/no-empty-object-type": "off",

      // General best practices
      "prefer-const": "warn",
      "no-var": "error",
      eqeqeq: ["error", "always"],
      curly: ["warn", "multi-line"],
      "no-throw-literal": "error",
      "no-return-await": "warn",
    },
  },

  // Prettier compat (disable formatting rules)
  prettierConfig,
];
