import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AgentContextProvider } from './agent-context-provider';
import { CONTEXT_CONTRIBUTOR, type ContextContributor, type ContextFragment } from './types';

function contributor(id: string, order: number, fragment: ContextFragment | null): {
  provide: typeof CONTEXT_CONTRIBUTOR;
  useValue: ContextContributor;
  multi: true;
} {
  return {
    provide: CONTEXT_CONTRIBUTOR,
    useValue: { id, order, contribute: () => fragment },
    multi: true,
  };
}

describe('AgentContextProvider', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('returns an empty string when no contributors are registered', () => {
    TestBed.configureTestingModule({});
    const provider = TestBed.inject(AgentContextProvider);
    expect(provider.compose()).toBe('');
    expect(provider.composeStructured()).toEqual([]);
  });

  it('orders contributors ascending by `order`', () => {
    TestBed.configureTestingModule({
      providers: [
        contributor('c', 300, { tag: 'c', content: 'C' }),
        contributor('a', 100, { tag: 'a', content: 'A' }),
        contributor('b', 200, { tag: 'b', content: 'B' }),
      ],
    });
    const fragments = TestBed.inject(AgentContextProvider).composeStructured();
    expect(fragments.map((f) => f.tag)).toEqual(['a', 'b', 'c']);
  });

  it('skips contributors that return null', () => {
    TestBed.configureTestingModule({
      providers: [
        contributor('a', 100, { tag: 'a', content: 'present' }),
        contributor('null', 200, null),
        contributor('c', 300, { tag: 'c', content: 'also-present' }),
      ],
    });
    const fragments = TestBed.inject(AgentContextProvider).composeStructured();
    expect(fragments.map((f) => f.tag)).toEqual(['a', 'c']);
  });

  it('renders nested fragments with indentation', () => {
    TestBed.configureTestingModule({
      providers: [
        contributor('nested', 100, {
          tag: 'parent',
          content: [
            { tag: 'child', attrs: { id: '1' }, content: 'first' },
            { tag: 'child', attrs: { id: '2' } },
          ],
        }),
      ],
    });
    const out = TestBed.inject(AgentContextProvider).compose();
    expect(out).toBe(
      `<context>
  <parent>
    <child id="1">first</child>
    <child id="2" />
  </parent>
</context>`,
    );
  });

  it('escapes attribute quotes and text-content < / & characters', () => {
    TestBed.configureTestingModule({
      providers: [
        contributor('esc', 100, {
          tag: 'note',
          attrs: { msg: 'say "hi" & bye' },
          content: 'pre <tag> & post',
        }),
      ],
    });
    const out = TestBed.inject(AgentContextProvider).compose();
    expect(out).toContain('msg="say &quot;hi&quot; &amp; bye"');
    expect(out).toContain('pre &lt;tag&gt; &amp; post');
  });

  it('renders self-closing elements when content is undefined', () => {
    TestBed.configureTestingModule({
      providers: [
        contributor('self', 100, { tag: 'flag', attrs: { name: 'urgent' } }),
      ],
    });
    const out = TestBed.inject(AgentContextProvider).compose();
    expect(out).toBe('<context>\n  <flag name="urgent" />\n</context>');
  });
});
