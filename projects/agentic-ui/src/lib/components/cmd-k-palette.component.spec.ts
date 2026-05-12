import { TestBed, ComponentFixture } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { agenticIntent, agenticTool, IntentRegistry, ToolRegistry, type ToolDef } from '../internal';
import { CmdKPaletteComponent, type CmdKResult } from './cmd-k-palette.component';

function seedRegistries(): void {
  const intents = TestBed.inject(IntentRegistry);
  const tools = TestBed.inject(ToolRegistry);

  intents.register(
    agenticIntent({
      id: 'open-custodians',
      description: 'Open the custodians list',
      examples: ['open custodians', 'show custodians'],
      schema: z.object({}),
      mapsTo: { kind: 'route', target: '/custodians' },
    }),
  );
  intents.register(
    agenticIntent({
      id: 'place-legal-hold',
      description: 'Place a legal hold',
      examples: ['place legal hold', 'issue hold'],
      schema: z.object({}),
      mapsTo: { kind: 'action', target: 'place-legal-hold' },
    }),
  );

  tools.register(
    agenticTool({
      name: 'searchDocuments',
      description: 'Semantic search across documents',
      schema: z.object({ query: z.string() }),
      handler: async () => ({}),
    }) as ToolDef,
  );
  tools.register(
    agenticTool({
      name: 'addCustodian',
      description: 'Add a custodian to a matter',
      schema: z.object({}),
      handler: async () => ({}),
    }) as ToolDef,
  );
}

function setup(): ComponentFixture<CmdKPaletteComponent> {
  TestBed.configureTestingModule({ imports: [CmdKPaletteComponent] });
  seedRegistries();
  const fixture = TestBed.createComponent(CmdKPaletteComponent);
  fixture.detectChanges();
  return fixture;
}

function dispatchKey(target: Document | HTMLElement, key: string, opts: KeyboardEventInit = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts });
  target.dispatchEvent(ev);
  return ev;
}

