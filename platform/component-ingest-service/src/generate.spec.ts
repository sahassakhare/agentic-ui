import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateCapabilityTs, componentCatalogBody, propsSchemaExpr, type RemoteMeta } from './generate.js';
import { scaffoldRemote, remoteAngularJson, type ScaffoldOptions } from './scaffold.js';
import type { DiscoveredComponent } from './introspect.js';

const meta: RemoteMeta = { remoteName: 'kendo-buttons', version: '1.2.3', packageName: '@progress/kendo-angular-buttons' };
const comps: DiscoveredComponent[] = [
  { className: 'ButtonComponent', selector: 'kendo-button', inputs: ['disabled', 'size'], standalone: true,
    importPath: '@progress/kendo-angular-buttons',
    inputTypes: { disabled: { kind: 'boolean' }, size: { kind: 'enum', enum: ['small', 'large'] } }, widgetName: 'kendo-button' },
  { className: 'ChipComponent', selector: 'kendo-chip', inputs: ['label'], standalone: true,
    importPath: '@progress/kendo-angular-buttons',
    inputTypes: { label: { kind: 'string' } }, widgetName: 'kendo-chip' },
];

describe('generateCapabilityTs', () => {
  const src = generateCapabilityTs(meta, comps);
  it('imports the component classes from the package', () => {
    expect(src).toContain("import { ButtonComponent, ChipComponent } from '@progress/kendo-angular-buttons';");
  });
  it('emits a defineCapabilityModule with a typed agenticWidget per component', () => {
    expect(src).toContain("remoteName: 'kendo-buttons'");
    expect(src).toContain("name: 'kendo-button', component: ButtonComponent");
    expect(src).toContain("name: 'kendo-chip', component: ChipComponent");
  });
  it('groups imports by each component\'s secondary entry point', () => {
    const multi = generateCapabilityTs({ remoteName: 'primeng', version: '22.0.0', packageName: 'primeng' }, [
      { ...comps[0], className: 'Button', importPath: 'primeng/button', widgetName: 'p-button' },
      { ...comps[1], className: 'Card', importPath: 'primeng/card', widgetName: 'p-card' },
    ]);
    expect(multi).toContain("import { Button } from 'primeng/button';");
    expect(multi).toContain("import { Card } from 'primeng/card';");
  });
});

describe('propsSchemaExpr', () => {
  it('builds a typed passthrough object schema from input types', () => {
    expect(propsSchemaExpr(comps[0])).toBe("z.object({ 'disabled': z.boolean().optional(), 'size': z.enum(['small', 'large']).optional() }).passthrough()");
  });
  it('falls back to passthrough when there are no typed inputs', () => {
    expect(propsSchemaExpr({ ...comps[0], inputTypes: {} })).toBe('z.object({}).passthrough()');
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
