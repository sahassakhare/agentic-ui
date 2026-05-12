import { Component, input } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ComponentRegistry, agenticWidget } from '../internal';
import type { SlotMap, ResponsiveCollapseRule } from '../layout/types';
import { WorkspaceLayoutComponent } from './workspace-layout.component';

// ── test fixtures ──────────────────────────────────────────────────

@Component({
  selector: 'mvk-test-doc-preview',
  template: `<div data-testid="doc-preview" [attr.data-doc-id]="docId()">doc:{{ docId() }}</div>`,
})
class TestDocPreviewComponent {
  readonly docId = input<string>('');
}

@Component({
  selector: 'mvk-test-tag-panel',
  template: `<div data-testid="tag-panel">tags</div>`,
})
class TestTagPanelComponent {}

@Component({
  selector: 'mvk-test-priv-log',
  template: `<div data-testid="priv-log">priv-log</div>`,
})
class TestPrivLogComponent {}

@Component({
  imports: [WorkspaceLayoutComponent],
  template: `
    <div [style.width.px]="widthPx" style="height: 600px;">
      <mvk-workspace-layout
        [slots]="slots"
        [responsive]="responsive"
        [layoutName]="layoutName" />
    </div>
  `,
})
class HostComponent {
  slots: SlotMap = {};
  responsive: readonly ResponsiveCollapseRule[] = [];
  layoutName: string | undefined = undefined;
  widthPx = 1440;
}

function registerThreeWidgets(): void {
  const components = TestBed.inject(ComponentRegistry);
  components.register(
    agenticWidget({
      name: 'documentPreview',
      component: TestDocPreviewComponent,
      propsSchema: z.object({ docId: z.string() }),
    }),
  );
  components.register(
    agenticWidget({
      name: 'tagPanel',
      component: TestTagPanelComponent,
      propsSchema: z.object({}),
    }),
  );
  components.register(
    agenticWidget({
      name: 'privilegeLog',
      component: TestPrivLogComponent,
      propsSchema: z.object({}),
    }),
  );
}

function setupHost(slots: SlotMap, opts: Partial<HostComponent> = {}): ComponentFixture<HostComponent> {
  const fixture = TestBed.createComponent(HostComponent);
  Object.assign(fixture.componentInstance, { slots, ...opts });
  fixture.detectChanges();
  return fixture;
}

// ── slot rendering ─────────────────────────────────────────────────

describe('WorkspaceLayoutComponent — slot rendering', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    registerThreeWidgets();
  });

  it('mounts each slot component via ComponentRegistry lookup', () => {
    const fixture = setupHost({
      primary: { component: 'documentPreview', props: { docId: 'doc-1' } },
      sidebar: { component: 'tagPanel' },
      footer:  { component: 'privilegeLog' },
    });

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="doc-preview"]')?.textContent).toBe('doc:doc-1');
    expect(el.querySelector('[data-testid="tag-panel"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="priv-log"]')).not.toBeNull();
  });

  it('applies slot.size as flex-basis + min/max width', () => {
    const fixture = setupHost({
      primary: { component: 'documentPreview', props: { docId: 'd' }, size: { default: '60%', min: '320px', max: '70%' } },
    });
    const slotEl = fixture.nativeElement.querySelector('section.slot[data-slot="primary"]') as HTMLElement;
    expect(slotEl.style.flexBasis).toBe('60%');
    expect(slotEl.style.minWidth).toBe('320px');
    expect(slotEl.style.maxWidth).toBe('70%');
  });

  it('attaches data-open attribute reflecting SlotDef.open', () => {
    const fixture = setupHost({
      primary: { component: 'tagPanel', open: 'drawer' },
      footer: { component: 'privilegeLog' },     // defaults to inline
    });
    const primary = fixture.nativeElement.querySelector('[data-slot="primary"]') as HTMLElement;
    const footer = fixture.nativeElement.querySelector('[data-slot="footer"]') as HTMLElement;
    expect(primary.getAttribute('data-open')).toBe('drawer');
    expect(footer.getAttribute('data-open')).toBe('inline');
  });

  it('passes validated props into the mounted component as inputs', () => {
    const fixture = setupHost({
      primary: { component: 'documentPreview', props: { docId: 'doc-42' } },
    });
    const inner = fixture.nativeElement.querySelector('[data-testid="doc-preview"]') as HTMLElement;
    expect(inner.getAttribute('data-doc-id')).toBe('doc-42');
  });

  it('falls through to raw props when Zod parse fails (matches widget-container)', () => {
    // docId is required string; pass a number — schema fails, but the slot
    // still mounts with the unvalidated value so a single bad prop doesn't
    // break the whole layout.
    const fixture = setupHost({
      primary: { component: 'documentPreview', props: { docId: 99 } },
    });
    expect(fixture.nativeElement.querySelector('[data-testid="doc-preview"]')).not.toBeNull();
  });
});

