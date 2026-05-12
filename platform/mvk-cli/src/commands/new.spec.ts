import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../cli.js';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

describe('mvk new app', () => {
  it('rejects an invalid project name', async () => {
    const code = await run(['new', 'app', 'BAD NAME']);
    expect(code).toBe(1);
  });

  it('rejects when no name is given', async () => {
    const code = await run(['new', 'app']);
    expect(code).toBe(1);
  });

  it('--dry-run prints the planned output without writing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mvk-new-dryrun-'));
    try {
      const code = await run([
        'new', 'app', 'demo',
        '--dir', join(dir, 'demo'),
        '--dry-run',
      ]);
      expect(code).toBe(0);
      expect(existsSync(join(dir, 'demo'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes the templated files to disk on real run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mvk-new-real-'));
    try {
      const target = join(dir, 'demo');
      const code = await run([
        'new', 'app', 'demo',
        '--dir', target,
      ]);
      expect(code).toBe(0);
      expect(existsSync(join(target, 'package.json'))).toBe(true);
      expect(existsSync(join(target, 'angular.json'))).toBe(true);
      expect(existsSync(join(target, 'src/main.ts'))).toBe(true);

      const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
      expect(pkg.name).toBe('demo');
      expect(pkg.dependencies['@infra-tools/agentic-ui']).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to clobber a non-empty target dir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mvk-new-clobber-'));
    try {
      const target = join(dir, 'demo');
      // Create a non-empty target.
      const fs = await import('node:fs');
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(join(target, 'EXISTING.md'), 'do not delete\n');

      const code = await run([
        'new', 'app', 'demo',
        '--dir', target,
      ]);
      expect(code).toBe(1);
      // EXISTING.md untouched
      expect(readFileSync(join(target, 'EXISTING.md'), 'utf8')).toContain('do not delete');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--with-catalog onboards tenant and registers a sample capability', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mvk-new-catalog-'));
    try {
      const target = join(dir, 'demo');
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : (input as Request).url ?? String(input);
        if (url.endsWith('/v1/tenants')) {
          return new Response(JSON.stringify({ id: 'demo', status: 'active' }), { status: 201 });
        }
        if (url.includes('/capabilities')) {
          return new Response(JSON.stringify({ id: 'cap-1', kind: 'tool', name: 'echo' }), { status: 201 });
        }
        return new Response('{}', { status: 200 });
      });
      vi.stubGlobal('fetch', fetchMock);

      const code = await run([
        'new', 'app', 'demo',
        '--dir', target,
        '--with-catalog',
        '--catalog-url', 'http://localhost:8080',
        '--auth-mode', 'disabled',
      ]);
      expect(code).toBe(0);
      // Files written
      expect(existsSync(join(target, 'package.json'))).toBe(true);
      // Two HTTP calls: tenant create + capability create
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      vi.unstubAllGlobals();
    }
  });

  it('--with-catalog tolerates an existing tenant (409)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mvk-new-409-'));
    try {
      const target = join(dir, 'demo');
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : (input as Request).url ?? String(input);
        if (url.endsWith('/v1/tenants')) {
          return new Response(JSON.stringify({ title: 'Conflict', detail: 'Tenant "demo" already exists' }), {
            status: 409,
          });
        }
        if (url.includes('/capabilities')) {
          return new Response(JSON.stringify({ id: 'cap-1' }), { status: 201 });
        }
        return new Response('{}');
      });
      vi.stubGlobal('fetch', fetchMock);

      const code = await run([
        'new', 'app', 'demo',
        '--dir', target,
        '--with-catalog',
        '--catalog-url', 'http://localhost:8080',
        '--auth-mode', 'disabled',
      ]);
      expect(code).toBe(0);
      expect(existsSync(join(target, 'package.json'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      vi.unstubAllGlobals();
    }
  });
});
