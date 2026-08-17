import { describe, expect, it } from 'vitest';
import { hexToRgb, rgbToHex, mix, luminance, readableOn, deriveBrand } from './theme-colors';

describe('color helpers', () => {
  it('round-trips hex ↔ rgb (incl. shorthand)', () => {
    expect(hexToRgb('#ffffff')).toEqual([255, 255, 255]);
    expect(hexToRgb('#000')).toEqual([0, 0, 0]);
    expect(rgbToHex([79, 70, 229])).toBe('#4f46e5');
  });
  it('mixes toward a target', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#4f46e5', '#ffffff', 0)).toBe('#4f46e5');
  });
  it('luminance orders dark < light', () => {
    expect(luminance('#000000')).toBeLessThan(luminance('#4f46e5'));
    expect(luminance('#4f46e5')).toBeLessThan(luminance('#ffffff'));
  });
  it('readableOn picks a contrasting foreground', () => {
    expect(readableOn('#ffffff')).toBe('#0c0f16');
    expect(readableOn('#4f46e5')).toBe('#ffffff');
  });
  it('deriveBrand builds a ramp with a readable on-brand', () => {
    const r = deriveBrand('#4f46e5');
    expect(r['brand']).toBe('#4f46e5');
    expect(r['on-brand']).toBe('#ffffff');
    expect(r['brand-ring']).toMatch(/^rgba\(79,70,229,/);
    expect(r['brand-soft']).not.toBe('#4f46e5'); // lightened
  });
});
