/**
 * Design-token contract — the single source of truth for the platform's theme
 * vocabulary. A token set is a grouped, DTCG-lite value map (`base` + optional
 * `dark` overrides) that compiles to the CSS custom properties every rendered
 * surface (components, forms, dashboards, layouts, pages, applications) consumes.
 *
 * One contract fixes the historical drift between the Studio (`--text/--border/
 * --danger`) and Hub (`--ink/--line/--bad`) stylesheets: authoring is by token
 * name here, and `tokensToCssVars` maps to the canonical `--*` names.
 */

/** A group of `name → value` tokens (values are raw CSS: hex, px, font stacks…). */
export type TokenGroup = Readonly<Record<string, string>>;

/** All token groups. Keys within a group map to CSS vars via `cssVarName`. */
export interface TokenGroups {
  readonly color?: TokenGroup;     // brand, surface, text, ok, warn, danger, … → --brand, --surface, …
  readonly space?: TokenGroup;     // s1..s8                                     → --s1..--s8
  readonly radius?: TokenGroup;    // sm/md/lg/full                              → --r-sm, --r-md, …
  readonly font?: TokenGroup;      // sans/mono                                  → --font-sans, --font-mono
  readonly fontSize?: TokenGroup;  // xs..2xl                                    → --fs-xs..--fs-2xl
  readonly shadow?: TokenGroup;    // 1/2/3                                      → --shadow-1..3
}

/** A named theme: base tokens + optional dark-mode overrides. */
export interface TokenSet {
  readonly title?: string;
  readonly base: TokenGroups;
  readonly dark?: TokenGroups;
}

export type ThemeMode = 'light' | 'dark';

/** Map a `(group, key)` to its canonical CSS custom-property name. */
export function cssVarName(group: keyof TokenGroups, key: string): string {
  switch (group) {
    case 'color': return `--${key}`;      // color.brand → --brand, color.text-muted → --text-muted
    case 'space': return `--${key}`;      // space.s1 → --s1
    case 'radius': return `--r-${key}`;   // radius.sm → --r-sm
    case 'font': return `--font-${key}`;  // font.sans → --font-sans
    case 'fontSize': return `--fs-${key}`;// fontSize.xs → --fs-xs
    case 'shadow': return `--shadow-${key}`;
    default: return `--${key}`;
  }
}

const GROUPS: (keyof TokenGroups)[] = ['color', 'space', 'radius', 'font', 'fontSize', 'shadow'];

/**
 * Legacy var aliases so applying a token set themes the older, divergent app
 * vocabularies too (the Hub used `--ink/--line/--bad/--muted/--font`). Each alias
 * mirrors a canonical var's value.
 */
const ALIASES: Readonly<Record<string, string>> = {
  '--ink': '--text', '--muted': '--text-muted', '--line': '--border',
  '--bad': '--danger', '--font': '--font-sans',
};

/**
 * Compile a token set into `{ '--var': value }` for a mode. `dark` overrides are
 * layered over `base` when `mode === 'dark'`, so a dark set need only list the
 * tokens that differ. Also emits legacy aliases (see {@link ALIASES}).
 */
export function tokensToCssVars(set: TokenSet, mode: ThemeMode = 'light'): Record<string, string> {
  const out: Record<string, string> = {};
  const layers: TokenGroups[] = mode === 'dark' && set.dark ? [set.base, set.dark] : [set.base];
  for (const layer of layers) {
    for (const group of GROUPS) {
      const g = layer[group];
      if (!g) continue;
      for (const [key, value] of Object.entries(g)) out[cssVarName(group, key)] = value;
    }
  }
  for (const [alias, canonical] of Object.entries(ALIASES)) {
    if (out[canonical] !== undefined) out[alias] = out[canonical];
  }
  return out;
}

/** Render a token set as a CSS `:root { … }` block (for a static default stylesheet). */
export function tokensToCssRoot(set: TokenSet, mode: ThemeMode = 'light', selector = ':root'): string {
  const vars = tokensToCssVars(set, mode);
  const body = Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join('\n');
  return `${selector} {\n${body}\n}`;
}

/**
 * The default platform theme — the current app vocabulary, captured as tokens.
 * Used as the applier's fallback, the Studio "new theme" seed, and to generate
 * the base `:root` stylesheet.
 */
export const DEFAULT_TOKENS: TokenSet = {
  title: 'Platform Default',
  base: {
    font: {
      sans: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      mono: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
    },
    fontSize: { xs: '.75rem', sm: '.8125rem', md: '.9375rem', lg: '1.125rem', xl: '1.5rem', '2xl': '2rem' },
    space: { s1: '4px', s2: '8px', s3: '12px', s4: '16px', s5: '24px', s6: '32px', s8: '48px' },
    radius: { sm: '6px', md: '9px', lg: '14px', full: '999px' },
    shadow: {
      '1': '0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.08)',
      '2': '0 4px 12px rgba(16,24,40,.08), 0 2px 6px rgba(16,24,40,.05)',
      '3': '0 12px 32px rgba(16,24,40,.14)',
    },
    color: {
      bg: '#f5f7fa', surface: '#ffffff', 'surface-2': '#f0f3f8', 'surface-hover': '#f5f8fd',
      border: '#dde3ec', 'border-strong': '#c6cedb',
      text: '#131720', 'text-muted': '#5a6473', 'text-faint': '#8a93a3',
      brand: '#4f46e5', 'brand-hover': '#4338ca', 'brand-soft': '#eef0fe', 'brand-ring': 'rgba(79,70,229,.28)', 'on-brand': '#ffffff',
      ok: '#0f8a4f', 'ok-soft': '#e4f5ec', 'ok-border': '#b7e2c8',
      warn: '#a5680a', 'warn-soft': '#f8efdb', 'warn-border': '#ecd6a3',
      danger: '#c23934', 'danger-soft': '#fbe9e8', 'danger-border': '#f0c2bf',
      info: '#2563c9', 'info-soft': '#e7eefb', 'info-border': '#bcd2f2',
    },
  },
  dark: {
    shadow: {
      '1': '0 1px 2px rgba(0,0,0,.4)', '2': '0 4px 14px rgba(0,0,0,.45)', '3': '0 16px 40px rgba(0,0,0,.55)',
    },
    color: {
      bg: '#0c0f16', surface: '#141924', 'surface-2': '#1b2130', 'surface-hover': '#1e2434',
      border: '#262e3d', 'border-strong': '#354052',
      text: '#e7ebf3', 'text-muted': '#9aa4b6', 'text-faint': '#6b7688',
      brand: '#818cf8', 'brand-hover': '#a5b0ff', 'brand-soft': '#1a2036', 'brand-ring': 'rgba(129,140,248,.32)', 'on-brand': '#0c0f16',
      ok: '#4ecb86', 'ok-soft': '#10261b', 'ok-border': '#1f4432',
      warn: '#e0b25a', 'warn-soft': '#2a2211', 'warn-border': '#4a3c1c',
      danger: '#f0817a', 'danger-soft': '#2b1614', 'danger-border': '#4d2723',
      info: '#6ea8fe', 'info-soft': '#131f33', 'info-border': '#274063',
    },
  },
};
