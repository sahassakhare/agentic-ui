import { describe, expect, it } from 'vitest';
import { renderAgenticAppTemplate, validateProjectName } from './agentic-app.js';

describe('validateProjectName', () => {
  it.each([
    ['my-app', true],
    ['app1', true],
    ['demo_app', true],
    ['agentic_demo_v2', true],
  ])('accepts %j', (name, ok) => {
    const r = validateProjectName(name);
    expect(r.ok).toBe(ok);
  });

  it.each([
    [''],
    ['BadName'],
    ['1starts-with-number'],
    ['has spaces'],
    ['has/slash'],
    ['../escape'],
    ['node_modules'],
    ['.'],
    ['..'],
  ])('rejects %j', (name) => {
    const r = validateProjectName(name);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/./);
  });

  it('rejects names longer than 214 chars', () => {
    const r = validateProjectName('a'.repeat(215));
    expect(r.ok).toBe(false);
  });
});

describe('renderAgenticAppTemplate', () => {
  it('produces 11 files with sensible bytes each', () => {
    const files = renderAgenticAppTemplate({ name: 'demo' });
    expect(files.length).toBe(11);
    for (const f of files) {
      expect(f.path).toMatch(/^[a-zA-Z0-9_./-]+$/);
      expect(f.content.length).toBeGreaterThan(0);
    }
  });

  it('substitutes the project name into package.json + angular.json + index.html', () => {
    const files = renderAgenticAppTemplate({ name: 'acme-portal' });
    const byPath = Object.fromEntries(files.map((f) => [f.path, f.content]));
    const pkg = JSON.parse(byPath['package.json']!);
    expect(pkg.name).toBe('acme-portal');
    const ng = JSON.parse(byPath['angular.json']!);
    expect(ng.projects['acme-portal']).toBeDefined();
    expect(byPath['src/index.html']).toContain('<title>acme-portal</title>');
    expect(byPath['src/app/app.component.ts']).toContain('<h1>acme-portal</h1>');
  });

  it('omits catalog section in README when no catalogUrl', () => {
    const files = renderAgenticAppTemplate({ name: 'demo' });
    const readme = files.find((f) => f.path === 'README.md')!.content;
    expect(readme).not.toContain('--with-catalog');
  });

  it('includes catalog section in README when catalogUrl is given', () => {
    const files = renderAgenticAppTemplate({
      name: 'demo',
      catalogUrl: 'https://catalog.example.com',
    });
    const readme = files.find((f) => f.path === 'README.md')!.content;
    expect(readme).toContain('--with-catalog https://catalog.example.com');
    expect(readme).toContain('mvk capability list --tenant demo');
  });

  it('package.json declares the @maverick/agentic-ui dependency', () => {
    const files = renderAgenticAppTemplate({ name: 'demo' });
    const pkg = JSON.parse(files.find((f) => f.path === 'package.json')!.content);
    expect(pkg.dependencies['@maverick/agentic-ui']).toBeTruthy();
  });

  it('app.config.ts wires provideAgenticUi', () => {
    const files = renderAgenticAppTemplate({ name: 'demo' });
    const cfg = files.find((f) => f.path === 'src/app/app.config.ts')!.content;
    expect(cfg).toContain('provideAgenticUi');
    expect(cfg).toContain('provideZonelessChangeDetection');
  });

  it('default scaffold does NOT include provideAgenticPlatform', () => {
    const files = renderAgenticAppTemplate({ name: 'demo' });
    const cfg = files.find((f) => f.path === 'src/app/app.config.ts')!.content;
    expect(cfg).not.toContain('provideAgenticPlatform');
  });

  it('withPlatform: scaffold wires provideAgenticPlatform with catalog URL + tenant', () => {
    const files = renderAgenticAppTemplate({
      name: 'demo',
      catalogUrl: 'https://catalog.example.com',
      withPlatform: true,
    });
    const cfg = files.find((f) => f.path === 'src/app/app.config.ts')!.content;
    expect(cfg).toContain('provideAgenticPlatform');
    expect(cfg).toContain(`CATALOG_URL = 'https://catalog.example.com'`);
    expect(cfg).toContain(`TENANT_ID = 'demo'`);
    expect(cfg).toContain('personaResolver:');
    expect(cfg).toContain('mfeRegistry:');
  });

  it('withPlatform with explicit tenantId override', () => {
    const files = renderAgenticAppTemplate({
      name: 'acme-portal',
      catalogUrl: 'https://catalog.example.com',
      withPlatform: true,
      tenantId: 'acme',
    });
    const cfg = files.find((f) => f.path === 'src/app/app.config.ts')!.content;
    expect(cfg).toContain(`TENANT_ID = 'acme'`);
    expect(cfg).not.toContain(`TENANT_ID = 'acme-portal'`);
  });

  it('withPlatform without catalogUrl falls back to platform-naive template', () => {
    const files = renderAgenticAppTemplate({
      name: 'demo',
      withPlatform: true,
      // catalogUrl intentionally omitted
    });
    const cfg = files.find((f) => f.path === 'src/app/app.config.ts')!.content;
    expect(cfg).not.toContain('provideAgenticPlatform');
    expect(cfg).toContain('provideAgenticUi');
  });
});
