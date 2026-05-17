import { agenticTool } from '@infra-tools/agentic-ui';
import { z } from 'zod';

export const redeemPointsTool = agenticTool({
  name: 'redeemPoints',
  description: 'Redeem loyalty points for a reward (flight, upgrade, gift card). Returns a redemption confirmation.',
  schema: z.object({
    points: z.number().int().positive().describe('Number of points to redeem'),
    reward: z.enum(['flight', 'upgrade', 'gift-card']).describe('Reward type'),
  }),
  handler: async ({ points, reward }) => ({
    redemptionId: `RD-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    points,
    reward,
    status: 'completed',
  }),
});
