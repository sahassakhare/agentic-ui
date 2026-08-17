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
  it('never returns an empty/invalid name', () => {
    expect(sanitizeRemote('@@@')).toBe('remote');
    expect(sanitizeRemote('Foo Bar')).toBe('foo-bar');
  });
});
