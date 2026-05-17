import { Component, input } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  ComponentRegistry,
  ToolRegistry,
  agenticTool,
  agenticWidget,
  type ToolDef,
} from '../internal';
import { SmartCellComponent } from './smart-cell.component';

// ── test fixtures ──────────────────────────────────────────────────

@Component({
  selector: 'mvk-test-confidence-pill',
  template: `<span data-testid="pill" [attr.data-confidence]="value()">{{ value() }}%</span>`,
})
class TestPillComponent {
  readonly value = input<number>(0);
}

@Component({
  selector: 'mvk-test-detail-card',
  template: `<div data-testid="detail">phrase match · value={{ value() }}</div>`,
})
class TestDetailComponent {
  readonly value = input<number>(0);
}

@Component({
  imports: [SmartCellComponent],
  template: `
    <mvk-smart-cell
      [value]="value"
      [loading]="loading"
      [error]="error"
      [widget]="widget"
      [hoverWidget]="hoverWidget"
      [tool]="tool" />
  `,
})
class HostComponent {
  value: unknown = undefined;
  loading = false;
  error: string | undefined = undefined;
  widget: string | undefined = undefined;
  hoverWidget: string | undefined = undefined;
  tool: string | undefined = undefined;
}

function setupRegistries(): { tools: ToolRegistry; components: ComponentRegistry } {
  const components = TestBed.inject(ComponentRegistry);
  const tools = TestBed.inject(ToolRegistry);
  components.register(
    agenticWidget({
      name: 'confidencePill',
      component: TestPillComponent,
      propsSchema: z.object({ value: z.number() }),
    }),
  );
  components.register(
    agenticWidget({
      name: 'confidenceDetail',
      component: TestDetailComponent,
      propsSchema: z.object({ value: z.number() }),
    }),
  );
  return { components, tools };
}

function setup(props: Partial<HostComponent>): ComponentFixture<HostComponent> {
  TestBed.configureTestingModule({ imports: [HostComponent] });
  setupRegistries();
  const fixture = TestBed.createComponent(HostComponent);
  Object.assign(fixture.componentInstance, props);
  fixture.detectChanges();
  return fixture;
}

// ── state rendering ────────────────────────────────────────────────

describe('SmartCellComponent — rendering states', () => {
  beforeEach(() => undefined);

  it('renders loading state with aria-busy when loading is true', () => {
    const fixture = setup({ value: 87, loading: true });
    const el = fixture.nativeElement.querySelector('.loading') as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.getAttribute('aria-busy')).toBe('true');
  });

  it('renders error state with the message in title attribute', () => {
    const fixture = setup({ error: 'classifier timeout' });
    const el = fixture.nativeElement.querySelector('.error') as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.getAttribute('title')).toBe('classifier timeout');
  });

  it('renders the value via widget when widget is supplied', () => {
    const fixture = setup({ value: 87, widget: 'confidencePill' });
    const pill = fixture.nativeElement.querySelector('[data-testid="pill"]') as HTMLElement;
    expect(pill).not.toBeNull();
    expect(pill.textContent).toContain('87');
    expect(pill.getAttribute('data-confidence')).toBe('87');
  });

  it('renders the value as plain text when no widget is supplied', () => {
    const fixture = setup({ value: 'PRIVILEGED' });
    const el = fixture.nativeElement.querySelector('.value.text') as HTMLElement;
    expect(el.textContent).toBe('PRIVILEGED');
  });

  it('renders empty string for undefined or null value (no widget)', () => {
    const fixture = setup({ value: undefined });
    const el = fixture.nativeElement.querySelector('.value.text') as HTMLElement;
    expect(el.textContent).toBe('');
  });

  it('stringifies objects to JSON in plain-text fallback', () => {
    const fixture = setup({ value: { score: 0.87 } });
    const el = fixture.nativeElement.querySelector('.value.text') as HTMLElement;
    expect(el.textContent).toContain('0.87');
  });
});

// ── persona scope ──────────────────────────────────────────────────

