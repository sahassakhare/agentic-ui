import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import type { LayoutDef } from '../../types/registry-defs';
import { LayoutTemplateRegistry } from './layout-template-registry';
import { ApprovalTransitionError } from './approval-workflow';
import type { LayoutTemplate } from './types';

function makeBody(name: string): LayoutDef {
  return {
    name,
    description: 'test layout',
    slots: ['primary'],
    component: class {} as never,
  };
}

function makeTemplate(name: string, overrides: Partial<LayoutTemplate> = {}): LayoutTemplate {
  return {
    name,
    title: `Title ${name}`,
    description: 'desc',
    approvalState: 'draft',
    approvalChain: [],
    author: { userId: 'u1', tenantId: 't1' },
    visibility: 'tenant',
    tags: [],
    body: makeBody(name),
    ...overrides,
  };
}

describe('LayoutTemplateRegistry', () => {
  let reg: LayoutTemplateRegistry;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    reg = TestBed.inject(LayoutTemplateRegistry);
  });

  it('register + get + entries signal', () => {
    reg.register(makeTemplate('a'));
    reg.register(makeTemplate('b'));
    expect(reg.entries().map((e) => e.name)).toEqual(['a', 'b']);
    expect(reg.get('a')?.title).toBe('Title a');
    expect(reg.get('missing')).toBeUndefined();
  });

  it('rejects duplicate names', () => {
    reg.register(makeTemplate('a'));
    expect(() => reg.register(makeTemplate('a'))).toThrow(/already registered/);
  });

  it('approved() filters to approved state only', () => {
    reg.register(makeTemplate('a', { approvalState: 'approved' }));
    reg.register(makeTemplate('b', { approvalState: 'draft' }));
    reg.register(makeTemplate('c', { approvalState: 'approved' }));
    expect(reg.approved().map((e) => e.name)).toEqual(['a', 'c']);
  });

  it('pendingReview() surfaces only the review state', () => {
    reg.register(makeTemplate('a', { approvalState: 'review' }));
    reg.register(makeTemplate('b', { approvalState: 'draft' }));
    expect(reg.pendingReview().map((e) => e.name)).toEqual(['a']);
  });

  it('listByState narrows to a custom state set', () => {
    reg.register(makeTemplate('a', { approvalState: 'rejected' }));
    reg.register(makeTemplate('b', { approvalState: 'deprecated' }));
    expect(reg.listByState(['rejected', 'deprecated']).map((e) => e.name)).toEqual(['a', 'b']);
  });

  it('listByTag returns templates carrying any of the provided tags', () => {
    reg.register(makeTemplate('a', { tags: ['privilege', 'review'] }));
    reg.register(makeTemplate('b', { tags: ['production'] }));
    reg.register(makeTemplate('c', { tags: [] }));
    expect(reg.listByTag(['privilege']).map((e) => e.name)).toEqual(['a']);
    expect(reg.listByTag(['production', 'privilege']).map((e) => e.name).sort()).toEqual(['a', 'b']);
  });

  describe('transition workflow', () => {
    it('appends an ApprovalEvent + updates state on every legal transition', () => {
      reg.register(makeTemplate('a'));
      const actor = { userId: 'admin', displayName: 'Admin' };
      reg.transition('a', 'submit', { actor });
      expect(reg.get('a')?.approvalState).toBe('review');
      expect(reg.approvalChain('a')).toHaveLength(1);
      reg.transition('a', 'approve', { actor, comment: 'looks good' });
      expect(reg.get('a')?.approvalState).toBe('approved');
      expect(reg.approvalChain('a')).toHaveLength(2);
      expect(reg.approvalChain('a')[1].comment).toBe('looks good');
    });

    it('throws on illegal transitions', () => {
      reg.register(makeTemplate('a'));
      const actor = { userId: 'admin' };
      // draft → approve isn't valid; must submit first.
      expect(() => reg.transition('a', 'approve', { actor })).toThrow(ApprovalTransitionError);
    });

    it('throws when target template missing', () => {
      expect(() => reg.transition('missing', 'submit', { actor: { userId: 'u' } })).toThrow(/not registered/);
    });

    it('records the from/to state on each ApprovalEvent', () => {
      reg.register(makeTemplate('a'));
      const actor = { userId: 'u' };
      reg.transition('a', 'submit', { actor });
      const event = reg.approvalChain('a')[0];
      expect(event.fromState).toBe('draft');
      expect(event.toState).toBe('review');
      expect(event.action).toBe('submit');
    });
  });

  it('clear() wipes the registry', () => {
    reg.register(makeTemplate('a'));
    reg.register(makeTemplate('b'));
    reg.clear();
    expect(reg.entries()).toEqual([]);
  });
});
