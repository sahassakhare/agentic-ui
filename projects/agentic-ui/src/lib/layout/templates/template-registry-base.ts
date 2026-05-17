import { computed, Injectable, signal } from '@angular/core';
import { randomId } from '../../chat/message-utils';
import {
  type ApprovalEvent,
  type TemplateApprovalState,
} from './types';
import type { TemplateMeta } from './types';
import { ApprovalTransitionError, nextState } from './approval-workflow';

/**
 * Base class for `LayoutTemplateRegistry` + `DashboardTemplateRegistry`.
 * Manages the in-memory registry of templates plus the approval state
 * machine. Persistence is intentionally NOT inside the registry —
 * adopters wire a `LayeredLayoutStore` (PR2 D2/D3) or another
 * persistence layer on top for cross-session durability.
 *
 * Why a separate base from `RegistryBase` (the lib's main registry
 * machinery): the approval workflow + template-specific querying
 * (by state, by visibility, by tag) aren't part of the generic
 * RegistryBase contract. Keeping it parallel preserves the simpler
 * shape RegistryBase is doing for tools / widgets / etc.
 */
export abstract class TemplateRegistryBase<T extends TemplateMeta> {
  protected readonly _entries = signal<readonly T[]>([]);
  readonly entries = this._entries.asReadonly();

  /** Templates currently in `approved` state — what the picker shows by default. */
  readonly approved = computed(() => this._entries().filter((e) => e.approvalState === 'approved'));

  /** Templates in any non-terminal state needing reviewer attention. */
  readonly pendingReview = computed(() => this._entries().filter((e) => e.approvalState === 'review'));

  /** Register a fresh template (in `draft` state). Adopters can override default state via opts. */
  register(template: T): void {
    this.assertUniqueName(template.name);
    this._entries.update((cur) => [...cur, template]);
  }

  /** Look up by name. */
  get(name: string): T | undefined {
    return this._entries().find((e) => e.name === name);
  }

  /** List templates whose `approvalState` is in the provided set. */
  listByState(states: readonly TemplateApprovalState[]): readonly T[] {
    const set = new Set(states);
    return this._entries().filter((e) => set.has(e.approvalState));
  }

  /** List templates carrying any of the provided tags. */
  listByTag(tags: readonly string[]): readonly T[] {
    const set = new Set(tags);
    return this._entries().filter((e) => e.tags.some((t) => set.has(t)));
  }

  /**
   * Run a workflow action against a template — submit / approve /
   * reject / deprecate / revoke. Validates the transition via the
   * state machine, then appends an ApprovalEvent to the chain +
   * swaps the entry's approvalState.
   */
  transition(name: string, action: ApprovalEvent['action'], opts: {
    actor: ApprovalEvent['actor'];
    comment?: string;
  }): void {
    const entry = this.get(name);
    if (!entry) throw new Error(`[TemplateRegistry] template "${name}" not registered.`);
    const toState = nextState(entry.approvalState, action);
    const event: ApprovalEvent = {
      id: randomId('approval'),
      timestamp: new Date().toISOString(),
      actor: opts.actor,
      action,
      fromState: entry.approvalState,
      toState,
      comment: opts.comment,
    };
    const updated = {
      ...entry,
      approvalState: toState,
      approvalChain: [...entry.approvalChain, event],
    } as T;
    this._entries.update((cur) => cur.map((e) => (e.name === name ? updated : e)));
  }

  /** Convenience — full approval chain for one template. */
  approvalChain(name: string): readonly ApprovalEvent[] {
    return this.get(name)?.approvalChain ?? [];
  }

  /** Admin/test helper — wipe the registry. */
  clear(): void {
    this._entries.set([]);
  }

  private assertUniqueName(name: string): void {
    if (this._entries().some((e) => e.name === name)) {
      throw new Error(`[TemplateRegistry] template "${name}" is already registered.`);
    }
  }
}

// Re-export the error so consumers can pattern-match without
// importing from the workflow module.
export { ApprovalTransitionError };
