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
});
