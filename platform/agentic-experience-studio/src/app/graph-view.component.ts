import {
  Component,
  ElementRef,
  ViewChild,
  effect,
  input,
  type AfterViewInit,
  type OnDestroy,
} from '@angular/core';
import cytoscape, { type Core } from 'cytoscape';
import type { GraphElement } from './experience-graph';

/**
 * Renders the capability **dependency** graph (AEP Seam A viz) with cytoscape:
 * the experience root and the capabilities it requires, edges coloured by
 * matched / unmet and dashed when optional. A breadthfirst layout rooted at
 * the experience reads the dependency DAG top-down. This is the dependency-edge
 * view the ops-console containment graph deliberately lacks.
 */
@Component({
  selector: 'aes-graph-view',
  template: '<div #host class="cy"></div>',
  styles: [`
    .cy { width: 100%; height: 360px; border: 1px solid color-mix(in srgb, currentColor 15%, transparent);
      border-radius: 8px; }
  `],
})
export class GraphViewComponent implements AfterViewInit, OnDestroy {
  readonly elements = input<readonly GraphElement[]>([]);

  @ViewChild('host', { static: true }) private readonly host!: ElementRef<HTMLElement>;
  private cy?: Core;

  constructor() {
    // Re-render whenever the input changes (after init).
    effect(() => {
      const els = this.elements();
      if (this.cy) this.render(els);
    });
  }

  ngAfterViewInit(): void {
    this.cy = cytoscape({
      container: this.host.nativeElement,
      // cytoscape's element/style types are stricter than our structurally
      // compatible shapes; widen at the boundary (ops-console does the same).
      elements: toElements(this.elements()),
      style: STYLESHEET as unknown as cytoscape.StylesheetStyle[],
      minZoom: 0.3,
      maxZoom: 2.5,
      wheelSensitivity: 0.25,
    });
    this.runLayout();
  }

  ngOnDestroy(): void {
    this.cy?.destroy();
  }

  private render(els: readonly GraphElement[]): void {
    if (!this.cy) return;
    this.cy.json({ elements: toElements(els) });
    this.runLayout();
  }

  private runLayout(): void {
    if (!this.cy) return;
    this.cy.layout({ name: 'breadthfirst', directed: true, padding: 20, spacingFactor: 1.1 }).run();
    this.cy.fit(undefined, 30);
  }
}

/** Widen our structurally-compatible GraphElement[] to cytoscape's element type. */
function toElements(els: readonly GraphElement[]): cytoscape.ElementDefinition[] {
  return els as unknown as cytoscape.ElementDefinition[];
}

/** Cytoscape stylesheet — node colour by state, dashed optional edges. */
const STYLESHEET = [
  {
    selector: 'node',
    style: {
      label: 'data(label)',
      'font-size': 11,
      color: '#444',
      'text-valign': 'center',
      'text-halign': 'center',
      'text-margin-y': -14,
      width: 14,
      height: 14,
      'background-color': '#94a3b8',
    },
  },
  { selector: 'node.root', style: { 'background-color': '#4682b4', width: 20, height: 20, 'font-weight': 'bold' } },
  { selector: 'node.matched', style: { 'background-color': '#2e8b57' } },
  { selector: 'node.unmet', style: { 'background-color': '#dc143c' } },
  {
    selector: 'edge',
    style: {
      width: 1.5,
      'line-color': '#cbd5e1',
      'target-arrow-color': '#cbd5e1',
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier',
    },
  },
  { selector: 'edge.optional', style: { 'line-style': 'dashed', 'line-color': '#94a3b8' } },
];
