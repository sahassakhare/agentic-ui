import type { StudioConfig } from './pages/capability-studio.component';

/** Prompt Studio — authors `prompt`-kind capabilities (AEP Seam B). */
export const PROMPT_STUDIO: StudioConfig = {
  kind: 'prompt',
  title: 'Prompt Studio',
  noun: 'prompt',
  bodyFields: [
    { key: 'template', label: 'Template', type: 'textarea', required: true, placeholder: 'You are a helpful {{role}}…' },
    { key: 'description', label: 'Description', type: 'text' },
    { key: 'model', label: 'Model hint', type: 'text', placeholder: 'claude-opus-5' },
    { key: 'version', label: 'Version', type: 'text', placeholder: '1.0.0' },
  ],
};

/** Navigation Studio — authors `navigation`-kind capabilities (AEP Seam B). */
export const NAVIGATION_STUDIO: StudioConfig = {
  kind: 'navigation',
  title: 'Navigation Studio',
  noun: 'nav entry',
  bodyFields: [
    { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Documents' },
    { key: 'route', label: 'Route', type: 'text', required: true, placeholder: '/documents' },
    { key: 'icon', label: 'Icon', type: 'text' },
    { key: 'order', label: 'Order', type: 'number' },
    { key: 'parent', label: 'Parent name', type: 'text' },
    { key: 'external', label: 'External link', type: 'checkbox' },
  ],
};

/**
 * Decision Studio — authors a `kind:'decision'` capability: a DMN-style decision
 * table (inputs, outputs, rules, hit policy). Workflows/forms reference it by name
 * for branching/validation. Rich table designer at /decisions/:id/design.
 */
/**
 * Theme Studio — authors a `kind:'theme'` capability: a design-token set (base +
 * dark overrides). The rich editing lives in the Token Designer (/themes/:id/design);
 * this generic studio lists/creates and shows the raw token body.
 */
export const THEME_STUDIO: StudioConfig = {
  kind: 'theme',
  title: 'Themes',
  noun: 'theme',
  bodyFields: [
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'base', label: 'Base tokens (JSON { color, space, radius, font, … })', type: 'json', required: true,
      placeholder: '{ "color": { "brand": "#4f46e5", "surface": "#ffffff", "text": "#131720" } }' },
    { key: 'dark', label: 'Dark overrides (JSON, optional)', type: 'json',
      placeholder: '{ "color": { "surface": "#141924", "text": "#e7ebf3" } }' },
  ],
};

export const DECISION_STUDIO: StudioConfig = {
  kind: 'decision',
  title: 'Decision Tables',
  noun: 'decision',
  bodyFields: [
    { key: 'description', label: 'Description', type: 'text' },
    { key: 'hitPolicy', label: 'Hit policy (first / unique / collect)', type: 'text', placeholder: 'first' },
    { key: 'inputs', label: 'Inputs (JSON [ { name, label } ])', type: 'json', required: true, placeholder: '[ { "name": "priority", "label": "Priority" } ]' },
    { key: 'outputs', label: 'Outputs (JSON [ { name, label } ])', type: 'json', required: true, placeholder: '[ { "name": "route", "label": "Route to" } ]' },
    { key: 'rules', label: 'Rules (JSON [ { when: { input: { op, value } }, then: { output: value } } ])', type: 'json', required: true,
      placeholder: '[ { "when": { "priority": { "op": "==", "value": "high" } }, "then": { "route": "escalate" } } ]' },
  ],
};

/**
 * Page Studio — authors a `kind:'page'` capability. A page has a **type**:
 *  - `content` — a routed leaf page (layout template + regions of surfaces).
 *  - `shell` — a *master page*: shell regions (header/sidenav/aside/footer) of
 *    shell components around the page-content outlet; an Application selects one
 *    as its shell. There is no separate "master" concept — it's a page type.
 * The rich type-aware designer is at /pages/:id/design; these are the raw fields.
 */
