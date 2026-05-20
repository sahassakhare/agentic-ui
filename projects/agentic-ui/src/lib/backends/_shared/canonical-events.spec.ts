import { describe, expect, it } from 'vitest';
import { InMemoryTelemetrySink } from '../../testing/in-memory-telemetry-sink';
import {
  extractWidgetRenders,
  parseAgenticEventStrict,
  parseMaybeJson,
} from './canonical-events';

describe('parseMaybeJson', () => {
  it('parses valid JSON', () => {
    expect(parseMaybeJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('returns the raw string on parse failure', () => {
    expect(parseMaybeJson('not json')).toBe('not json');
  });

  it('passes non-string inputs through', () => {
    expect(parseMaybeJson({ already: 'object' })).toEqual({ already: 'object' });
    expect(parseMaybeJson(null)).toBe(null);
  });
});

describe('extractWidgetRenders', () => {
  it('yields widget-render events for each entry in `components`', () => {
    const events = extractWidgetRenders('tc-1', JSON.stringify({
      components: [
        { name: 'flightCard', props: { from: 'LAX' } },
        { name: 'priceBlock', props: { amount: 342 } },
      ],
    }));
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: 'widget-render',
      widgetCallId: 'tc-1-0',
      name: 'flightCard',
      props: { from: 'LAX' },
    });
    const second = events[1] as Extract<typeof events[number], { type: 'widget-render' }>;
    expect(second.widgetCallId).toBe('tc-1-1');
  });

  it('skips components missing a name', () => {
    const events = extractWidgetRenders('tc-1', {
      components: [{ name: 'ok', props: {} }, { props: { stray: true } }, { name: 42 }],
    });
    expect(events).toHaveLength(1);
    expect((events[0] as { name: string }).name).toBe('ok');
  });

  it('returns empty for non-component-shaped content', () => {
    expect(extractWidgetRenders('tc-1', { other: 'shape' })).toEqual([]);
    expect(extractWidgetRenders('tc-1', 'plain string')).toEqual([]);
    expect(extractWidgetRenders('tc-1', null)).toEqual([]);
  });
});

describe('parseAgenticEventStrict', () => {
  const ctx = () => ({
    telemetry: new InMemoryTelemetrySink(),
    threadId: 't-1',
    runId: 'r-1',
    backendId: 'test-backend',
  });

  it('parses a well-formed event', () => {
    const c = ctx();
    const ev = parseAgenticEventStrict(JSON.stringify({
      type: 'text-delta', messageId: 'm-1', delta: 'hi',
    }), c);
    expect(ev?.type).toBe('text-delta');
    expect(c.telemetry.events).toHaveLength(0);
  });

  it('drops + telemetries an event with the wrong shape', () => {
    const c = ctx();
    const ev = parseAgenticEventStrict(JSON.stringify({
      type: 'text-delta', delta: 'orphan',  // missing messageId
    }), c);
    expect(ev).toBeNull();
    const t = c.telemetry.eventsByName('agentic.run.malformed_event');
    expect(t).toHaveLength(1);
    expect(t[0]?.attributes?.['agentic.backend.id']).toBe('test-backend');
    expect(t[0]?.attributes?.['agentic.event.type']).toBe('text-delta');
    expect(String(t[0]?.attributes?.['agentic.event.parse_errors'])).toContain('messageId');
  });

  it('drops + telemetries an unknown event type', () => {
    const c = ctx();
    const ev = parseAgenticEventStrict(JSON.stringify({
      type: 'invented-event', payload: { x: 1 },
    }), c);
    expect(ev).toBeNull();
    expect(c.telemetry.eventsByName('agentic.run.malformed_event')[0]?.attributes?.['agentic.event.type'])
      .toBe('invented-event');
  });

  it('drops + telemetries invalid JSON', () => {
    const c = ctx();
    const ev = parseAgenticEventStrict('not-json{', c);
    expect(ev).toBeNull();
    const t = c.telemetry.eventsByName('agentic.run.malformed_event');
    expect(t).toHaveLength(1);
    expect(t[0]?.attributes?.['agentic.event.type']).toBe('(invalid-json)');
    expect(t[0]?.attributes?.['agentic.event.parse_errors']).toBe('json-parse');
  });

  it('carries the backendId so dashboards can group by adapter', () => {
    const c1 = { ...ctx(), backendId: 'hashbrown' };
    const c2 = { ...ctx(), backendId: 'a2ui' };
    parseAgenticEventStrict('bad', c1);
    parseAgenticEventStrict('bad', c2);
    expect(c1.telemetry.eventsByName('agentic.run.malformed_event')[0]?.attributes?.['agentic.backend.id']).toBe('hashbrown');
    expect(c2.telemetry.eventsByName('agentic.run.malformed_event')[0]?.attributes?.['agentic.backend.id']).toBe('a2ui');
  });
});
