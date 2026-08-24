import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { CodeViewComponent } from './code-view.component';

describe('CodeViewComponent', () => {
  function render(value: unknown, language: 'json' | 'text' = 'json'): HTMLElement {
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(CodeViewComponent);
    fixture.componentRef.setInput('value', value);
    fixture.componentRef.setInput('language', language);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('pretty-prints an object as indented JSON', () => {
    const el = render({ kind: 'form', required: true });
    const code = el.querySelector('code')!.textContent!;
    expect(code).toContain('"kind"');
    expect(code).toContain('\n'); // indented, multi-line
  });

  it('syntax-highlights keys, strings and booleans into token spans', () => {
    const el = render({ name: 'contact', active: true });
    expect(el.querySelector('.tok-key')).toBeTruthy();
    expect(el.querySelector('.tok-str')).toBeTruthy();
    expect(el.querySelector('.tok-bool')).toBeTruthy();
  });

  it('escapes HTML so a malicious value cannot inject markup', () => {
    const el = render({ x: '<img src=x onerror=alert(1)>' });
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('code')!.textContent).toContain('<img');
  });

  it('shows raw text unchanged in text mode', () => {
    const el = render('just some text', 'text');
    expect(el.querySelector('code')!.textContent).toBe('just some text');
  });

  it('emits the parsed object on save when the edited JSON is valid', () => {
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(CodeViewComponent);
    fixture.componentRef.setInput('value', { a: 1 });
    fixture.componentRef.setInput('editable', true);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    let emitted: unknown = null;
    cmp.save.subscribe((v) => (emitted = v));

    cmp.startEdit();
    cmp.draft.set('{ "a": 2, "b": "x" }');
    expect(cmp.parsed().ok).toBe(true);
    cmp.commit();

    expect(emitted).toEqual({ a: 2, b: 'x' });
    expect(cmp.editing()).toBe(false);
  });

  it('rejects invalid or non-object JSON (save stays blocked, nothing emitted)', () => {
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(CodeViewComponent);
    fixture.componentRef.setInput('value', { a: 1 });
    fixture.componentRef.setInput('editable', true);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    let emitted = false;
    cmp.save.subscribe(() => (emitted = true));

    cmp.startEdit();
    cmp.draft.set('{ bad json');
    expect(cmp.parsed().ok).toBe(false);
    cmp.commit();
    expect(emitted).toBe(false);

    cmp.draft.set('[1,2,3]'); // valid JSON but not an object
    expect(cmp.parsed().ok).toBe(false);
  });
});
