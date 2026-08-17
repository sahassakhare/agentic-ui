import { describe, expect, it } from 'vitest';
import { cssVarName, tokensToCssVars, DEFAULT_TOKENS, type TokenSet } from './theme-tokens';

describe('cssVarName', () => {
  it('maps each group to its canonical var name', () => {
    expect(cssVarName('color', 'brand')).toBe('--brand');
    expect(cssVarName('color', 'text-muted')).toBe('--text-muted');
    expect(cssVarName('space', 's1')).toBe('--s1');
    expect(cssVarName('radius', 'sm')).toBe('--r-sm');
    expect(cssVarName('font', 'sans')).toBe('--font-sans');
    expect(cssVarName('fontSize', 'xs')).toBe('--fs-xs');
    expect(cssVarName('shadow', '1')).toBe('--shadow-1');
  });
});

describe('tokensToCssVars', () => {
  const set: TokenSet = {
    base: { color: { brand: '#111', text: '#222', border: '#333', danger: '#f00', 'text-muted': '#888' }, space: { s1: '4px' } },
    dark: { color: { brand: '#eee', surface: '#000' } },
  };

  it('compiles base tokens to canonical vars', () => {
    const v = tokensToCssVars(set, 'light');
    expect(v['--brand']).toBe('#111');
    expect(v['--s1']).toBe('4px');
  });

  it('layers dark overrides over base', () => {
    const v = tokensToCssVars(set, 'dark');
    expect(v['--brand']).toBe('#eee');   // overridden
    expect(v['--text']).toBe('#222');    // inherited from base
    expect(v['--surface']).toBe('#000'); // dark-only
  });

  it('emits legacy aliases mirroring canonical values', () => {
    const v = tokensToCssVars(set, 'light');
    expect(v['--ink']).toBe(v['--text']);       // #222
    expect(v['--line']).toBe(v['--border']);    // #333
    expect(v['--bad']).toBe(v['--danger']);     // #f00
    expect(v['--muted']).toBe(v['--text-muted']); // #888
  });

  it('DEFAULT_TOKENS produce the platform vocabulary in both modes', () => {
    const light = tokensToCssVars(DEFAULT_TOKENS, 'light');
    const dark = tokensToCssVars(DEFAULT_TOKENS, 'dark');
    expect(light['--brand']).toBe('#4f46e5');
    expect(dark['--brand']).toBe('#818cf8');
    expect(light['--surface']).toBe('#ffffff');
    expect(dark['--surface']).toBe('#141924');
    expect(light['--font-sans']).toContain('Inter');
  });
});
