/**
 * Host tools the agentic assistant can call to actually operate the workspace.
 * These make the assistant *agentic* — it doesn't just talk, it navigates the
 * app and reads its governed catalog. Registered as `host`-source tools via the
 * platform facade; the run-loop (`runUntilSettled`) executes them and feeds the
 * results back to the model.
 */
import { z } from 'zod';
import { agenticTool, type ToolDef } from '@infra-tools/agentic-ui';
import { shellApi } from './shell-api';

/** List the applications/dashboards available in the current workspace menu. */
const listApplications = agenticTool({
  name: 'listApplications',
  description: "List the applications and dashboards available in the user's workspace, with whether each is a dashboard or a guided journey.",
  schema: z.object({}),
  handler: () => {
    const items = shellApi.listMenu?.() ?? [];
    return { count: items.length, items };
  },
});

/** Open one of the workspace applications by its experience name. */
const openApplication = agenticTool({
  name: 'openApplication',
  description: 'Open one of the workspace applications (dashboard or journey) in the main view, by its experience name (see listApplications).',
  schema: z.object({
    name: z.string().describe('The experience name to open, e.g. "ops-overview" or "employee-onboarding".'),
  }),
  handler: ({ name }) => {
    const opened = shellApi.openExperience?.(name) ?? false;
    return opened
      ? { opened: true, name }
      : { opened: false, name, error: `No application named "${name}". Call listApplications to see valid names.` };
  },
});

/** The host tool-kit passed to provideAgenticUiPlatform. */
export const appTools: ToolDef[] = [listApplications, openApplication] as unknown as ToolDef[];
