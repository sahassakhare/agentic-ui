import { Tree } from '@angular-devkit/schematics';
import { readJson, writeJson } from './workspace';

export interface PackageJson {
  readonly name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export function addDependency(host: Tree, name: string, version: string, dev = false): void {
  const pkg = readJson<PackageJson>(host, 'package.json');
  const target: 'dependencies' | 'devDependencies' = dev ? 'devDependencies' : 'dependencies';
  pkg[target] ??= {};
  if (pkg[target]![name] === undefined) {
    pkg[target]![name] = version;
  }
  writeJson(host, 'package.json', pkg);
}

export function addDependencies(host: Tree, deps: Record<string, string>, dev = false): void {
  for (const [n, v] of Object.entries(deps)) addDependency(host, n, v, dev);
}
