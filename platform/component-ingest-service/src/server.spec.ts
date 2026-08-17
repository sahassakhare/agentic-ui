import { describe, expect, it } from 'vitest';
import { sanitizeRemote } from './server.js';

describe('sanitizeRemote', () => {
  it('derives a valid remote name from an npm spec', () => {
    expect(sanitizeRemote('@progress/kendo-angular-buttons@1.2.3')).toBe('progress-kendo-angular-buttons');
    expect(sanitizeRemote('my-lib@2.0.0')).toBe('my-lib');
  });
  it('derives from an archive path', () => {
    expect(sanitizeRemote('/tmp/uploads/Acme.UI.tgz')).toBe('acme-ui');
    expect(sanitizeRemote('helix-angular.zip')).toBe('helix-angular');
  });
  it('derives from a tarball URL (drops host + query)', () => {
    expect(sanitizeRemote('https://registry.npmjs.org/@progress/kendo-angular-buttons/-/kendo-angular-buttons-16.0.0.tgz'))
      .toBe('kendo-angular-buttons-16-0-0');
    expect(sanitizeRemote('https://example.com/dl/my-lib.tgz?token=abc')).toBe('my-lib');
  });
  it('never returns an empty/invalid name', () => {
    expect(sanitizeRemote('@@@')).toBe('remote');
    expect(sanitizeRemote('Foo Bar')).toBe('foo-bar');
  });
});
