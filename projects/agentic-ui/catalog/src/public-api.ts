/**
 * `@infra-tools/agentic-ui/catalog` — Experience Studio catalog consumption.
 *
 * A secondary entry point (kept out of the primary FESM bundle) that turns
 * governed, Studio-authored capabilities into live registry entries via one
 * provider call. Host-app level: import from a host's `app.config.ts`, never
 * from a federated remote (see ADR on the catalog secondary entry).
 */
export { provideCatalogRuntime, type CatalogRuntimeOptions } from './lib/provide-catalog-runtime';
export {
  CATALOG_CONFIG, CATALOG_AUTH,
  type CatalogRuntimeConfig, type ResolvedCatalogConfig, type CatalogAuth,
} from './lib/catalog-config';

// Sources (exposed so a host can read their `count`/`error` signals or drive them).
export {
  CatalogExperienceSource, CatalogValidationSource, CatalogFormSource, CatalogWorkflowSource,
  CatalogThemeSource, CatalogDataSource, CatalogToolSource, CatalogPromptSource,
  CatalogSkillSource, CatalogNavigationSource, CatalogDecisionSource,
} from './lib/content-sources';
export {
  ApplicationSource, flattenNav,
  type ApplicationDef, type AppMenuEntry, type AppAssistant,
  type NavEntry, type FlatNavEntry, type SurfaceTarget, type SurfaceKind,
} from './lib/application-source';
export { PageSource, type PageDef, type PageType, type PageLayout } from './lib/page-source';

// Shell mode: the root shell, render hosts, and master-page widgets.
export { CatalogShellComponent } from './lib/shell/catalog-shell.component';
export { shellWidgets, SHELL_COMPONENT_NAMES } from './lib/shell/shell-widgets';
export { CatalogPageHostComponent } from './lib/render/page-host.component';
export { CatalogSurfaceHostComponent } from './lib/render/surface-host.component';
export { CatalogExperienceHostComponent } from './lib/render/experience-host.component';

// Registries + client (shell mode / advanced hosts).
export { CatalogClient, capabilityMutationMatches, type CatalogMutation } from './lib/catalog-client';
export {
  CatalogComponentSource, CATALOG_REMOTE_LOADER,
  type ComponentResolution, type CatalogRemoteLoader,
} from './lib/component-source';
export { ValidationRuleRegistry } from './lib/validation-rule-registry';
export { DecisionRegistry, type DecisionEntry } from './lib/decision-registry';

// Pure compilers/helpers (unit-testable; reusable by advanced hosts).
export {
  fieldsToZod, fieldsToUi, resolveActions,
  type CatalogFormField, type CatalogFieldValidation, type FieldValidator,
} from './lib/catalog-form-compile';
export { compileRule } from './lib/validation-compile';
export {
  evaluateDecision, cellMatches,
  type DecisionTable, type DecisionRule, type DecisionField, type DecisionResult,
  type DecisionOp, type HitPolicy, type DecisionType,
} from './lib/decision-eval';
export {
  interpolateSecrets, resolveHeaders, fillTemplate, fillDeep, joinUrl, buildHttpAdapter,
  type HttpConfig, type HttpQuery,
} from './lib/catalog-http';
