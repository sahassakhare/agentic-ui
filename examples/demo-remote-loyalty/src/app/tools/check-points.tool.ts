import { agenticTool } from '@maverick/agentic-ui';
import { z } from 'zod';

export const checkPointsTool = agenticTool({
  name: 'checkPoints',
  description: 'Check the current loyalty points balance and tier status. Returns balance + tier and renders a points card UI.',
  schema: z.object({}),
  handler: async () => {
    const balance = Math.round(15_000 + Math.random() * 35_000);
    const tier = balance > 40_000 ? 'platinum' : balance > 25_000 ? 'gold' : 'silver';
    const nextTier = tier === 'silver' ? 'gold' : tier === 'gold' ? 'platinum' : null;
    const nextTierAt = nextTier === 'gold' ? 25_000 : nextTier === 'platinum' ? 40_000 : null;
    const props = { balance, tier, nextTier: nextTier ?? '', nextTierAt };
    return { ...props, components: [{ name: 'pointsCard', props }] };
  },
});
