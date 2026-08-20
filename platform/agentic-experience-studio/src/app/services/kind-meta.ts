/**
 * One taxonomy for every capability kind — a glyph, a readable label, and a hue —
 * so a page, a component, an experience, a form, etc. are visually distinct
 * wherever they appear (registry lists, designer palettes, usage chips). Import
 * this instead of re-inventing per-kind glyphs in each screen.
 */
export interface KindMeta { readonly glyph: string; readonly label: string; readonly hue: number; }

export const KIND_META: Record<string, KindMeta> = {
  application: { glyph: '▣', label: 'Application', hue: 259 },
  page:        { glyph: '▤', label: 'Page', hue: 222 },
  experience:  { glyph: '✦', label: 'Experience', hue: 286 },
  form:        { glyph: '▦', label: 'Form', hue: 194 },
  workflow:    { glyph: '⇥', label: 'Workflow', hue: 162 },
  component:   { glyph: '⛃', label: 'Component', hue: 28 },
  dashboard:   { glyph: '▧', label: 'Dashboard', hue: 205 },
  decision:    { glyph: '◈', label: 'Decision', hue: 45 },
  tool:        { glyph: '⚙', label: 'Tool', hue: 212 },
  datasource:  { glyph: '⇄', label: 'Data source', hue: 176 },
  validation:  { glyph: '⛨', label: 'Validation', hue: 2 },
  action:      { glyph: '⚡', label: 'Action', hue: 38 },
  skill:       { glyph: '✧', label: 'Skill', hue: 300 },
  prompt:      { glyph: '❝', label: 'Prompt', hue: 322 },
  navigation:  { glyph: '⇱', label: 'Navigation', hue: 232 },
  knowledge:   { glyph: '❖', label: 'Knowledge', hue: 150 },
  memory:      { glyph: '⊙', label: 'Memory', hue: 272 },
  theme:       { glyph: '◐', label: 'Theme', hue: 52 },
  policy:      { glyph: '§', label: 'Policy', hue: 350 },
};

export function kindMeta(kind: string): KindMeta {
  return KIND_META[kind] ?? { glyph: '◇', label: kind, hue: 220 };
}