describe('SmartCellComponent — persona scope via [tool]', () => {
  beforeEach(() => undefined);

  it('renders an em-dash placeholder when the persona cannot see [tool]', () => {
    const fixture = setup({ value: 87, widget: 'confidencePill', tool: 'runTARClassifier' });
    // Register the tool, then install a deny-all scope policy so it's
    // not visible.
    const tools = TestBed.inject(ToolRegistry);
    tools.register(
      agenticTool({
        name: 'runTARClassifier',
        description: 'tar',
        schema: z.object({}),
        handler: async () => ({}),
      }) as ToolDef,
    );
    tools.setScopePolicy(() => false);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.blocked')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="pill"]')).toBeNull();
  });

  it('renders normally when the persona can see [tool]', () => {
    const fixture = setup({ value: 87, widget: 'confidencePill', tool: 'runTARClassifier' });
    const tools = TestBed.inject(ToolRegistry);
    tools.register(
      agenticTool({
        name: 'runTARClassifier',
        description: 'tar',
        schema: z.object({}),
        handler: async () => ({}),
      }) as ToolDef,
    );
    // Default scope policy is allow-all.
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.blocked')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="pill"]')).not.toBeNull();
  });

  it('renders an em-dash placeholder when [tool] references a non-existent tool', () => {
    const fixture = setup({ value: 87, widget: 'confidencePill', tool: 'never-registered' });
    expect(fixture.nativeElement.querySelector('.blocked')).not.toBeNull();
  });

  it('does NOT apply persona scope when [tool] is omitted', () => {
    const fixture = setup({ value: 87, widget: 'confidencePill' });
    expect(fixture.nativeElement.querySelector('.blocked')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="pill"]')).not.toBeNull();
  });
});

// ── hover detail ───────────────────────────────────────────────────

describe('SmartCellComponent — hover explainability widget', () => {
  beforeEach(() => undefined);

  it('does not render the detail panel until hover/tap', () => {
    const fixture = setup({ value: 87, widget: 'confidencePill', hoverWidget: 'confidenceDetail' });
    expect(fixture.nativeElement.querySelector('[data-testid="detail"]')).toBeNull();
  });

  it('reveals the detail widget on mouseenter', () => {
    const fixture = setup({ value: 87, widget: 'confidencePill', hoverWidget: 'confidenceDetail' });
    const valueEl = fixture.nativeElement.querySelector('.value') as HTMLElement;
    valueEl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="detail"]')).not.toBeNull();
  });

  it('hides the detail on mouseleave', () => {
    const fixture = setup({ value: 87, widget: 'confidencePill', hoverWidget: 'confidenceDetail' });
    const valueEl = fixture.nativeElement.querySelector('.value') as HTMLElement;
    valueEl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    fixture.detectChanges();
    valueEl.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="detail"]')).toBeNull();
  });

  it('toggles the detail on click (touch support)', () => {
    const fixture = setup({ value: 87, widget: 'confidencePill', hoverWidget: 'confidenceDetail' });
    const valueEl = fixture.nativeElement.querySelector('.value') as HTMLElement;
    valueEl.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="detail"]')).not.toBeNull();
    valueEl.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="detail"]')).toBeNull();
  });

  it('does nothing on hover when no hoverWidget is supplied', () => {
    const fixture = setup({ value: 87, widget: 'confidencePill' });
    const valueEl = fixture.nativeElement.querySelector('.value') as HTMLElement;
    valueEl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.detail')).toBeNull();
  });

  it('forwards `value` to the hover widget as a bound input', () => {
    const fixture = setup({ value: 87, widget: 'confidencePill', hoverWidget: 'confidenceDetail' });
    const valueEl = fixture.nativeElement.querySelector('.value') as HTMLElement;
    valueEl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    fixture.detectChanges();
    const detail = fixture.nativeElement.querySelector('[data-testid="detail"]') as HTMLElement;
    expect(detail.textContent).toContain('value=87');
  });
});

// ── widget fallback when registry doesn't know the name ────────────

describe('SmartCellComponent — widget fallback', () => {
  beforeEach(() => undefined);

  it('falls back to plain text when the widget name is not registered', () => {
    const fixture = setup({ value: 'PRIV', widget: 'never-registered' });
    expect(fixture.nativeElement.querySelector('[data-testid="pill"]')).toBeNull();
    const el = fixture.nativeElement.querySelector('.value.text') as HTMLElement;
    expect(el.textContent).toBe('PRIV');
  });
});
