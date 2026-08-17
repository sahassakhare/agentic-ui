import { describe, expect, it } from 'vitest';
import { introspectDts } from './introspect.js';

// A Kendo-style Ivy component declaration (newer input-map shape with alias/required).
const KENDO_BUTTON = `
import * as i0 from "@angular/core";
export declare class ButtonComponent {
    disabled: boolean;
    size: "small" | "medium" | "large";
    themeColor: string;
    static ɵfac: i0.ɵɵFactoryDeclaration<ButtonComponent, never>;
    static ɵcmp: i0.ɵɵComponentDeclaration<ButtonComponent, "kendo-button", never, { "disabled": { "alias": "disabled"; "required": false; }; "size": { "alias": "size"; "required": false; }; "themeColor": { "alias": "themeColor"; "required": false; }; }, {}, never, ["*"], true, never>;
}
export declare class ButtonModule {
    static ɵmod: i0.ɵɵNgModuleDeclaration<ButtonModule, [typeof ButtonComponent], never, [typeof ButtonComponent]>;
}
`;

// An older-style component (input map values are plain strings) + a directive (no inputs).
const OLDER = `
import * as i0 from "@angular/core";
export declare class GridComponent {
    static ɵcmp: i0.ɵɵComponentDeclaration<GridComponent, "app-grid", never, { "data": "data"; "pageSize": "pageSize"; }, {}, never, never, false, never>;
}
export declare class PlainService {
    static ɵprov: i0.ɵɵInjectableDeclaration<PlainService>;
}
`;

describe('introspectDts', () => {
  it('extracts a component name, selector, and input names (alias-map shape)', () => {
    const [c] = introspectDts(KENDO_BUTTON);
    expect(c.className).toBe('ButtonComponent');
    expect(c.selector).toBe('kendo-button');
    expect(c.inputs).toEqual(['disabled', 'size', 'themeColor']);
    expect(c.widgetName).toBe('kendo-button');
  });

  it('classifies each input type (boolean / string-literal-union enum / string)', () => {
    const [c] = introspectDts(KENDO_BUTTON);
    expect(c.inputTypes['disabled']).toEqual({ kind: 'boolean' });
    expect(c.inputTypes['themeColor']).toEqual({ kind: 'string' });
    expect(c.inputTypes['size']).toEqual({ kind: 'enum', enum: ['small', 'medium', 'large'] });
  });

  it('ignores NgModules / services (only ɵcmp classes)', () => {
    expect(introspectDts(KENDO_BUTTON)).toHaveLength(1);
  });

  it('reads the standalone flag (8th type arg)', () => {
    expect(introspectDts(KENDO_BUTTON)[0].standalone).toBe(true);
    expect(introspectDts(OLDER)[0].standalone).toBe(false);
  });

  it('handles the older string input-map shape + derives a widget name from selector', () => {
    const found = introspectDts(OLDER);
    expect(found).toHaveLength(1);
    expect(found[0].className).toBe('GridComponent');
    expect(found[0].inputs).toEqual(['data', 'pageSize']);
    expect(found[0].widgetName).toBe('app-grid');
  });

  it('falls back to a kebab class name when there is no tag selector', () => {
    const c = introspectDts(`
      import * as i0 from "@angular/core";
      export declare class FancyCardComponent {
        static ɵcmp: i0.ɵɵComponentDeclaration<FancyCardComponent, "[fancyCard]", never, {}, {}, never, never, true, never>;
      }`)[0];
    // attribute selector → not a tag; derive from class name
    expect(c.widgetName).toBe('fancy-card');
    expect(c.inputs).toEqual([]);
  });
});