export const PAGE_STUDIO: StudioConfig = {
  kind: 'page',
  title: 'Page Studio',
  noun: 'page',
  bodyFields: [
    { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Home' },
    { key: 'type', label: 'Type (content / shell)', type: 'text', placeholder: 'content' },
    { key: 'layout', label: 'Layout — content pages (single/two-column/sidebar-right/sidebar-left/stacked/grid)', type: 'text', placeholder: 'sidebar-right' },
    { key: 'regions', label: 'Regions (JSON { region: [ { kind, name, props? } ] })', type: 'json', required: true,
      placeholder: '{ "main": [ { "kind": "dashboard", "name": "ops-overview" } ] }' },
    { key: 'access', label: 'Access — content pages (JSON { personas, scopes })', type: 'json', placeholder: '{ "personas": ["admin"], "scopes": ["ops:read"] }' },
  ],
};

/**
 * Application Studio — authors a whole end-user product (a `kind:'application'`
 * capability): a title, a navigation route tree binding to Studio-authored
 * Pages, and an agentic assistant. The runtime Experience Hub renders exactly
 * this. The rich route-tree designer is at /applications/:id/design.
 */
export const APPLICATION_STUDIO: StudioConfig = {
  kind: 'application',
  title: 'Application Studio',
  noun: 'application',
  bodyFields: [
    { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Acme Operations Workspace' },
    { key: 'description', label: 'Description', type: 'textarea' },
    {
      key: 'menu', label: 'Menu (JSON array of { id, title, order, icon, target:{ kind, name } })', type: 'json', required: true,
      placeholder: '[ { "id": "overview", "title": "Operations Overview", "order": 10, "target": { "kind": "experience", "name": "ops-overview" } } ]',
    },
    { key: 'assistant', label: 'Assistant (JSON { backend, enabled, greeting })', type: 'json', placeholder: '{ "backend": "ag-ui", "enabled": true }' },
    { key: 'personas', label: 'Personas', type: 'list', placeholder: 'admin, ops-manager, end-user' },
  ],
};

/** Skill Studio — authors `skill`-kind capabilities (AEP Seam B). */
export const SKILL_STUDIO: StudioConfig = {
  kind: 'skill',
  title: 'Skill Studio',
  noun: 'skill',
  bodyFields: [
    { key: 'description', label: 'Description', type: 'text', required: true },
    { key: 'tools', label: 'Tools (whitespace/comma separated)', type: 'list', required: true, placeholder: 'search tag conflictCheck' },
    { key: 'prompt', label: 'Guiding prompt name', type: 'text' },
    { key: 'version', label: 'Version', type: 'text' },
  ],
};

/** Knowledge Studio — authors `knowledge`-kind capabilities (AEP Seam B). */
export const KNOWLEDGE_STUDIO: StudioConfig = {
  kind: 'knowledge',
  title: 'Knowledge Studio',
  noun: 'knowledge source',
  bodyFields: [
    { key: 'kind', label: 'Source type (vector/document/sql/graph/api)', type: 'text', required: true, placeholder: 'vector' },
    { key: 'description', label: 'Description', type: 'text' },
    { key: 'connector', label: 'Connector / DataSource name', type: 'text' },
    { key: 'uri', label: 'URI / index / table', type: 'text' },
  ],
};

/** Component Registry — `component`-kind capabilities (UI widgets; Angular class
 *  stays host-local, the catalog stores the metadata + optional federation ptr). */
export const COMPONENT_STUDIO: StudioConfig = {
  kind: 'component',
  title: 'Component Registry',
  noun: 'component',
  bodyFields: [
    { key: 'description', label: 'Description', type: 'text' },
    { key: 'manifestUrl', label: 'MFE manifest URL (federation)', type: 'text', placeholder: 'https://…/remoteEntry.json' },
    { key: 'exposedModule', label: 'Exposed module', type: 'text', placeholder: './PriorityPicker' },
    { key: 'version', label: 'Version', type: 'text' },
  ],
};

/** Form Registry — `form`-kind capabilities (rendered by <mvk-form-renderer>).
 *  The form is composed declaratively as JSON in `schema`; the same JSON drives
 *  the renderer, an agent's tool-input schema, and cross-registry composition
 *  (a field may `widget`-reference a Component entry). */
export const FORM_STUDIO: StudioConfig = {
  kind: 'form',
  title: 'Form Registry',
  noun: 'form',
  bodyFields: [
    { key: 'description', label: 'Description', type: 'text' },
    { key: 'schema', label: 'Form schema (JSON)', type: 'json', placeholder: '{\n  "fields": [\n    { "name": "email", "type": "text", "label": "Email", "required": true }\n  ],\n  "actions": [\n    { "kind": "submit", "label": "Save" },\n    { "kind": "tool", "label": "Export", "tool": "export-pdf" }\n  ]\n}' },
    { key: 'submit', label: 'Submit target', type: 'text', placeholder: 'usage-event / backend name' },
    { key: 'version', label: 'Version', type: 'text' },
  ],
};

/** Data Source Registry — `datasource`-kind capabilities. Tools and form fields
 *  reference one by name (governed). An `api`/`rest` source with an `endpoint` is
 *  compiled by the Hub's `CatalogDataSource` into a live `fetch`-backed source. */
export const DATASOURCE_STUDIO: StudioConfig = {
  kind: 'datasource',
  title: 'Data Source Registry',
  noun: 'data source',
  bodyFields: [
    { key: 'kind', label: 'Type (api/rest/sql/document/vector)', type: 'text', required: true, placeholder: 'api' },
    { key: 'description', label: 'Description', type: 'text' },
    { key: 'endpoint', label: 'API endpoint URL (for api/rest)', type: 'text', placeholder: 'https://crm.example.com/v1' },
    { key: 'method', label: 'Default method', type: 'text', placeholder: 'GET' },
    { key: 'headers', label: 'Headers (JSON — use ${SECRET} for tokens)', type: 'json', placeholder: '{ "Authorization": "Bearer ${CRM_TOKEN}" }' },
    { key: 'connector', label: 'Connector (non-HTTP: postgres / scim / s3)', type: 'text', placeholder: 'postgres / scim / s3' },
    { key: 'uri', label: 'URI / table / index (non-HTTP)', type: 'text' },
  ],
};

/** Validation Registry — `validation`-kind capabilities. A form field references
 *  one by name (`validators`); inline constraints live in the field schema. */
export const VALIDATION_STUDIO: StudioConfig = {
  kind: 'validation',
  title: 'Validation Registry',
  noun: 'validation rule',
  bodyFields: [
    { key: 'description', label: 'Description', type: 'text', required: true },
    { key: 'rule', label: 'Rule (expression or service ref)', type: 'text', placeholder: 'value != null && value.length <= 500' },
    { key: 'message', label: 'Error message', type: 'text', placeholder: 'Please enter a value' },
    { key: 'async', label: 'Async (calls a service)', type: 'checkbox' },
  ],
};

/** Tool Registry — `tool`-kind capabilities (agent tools). A tool bound to a
 *  `dataSource` is compiled by the Hub's `CatalogToolSource` into an executable
 *  tool: the agent's call args fill `{arg}` placeholders in the path/query/body
 *  and the request goes to the data source's endpoint — no code. */
export const TOOL_STUDIO: StudioConfig = {
  kind: 'tool',
  title: 'Tool Registry',
  noun: 'tool',
  bodyFields: [
    { key: 'description', label: 'Description (shown to the assistant)', type: 'text', required: true },
    { key: 'inputs', label: 'Inputs (comma separated)', type: 'list' },
    { key: 'dataSource', label: 'Data source (name) — makes the tool callable', type: 'text', placeholder: 'crm-api' },
    { key: 'method', label: 'HTTP method', type: 'text', placeholder: 'GET' },
    { key: 'path', label: 'Path template ({arg} refs)', type: 'text', placeholder: '/customers/{id}' },
    { key: 'query', label: 'Query params (JSON — {arg} refs)', type: 'json', placeholder: '{ "q": "{term}" }' },
    { key: 'body', label: 'Request body (JSON — {arg} refs)', type: 'json', placeholder: '{ "name": "{name}" }' },
    { key: 'version', label: 'Version', type: 'text' },
  ],
};

/** Memory Studio — authors `memory`-kind capabilities (AEP Seam B). */
export const MEMORY_STUDIO: StudioConfig = {
  kind: 'memory',
  title: 'Memory Studio',
  noun: 'memory provider',
  bodyFields: [
    { key: 'kind', label: 'Memory class (short-term/long-term/episodic/semantic)', type: 'text', required: true, placeholder: 'long-term' },
    { key: 'scope', label: 'Scope (user/thread/tenant/global)', type: 'text' },
    { key: 'provider', label: 'Provider / adapter name', type: 'text' },
    { key: 'description', label: 'Description', type: 'text' },
  ],
};
