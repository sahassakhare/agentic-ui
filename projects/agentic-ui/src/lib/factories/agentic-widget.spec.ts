import { Component } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { agenticWidget } from './agentic-widget';

@Component({ selector: 'mvk-test', template: '' })
class TestComponent {}

describe('agenticWidget — dataSources field (Capability F2)', () => {
  it('threads dataSources through to the resulting ComponentDef', () => {
    const def = agenticWidget({
      name: 'supervisor-picker',
      component: TestComponent,
      propsSchema: z.object({}),
      dataSources: ['users', 'roles'],
    });
    expect(def.dataSources).toEqual(['users', 'roles']);
  });

  it('omits dataSources when the caller does not pass it', () => {
    const def = agenticWidget({
      name: 'plain-widget',
      component: TestComponent,
      propsSchema: z.object({}),
    });
    expect(def.dataSources).toBeUndefined();
  });

  it('accepts an empty dataSources array (still recorded for shape parity)', () => {
    const def = agenticWidget({
      name: 'no-sources',
      component: TestComponent,
      propsSchema: z.object({}),
      dataSources: [],
    });
    expect(def.dataSources).toEqual([]);
  });
});
