/**
 * Discover an Angular library's components from its shipped `.d.ts` — the single
 * hardest part of ingestion. ng-packagr strips `@Input()` decorators, but Ivy
 * encodes each component as a `static ɵcmp: ɵɵComponentDeclaration<Cmp, Selector,
 * ExportAs, InputMap, …, IsStandalone, …>`. We parse that syntactically (no type
 * resolution, no node_modules) to get the class name, selector, input names +
 * types, and the standalone flag.
 *
 * For a real library (PrimeNG, Kendo, …) two things matter beyond parsing:
 *  - components live behind **secondary entry points** (`primeng/button`, …), so
 *    each component is imported from its owning entry, not the package root; and
 *  - only **standalone** + **publicly-exported** components are usable (internal
 *    sub-components / non-standalone classes can't be mounted via ngComponentOutlet).
 */
import ts from 'typescript';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

export interface PropType {
  readonly kind: 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'object' | 'unknown';
  readonly enum?: readonly string[];
}

/** A component parsed from one `.d.ts` (before its public import path is resolved). */
export interface ComponentInfo {
  readonly className: string;
  readonly selector: string | null;
  readonly inputs: readonly string[];
  readonly inputTypes: Readonly<Record<string, PropType>>;
  readonly standalone: boolean;
  readonly widgetName: string;
}

/** A usable component: `ComponentInfo` + the module to import its class from. */
export interface DiscoveredComponent extends ComponentInfo {
  readonly importPath: string;
}

