import type { Type } from '@angular/core';
import type { ZodTypeAny } from 'zod';
import type { ComponentDef } from '../types/registry-defs';

export interface AgenticWidgetConfig {
  readonly name: string;
  readonly component: Type<unknown>;
  readonly propsSchema: ZodTypeAny;
  /**
   * Optional list of `DataSourceRegistry` entry names this widget consumes
   * (Capability F2). Mount-time machinery validates every declared name
   * resolves before instantiating the component.
   */
  readonly dataSources?: readonly string[];
}

/**
 * Factory for component (widget) definitions registered with the agent's
 * ComponentRegistry. The Zod schema validates props before they reach the
 * component instance via `*ngComponentOutlet` inputs.
 */
export function agenticWidget(config: AgenticWidgetConfig): ComponentDef {
  return {
    name: config.name,
    component: config.component,
    propsSchema: config.propsSchema,
    ...(config.dataSources !== undefined ? { dataSources: config.dataSources } : {}),
  };
}