// ── unresolved (unknown component) ─────────────────────────────────

describe('WorkspaceLayoutComponent — unresolved slots', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    registerThreeWidgets();
  });

  it('renders an inline warning for slots whose component is not registered', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fixture = setupHost({
      primary: { component: 'documentPreview', props: { docId: 'd' } },
      mystery: { component: 'unknownComponent' },
    });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="doc-preview"]')).not.toBeNull();
    const warning = el.querySelector('.slot-unresolved') as HTMLElement;
    expect(warning?.textContent).toContain('unknownComponent');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ── responsive collapse + drawer ───────────────────────────────────

describe('WorkspaceLayoutComponent — responsive collapse', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    registerThreeWidgets();
  });

  function waitForResize(): Promise<void> {
    // ResizeObserver fires asynchronously; queueMicrotask + a frame is
    // enough for the inner signal write to flush in vitest's jsdom env.
    return new Promise((r) => setTimeout(r, 30));
  }

  it('renders every slot at wide widths', async () => {
    const fixture = setupHost(
      {
        primary: { component: 'documentPreview', props: { docId: 'd' } },
        sidebar: { component: 'tagPanel' },
        footer:  { component: 'privilegeLog' },
      },
      {
        responsive: [
          { belowPx: 1024, collapse: ['footer'], drawer: ['sidebar'] },
          { belowPx: 768,  collapse: ['sidebar', 'footer'], drawer: [] },
        ],
        widthPx: 1440,
      },
    );
    await waitForResize();
    fixture.detectChanges();
    const slots = fixture.nativeElement.querySelectorAll('section.slot');
    // 3 mounted + 0 unresolved
    expect(slots.length).toBe(3);
  });

  it('preserves pinned slots even when the active rule would collapse them', async () => {
    const fixture = setupHost(
      {
        primary: { component: 'documentPreview', props: { docId: 'd' }, pinned: true },
        footer:  { component: 'privilegeLog' },
      },
      {
        responsive: [{ belowPx: 9999, collapse: ['primary', 'footer'], drawer: [] }],
        widthPx: 100,
      },
    );
    await waitForResize();
    fixture.detectChanges();
    // primary is pinned → stays; footer is collapsed.
    const primary = fixture.nativeElement.querySelector('[data-slot="primary"]');
    const footer = fixture.nativeElement.querySelector('[data-slot="footer"]');
    expect(primary).not.toBeNull();
    expect(footer).toBeNull();
  });
});

// ── host attributes ────────────────────────────────────────────────

describe('WorkspaceLayoutComponent — host attributes', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    registerThreeWidgets();
  });

  it('mirrors layoutName onto data-layout-name', () => {
    const fixture = setupHost(
      { primary: { component: 'documentPreview', props: { docId: 'd' } } },
      { layoutName: 'review-workbench' },
    );
    const hostEl = fixture.nativeElement.querySelector('mvk-workspace-layout') as HTMLElement;
    expect(hostEl.getAttribute('data-layout-name')).toBe('review-workbench');
  });

  it('omits data-layout-name when layoutName is not set', () => {
    const fixture = setupHost({
      primary: { component: 'documentPreview', props: { docId: 'd' } },
    });
    const hostEl = fixture.nativeElement.querySelector('mvk-workspace-layout') as HTMLElement;
    expect(hostEl.getAttribute('data-layout-name')).toBeNull();
  });
});