/** Parse one `.d.ts` source for Ivy components (unfiltered — no import path yet). */
export function introspectDts(source: string): ComponentInfo[] {
  const sf = ts.createSourceFile('lib.d.ts', source, ts.ScriptTarget.Latest, true);
  const out: ComponentInfo[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name) {
      const cmp = findComponentDeclaration(node);
      if (cmp) {
        const args = cmp.typeArguments ?? [];
        const selector = firstSelector(args[1]);
        const inputs = inputNames(args[3]);
        const propTypes = classPropTypes(node);
        const inputTypes: Record<string, PropType> = {};
        for (const name of inputs) inputTypes[name] = propType(propTypes.get(name));
        const className = node.name.text;
        out.push({ className, selector, inputs, inputTypes, standalone: isStandalone(args[7]), widgetName: widgetNameFor(selector, className) });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return out;
}

/**
 * Introspect a package dir: find its standalone, publicly-exported components and
 * the entry-point path to import each from.
 */
export function introspectLibrary(pkgDir: string): DiscoveredComponent[] {
  const packageName = readPackageName(pkgDir);
  const exportMap = publicExportMap(pkgDir, packageName);

  const found = new Map<string, ComponentInfo>();
  for (const file of walkDts(pkgDir)) {
    for (const c of introspectDts(readFileSync(file, 'utf8'))) if (!found.has(c.className)) found.set(c.className, c);
  }

  const used = new Set<string>();
  const out: DiscoveredComponent[] = [];
  for (const c of found.values()) {
    if (!c.standalone) continue;                                    // only mountable standalone components
    // Import from the entry point that exports it; if the lib has no export map
    // (a simple single-entry lib) import everything from the package root.
    const importPath = exportMap.get(c.className) ?? (exportMap.size === 0 ? packageName : undefined);
    if (!importPath) continue;                                      // internal / not publicly exported
    let name = c.widgetName; let n = 2;
    while (used.has(name)) name = `${c.widgetName}-${n++}`;
    used.add(name);
    out.push({ ...c, importPath, widgetName: name });
  }
  return out;
}

// ── Ivy ɵcmp parsing ─────────────────────────────────────────────────────────

function findComponentDeclaration(cls: ts.ClassDeclaration): ts.TypeReferenceNode | null {
  for (const m of cls.members) {
    if (ts.isPropertyDeclaration(m) && m.name && ts.isIdentifier(m.name) && m.name.text === 'ɵcmp'
        && m.type && ts.isTypeReferenceNode(m.type)) {
      const ref = m.type.typeName;
      const text = ts.isQualifiedName(ref) ? ref.right.text : ref.text;
      if (text === 'ɵɵComponentDeclaration') return m.type;
    }
  }
  return null;
}

function firstSelector(arg: ts.TypeNode | undefined): string | null {
  if (!arg) return null;
  const lits: string[] = [];
  const collect = (t: ts.TypeNode): void => {
    if (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)) lits.push(t.literal.text);
    else if (ts.isUnionTypeNode(t)) t.types.forEach(collect);
  };
  collect(arg);
  const first = lits[0]?.split(',')[0].trim();
  return first || null;
}

function inputNames(arg: ts.TypeNode | undefined): string[] {
  if (!arg || !ts.isTypeLiteralNode(arg)) return [];
  const names: string[] = [];
  for (const m of arg.members) {
    if (ts.isPropertySignature(m) && m.name) {
      if (ts.isStringLiteral(m.name)) names.push(m.name.text);
      else if (ts.isIdentifier(m.name)) names.push(m.name.text);
    }
  }
  return names;
}

/** The 8th type arg (IsStandalone) is a `true`/`false` literal; absent → best-effort true. */
function isStandalone(arg: ts.TypeNode | undefined): boolean {
  if (arg && ts.isLiteralTypeNode(arg)) {
    if (arg.literal.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (arg.literal.kind === ts.SyntaxKind.FalseKeyword) return false;
  }
  return true;
}

function classPropTypes(cls: ts.ClassDeclaration): Map<string, ts.TypeNode> {
  const m = new Map<string, ts.TypeNode>();
  for (const member of cls.members) {
    if (ts.isPropertyDeclaration(member) && member.type && member.name) {
      const name = ts.isIdentifier(member.name) ? member.name.text
        : ts.isStringLiteral(member.name) ? member.name.text : null;
      if (name && name !== 'ɵcmp' && name !== 'ɵfac') m.set(name, member.type);
    }
  }
  return m;
}

function propType(t: ts.TypeNode | undefined): PropType {
  if (!t) return { kind: 'unknown' };
  if (ts.isArrayTypeNode(t)) return { kind: 'array' };
  if (ts.isTypeLiteralNode(t)) return { kind: 'object' };
  if (ts.isUnionTypeNode(t)) {
    const strLits = t.types.filter((x) => ts.isLiteralTypeNode(x) && ts.isStringLiteral(x.literal));
    if (strLits.length && strLits.length === t.types.filter((x) => !isNullish(x)).length) {
      return { kind: 'enum', enum: strLits.map((x) => ((x as ts.LiteralTypeNode).literal as ts.StringLiteral).text) };
    }
    return { kind: 'unknown' };
  }
  if (ts.isTypeReferenceNode(t)) {
    const name = ts.isQualifiedName(t.typeName) ? t.typeName.right.text : t.typeName.text;
    return name === 'Array' ? { kind: 'array' } : { kind: 'object' };
  }
  switch (t.kind) {
    case ts.SyntaxKind.StringKeyword: return { kind: 'string' };
    case ts.SyntaxKind.NumberKeyword: return { kind: 'number' };
    case ts.SyntaxKind.BooleanKeyword: return { kind: 'boolean' };
    default: return { kind: 'unknown' };
  }
}

function isNullish(t: ts.TypeNode): boolean {
  return t.kind === ts.SyntaxKind.UndefinedKeyword || t.kind === ts.SyntaxKind.NullKeyword
    || (ts.isLiteralTypeNode(t) && t.literal.kind === ts.SyntaxKind.NullKeyword);
}

function widgetNameFor(selector: string | null, className: string): string {
  const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '');
  if (selector && /^[a-zA-Z]/.test(selector)) return kebab(selector);
  return kebab(className.replace(/Component$/i, ''));
}

// ── public entry-point resolution (which module exports each component) ───────

function readPackageName(pkgDir: string): string {
  try { return JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).name ?? ''; } catch { return ''; }
}

/** className → import path (`packageName` or a secondary entry like `primeng/button`). */
function publicExportMap(pkgDir: string, packageName: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!packageName) return map;
  for (const ep of entryPoints(pkgDir)) {
    const importPath = packageName + ep.subpath;
    for (const cls of exportedClasses(ep.typesFile, new Set())) if (!map.has(cls)) map.set(cls, importPath);
  }
  return map;
}

