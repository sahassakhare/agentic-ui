// @ts-check
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

/**
 * ESLint flat config — scoped to the Agentic Experience Studio.
 *
 * Deliberately narrow: it lints the Studio app only (the rest of the monorepo
 * is not yet wired for lint, and enrolling 12 projects at once would bury this
 * branch in triage). Inline component templates are linted via
 * angular-eslint's processor. Run with `npm run lint:studio`.
 */
module.exports = tseslint.config(
  {
    files: ['platform/agentic-experience-studio/**/*.ts'],
    ignores: ['**/*.spec.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': ['error', { type: 'attribute', prefix: 'aes', style: 'camelCase' }],
      '@angular-eslint/component-selector': ['error', { type: 'element', prefix: 'aes', style: 'kebab-case' }],
      // Idiomatic side-effecting ternary/short-circuit (e.g. `on ? add() : del()`).
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
      // `save`/`close` outputs shadow native event names but are intentional here.
      '@angular-eslint/no-output-native': 'off',
    },
  },
  {
    // Applies to .html templates AND (via the processor above) inline templates.
    files: ['platform/agentic-experience-studio/**/*.html'],
    extends: [
      ...angular.configs.templateRecommended,
      ...angular.configs.templateAccessibility,
    ],
    rules: {
      // These a11y rules surface real improvements (label association, keyboard
      // handlers on click targets) but warrant a dedicated a11y pass rather than
      // blocking this branch — warnings for now, not errors.
      '@angular-eslint/template/label-has-associated-control': 'warn',
      '@angular-eslint/template/click-events-have-key-events': 'warn',
      '@angular-eslint/template/interactive-supports-focus': 'warn',
    },
  },
);
