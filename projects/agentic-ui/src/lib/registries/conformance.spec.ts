import { describe, expect, it } from 'vitest';
import { runConformance } from '../testing/conformance-suite';
import { FakeAgenticBackend } from '../testing/fake-agentic-backend';

describe('Cross-backend conformance — FakeAgenticBackend', () => {
  it('passes lifecycle + abort checks', async () => {
    const backend = new FakeAgenticBackend();
    const report = await runConformance(backend);
    expect(report.failed).toBe(0);
    expect(report.passed).toBeGreaterThan(0);
  });
});
