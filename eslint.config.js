// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-types/**',
      '**/coverage/**',
      '**/dev-dist/**',
      '**/test-results/**',
      '**/playwright-report/**',
      '**/*.config.js',
      '**/*.config.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'smart'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // The DSP and DJ packages must stay runnable in Node, so they may not reach
    // for anything the browser happens to provide.
    files: ['packages/dsp/**/*.ts', 'packages/dj/**/*.ts', 'packages/core/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'This package must run in Node and in workers.' },
        { name: 'document', message: 'This package must run in Node and in workers.' },
      ],
    },
  },
  {
    // Build scripts are Node programs. They are not shipped to the browser, and
    // printing what they did is the point of running them.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
    rules: { 'no-console': 'off' },
  },
  prettier,
);
