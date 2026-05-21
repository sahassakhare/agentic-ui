import { describe, expect, it } from 'vitest';
import { componentTreeNodeSchema, MCP_UI_COMPONENT_TREE_MIME, mcpUiResourceSchema } from './types';

/**
 * Phase 3 — component-tree validation. The recursive renderer itself
 * (`McpUiComponentTreeComponent`) is a thin ngComponentOutlet wrapper
 * exercised by the lib's component-test infra; this spec covers the
 * Zod boundary that gates what reaches the renderer.
 */

describe('componentTreeNodeSchema', () => {
  it('accepts a leaf node', () => {
    expect(componentTreeNodeSchema.safeParse({ component: 'flightCard', props: { from: 'LAX' } }).success).toBe(true);
  });

  it('accepts a nested tree', () => {
    const tree = {
      component: 'panel',
      props: { title: 'Trip' },
      children: [
        { component: 'flightCard', props: { from: 'LAX', to: 'JFK' } },
        { component: 'priceBlock', props: { amount: 342 }, children: [{ component: 'footnote' }] },
      ],
    };
    expect(componentTreeNodeSchema.safeParse(tree).success).toBe(true);
  });

  it('rejects a node missing component', () => {
    expect(componentTreeNodeSchema.safeParse({ props: { x: 1 } }).success).toBe(false);
  });

  it('rejects a node with an empty component name', () => {
    expect(componentTreeNodeSchema.safeParse({ component: '' }).success).toBe(false);
  });

  it('rejects malformed children', () => {
    expect(componentTreeNodeSchema.safeParse({ component: 'panel', children: [{ notAComponent: true }] }).success).toBe(false);
  });
});

describe('mcpUiResourceSchema — component-tree MIME', () => {
  it('accepts a component-tree resource', () => {
    const r = mcpUiResourceSchema.safeParse({
      uri: 'ui://tree/1',
      mimeType: MCP_UI_COMPONENT_TREE_MIME,
      content: JSON.stringify({ component: 'panel', children: [{ component: 'card' }] }),
    });
    expect(r.success).toBe(true);
  });
});
