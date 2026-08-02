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
    { key: 'schema', label: 'Form schema (JSON)', type: 'json', placeholder: '{\n  "fields": [\n    { "name": "email", "type": "text", "label": "Email", "required": true }\n  ],\n  "submit": "usage-event"\n}' },
    { key: 'submit', label: 'Submit target', type: 'text', placeholder: 'usage-event / backend name' },
    { key: 'version', label: 'Version', type: 'text' },
  ],
};

/** Data Source Registry — `datasource`-kind capabilities. A form field or submit
 *  references one by name (governed); the platform resolves it — never a raw URL. */
export const DATASOURCE_STUDIO: StudioConfig = {
  kind: 'datasource',
  title: 'Data Source Registry',
  noun: 'data source',
  bodyFields: [
    { key: 'kind', label: 'Type (sql/api/document/vector)', type: 'text', required: true, placeholder: 'sql' },
    { key: 'description', label: 'Description', type: 'text' },
    { key: 'connector', label: 'Connector', type: 'text', placeholder: 'postgres / scim / s3' },
    { key: 'uri', label: 'URI / table / index', type: 'text' },
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

/** Tool Registry — `tool`-kind capabilities (agent tools). */
export const TOOL_STUDIO: StudioConfig = {
  kind: 'tool',
  title: 'Tool Registry',
  noun: 'tool',
  bodyFields: [
    { key: 'description', label: 'Description', type: 'text', required: true },
    { key: 'inputs', label: 'Inputs (comma separated)', type: 'list' },
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
