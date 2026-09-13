import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { CopilotRailComponent } from './copilot-rail.component';
import { authoringBridge } from './authoring-bridge';
import { CapabilityCatalogService } from '../services/capability-catalog.service';
import { ExperienceCatalogService } from '../services/experience-catalog.service';
import { FeatureFlagsService } from '../services/feature-flags.service';

/**
 * Exercises the rail's bridge WIRING — the closures it installs on
 * `authoringBridge` that the copilot tools call. Focus: capability vs
 * experience routing (experiences live in a separate store), title/goal split,
 * merge semantics, and route parsing for getActive.
 */

// Minimal service doubles. Each returns whatever the test seeds via mockReturnValue.
function makeCaps() {
  return {
    create: vi.fn(),
    listByKind: vi.fn().mockReturnValue(of({ items: [] })),
    get: vi.fn().mockReturnValue(of(null)),
    update: vi.fn(),
  };
}
function makeExps() {
  return {
    create: vi.fn(),
    list: vi.fn().mockReturnValue(of({ items: [] })),
    get: vi.fn().mockReturnValue(of(null)),
    update: vi.fn(),
  };
}

let caps: ReturnType<typeof makeCaps>;
let exps: ReturnType<typeof makeExps>;
let router: { navigateByUrl: ReturnType<typeof vi.fn>; url: string };

function build() {
  caps = makeCaps();
  exps = makeExps();
  router = { navigateByUrl: vi.fn(), url: '/' };
  TestBed.configureTestingModule({
    providers: [
      { provide: CapabilityCatalogService, useValue: caps },
      { provide: ExperienceCatalogService, useValue: exps },
      { provide: Router, useValue: router },
      { provide: FeatureFlagsService, useValue: { aiAssistedAuthoring: () => true } },
    ],
  });
  // Blank the template so only the constructor runs (no <mvk-chat-shell> deps).
  TestBed.overrideComponent(CopilotRailComponent, { set: { template: '', imports: [] } });
  TestBed.createComponent(CopilotRailComponent); // constructor populates authoringBridge
}

describe('copilot rail bridge', () => {
  beforeEach(() => { TestBed.resetTestingModule(); build(); });

  it('createDraft: a capability kind goes to the catalog as an ai-assisted draft and navigates to its designer', async () => {
    caps.create.mockReturnValue(of({ id: 'f1', name: 'contact', kind: 'form', body: {} }));
    const draft = await authoringBridge.createDraft!('form', 'contact', { schema: { fields: [] } });
    expect(caps.create).toHaveBeenCalledWith({ kind: 'form', name: 'contact', body: { schema: { fields: [] } }, authoredBy: 'ai-assisted' });
    expect(draft).toMatchObject({ id: 'f1', kind: 'form', designerPath: '/forms/f1/design' });
    expect(router.navigateByUrl).toHaveBeenCalledWith('/forms/f1/design');
  });

  it('createDraft: an experience goes to the SEPARATE store, splitting title/goal from the body, and opens its detail page', async () => {
    exps.create.mockReturnValue(of({ id: 'e1', name: 'exp', title: 'Trip', goal: 'book', body: {} }));
    const draft = await authoringBridge.createDraft!('experience', 'exp', {
      title: 'Trip', goal: 'book', intents: ['travel'], requires: [{ kind: 'form', name: 'contact' }],
    });
    expect(exps.create).toHaveBeenCalledWith({
      name: 'exp', title: 'Trip', goal: 'book',
      body: { intents: ['travel'], requires: [{ kind: 'form', name: 'contact' }] },
    });
    expect(caps.create).not.toHaveBeenCalled();
    expect(draft).toMatchObject({ id: 'e1', kind: 'experience', designerPath: '/experiences/e1' });
  });

  it('createDraft: an experience with no title/goal falls back to the name', async () => {
    exps.create.mockReturnValue(of({ id: 'e2', name: 'solo' }));
    await authoringBridge.createDraft!('experience', 'solo', { requires: [] });
    expect(exps.create).toHaveBeenCalledWith({ name: 'solo', title: 'solo', goal: 'solo', body: { intents: undefined, requires: [] } });
  });

  it('list: capability kinds read the catalog; experience reads the experiences store', async () => {
    caps.listByKind.mockReturnValue(of({ items: [{ id: 'a', name: 'a', kind: 'form', lifecycle: 'draft' }] }));
    const forms = await authoringBridge.list!('form');
    expect(caps.listByKind).toHaveBeenCalledWith('form');
    expect(forms).toEqual([{ id: 'a', name: 'a', kind: 'form', lifecycle: 'draft' }]);

    exps.list.mockReturnValue(of({ items: [{ id: 'e', name: 'exp', approvalState: 'approved', body: {} }] }));
    const experiences = await authoringBridge.list!('experience');
    expect(exps.list).toHaveBeenCalled();
    expect(experiences).toEqual([{ id: 'e', name: 'exp', kind: 'experience', lifecycle: 'approved' }]);
  });

  it('get: returns a capability body; for an experience, merges title/goal with its body', async () => {
    caps.get.mockReturnValue(of({ id: 'f1', name: 'contact', kind: 'form', body: { schema: 1 } }));
    expect(await authoringBridge.get!('f1', 'form')).toEqual({ schema: 1 });

    exps.get.mockReturnValue(of({ id: 'e1', name: 'exp', title: 'T', goal: 'G', body: { requires: [1] } }));
    expect(await authoringBridge.get!('e1', 'experience')).toEqual({ title: 'T', goal: 'G', requires: [1] });
  });

  it('updateDraft: a capability shallow-merges the patch into its body with the loaded version', async () => {
    caps.get.mockReturnValue(of({ id: 'c1', name: 'x', kind: 'form', body: { a: 1 }, version: 3 }));
    caps.update.mockReturnValue(of({ id: 'c1', name: 'x', kind: 'form' }));
    const draft = await authoringBridge.updateDraft!('c1', 'form', { b: 2 });
    expect(caps.update).toHaveBeenCalledWith('c1', { body: { a: 1, b: 2 } }, 3);
    expect(draft).toMatchObject({ id: 'c1', kind: 'form', designerPath: '/forms/c1/design' });
  });

  it('updateDraft: an experience splits title/goal top-level from intents/requires in the body', async () => {
    exps.get.mockReturnValue(of({ id: 'e1', name: 'exp', title: 'T', goal: 'G', body: { requires: [1] } }));
    exps.update.mockReturnValue(of({ id: 'e1', name: 'exp' }));
    await authoringBridge.updateDraft!('exp', 'experience', { goal: 'G2', requires: [2] });
    expect(exps.update).toHaveBeenCalledWith('e1', { goal: 'G2', body: { requires: [2] } });
    expect(caps.update).not.toHaveBeenCalled();
  });

  it('getActive: parses the routed designer/detail URL to { id, kind }', () => {
    router.url = '/forms/f1/design';
    expect(authoringBridge.getActive!()).toEqual({ id: 'f1', kind: 'form' });
    router.url = '/experiences/e1';
    expect(authoringBridge.getActive!()).toEqual({ id: 'e1', kind: 'experience' });
    router.url = '/workflows/w9/design?tab=steps';
    expect(authoringBridge.getActive!()).toEqual({ id: 'w9', kind: 'workflow' });
    router.url = '/prompts';        // a list route, no open capability
    expect(authoringBridge.getActive!()).toBeNull();
    router.url = '/';
    expect(authoringBridge.getActive!()).toBeNull();
  });
});