function paletteEl(fixture: ComponentFixture<CmdKPaletteComponent>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

// ── open / close ───────────────────────────────────────────────────

describe('CmdKPaletteComponent — open/close', () => {
  beforeEach(() => undefined);

  it('opens on Cmd+K', async () => {
    const fixture = setup();
    expect(paletteEl(fixture).querySelector('.panel')).toBeNull();

    dispatchKey(document, 'k', { metaKey: true });
    fixture.detectChanges();
    expect(paletteEl(fixture).querySelector('.panel')).not.toBeNull();
  });

  it('opens on Ctrl+K', () => {
    const fixture = setup();
    dispatchKey(document, 'k', { ctrlKey: true });
    fixture.detectChanges();
    expect(paletteEl(fixture).querySelector('.panel')).not.toBeNull();
  });

  it('opens on "/" when no input is focused', () => {
    const fixture = setup();
    dispatchKey(document, '/');
    fixture.detectChanges();
    expect(paletteEl(fixture).querySelector('.panel')).not.toBeNull();
  });

  it('does NOT open on "/" when an input is focused', () => {
    const fixture = setup();
    const sink = document.createElement('input');
    document.body.appendChild(sink);
    sink.focus();
    dispatchKey(document, '/');
    fixture.detectChanges();
    expect(paletteEl(fixture).querySelector('.panel')).toBeNull();
    sink.remove();
  });

  it('closes on Escape', () => {
    const fixture = setup();
    dispatchKey(document, 'k', { metaKey: true });
    fixture.detectChanges();
    dispatchKey(document, 'Escape');
    fixture.detectChanges();
    expect(paletteEl(fixture).querySelector('.panel')).toBeNull();
  });

  it('closes when the backdrop is clicked', () => {
    const fixture = setup();
    dispatchKey(document, 'k', { metaKey: true });
    fixture.detectChanges();
    const backdrop = paletteEl(fixture).querySelector('.backdrop') as HTMLElement;
    backdrop.click();
    fixture.detectChanges();
    expect(paletteEl(fixture).querySelector('.panel')).toBeNull();
  });
});

// ── matching logic ─────────────────────────────────────────────────

describe('CmdKPaletteComponent — matching', () => {
  it('shows matching intents before tools', () => {
    const fixture = setup();
    dispatchKey(document, 'k', { metaKey: true });
    fixture.detectChanges();

    const input = paletteEl(fixture).querySelector('input.query') as HTMLInputElement;
    input.value = 'custodian';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const labels = Array.from(paletteEl(fixture).querySelectorAll('.row .label')).map((n) => n.textContent?.trim());
    // The intent for 'open-custodians' should appear via its
    // 'open custodians' example or description. tool 'addCustodian'
    // should NOT appear because intents matched (tools-as-fallback only).
    expect(labels.some((l) => l?.includes('Open the custodians list'))).toBe(true);
    expect(labels.some((l) => l === 'addCustodian')).toBe(false);
  });

  it('falls through to tools when no intent matches', () => {
    const fixture = setup();
    dispatchKey(document, 'k', { metaKey: true });
    fixture.detectChanges();

    const input = paletteEl(fixture).querySelector('input.query') as HTMLInputElement;
    input.value = 'searchDoc';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const labels = Array.from(paletteEl(fixture).querySelectorAll('.row .label')).map((n) => n.textContent?.trim());
    expect(labels.some((l) => l === 'searchDocuments')).toBe(true);
  });

  it('always appends a free-text "Ask: ..." row at the bottom for non-empty queries', () => {
    const fixture = setup();
    dispatchKey(document, 'k', { metaKey: true });
    fixture.detectChanges();

    const input = paletteEl(fixture).querySelector('input.query') as HTMLInputElement;
    input.value = 'something nobody registered';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const labels = Array.from(paletteEl(fixture).querySelectorAll('.row .label')).map((n) => n.textContent?.trim());
    expect(labels.some((l) => l?.startsWith('Ask:'))).toBe(true);
  });

  it('shows nothing-matching state when query is empty and no intents/tools', () => {
    const fixture = setup();
    dispatchKey(document, 'k', { metaKey: true });
    fixture.detectChanges();
    // Empty query → no rows from intents/tools, no free-text either.
    const emptyMsg = paletteEl(fixture).querySelector('.row.empty');
    expect(emptyMsg?.textContent).toContain('No matching');
  });
});

// ── selection + dispatch ───────────────────────────────────────────

describe('CmdKPaletteComponent — selection', () => {
  it('emits (selected) with the typed intent target on Enter', () => {
    const fixture = setup();
    const received: CmdKResult[] = [];
    fixture.componentInstance.selected.subscribe((r) => received.push(r));

    dispatchKey(document, 'k', { metaKey: true });
    fixture.detectChanges();

    const input = paletteEl(fixture).querySelector('input.query') as HTMLInputElement;
    input.value = 'custodian';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    // First row should be the intent → Enter dispatches it.
    dispatchKey(input, 'Enter');
    fixture.detectChanges();

    expect(received).toHaveLength(1);
    const r = received[0]!;
    expect(r.kind).toBe('route');
    expect(r.target).toBe('/custodians');
  });

  it('emits a chat-source row for tool-match selection', () => {
    const fixture = setup();
    const received: CmdKResult[] = [];
    fixture.componentInstance.selected.subscribe((r) => received.push(r));

    dispatchKey(document, 'k', { metaKey: true });
    fixture.detectChanges();

    const input = paletteEl(fixture).querySelector('input.query') as HTMLInputElement;
    input.value = 'searchDoc';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    dispatchKey(input, 'Enter');
    fixture.detectChanges();

    expect(received).toHaveLength(1);
    const r = received[0]!;
    expect(r.kind).toBe('chat');
    expect(r.target).toContain('searchDocuments');
  });

  it('closes the palette after selection', () => {
    const fixture = setup();
    dispatchKey(document, 'k', { metaKey: true });
    fixture.detectChanges();

    const input = paletteEl(fixture).querySelector('input.query') as HTMLInputElement;
    input.value = 'custodian';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    dispatchKey(input, 'Enter');
    fixture.detectChanges();
    expect(paletteEl(fixture).querySelector('.panel')).toBeNull();
  });

  it('arrow keys navigate the result list', () => {
    const fixture = setup();
    const received: CmdKResult[] = [];
    fixture.componentInstance.selected.subscribe((r) => received.push(r));

    dispatchKey(document, 'k', { metaKey: true });
    fixture.detectChanges();

    const input = paletteEl(fixture).querySelector('input.query') as HTMLInputElement;
    // Query that matches both intents (place legal hold + custodian list don't share words; use 'open' which matches description)
    input.value = 'hold';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    dispatchKey(input, 'ArrowDown');
    fixture.detectChanges();
    dispatchKey(input, 'Enter');
    fixture.detectChanges();

    expect(received).toHaveLength(1);
    // After one ArrowDown the second row is selected; here that's the
    // free-text "Ask:" fallback (since only one intent matches 'hold').
    expect(received[0]!.label.startsWith('Ask:')).toBe(true);
  });
});
