const js = require('@eslint/js');
const globals = require('globals');
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  {
    // Base ESLint configuration
    ...js.configs.recommended,
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  // TypeScript configuration
  ...tseslint.configs.recommended,
  {
    // Project-specific configuration
    files: ['**/*.ts'],
    ignores: ['dist/**', 'node_modules/**'],
    rules: {
      // Add any custom rules here
    }
  }
);
