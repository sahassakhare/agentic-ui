import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { introspectLibrary } from './introspect.js';

/** A ɵcmp declaration line for a component (standalone flag = 8th type arg). */
const cmp = (cls: string, selector: string, standalone: boolean) =>
  `    static ɵcmp: i0.ɵɵComponentDeclaration<${cls}, "${selector}", never, {}, {}, never, never, ${standalone}, never>;`;

/** Build a fake ng-packagr library with two secondary entry points (button, table). */
function fixtureLib(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lib-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fancy-ui', version: '1.0.0' }));

  // fancy-ui/button — exports a standalone component + an exported NON-standalone one
  // + an internal (non-exported) component. Only the standalone export survives.
  mkdirSync(join(dir, 'button'));
  writeFileSync(join(dir, 'button', 'package.json'), JSON.stringify({ typings: 'index.d.ts' }));
  writeFileSync(join(dir, 'button', 'index.d.ts'), [
    'import * as i0 from "@angular/core";',
    'export declare class ButtonComponent {', cmp('ButtonComponent', 'fx-button', true), '}',
    'export declare class LegacyComponent {', cmp('LegacyComponent', 'fx-legacy', false), '}',
    'declare class InternalThing {', cmp('InternalThing', 'fx-internal', true), '}',
  ].join('\n'));

  // fancy-ui/table — typings re-exports via `export * from './table.component'`.
  mkdirSync(join(dir, 'table'));
  writeFileSync(join(dir, 'table', 'package.json'), JSON.stringify({ typings: './public.d.ts' }));
  writeFileSync(join(dir, 'table', 'public.d.ts'), "export * from './table.component';");
  writeFileSync(join(dir, 'table', 'table.component.d.ts'), [
    'import * as i0 from "@angular/core";',
    'export declare class TableComponent {', cmp('TableComponent', 'fx-table', true), '}',
  ].join('\n'));
  return dir;
}

describe('introspectLibrary', () => {
  const found = introspectLibrary(fixtureLib());
  const byClass = new Map(found.map((c) => [c.className, c]));

  it('keeps only standalone, publicly-exported components', () => {
    expect([...byClass.keys()].sort()).toEqual(['ButtonComponent', 'TableComponent']);
  });
  it('resolves each component to its secondary entry-point import path', () => {
    expect(byClass.get('ButtonComponent')!.importPath).toBe('fancy-ui/button');
    expect(byClass.get('TableComponent')!.importPath).toBe('fancy-ui/table');   // followed `export *`
  });
});
