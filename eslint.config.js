import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import prettierConfig from 'eslint-config-prettier/flat'
import globals from 'globals'

// Performance note: we deliberately use `eslint-config-prettier` (turns off
// conflicting stylistic rules) instead of `eslint-plugin-prettier` (runs
// Prettier as an ESLint rule). The plugin approach roughly doubles lint time
// on large repos because Prettier has to re-parse every file. Prettier is
// run separately via `npm run format:check`. See
// https://prettier.io/docs/integrating-with-linters and
// https://typescript-eslint.io/troubleshooting/typed-linting/performance/

export default [
  {
    ignores: [
      'out/**',
      'dist/**',
      'node_modules/**',
      '**/*.d.ts',
      'docs/**',
      'tests/e2e/**',
      'e2e-*.mjs',
      '.planning/**',
      // Third-party bundles shipped directly to the renderer's public
      // folder — not authored in this repo, never meant to be linted.
      'src/renderer/public/**'
    ]
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  prettierConfig,
  {
    // Type-aware linting: only applies to src/**. This is the expensive
    // pipeline (projectService loads the TS program and rules like
    // strict-boolean-expressions request type info per file). Tests and
    // scripts deliberately skip it so they lint in milliseconds, not seconds.
    files: ['src/**/*.{ts,tsx,vue}'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue']
      }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/strict-boolean-expressions': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-empty-object-type': ['error', { allowObjectTypes: 'always' }],
      'vue/multi-word-component-names': 'off'
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx,vue}'],
    languageOptions: {
      globals: {
        ...globals.browser
      }
    }
  },
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node
      }
    }
  },
  {
    files: ['**/*.config.{js,ts}', 'eslint.config.js'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off'
    }
  },
  // Ban renderer -> main process imports
  {
    files: ['src/renderer/**/*.{ts,tsx,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/main/**'],
              message: 'Renderer must not import from main process. Use src/shared/ re-exports.'
            }
          ]
        }
      ]
    }
  },
  // Ban raw window.api access (enforce useApiService) and ad-hoc IPC error checks
  {
    files: ['src/renderer/**/*.{ts,tsx,vue}'],
    ignores: [
      'src/renderer/src/composables/useApiService.ts',
      'src/renderer/src/services/LogService.ts',
      'src/renderer/src/stores/externalLinksStore.ts',
      'src/renderer/src/stores/databaseStore.ts'
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.property.name='api'][object.object.name='window']",
          message: 'Use useApiService() for API access. Direct window.api usage is not allowed.'
        },
        {
          selector: "BinaryExpression[operator='in'][left.value='error'][right.type='Identifier']",
          message:
            "Use isIpcError() from shared/types/errors instead of ad-hoc 'error' in result checks."
        }
      ]
    }
  }
]
