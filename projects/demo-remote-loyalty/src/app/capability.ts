import { defineCapabilityModule } from '@maverick/agentic-ui';
import type { ToolDef } from '@maverick/agentic-ui';
import { checkPointsTool } from './tools/check-points.tool';
import { redeemPointsTool } from './tools/redeem-points.tool';
import { pointsCardWidget } from './widgets/points-card.widget';

export const capability = defineCapabilityModule({
  remoteName: 'demo-remote-loyalty',
  version: '1.0.0',
  tools: [checkPointsTool as ToolDef, redeemPointsTool as ToolDef],
  components: [pointsCardWidget],
});
