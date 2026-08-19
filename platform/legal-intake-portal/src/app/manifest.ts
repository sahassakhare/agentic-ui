import type { PublishedManifest } from '@infra-tools/aep-embed-sdk';

/**
 * The published render manifest — what the catalog returns for a published
 * experience. In production this comes from the embed SDK:
 *
 *   import { createEmbedClient } from '@infra-tools/aep-embed-sdk';
 *   const client = createEmbedClient({ catalogUrl, tenant, key });
 *   const manifest = await client.getManifest('legal-intake-matter');
 *
 * Inlined here so the demo runs offline. Data + control-flow only — the
 * conflict-check branch is declarative and framework-agnostic; this portal
 * supplies every component itself (see steps.ts).
 */
export const MANIFEST: PublishedManifest = {
  experience: {
    name: 'legal-intake-matter',
    title: 'New Matter Intake',
    goal: 'Open a new legal matter — capture the client, scope the matter, clear conflicts, and set the fee arrangement before it reaches a partner.',
  },
  workflow: {
    steps: [
      { id: 'client', widget: 'legal-client-form', section: 'Client', next: 'matter' },
      { id: 'matter', widget: 'legal-matter-form', section: 'Matter', next: 'conflicts' },
      {
        id: 'conflicts', widget: 'legal-conflict-check', section: 'Conflicts',
        next: { branches: [{ when: { field: 'conflictFound', op: 'truthy' }, goto: 'conflict-review' }], default: 'fees' },
      },
      { id: 'conflict-review', widget: 'legal-conflict-review', section: 'Waiver', next: 'fees' },
      { id: 'fees', widget: 'legal-fee-form', section: 'Fees', next: 'review' },
      { id: 'review', widget: 'legal-matter-review', section: 'Review', next: null },
    ],
  },
  widgets: [
    { name: 'legal-client-form', kind: 'form' },
    { name: 'legal-matter-form', kind: 'form' },
    { name: 'legal-conflict-check', kind: 'component' },
    { name: 'legal-conflict-review', kind: 'form' },
    { name: 'legal-fee-form', kind: 'form' },
    { name: 'legal-matter-review', kind: 'component' },
  ],
  publishedVersionNo: 3,
  publishedAt: '2026-08-18T00:00:00Z',
};

/** The firm's book of business — an opposing party matching one trips a conflict. */
export const EXISTING_CLIENTS = ['Meridian Capital', 'Halcyon Health', 'Northwind Trading', 'Ashcroft Holdings'];
export const MATTER_TYPES = ['Litigation', 'Corporate', 'Intellectual Property', 'Employment', 'Real Estate'];
export const FEE_TYPES = ['Hourly', 'Fixed fee', 'Contingency'];
