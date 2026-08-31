import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ComponentRegistry, type CapabilityModule, type ComponentDef } from '@infra-tools/agentic-ui';
import { CatalogComponentSource, CATALOG_REMOTE_LOADER, type CatalogRemoteLoader } from './component-source';
import { CatalogClient } from './catalog-client';

/** A minimal CapabilityModule whose `apply()` registers one component widget. */
function fakeCapability(widgetName: string): CapabilityModule {
  const widget = { name: widgetName, component: class Fake {} } as unknown as ComponentDef;
  return {
    remoteName: 'r', version: '1.0.0', tools: [], components: [widget],
    apply: (reg: { components: { registerAll(defs: readonly ComponentDef[]): void } }) => {
      reg.components.registerAll([widget]);
      return () => undefined;
    },
  } as unknown as CapabilityModule;
}

interface Row { name: string; body?: Record<string, unknown> }
const federated = (name: string, remoteName = 'r'): Row => ({
  name, body: { remoteName, version: '1.0.0', manifestUrl: `http://x/${remoteName}/remoteEntry.json`, exposedModule: './Capability' },
});
const preview = (name: string): Row => ({ name, body: { description: 'preview only', preview: { type: 'html', html: '<b/>' } } });

function setup(rows: Row[], loader: CatalogRemoteLoader) {
  TestBed.configureTestingModule({
    providers: [
      CatalogComponentSource,
      { provide: CatalogClient, useValue: { listByKind: () => Promise.resolve(rows) } },
      { provide: CATALOG_REMOTE_LOADER, useValue: loader },
    ],
  });
  return {
    source: TestBed.inject(CatalogComponentSource),
    registry: TestBed.inject(ComponentRegistry),
  };
}

describe('CatalogComponentSource', () => {
  it('loads a federated remote on demand and registers its widget', async () => {
    const loader = vi.fn<CatalogRemoteLoader>(async () => ({ capability: fakeCapability('mfe-widget') }));
    const { source, registry } = setup([federated('mfe-widget')], loader);

    expect(registry.getRaw('mfe-widget')).toBeUndefined();
    const res = await source.ensure('mfe-widget');

    expect(res).toBe('ready');
    expect(registry.getRaw('mfe-widget')).toBeDefined();
    expect(loader).toHaveBeenCalledOnce();
    expect(loader.mock.calls[0][1]).toBe('./Capability'); // exposedModule passed through
  });

  it('short-circuits when the widget is already registered (no remote load)', async () => {
    const loader = vi.fn<CatalogRemoteLoader>(async () => ({ capability: fakeCapability('x') }));
    const { source, registry } = setup([federated('pre-reg')], loader);
    registry.registerAll([{ name: 'pre-reg', component: class {} } as unknown as ComponentDef]);

    expect(await source.ensure('pre-reg')).toBe('ready');
    expect(loader).not.toHaveBeenCalled();
  });

  it('returns not-federated for a preview-only row (nothing to load)', async () => {
    const loader = vi.fn<CatalogRemoteLoader>(async () => ({ capability: fakeCapability('x') }));
    const { source } = setup([preview('static-preview')], loader);

    expect(await source.ensure('static-preview')).toBe('not-federated');
    expect(loader).not.toHaveBeenCalled();
  });

  it('returns not-federated when no row exists for the name', async () => {
    const loader = vi.fn<CatalogRemoteLoader>(async () => ({ capability: fakeCapability('x') }));
    const { source } = setup([federated('other')], loader);
    expect(await source.ensure('missing')).toBe('not-federated');
  });

  it('loads each remote at most once across concurrent + repeat calls', async () => {
    const loader = vi.fn<CatalogRemoteLoader>(async () => ({ capability: fakeCapability('a') }));
    // Two widgets from the SAME remote 'r' — one load must serve both.
    const { source } = setup([federated('a', 'r'), federated('b', 'r')], loader);

    await Promise.all([source.ensure('a'), source.ensure('a'), source.ensure('b')]);
    await source.ensure('a');
    expect(loader).toHaveBeenCalledOnce();
  });

  it('reports load-failed and does not cache the failure (a later call retries)', async () => {
    let attempt = 0;
    const loader = vi.fn<CatalogRemoteLoader>(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('network');
      return { capability: fakeCapability('flaky') };
    });
    const { source, registry } = setup([federated('flaky')], loader);

    expect(await source.ensure('flaky')).toBe('load-failed');
    expect(registry.getRaw('flaky')).toBeUndefined();

    // Second attempt succeeds — the failed remote was not cached.
    expect(await source.ensure('flaky')).toBe('ready');
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
