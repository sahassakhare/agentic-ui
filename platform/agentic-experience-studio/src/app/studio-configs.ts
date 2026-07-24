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
