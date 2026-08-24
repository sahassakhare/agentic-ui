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
      // Labels are all associated with a control (or demoted to <span> where
      // they only caption a composite) — enforced.
      '@angular-eslint/template/label-has-associated-control': 'error',
      // The genuinely-interactive click targets (page-designer region/surface,
      // history version row) now carry tabindex + keyboard handlers. The
      // remaining hits are dismiss backdrops/scrims (keyboard = Escape, wired
      // via @HostListener) and listbox options (roving focus via the input) —
      // per-element handlers would be the wrong fix, so these stay warnings.
      '@angular-eslint/template/click-events-have-key-events': 'warn',
      '@angular-eslint/template/interactive-supports-focus': 'warn',
    },
  },
);
