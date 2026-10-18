// ESLint flat config for the whole repo (server, web, tooling).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { colorsPlugin, i18nPlugin } from './eslint-rules/index.js';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const allowlistPath = path.join(rootDir, 'web/src/i18n/lint-allowlist.json');
const webTestFiles = ['web/src/**/*.test.{ts,tsx}', 'web/src/**/__tests__/**'];

export default defineConfig([
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    'coverage/',
    'playwright-report/',
    'test-results/',
    '.claude/',
    '.codex/',
    'plans/',
    'web/public/',
    'server/test/fixtures/',
    '.transfer/',
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Node-side code: server, scripts, lint rules, configs, e2e (runs in Node, evaluates in a page).
    files: [
      'server/**/*.{ts,js}',
      'scripts/**/*.{ts,js}',
      'eslint-rules/**/*.{ts,js}',
      '*.{js,ts,mjs,cjs}',
      'web/*.{js,ts}',
      'web/e2e/**/*.ts',
    ],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['web/e2e/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['web/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Project rules: all UI text through i18n, all colors through design tokens.
    files: ['web/src/**/*.{ts,tsx}'],
    ignores: webTestFiles,
    plugins: { i18n: i18nPlugin, colors: colorsPlugin },
    rules: {
      'i18n/no-literal-ui-strings': ['error', { allowlistPath, rootDir }],
      'colors/no-raw-color': 'error',
    },
  },
  prettier,
]);
