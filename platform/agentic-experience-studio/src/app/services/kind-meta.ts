/**
 * One taxonomy for every capability kind — a Material icon, a fallback glyph, a
 * readable label, and a hue — so a page, a component, an experience, a form, etc.
 * are visually distinct wherever they appear (registry lists, designer palettes,
 * usage chips). Import this instead of re-inventing per-kind icons in each screen.
 * `icon` is a Material Icons ligature (self-hosted font); `glyph` is a unicode
 * fallback for contexts that can't render mat-icon.
 */
export interface KindMeta { readonly icon: string; readonly glyph: string; readonly label: string; readonly hue: number; }

export const KIND_META: Record<string, KindMeta> = {
  application: { icon: 'apps',            glyph: '▣', label: 'Application', hue: 259 },
  page:        { icon: 'article',         glyph: '▤', label: 'Page', hue: 222 },
  experience:  { icon: 'auto_awesome',    glyph: '✦', label: 'Experience', hue: 286 },
  form:        { icon: 'dynamic_form',    glyph: '▦', label: 'Form', hue: 194 },
  workflow:    { icon: 'account_tree',    glyph: '▸', label: 'Workflow', hue: 162 },
  component:   { icon: 'widgets',         glyph: '◫', label: 'Component', hue: 28 },
  dashboard:   { icon: 'dashboard',       glyph: '▧', label: 'Dashboard', hue: 205 },
  decision:    { icon: 'rule',            glyph: '◈', label: 'Decision', hue: 45 },
  tool:        { icon: 'build',           glyph: '⚙', label: 'Tool', hue: 212 },
  datasource:  { icon: 'storage',         glyph: '⇄', label: 'Data source', hue: 176 },
  validation:  { icon: 'fact_check',      glyph: '✓', label: 'Validation', hue: 2 },
  action:      { icon: 'bolt',            glyph: '⚡', label: 'Action', hue: 38 },
  skill:       { icon: 'psychology',      glyph: '✧', label: 'Skill', hue: 300 },
  prompt:      { icon: 'format_quote',    glyph: '❝', label: 'Prompt', hue: 322 },
  navigation:  { icon: 'explore',         glyph: '☰', label: 'Navigation', hue: 232 },
  knowledge:   { icon: 'menu_book',       glyph: '❖', label: 'Knowledge', hue: 150 },
  memory:      { icon: 'memory',          glyph: '⊙', label: 'Memory', hue: 272 },
  theme:       { icon: 'palette',         glyph: '◐', label: 'Theme', hue: 52 },
  policy:      { icon: 'policy',          glyph: '§', label: 'Policy', hue: 350 },
};

export function kindMeta(kind: string): KindMeta {
  return KIND_META[kind] ?? { icon: 'category', glyph: '◇', label: kind, hue: 220 };
}
