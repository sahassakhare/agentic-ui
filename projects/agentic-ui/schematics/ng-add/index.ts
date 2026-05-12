import { strings } from '@angular-devkit/core';
import {
  apply,
  applyTemplates,
  chain,
  mergeWith,
  move,
  Rule,
  SchematicContext,
  SchematicsException,
  Tree,
  url,
} from '@angular-devkit/schematics';
import { NodePackageInstallTask } from '@angular-devkit/schematics/tasks';
import { addDependencies } from '../utils/dependencies';
import { patchAppConfig } from '../utils/app-config';
import { getSourceRoot, resolveProject } from '../utils/workspace';

export interface NgAddOptions {
  project?: string;
  backend: 'ag-ui' | 'hashbrown' | 'a2ui';
  agentUrl: string;
  telemetry: 'none' | 'console' | 'otel';
  skipInstall: boolean;
}

const DEPS = {
  '@infra-tools/agentic-ui': '^0.1.0',
  zod: '^3.23.0',
};

const BACKEND_DEPS: Record<NgAddOptions['backend'], Record<string, string>> = {
  'ag-ui': { '@ag-ui/client': '^0.0.52' },
  hashbrown: {},
  a2ui: {},
};

const TELEMETRY_DEPS: Record<NgAddOptions['telemetry'], Record<string, string>> = {
  none: {},
  console: {},
  otel: { '@opentelemetry/api': '^1.9.0' },
};

export function ngAdd(rawOptions: Partial<NgAddOptions> = {}): Rule {
  const options: NgAddOptions = {
    project: rawOptions.project,
    backend: rawOptions.backend ?? 'ag-ui',
    agentUrl: rawOptions.agentUrl ?? 'http://localhost:4111/agents/echo/run',
    telemetry: rawOptions.telemetry ?? 'none',
    skipInstall: rawOptions.skipInstall ?? false,
  };

  return (host: Tree, context: SchematicContext) => {
    const { name, project } = resolveProject(host, options.project);
    if (project.projectType !== 'application') {
      throw new SchematicsException(`ng-add targets an application; "${name}" is a ${project.projectType ?? 'unknown'}.`);
    }
    const sourceRoot = getSourceRoot(project);
    const configPath = `${sourceRoot}/app/app.config.ts`;
    if (!host.exists(configPath)) {
      throw new SchematicsException(`Could not find ${configPath}. Is this a standalone Angular app?`);
    }

    addDependencies(host, { ...DEPS, ...BACKEND_DEPS[options.backend], ...TELEMETRY_DEPS[options.telemetry] });

    const backendImport = backendImportFor(options.backend);
    const backendCall = backendCallFor(options.backend, options.agentUrl);

    patchAppConfig(
      host,
      configPath,
      [
        { symbols: ['provideAgenticUi'], module: '@infra-tools/agentic-ui' },
        backendImport,
      ],
      ['provideAgenticUi()', backendCall],
    );

    const seedTemplate = apply(url('./files'), [
      applyTemplates({ ...strings, ...options }),
      move(`${sourceRoot}/app/agentic`),
    ]);

    if (!options.skipInstall) {
      context.addTask(new NodePackageInstallTask());
    }

    return chain([mergeWith(seedTemplate)]);
  };
}

function backendImportFor(backend: NgAddOptions['backend']) {
  switch (backend) {
    case 'ag-ui':
      return { symbols: ['provideAgUiBackend'], module: '@infra-tools/agentic-ui/ag-ui' };
    case 'hashbrown':
      return { symbols: ['provideHashbrownBackend'], module: '@infra-tools/agentic-ui/hashbrown' };
    case 'a2ui':
      return { symbols: ['provideA2uiBackend'], module: '@infra-tools/agentic-ui/a2ui' };
  }
}

function backendCallFor(backend: NgAddOptions['backend'], url: string): string {
  switch (backend) {
    case 'ag-ui':
      return `provideAgUiBackend({ url: '${url}' })`;
    case 'hashbrown':
      return `provideHashbrownBackend({ /* configure when M4 lands */ })`;
    case 'a2ui':
      return `provideA2uiBackend({ /* configure when M3 lands */ })`;
  }
}
