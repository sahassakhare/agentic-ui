/**
 * Minimal module declaration for `cytoscape-cose-bilkent` — the
 * package doesn't ship its own .d.ts. We register it as a Cytoscape
 * extension via `cytoscape.use(coseBilkent)`; consumers reference
 * the layout name as a string `'cose-bilkent'` so we don't need rich
 * types.
 */
declare module 'cytoscape-cose-bilkent' {
  import type cytoscape from 'cytoscape';
  const ext: cytoscape.Ext;
  export default ext;
}
