import { inject, Injectable } from '@angular/core';
import { CONTEXT_CONTRIBUTOR, type ContextFragment } from './types';

/**
 * Assembles the per-turn agent-context block (ADR-046 D5) from every
 * registered `ContextContributor`. Two output shapes:
 *
 *  - `compose()` — XML-like string. Drop it into the agent's system
 *    instruction or the `messages` array as a system block. LLMs parse
 *    XML-tagged context reliably; this is the path the chat-shell
 *    integration uses.
 *  - `composeStructured()` — the raw `ContextFragment[]`. For hosts
 *    that prefer JSON or want to filter / transform before sending.
 *
 * Adopters extend the block by registering additional contributors via
 * `provideAgentContext({ extraContributors: [MyContributor] })`. The
 * lib ships route / persona / layout-state contributors out of the box;
 * adopters add selection / recent-tool-calls / matter-phase / alert
 * contributors as their app exposes those signals.
 */
@Injectable({ providedIn: 'root' })
export class AgentContextProvider {
  private readonly contributors = inject(CONTEXT_CONTRIBUTOR);

  /**
   * Build the full context block as an XML-like string. Empty string
   * if no contributor produced a fragment this turn (so callers can
   * safely concatenate without conditional logic).
   */
  compose(): string {
    const fragments = this.composeStructured();
    if (fragments.length === 0) return '';
    const inner = fragments.map((f) => renderFragment(f, 2)).join('\n');
    return `<context>\n${inner}\n</context>`;
  }

  /**
   * Raw structured fragments in `order` ascending, with null
   * contributions filtered out. Cheaper than `compose()` when the
   * caller wants to inspect / transform before serializing.
   */
  composeStructured(): readonly ContextFragment[] {
    return this.contributors
      .map((c) => ({ order: c.order, fragment: c.contribute() }))
      .filter(
        (entry): entry is { order: number; fragment: ContextFragment } =>
          entry.fragment !== null,
      )
      .sort((a, b) => a.order - b.order)
      .map((entry) => entry.fragment);
  }
}

function renderFragment(f: ContextFragment, indent: number): string {
  const pad = ' '.repeat(indent);
  const attrs = f.attrs
    ? Object.entries(f.attrs)
        .map(([k, v]) => ` ${k}="${escapeAttr(String(v))}"`)
        .join('')
    : '';
  if (f.content === undefined) {
    return `${pad}<${f.tag}${attrs} />`;
  }
  if (typeof f.content === 'string') {
    return `${pad}<${f.tag}${attrs}>${escapeText(f.content)}</${f.tag}>`;
  }
  if (f.content.length === 0) {
    return `${pad}<${f.tag}${attrs} />`;
  }
  const nested = f.content.map((c) => renderFragment(c, indent + 2)).join('\n');
  return `${pad}<${f.tag}${attrs}>\n${nested}\n${pad}</${f.tag}>`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
