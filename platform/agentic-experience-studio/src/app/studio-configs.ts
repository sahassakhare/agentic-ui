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
