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

export interface ConnectStudioOptions {
  project?: string;
  catalogUrl: string;
  tenant: string;
  applicationName?: string;
  authMode: 'disabled' | 'oidc';
  skipInstall: boolean;
}

const DEPS = {
  '@infra-tools/agentic-ui': '^0.1.0',
  zod: '^3.23.0',
};

/**
 * Connect an existing standalone Angular app to an Experience Studio catalog
 * backend: scaffold a `catalog-runtime/` bridge and wire `provideCatalogRuntime`
 * into `app.config.ts`, so the app loads the tenant's governed capabilities
 * (experiences, forms, workflows, data sources, tools) at boot and live over SSE.
 */
export function connectStudio(rawOptions: Partial<ConnectStudioOptions> = {}): Rule {
  const options: ConnectStudioOptions = {
    project: rawOptions.project,
    catalogUrl: rawOptions.catalogUrl ?? 'http://localhost:8081',
    tenant: rawOptions.tenant ?? 'acme',
    applicationName: rawOptions.applicationName,
    authMode: rawOptions.authMode ?? 'disabled',
    skipInstall: rawOptions.skipInstall ?? false,
  };

  return (host: Tree, context: SchematicContext) => {
    const { name, project } = resolveProject(host, options.project);
    if (project.projectType !== 'application') {
      throw new SchematicsException(`connect-studio targets an application; "${name}" is a ${project.projectType ?? 'unknown'}.`);
    }
    const sourceRoot = getSourceRoot(project);
    const configPath = `${sourceRoot}/app/app.config.ts`;
    if (!host.exists(configPath)) {
      throw new SchematicsException(`Could not find ${configPath}. Is this a standalone Angular app?`);
    }

    // The bridge fills the lib platform's registries — warn if the platform
    // isn't wired yet (run `ng add @infra-tools/agentic-ui` first).
    const configText = host.read(configPath)?.toString('utf-8') ?? '';
    if (!/provideAgenticUi(Platform)?\s*\(/.test(configText)) {
      context.logger.warn(
        '[connect-studio] provideAgenticUi()/provideAgenticUiPlatform() was not found in app.config.ts. '
        + 'The catalog runtime needs the agentic-ui platform for its registries — run '
        + '`ng add @infra-tools/agentic-ui` first, then re-run this schematic.',
      );
    }

    addDependencies(host, DEPS);

    patchAppConfig(
      host,
      configPath,
      [{ symbols: ['provideCatalogRuntime'], module: './catalog-runtime' }],
      [buildProviderExpression(options)],
    );

    const seedTemplate = apply(url('./files'), [
      applyTemplates({ ...strings, ...options }),
      move(`${sourceRoot}/app`),
    ]);

    if (!options.skipInstall) {
      context.addTask(new NodePackageInstallTask());
    }

    context.logger.info(
      `[connect-studio] Wired catalog runtime → ${options.catalogUrl} (tenant "${options.tenant}"). `
      + 'See src/app/catalog-runtime/README.md.',
    );

    return chain([mergeWith(seedTemplate)]);
  };
}

/** Build the `provideCatalogRuntime({ ... })` provider expression for app.config.ts. */
function buildProviderExpression(o: ConnectStudioOptions): string {
  const fields = [`baseUrl: '${o.catalogUrl}'`, `tenant: '${o.tenant}'`];
  if (o.applicationName) fields.push(`applicationName: '${o.applicationName}'`);
  if (o.authMode === 'oidc') fields.push(`authMode: 'oidc'`);
  return `provideCatalogRuntime({ ${fields.join(', ')} })`;
}