/**
 * Enumerate the library's entry points from both conventions:
 *  1. the root package.json `exports` map (modern ng-packagr — PrimeNG, Angular
 *     Material, … : `"./button": { "types": "./types/…d.ts" }`), and
 *  2. per-directory package.json stubs (classic ng-packagr secondary entries).
 */
function entryPoints(pkgDir: string): { subpath: string; typesFile: string }[] {
  const out: { subpath: string; typesFile: string }[] = [];
  const seen = new Set<string>();
  const add = (subpath: string, typesFile: string): void => {
    if (existsSync(typesFile) && !seen.has(typesFile)) { seen.add(typesFile); out.push({ subpath, typesFile }); }
  };

  let rootPkg: { exports?: unknown } | undefined;
  try { rootPkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')); } catch { /* none */ }
  const exp = rootPkg?.exports;
  if (exp && typeof exp === 'object') {
    for (const [key, val] of Object.entries(exp as Record<string, unknown>)) {
      if (key.includes('*') || key.endsWith('package.json')) continue;
      const types = typesFromExport(val);
      if (types) add(key === '.' ? '' : key.replace(/^\./, ''), join(pkgDir, types));   // './button' → '/button'
    }
  }

  for (const pj of walkPackageJsons(pkgDir)) {
    const dir = dirname(pj);
    let types: string | undefined;
    try { const p = JSON.parse(readFileSync(pj, 'utf8')); types = p.typings ?? p.types; } catch { /* skip */ }
    if (!types && existsSync(join(dir, 'index.d.ts'))) types = 'index.d.ts';
    if (!types) continue;
    const rel = relative(pkgDir, dir).replace(/\\/g, '/');
    add(rel ? `/${rel}` : '', join(dir, types));
  }
  return out;
}

/** Extract the `.d.ts` from an `exports` map value (string, or a conditions object). */
function typesFromExport(val: unknown): string | null {
  if (typeof val === 'string') return val.endsWith('.d.ts') ? val : null;
  if (val && typeof val === 'object') {
    const o = val as Record<string, unknown>;
    for (const k of ['types', 'typings']) if (typeof o[k] === 'string') return o[k] as string;
    for (const k of ['import', 'module', 'default', 'node', 'browser', 'require']) {
      const r = typesFromExport(o[k]); if (r) return r;
    }
  }
  return null;
}

/** Class names publicly exported from an entry's `.d.ts` (follows `export * from`). */
function exportedClasses(file: string, seen: Set<string>): string[] {
  if (seen.has(file) || !existsSync(file)) return [];
  seen.add(file);
  let src: string;
  try { src = readFileSync(file, 'utf8'); } catch { return []; }
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  sf.forEachChild((node) => {
    if (ts.isClassDeclaration(node) && node.name && isExported(node)) {
      names.push(node.name.text);
    } else if (ts.isExportDeclaration(node)) {
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const el of node.exportClause.elements) names.push(el.name.text);
      } else if (!node.exportClause && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const target = resolveDts(dirname(file), node.moduleSpecifier.text);
        if (target) names.push(...exportedClasses(target, seen));
      }
    }
  });
  return names;
}

function isExported(node: ts.ClassDeclaration): boolean {
  return !!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function resolveDts(dir: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = join(dir, spec);
  for (const cand of [`${base}.d.ts`, join(base, 'index.d.ts')]) if (existsSync(cand)) return cand;
  return null;
}

// ── fs walkers ───────────────────────────────────────────────────────────────

function* walkDts(dir: string): Generator<string> {
  for (const e of readDir(dir)) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walkDts(p);
    else if (e.name.endsWith('.d.ts')) yield p;
  }
}

function* walkPackageJsons(dir: string): Generator<string> {
  for (const e of readDir(dir)) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walkPackageJsons(p);
    else if (e.name === 'package.json') yield p;
  }
}

function readDir(dir: string) {
  try { return readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}
