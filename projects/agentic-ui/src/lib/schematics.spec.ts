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
  beforeEach(() => { runner = new SchematicTestRunner('@maverick/agentic-ui', COLLECTION_PATH); });

  it('creates a *.tool.ts with agenticTool() + Zod schema scaffold', async () => {
    const tree = await runner.runSchematic('tool', { name: 'bookFlight' }, baseWorkspace());
    const files = tree.files.filter((f) => f.includes('agentic/tools/'));
    expect(files).toContain('/src/app/agentic/tools/book-flight.tool.ts');
    const content = tree.readContent('/src/app/agentic/tools/book-flight.tool.ts');
    expect(content).toContain("import { agenticTool } from '@maverick/agentic-ui';");
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
  beforeEach(() => { runner = new SchematicTestRunner('@maverick/agentic-ui', COLLECTION_PATH); });

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
  beforeEach(() => { runner = new SchematicTestRunner('@maverick/agentic-ui', COLLECTION_PATH); });

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
    const runner = new SchematicTestRunner('@maverick/agentic-ui', COLLECTION_PATH);
    const tree = await runner.runSchematic('chat-shell', { name: 'Chat' }, baseWorkspace());
    const content = tree.readContent('/src/app/chat/chat.component.ts');
    expect(content).toContain('ChatShellComponent');
    expect(content).toContain('<mvk-chat-shell />');
    expect(content).toContain('@maverick/agentic-ui');
  });
});

describe('schematics: backend', () => {
  it('scaffolds an AgenticBackend adapter + provider factory', async () => {
    const runner = new SchematicTestRunner('@maverick/agentic-ui', COLLECTION_PATH);
    const tree = await runner.runSchematic('backend', { name: 'AcmeBackend' }, baseWorkspace());
    const content = tree.readContent('/src/app/agentic/backends/acme-backend.backend.ts');
    expect(content).toContain('class AcmeBackend implements AgenticBackend');
    expect(content).toContain('provideAcmeBackend');
    expect(content).toContain('provideAgenticBackend({');
  });
});

describe('schematics: mfe-capability', () => {
  it('scaffolds capability.ts + capabilities.json', async () => {
    const runner = new SchematicTestRunner('@maverick/agentic-ui', COLLECTION_PATH);
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
    const runner = new SchematicTestRunner('@maverick/agentic-ui', COLLECTION_PATH);
    const tree = await runner.runSchematic('agent-server', { name: 'my-agent', port: 4111 }, baseWorkspace());
    expect(tree.files).toContain('/projects/my-agent/package.json');
    expect(tree.files).toContain('/projects/my-agent/src/server.ts');
    const server = tree.readContent('/projects/my-agent/src/server.ts');
    expect(server).toContain("import { serve } from '@hono/node-server';");
    expect(server).toContain('agUiRouteHandler');
    expect(server).toContain('EchoAgent');
  });
});
