import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolDef } from '@infra-tools/agentic-ui';
import { authoringTools } from './authoring-tools';
import { authoringBridge, lastDraft, designerPathFor } from './authoring-bridge';

const byName = (n: string) => authoringTools.find((t) => (t as ToolDef).name === n) as ToolDef;
const call = (t: ToolDef, args: unknown) => (t.handler as (a: unknown, c: unknown) => Promise<unknown>)(args, {});

describe('designerPathFor', () => {
  it('routes designer kinds to their /design page', () => {
    expect(designerPathFor('form', 'abc')).toBe('/forms/abc/design');
    expect(designerPathFor('workflow', 'w1')).toBe('/workflows/w1/design');
  });
  it('routes non-designer kinds to the registry list', () => {
    expect(designerPathFor('tool', 't1')).toBe('/tools');
    expect(designerPathFor('prompt', 'p1')).toBe('/prompts');
  });
});

describe('authoring tools', () => {
  beforeEach(() => {
    delete authoringBridge.createDraft;
    delete authoringBridge.updateDraft;
    delete authoringBridge.list;
    delete authoringBridge.get;
    delete authoringBridge.getActive;
    lastDraft.set(null);
  });

  it('exposes the five authoring tools', () => {
    expect(authoringTools.map((t) => (t as ToolDef).name).sort())
      .toEqual(['createDraftCapability', 'getActiveCapability', 'getCapability', 'listCapabilities', 'updateDraftCapability']);
  });

  it('getActiveCapability returns the open designer capability from the bridge', async () => {
    authoringBridge.getActive = () => ({ id: 'f7', kind: 'form' });
    expect(await call(byName('getActiveCapability'), {})).toEqual({ open: true, id: 'f7', kind: 'form' });
  });

  it('getActiveCapability reports none open when no designer is active', async () => {
    expect(await call(byName('getActiveCapability'), {})).toEqual({ open: false });
  });

  it('updateDraftCapability delegates to the bridge and records the last draft', async () => {
    const draft = { id: 'f9', name: 'contact-form', kind: 'form', designerPath: '/forms/f9/design' };
    authoringBridge.updateDraft = vi.fn().mockResolvedValue(draft);
    const patch = { schema: { fields: [{ name: 'phone', type: 'text' }] } };
    const res = await call(byName('updateDraftCapability'), { idOrName: 'contact-form', kind: 'form', bodyPatch: patch });
    expect(authoringBridge.updateDraft).toHaveBeenCalledWith('contact-form', 'form', patch);
    expect(res).toMatchObject({ ok: true, id: 'f9', designerPath: '/forms/f9/design' });
    expect(lastDraft()).toEqual(draft);
  });

  it('createDraftCapability delegates to the bridge and records the last draft', async () => {
    const draft = { id: 'f1', name: 'contact-form', kind: 'form', designerPath: '/forms/f1/design' };
    authoringBridge.createDraft = vi.fn().mockResolvedValue(draft);

    const body = { description: 'x', schema: { fields: [{ name: 'email', type: 'email' }] } };
    const res = await call(byName('createDraftCapability'), { kind: 'form', name: 'contact-form', body });

    expect(authoringBridge.createDraft).toHaveBeenCalledWith('form', 'contact-form', body);
    expect(res).toMatchObject({ ok: true, id: 'f1', kind: 'form', designerPath: '/forms/f1/design' });
    expect(lastDraft()).toEqual(draft);
  });

  it('createDraftCapability reports an error when the copilot is inactive', async () => {
    const res = await call(byName('createDraftCapability'), { kind: 'form', name: 'x', body: {} });
    expect(res).toMatchObject({ ok: false });
    expect(lastDraft()).toBeNull();
  });

  it('listCapabilities delegates to the bridge', async () => {
    authoringBridge.list = vi.fn().mockResolvedValue([{ id: 'a', name: 'a', kind: 'form' }]);
    const res = await call(byName('listCapabilities'), { kind: 'form' }) as { count: number };
    expect(authoringBridge.list).toHaveBeenCalledWith('form');
    expect(res.count).toBe(1);
  });

  it('getCapability returns the body when found', async () => {
    authoringBridge.get = vi.fn().mockResolvedValue({ description: 'hi' });
    const res = await call(byName('getCapability'), { idOrName: 'contact-form', kind: 'form' });
    expect(res).toEqual({ found: true, body: { description: 'hi' } });
  });
});
