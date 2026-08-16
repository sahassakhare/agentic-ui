import { describe, expect, it } from 'vitest';
import { lifecycleTransitions } from './lifecycle';

describe('lifecycleTransitions', () => {
  it('draft → publish', () => {
    expect(lifecycleTransitions('draft').map((t) => t.to)).toEqual(['published']);
  });
  it('published → deprecate / disable', () => {
    expect(lifecycleTransitions('published').map((t) => t.to)).toEqual(['deprecated', 'disabled']);
  });
  it('deprecated → restore / disable', () => {
    expect(lifecycleTransitions('deprecated').map((t) => t.to)).toEqual(['published', 'disabled']);
  });
  it('disabled → restore', () => {
    expect(lifecycleTransitions('disabled').map((t) => t.to)).toEqual(['published']);
  });
  it('unknown state → no transitions', () => {
    expect(lifecycleTransitions('weird')).toEqual([]);
  });
  it('labels are human-friendly', () => {
    expect(lifecycleTransitions('draft')[0].label).toBe('Publish');
    expect(lifecycleTransitions('disabled')[0].label).toBe('Restore');
  });
});
