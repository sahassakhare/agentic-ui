import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateCapabilityTs, componentCatalogBody, type RemoteMeta } from './generate.js';
import { scaffoldRemote, remoteAngularJson, type ScaffoldOptions } from './scaffold.js';
import type { DiscoveredComponent } from './introspect.js';

const meta: RemoteMeta = { remoteName: 'kendo-buttons', version: '1.2.3', packageName: '@progress/kendo-angular-buttons' };
const comps: DiscoveredComponent[] = [
  { className: 'ButtonComponent', selector: 'kendo-button', inputs: ['disabled', 'size'], widgetName: 'kendo-button' },
  { className: 'ChipComponent', selector: 'kendo-chip', inputs: ['label'], widgetName: 'kendo-chip' },
];

describe('generateCapabilityTs', () => {
  const src = generateCapabilityTs(meta, comps);
  it('imports the component classes from the package', () => {
    expect(src).toContain("import { ButtonComponent, ChipComponent } from '@progress/kendo-angular-buttons';");
  });
  it('emits a defineCapabilityModule with an agenticWidget per component', () => {
    expect(src).toContain("remoteName: 'kendo-buttons'");
    expect(src).toContain("agenticWidget({ name: 'kendo-button', component: ButtonComponent, propsSchema: anyProps })");
    expect(src).toContain("agenticWidget({ name: 'kendo-chip', component: ChipComponent, propsSchema: anyProps })");
  });
});

describe('componentCatalogBody', () => {
  it('builds a kind:component body with the remote pointer + inputs', () => {
    const b = componentCatalogBody(meta, 'http://host/remotes/kendo-buttons/remoteEntry.json', comps[0]);
    expect(b.kind).toBe('component');
    expect(b.name).toBe('kendo-button');
    expect(b.lifecycle).toBe('published');
    expect(b.body).toMatchObject({
      exposedModule: './Capability', remoteName: 'kendo-buttons',
      manifestUrl: 'http://host/remotes/kendo-buttons/remoteEntry.json', inputs: ['disabled', 'size'],
    });
  });
});

describe('scaffoldRemote', () => {
  const opts: ScaffoldOptions = { remoteName: 'kendo-buttons', packageName: '@progress/kendo-angular-buttons', packageSpec: '^1.2.3', port: 4310 };
  it('produces a valid angular.json with the build/esbuild/serve quad', () => {
    const ng = remoteAngularJson(opts) as any;
    const arch = ng.projects['kendo-buttons'].architect;
    expect(arch.build.builder).toBe('@angular-architects/native-federation:build');
    expect(arch.esbuild.options.browser).toBe('src/main.ts');
    expect(arch.esbuild.options.outputPath).toBe('dist/kendo-buttons');
  });
  it('writes a buildable workspace (files present, federation references the remote)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ingest-'));
    scaffoldRemote(dir, opts, generateCapabilityTs(meta, comps));
    for (const f of ['package.json', 'angular.json', 'tsconfig.json', 'tsconfig.app.json', 'federation.config.js', 'src/main.ts', 'src/capability.ts']) {
      expect(existsSync(join(dir, f)), f).toBe(true);
    }
    expect(readFileSync(join(dir, 'federation.config.js'), 'utf8')).toContain("name: 'kendo-buttons'");
    expect(readFileSync(join(dir, 'src/capability.ts'), 'utf8')).toContain('defineCapabilityModule');
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).dependencies['@progress/kendo-angular-buttons']).toBe('^1.2.3');
  });
});
