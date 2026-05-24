import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { Component, InjectionToken } from '@angular/core';
import { z } from 'zod';
import { provideAgenticUiPlatform } from './provide-agentic-ui-platform';
import { provideAgUiBackend } from '../backends/ag-ui/ag-ui-backend';
import { agenticWidget } from '../factories/agentic-widget';
import { ToolRegistry } from '../registries/tool-registry';
import { ComponentRegistry } from '../registries/component-registry';
import { BackendRegistry } from '../registries/backend-registry';
import { MCP_UI_CONFIG } from '../mcp-ui/config';
import type { ToolDef } from '../types/registry-defs';

@Component({ selector: 'mvk-test-flight-card', template: '' })
class TestWidget {}

const tool: ToolDef = {
  name: 'bookFlight',
  description: 'book a flight',
  schema: z.object({ from: z.string() }),
  handler: async () => ({ ok: true }),
};

const widget = agenticWidget({
  name: 'flightCard',
  component: TestWidget,
  propsSchema: z.object({}),
});

describe('provideAgenticUiPlatform', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('registers tools + widgets and activates the single transport', () => {
    TestBed.configureTestingModule({
      providers: [
        provideAgenticUiPlatform({
          tools: [tool],
          widgets: [widget],
          transport: provideAgUiBackend({ url: '/api/ag-ui' }),
        }),
      ],
    });

    expect(TestBed.inject(ToolRegistry).list().map((t) => t.name)).toContain('bookFlight');
    expect(TestBed.inject(ComponentRegistry).list().map((w) => w.name)).toContain('flightCard');
    // The transport provider registered + set itself active.
    expect(TestBed.inject(BackendRegistry).active()?.id).toBe('ag-ui');
  });

  it('passes mcpUi options through to provideMcpUi', () => {
    TestBed.configureTestingModule({
      providers: [
        provideAgenticUiPlatform({
          transport: provideAgUiBackend({ url: '/x' }),
          mcpUi: { allowedOrigins: ['https://widgets.example.com'] },
        }),
      ],
    });

    expect(TestBed.inject(MCP_UI_CONFIG).allowedOrigins).toContain('https://widgets.example.com');
  });

  it('folds extraProviders (plain Provider) into the platform', () => {
    const TOKEN = new InjectionToken<string>('TEST_TOKEN');
    TestBed.configureTestingModule({
      providers: [
        provideAgenticUiPlatform({
          transport: provideAgUiBackend({ url: '/x' }),
          extraProviders: [{ provide: TOKEN, useValue: 'folded' }],
        }),
      ],
    });

    expect(TestBed.inject(TOKEN)).toBe('folded');
  });

  it('is a thin aggregator — works with only tools + transport (no mcpUi/webMcp)', () => {
    TestBed.configureTestingModule({
      providers: [
        provideAgenticUiPlatform({
          tools: [tool],
          transport: provideAgUiBackend({ url: '/x' }),
        }),
      ],
    });
    expect(TestBed.inject(ToolRegistry).list()).toHaveLength(1);
    expect(TestBed.inject(BackendRegistry).active()?.id).toBe('ag-ui');
  });
});
