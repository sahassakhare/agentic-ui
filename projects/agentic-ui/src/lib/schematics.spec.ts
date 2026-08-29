/**
 * Schematic snapshot tests. Runs each generator from the compiled collection
 * (`dist/agentic-ui/schematics`) against a simulated Angular workspace tree
 * and asserts the resulting file set + content.
 *
 * Run order matters: this spec assumes `npm run build:schematics` has produced
 * `dist/agentic-ui/schematics/` and copied the non-TS assets. CI runs
 * `npm run build:lib` (which chains build:schematics) before `ng test`.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { SchematicTestRunner, UnitTestTree } from '@angular-devkit/schematics/testing';
import { Tree } from '@angular-devkit/schematics';

// Tests run with cwd = workspace root (Vitest's default for `ng test`).
const COLLECTION_PATH = 'dist/agentic-ui/schematics/collection.json';

const WORKSPACE_NAME = 'demo';

function baseWorkspace(): Tree {
  const tree = Tree.empty();
  tree.create('package.json', JSON.stringify({
    name: 'host',
    version: '0.0.1',
    dependencies: {},
    devDependencies: {},
  }, null, 2));
  tree.create('angular.json', JSON.stringify({
    $schema: './node_modules/@angular/cli/lib/config/schema.json',
    version: 1,
    newProjectRoot: 'projects',
    projects: {
      [WORKSPACE_NAME]: {
        projectType: 'application',
        root: '',
        sourceRoot: 'src',
        prefix: 'app',
        architect: {
          build: { builder: '@angular/build:application', options: {}, configurations: {} },
        },
      },
    },
  }, null, 2));
  tree.create('tsconfig.json', '{ "compilerOptions": { "paths": {} } }');
  tree.create('src/app/app.config.ts', `import { ApplicationConfig } from '@angular/core';

export const appConfig: ApplicationConfig = {
  providers: [],
};
`);
  tree.create('src/app/app.routes.ts', 'export const routes = [];');
  return tree;
}

describe('schematics: tool', () => {
  let runner: SchematicTestRunner;
  beforeEach(() => { runner = new SchematicTestRunner('@infra-tools/agentic-ui', COLLECTION_PATH); });

  it('creates a *.tool.ts with agenticTool() + Zod schema scaffold', async () => {
    const tree = await runner.runSchematic('tool', { name: 'bookFlight' }, baseWorkspace());
    const files = tree.files.filter((f) => f.includes('agentic/tools/'));
    expect(files).toContain('/src/app/agentic/tools/book-flight.tool.ts');
    const content = tree.readContent('/src/app/agentic/tools/book-flight.tool.ts');
    expect(content).toContain("import { agenticTool } from '@infra-tools/agentic-ui';");
    expect(content).toContain("import { z } from 'zod';");
    expect(content).toContain("name: 'bookFlight'");
    expect(content).toContain("agenticTool({");
    expect(content).toContain("z.object({");
  });

  it('honors --executeIn=remote', async () => {
    const tree = await runner.runSchematic('tool', { name: 'syncPrefs', executeIn: 'remote' }, baseWorkspace());
    const content = tree.readContent('/src/app/agentic/tools/sync-prefs.tool.ts');
    expect(content).toContain("executeIn: 'remote'");
  });
});

describe('schematics: widget', () => {
  let runner: SchematicTestRunner;
  beforeEach(() => { runner = new SchematicTestRunner('@infra-tools/agentic-ui', COLLECTION_PATH); });

  it('creates a standalone component + agenticWidget factory', async () => {
    const tree = await runner.runSchematic('widget', { name: 'FlightCard' }, baseWorkspace());
    expect(tree.files).toContain('/src/app/agentic/widgets/flight-card.component.ts');
    expect(tree.files).toContain('/src/app/agentic/widgets/flight-card.widget.ts');
    const cmp = tree.readContent('/src/app/agentic/widgets/flight-card.component.ts');
    expect(cmp).toContain("selector: 'app-flight-card'");
    expect(cmp).toContain('FlightCardComponent');
    const widget = tree.readContent('/src/app/agentic/widgets/flight-card.widget.ts');
    expect(widget).toContain("agenticWidget({");
    expect(widget).toContain("name: 'flightCard'");
    expect(widget).toContain('FlightCardComponent');
  });
});

describe('schematics: action / intent / form', () => {
  let runner: SchematicTestRunner;
  beforeEach(() => { runner = new SchematicTestRunner('@infra-tools/agentic-ui', COLLECTION_PATH); });

  it('action: scaffolds *.action.ts with agenticAction()', async () => {
    const tree = await runner.runSchematic('action', { name: 'navigateToBooking' }, baseWorkspace());
    const content = tree.readContent('/src/app/agentic/actions/navigate-to-booking.action.ts');
    expect(content).toContain("agenticAction({");
    expect(content).toContain("type: 'navigateToBooking'");
  });

  it('intent: scaffolds *.intent.ts with mapsTo block', async () => {
    const tree = await runner.runSchematic('intent', { name: 'showFlights', kind: 'tool', target: 'searchFlights' }, baseWorkspace());
    const content = tree.readContent('/src/app/agentic/intents/show-flights.intent.ts');
    expect(content).toContain("agenticIntent({");
    expect(content).toContain("kind: 'tool'");
    expect(content).toContain("target: 'searchFlights'");
  });

  it('form: scaffolds *.form.ts with fieldsSchema + submit', async () => {
    const tree = await runner.runSchematic('form', { name: 'bookingForm' }, baseWorkspace());
    const content = tree.readContent('/src/app/agentic/forms/booking-form.form.ts');
    expect(content).toContain("agenticForm({");
    expect(content).toContain("fieldsSchema:");
    expect(content).toContain("submit:");
  });
});

describe('schematics: chat-shell', () => {
  it('scaffolds a standalone component using <mvk-chat-shell>', async () => {
    const runner = new SchematicTestRunner('@infra-tools/agentic-ui', COLLECTION_PATH);
    const tree = await runner.runSchematic('chat-shell', { name: 'Chat' }, baseWorkspace());
    const content = tree.readContent('/src/app/chat/chat.component.ts');
    expect(content).toContain('ChatShellComponent');
    expect(content).toContain('<mvk-chat-shell />');
    expect(content).toContain('@infra-tools/agentic-ui');
  });
});

describe('schematics: backend', () => {
  it('scaffolds an AgenticBackend adapter + provider factory', async () => {
    const runner = new SchematicTestRunner('@infra-tools/agentic-ui', COLLECTION_PATH);
    const tree = await runner.runSchematic('backend', { name: 'AcmeBackend' }, baseWorkspace());
    const content = tree.readContent('/src/app/agentic/backends/acme-backend.backend.ts');
    expect(content).toContain('class AcmeBackend implements AgenticBackend');
    expect(content).toContain('provideAcmeBackend');
    expect(content).toContain('provideAgenticBackend({');
  });
});

describe('schematics: mfe-capability', () => {
  it('scaffolds capability.ts + capabilities.json', async () => {
    const runner = new SchematicTestRunner('@infra-tools/agentic-ui', COLLECTION_PATH);
    const tree = await runner.runSchematic('mfe-capability', { remoteName: 'bookings' }, baseWorkspace());
    expect(tree.files).toContain('/src/app/capability/capability.ts');
    expect(tree.files).toContain('/src/app/capability/capabilities.json');
    const ts = tree.readContent('/src/app/capability/capability.ts');
    expect(ts).toContain("defineCapabilityModule({");
    expect(ts).toContain("remoteName: 'bookings'");
    const json = JSON.parse(tree.readContent('/src/app/capability/capabilities.json'));
    expect(json.remoteName).toBe('bookings');
    expect(json.exposes).toBeDefined();
  });
});

describe('schematics: agent-server', () => {
  it('scaffolds a Hono server project under projects/<name>/', async () => {
    const runner = new SchematicTestRunner('@infra-tools/agentic-ui', COLLECTION_PATH);
    const tree = await runner.runSchematic('agent-server', { name: 'my-agent', port: 4111 }, baseWorkspace());
    expect(tree.files).toContain('/projects/my-agent/package.json');
    expect(tree.files).toContain('/projects/my-agent/src/server.ts');
    const server = tree.readContent('/projects/my-agent/src/server.ts');
    expect(server).toContain("import { serve } from '@hono/node-server';");
    expect(server).toContain('agUiRouteHandler');
    expect(server).toContain('EchoAgent');
  });
});

describe('schematics: trigger', () => {
  let runner: SchematicTestRunner;
  beforeEach(() => { runner = new SchematicTestRunner('@infra-tools/agentic-ui', COLLECTION_PATH); });

  it('scaffolds a cron + tool TriggerDef by default', async () => {
    const tree = await runner.runSchematic('trigger', { name: 'dailyAckSweep' }, baseWorkspace());
    expect(tree.files).toContain('/src/app/agentic/triggers/daily-ack-sweep.trigger.ts');
    const content = tree.readContent('/src/app/agentic/triggers/daily-ack-sweep.trigger.ts');
    expect(content).toContain("import type { TriggerDef } from '@infra-tools/agentic-ui';");
    expect(content).toContain("name: 'dailyAckSweep'");
    expect(content).toContain("kind: 'cron'");
    expect(content).toContain("{ kind: 'cron', expression: '@daily' }");
    expect(content).toContain("{ kind: 'tool', tool: 'myTool', args: {} }");
    expect(content).toContain('runAs: undefined');
  });

  it('honors --kind=webhook + --targetKind=notification', async () => {
    const tree = await runner.runSchematic(
      'trigger',
      { name: 'inboundPagerDuty', kind: 'webhook', spec: '/hooks/pagerduty', targetKind: 'notification', runAs: 'oncall' },
      baseWorkspace(),
    );
    const content = tree.readContent('/src/app/agentic/triggers/inbound-pager-duty.trigger.ts');
    expect(content).toContain("kind: 'webhook'");
    expect(content).toContain("{ kind: 'webhook', path: '/hooks/pagerduty' }");
    expect(content).toContain("kind: 'notification'");
    expect(content).toContain('compose:');
    expect(content).toContain("runAs: 'oncall'");
  });

  it('honors --kind=queue + --targetKind=action', async () => {
    const tree = await runner.runSchematic(
      'trigger',
      { name: 'ingestComplete', kind: 'queue', spec: 'matters.ingest.complete', targetKind: 'action', target: 'refreshMatter' },
      baseWorkspace(),
    );
    const content = tree.readContent('/src/app/agentic/triggers/ingest-complete.trigger.ts');
    expect(content).toContain("{ kind: 'queue', topic: 'matters.ingest.complete' }");
    expect(content).toContain("{ kind: 'action', action: 'refreshMatter' }");
  });
});

describe('schematics: dashboard', () => {
  it('scaffolds a DashboardDef with commented tile placeholders', async () => {
    const runner = new SchematicTestRunner('@infra-tools/agentic-ui', COLLECTION_PATH);
    const tree = await runner.runSchematic(
      'dashboard',
      { name: 'matterHealth', title: 'Matter health', description: 'Matter-level KPIs.', layout: 'three-col' },
      baseWorkspace(),
    );
    expect(tree.files).toContain('/src/app/agentic/dashboards/matter-health.dashboard.ts');
    const content = tree.readContent('/src/app/agentic/dashboards/matter-health.dashboard.ts');
    expect(content).toContain("import type { DashboardDef } from '@infra-tools/agentic-ui';");
    expect(content).toContain("name: 'matterHealth'");
    expect(content).toContain("title: 'Matter health'");
    expect(content).toContain("layout: 'three-col'");
    expect(content).toContain('tiles: [');
    // Sanity check that tile examples for all three invocation kinds are present.
    expect(content).toContain("kind: 'tool'");
    expect(content).toContain("kind: 'data'");
    expect(content).toContain("kind: 'static'");
  });
});

describe('schematics: playbook', () => {
  it('scaffolds a PlaybookDef with step placeholders', async () => {
    const runner = new SchematicTestRunner('@infra-tools/agentic-ui', COLLECTION_PATH);
    const tree = await runner.runSchematic(
      'playbook',
      { name: 'initialPrivilegePass', title: 'Initial privilege pass', description: 'First-pass privilege review.' },
      baseWorkspace(),
    );
    expect(tree.files).toContain('/src/app/agentic/playbooks/initial-privilege-pass.playbook.ts');
    const content = tree.readContent('/src/app/agentic/playbooks/initial-privilege-pass.playbook.ts');
    expect(content).toContain("import type { PlaybookDef } from '@infra-tools/agentic-ui';");
    expect(content).toContain("name: 'initialPrivilegePass'");
    expect(content).toContain("title: 'Initial privilege pass'");
    expect(content).toContain("version: 'v1'");
    expect(content).toContain('steps: [');
    // The placeholder block should hint at both gating modifiers.
    expect(content).toContain('requiresApproval');
    expect(content).toContain('continueOnError');
  });
});

describe('schematics: connect-studio', () => {
  let runner: SchematicTestRunner;
  beforeEach(() => { runner = new SchematicTestRunner('@infra-tools/agentic-ui', COLLECTION_PATH); });

  it('wires provideCatalogRuntime from the library (no app-local scaffold)', async () => {
    const tree = await runner.runSchematic(
      'connect-studio',
      { tenant: 'acme', catalogUrl: 'http://localhost:8081', skipInstall: true },
      baseWorkspace(),
    );

    // The runtime lives in the library now — nothing is scaffolded into the app.
    expect(tree.files.some((f) => f.includes('/catalog-runtime/'))).toBe(false);

    // app.config.ts patched with the import (from the secondary entry) + provider.
    const config = tree.readContent('/src/app/app.config.ts');
    expect(config).toContain("import { provideCatalogRuntime } from '@infra-tools/agentic-ui/catalog';");
    expect(config).toContain("provideCatalogRuntime({ baseUrl: 'http://localhost:8081', tenant: 'acme' })");

    // Dependency added.
    expect(JSON.parse(tree.readContent('/package.json')).dependencies['@infra-tools/agentic-ui']).toBeDefined();
  });

  it('honors --authMode=oidc + --applicationName', async () => {
    const tree = await runner.runSchematic(
      'connect-studio',
      { tenant: 'legal', authMode: 'oidc', applicationName: 'legal-intake', skipInstall: true },
      baseWorkspace(),
    );
    const config = tree.readContent('/src/app/app.config.ts');
    expect(config).toContain("authMode: 'oidc'");
    expect(config).toContain("applicationName: 'legal-intake'");
  });

  it('adds { mode: shell } for --shell', async () => {
    const tree = await runner.runSchematic(
      'connect-studio',
      { tenant: 'acme', shell: true, skipInstall: true },
      baseWorkspace(),
    );
    const config = tree.readContent('/src/app/app.config.ts');
    expect(config).toContain("{ mode: 'shell' }");
  });
});
