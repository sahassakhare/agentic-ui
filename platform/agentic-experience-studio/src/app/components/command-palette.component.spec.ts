import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { CommandPaletteComponent } from './command-palette.component';
import { CapabilityCatalogService } from '../services/capability-catalog.service';

/* Access protected signals/methods for testing. */
type Testable = {
  open: { set(v: boolean): void; (): boolean };
  results: () => ReadonlyArray<{ label: string; hint: string; keywords: string }>;
  setQuery: (v: string) => void;
  run: (cmd: unknown) => void;
  onGlobalKey: (e: KeyboardEvent) => void;
};

describe('CommandPaletteComponent', () => {
  let navByUrl: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;

  function make(): Testable {
    navByUrl = vi.fn();
    navigate = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: { navigateByUrl: navByUrl, navigate } },
        { provide: CapabilityCatalogService, useValue: { listByKind: () => of({ items: [] }) } },
      ],
    });
    return TestBed.createComponent(CommandPaletteComponent).componentInstance as unknown as Testable;
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('lists all sections when open with an empty query', () => {
    const c = make();
    c.open.set(true);
    expect(c.results().length).toBe(19);
    expect(c.results()[0]!.label).toContain('Go to');
  });

  it('filters to matching sections by query', () => {
    const c = make();
    c.open.set(true);
    c.setQuery('workflow');
    const r = c.results();
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((x) => x.keywords.includes('workflow'))).toBe(true);
  });

  it('running a section command navigates and closes', () => {
    const c = make();
    c.open.set(true);
    const forms = c.results().find((x) => x.hint === '/forms')!;
    c.run(forms);
    expect(navByUrl).toHaveBeenCalledWith('/forms');
    expect(c.open()).toBe(false);
  });

  it('⌘K toggles the palette open', () => {
    const c = make();
    expect(c.open()).toBe(false);
    c.onGlobalKey(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
    expect(c.open()).toBe(true);
  });
});
