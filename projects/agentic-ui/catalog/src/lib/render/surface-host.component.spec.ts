import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ExperiencePlanner, ExperienceRegistry, LayoutRegistry, ComponentRegistry } from '@infra-tools/agentic-ui';
import { CatalogSurfaceHostComponent } from './surface-host.component';
import { CATALOG_AUTH } from '../catalog-config';
import { CatalogComponentSource } from '../component-source';
import type { SurfaceTarget } from '../application-source';

/**
 * The Hub renders governed surfaces through this host. Covers the render
 * dispatch (which kind → which renderer), the access-gated experience plan
 * (the viewer's persona/permissions flow into the planner), and the lazy
 * federated-component resolution state added for catalog components.
 */
describe('CatalogSurfaceHostComponent', () => {
  let planner: { plan: ReturnType<typeof vi.fn> };
  let registry: { get: ReturnType<typeof vi.fn> };
  let source: { ensure: ReturnType<typeof vi.fn> };

  function mount(target: SurfaceTarget, opts: { withSource?: boolean } = { withSource: true }) {
    planner = { plan: vi.fn().mockReturnValue({ experienceId: target.name, layout: 'single', instances: [] }) };
    registry = { get: vi.fn().mockReturnValue(undefined) };
    source = { ensure: vi.fn().mockResolvedValue('not-federated') };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: ExperiencePlanner, useValue: planner },
        { provide: ExperienceRegistry, useValue: { list: () => [{ name: target.name }] } },
        { provide: LayoutRegistry, useValue: { get: () => undefined } },
        { provide: ComponentRegistry, useValue: registry },
        { provide: CATALOG_AUTH, useValue: { principalId: () => 'u1', persona: () => 'ops-manager', permissions: () => ['ops:read'] } },
        // CatalogComponentSource is providedIn:'root', so to exercise the
        // "no source" branch we must explicitly null it (omitting won't do).
        { provide: CatalogComponentSource, useValue: opts.withSource === false ? null : source },
      ],
    });
    // Blank the template so the child renderers (form/workflow/experience host,
    // widget-container) aren't needed — we assert the host's own logic.
    TestBed.overrideComponent(CatalogSurfaceHostComponent, { set: { template: '', imports: [] } });
    const f = TestBed.createComponent(CatalogSurfaceHostComponent);
    f.componentRef.setInput('target', target);
    f.detectChanges();
    return f;
  }
  const inst = (f: ReturnType<typeof mount>) => f.componentInstance as unknown as {
    isExperience(): boolean; plan(): unknown; componentState(): string;
  };

  it('routes experience/dashboard kinds to the experience path, others not', () => {
    expect(inst(mount({ kind: 'experience', name: 'e' } as SurfaceTarget)).isExperience()).toBe(true);
    expect(inst(mount({ kind: 'dashboard', name: 'd' } as SurfaceTarget)).isExperience()).toBe(true);
    expect(inst(mount({ kind: 'form', name: 'f' } as SurfaceTarget)).isExperience()).toBe(false);
  });

  it('plans an experience with the viewer’s persona + permissions (access gate)', () => {
    const f = mount({ kind: 'experience', name: 'ops-overview' } as SurfaceTarget);
    inst(f).plan(); // reading the computed triggers the planner
    expect(planner.plan).toHaveBeenCalledWith({
      experienceId: 'ops-overview',
      user: { id: 'u1', persona: 'ops-manager', permissions: ['ops:read'] },
    });
  });

  it('component surface: ready immediately when the widget is already registered', () => {
    const f = mount({ kind: 'component', name: 'p-button' } as SurfaceTarget);
    registry.get.mockReturnValue({ name: 'p-button' });
    f.componentRef.setInput('target', { kind: 'component', name: 'p-button' } as SurfaceTarget);
    f.detectChanges();
    expect(inst(f).componentState()).toBe('ready');
  });

  it('component surface: resolves via the component source, ending "missing" for a non-federated name', async () => {
    const f = mount({ kind: 'component', name: 'ghost' } as SurfaceTarget);
    await new Promise((r) => setTimeout(r, 0)); // drain the ensure() promise (zoneless)
    f.detectChanges();
    expect(source.ensure).toHaveBeenCalledWith('ghost');
    expect(inst(f).componentState()).toBe('missing');
  });

  it('component surface: "missing" when no component source is provided', () => {
    const f = mount({ kind: 'component', name: 'x' } as SurfaceTarget, { withSource: false });
    expect(inst(f).componentState()).toBe('missing');
  });
});
