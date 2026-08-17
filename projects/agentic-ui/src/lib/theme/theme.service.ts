import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';
import { tokensToCssVars, type ThemeMode, type TokenSet } from './theme-tokens';

/**
 * Applies a {@link TokenSet} to the document as CSS custom properties, so every
 * token-driven surface re-themes at runtime with no rebuild. Tracks what it set
 * and clears it on replace, and re-renders on light/dark mode changes. Hosts
 * call {@link apply} with the active application's theme (hot-swappable over SSE).
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  private current: TokenSet | null = null;
  private applied: string[] = [];

  /** Current light/dark mode (detected from `data-theme` / `prefers-color-scheme`). */
  readonly mode = signal<ThemeMode>(this.detectMode());

  /** Apply a token set (optionally forcing a mode) as CSS custom properties. */
  apply(set: TokenSet, mode?: ThemeMode): void {
    this.current = set;
    if (mode) this.mode.set(mode);
    this.render();
  }

  /** Switch light/dark and re-render the current token set. */
  setMode(mode: ThemeMode): void {
    if (this.mode() === mode) return;
    this.mode.set(mode);
    this.render();
  }

  /** Remove all applied token vars (revert to the stylesheet defaults). */
  clear(): void {
    const root = this.doc.documentElement;
    for (const v of this.applied) root.style.removeProperty(v);
    this.applied = [];
    this.current = null;
  }

  private render(): void {
    const root = this.doc.documentElement;
    for (const v of this.applied) root.style.removeProperty(v);
    this.applied = [];
    if (!this.current) return;
    const vars = tokensToCssVars(this.current, this.mode());
    for (const [name, value] of Object.entries(vars)) {
      root.style.setProperty(name, value);
      this.applied.push(name);
    }
  }

  private detectMode(): ThemeMode {
    const attr = this.doc.documentElement.getAttribute('data-theme');
    if (attr === 'dark' || attr === 'light') return attr;
    const win = this.doc.defaultView;
    return win?.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
}
