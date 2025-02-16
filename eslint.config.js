import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
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
