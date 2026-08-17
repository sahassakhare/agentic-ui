/**
 * Small color helpers for the Token Designer's "generate from brand" — derive a
 * brand ramp (hover/soft/ring + readable on-brand) from one brand color. No
 * external dependency; hex in, hex/rgba out.
 */

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6) || '000000', 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Linear mix of two colors, `t` in [0,1] (0 = a, 1 = b). */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a); const [br, bg, bb] = hexToRgb(b);
  return rgbToHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
}

/** Relative luminance (WCAG-ish), 0 (black) … 1 (white). */
export function luminance(hex: string): number {
  const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** A readable foreground (near-white or near-black) for a background color. */
export function readableOn(bg: string): string {
  return luminance(bg) > 0.45 ? '#0c0f16' : '#ffffff';
}

/** rgba() string from a hex + alpha. */
export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Derive the brand ramp tokens from a single brand color. */
export function deriveBrand(brand: string, dark = false): Record<string, string> {
  return {
    brand,
    'brand-hover': dark ? mix(brand, '#ffffff', 0.18) : mix(brand, '#000000', 0.12),
    'brand-soft': dark ? mix(brand, '#0c0f16', 0.82) : mix(brand, '#ffffff', 0.90),
    'brand-ring': rgba(brand, dark ? 0.32 : 0.28),
    'on-brand': readableOn(brand),
  };
}
