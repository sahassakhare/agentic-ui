import {
  Rule,
  SchematicContext,
  SchematicsException,
  Tree,
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
  /** 'registries' (default) populates the lib registries; 'shell' renders the full catalog app. */
  mode: 'registries' | 'shell';
  /** App auth service class (implements CatalogAuth) to wire for OIDC. */
  authService?: string;
  skipInstall: boolean;
}

const CATALOG_ENTRY = '@infra-tools/agentic-ui/catalog';
const DEPS = {
  '@infra-tools/agentic-ui': '^1.6.0',
  zod: '^3.23.0',
};

/**
 * Connect a standalone Angular app to an Experience Studio catalog backend by
 * wiring `provideCatalogRuntime(...)` (from `@infra-tools/agentic-ui/catalog`)
 * into `app.config.ts`. The runtime lives in the library, upgradable over npm —
 * this schematic just configures it. `--mode registries` (default) fills the lib
 * registries so the app embeds capabilities via `<mvk-form-renderer>` etc.;
 * `--mode shell` (or `--shell`) also renders the full catalog-driven application.
 */
export function connectStudio(rawOptions: Partial<ConnectStudioOptions> & { shell?: boolean } = {}): Rule {
  const options: ConnectStudioOptions = {
    project: rawOptions.project,
    catalogUrl: rawOptions.catalogUrl ?? 'http://localhost:8081',
    tenant: rawOptions.tenant ?? 'acme',
    applicationName: rawOptions.applicationName,
    authMode: rawOptions.authMode ?? 'disabled',
    mode: rawOptions.shell ? 'shell' : (rawOptions.mode ?? 'registries'),
    authService: rawOptions.authService,
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

    // The runtime fills the lib platform's registries — warn if the platform
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

    const imports = [{ symbols: ['provideCatalogRuntime'], module: CATALOG_ENTRY }];
    patchAppConfig(host, configPath, imports, [buildProviderExpression(options)]);

    if (options.authMode === 'oidc') {
      context.logger.info(
        '[connect-studio] OIDC selected. Provide your token/persona source to the runtime by adding:\n'
        + `    { provide: CATALOG_AUTH, useExisting: ${options.authService ?? 'MyAuthService'} }\n`
        + `  (import CATALOG_AUTH from '${CATALOG_ENTRY}'; your service implements CatalogAuth — token()/persona()/permissions()).`,
      );
    }
    if (options.mode === 'shell') {
      context.logger.info(
        '[connect-studio] Shell mode: bootstrap the catalog shell in main.ts —\n'
        + `    import { CatalogShellComponent } from '${CATALOG_ENTRY}';\n`
        + '    bootstrapApplication(CatalogShellComponent, appConfig);\n'
        + '  and ensure your app calls provideRouter([...]) (the runtime contributes catalog routes).',
      );
    }

    if (!options.skipInstall) {
      context.addTask(new NodePackageInstallTask());
    }

    context.logger.info(
      `[connect-studio] Wired provideCatalogRuntime → ${options.catalogUrl} (tenant "${options.tenant}", mode "${options.mode}").`,
    );

    return host;
  };
}

/** Build the `provideCatalogRuntime({ ... }, { mode })` expression for app.config.ts. */
function buildProviderExpression(o: ConnectStudioOptions): string {
  const fields = [`baseUrl: '${o.catalogUrl}'`, `tenant: '${o.tenant}'`];
  if (o.applicationName) fields.push(`applicationName: '${o.applicationName}'`);
  if (o.authMode === 'oidc') fields.push(`authMode: 'oidc'`);
  const cfg = `{ ${fields.join(', ')} }`;
  return o.mode === 'shell'
    ? `provideCatalogRuntime(${cfg}, { mode: 'shell' })`
    : `provideCatalogRuntime(${cfg})`;
}
