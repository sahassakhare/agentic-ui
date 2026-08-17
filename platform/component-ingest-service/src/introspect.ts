/**
 * Discover an Angular library's components from its shipped `.d.ts` — the single
 * hardest part of ingestion. ng-packagr strips `@Input()` decorators, but Ivy
 * encodes each component as a `static ɵcmp: ɵɵComponentDeclaration<Cmp, Selector,
 * ExportAs, InputMap, …>`. We parse that declaration syntactically (no type
 * resolution, so no node_modules needed) to get the class name, selector, and
 * input names. MVP ships a passthrough `propsSchema`; the input names still drive
 * a typed authoring hint and future typed schemas.
 */
import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** A coarse classification of an `@Input()`'s type, mapped to Zod at generation time. */
export interface PropType {
  readonly kind: 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'object' | 'unknown';
  readonly enum?: readonly string[];
}

export interface DiscoveredComponent {
  readonly className: string;
  readonly selector: string | null;
  readonly inputs: readonly string[];
  /** Per-input classified type (from the component class' property declarations). */
  readonly inputTypes: Readonly<Record<string, PropType>>;
  /** Kebab name used as the `agenticWidget` name / catalog capability name. */
  readonly widgetName: string;
}

/** Parse one `.d.ts` source for exported Ivy components. */
export function introspectDts(source: string): DiscoveredComponent[] {
  const sf = ts.createSourceFile('lib.d.ts', source, ts.ScriptTarget.Latest, true);
  const out: DiscoveredComponent[] = [];
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
        out.push({ className, selector, inputs, inputTypes, widgetName: widgetNameFor(selector, className) });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return out;
}

/** Map a component class' property declarations → `name → type node`. */
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

/** Classify a TS type node for schema generation. */
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

/** Introspect every `.d.ts` under a package dir; dedupe by class name. */
export function introspectLibrary(pkgDir: string): DiscoveredComponent[] {
  const seen = new Map<string, DiscoveredComponent>();
  for (const file of walkDts(pkgDir)) {
    for (const c of introspectDts(readFileSync(file, 'utf8'))) {
      if (!seen.has(c.className)) seen.set(c.className, c);
    }
  }
  // Ensure widget names are unique (suffix collisions).
  const used = new Set<string>();
  return [...seen.values()].map((c) => {
    let name = c.widgetName; let n = 2;
    while (used.has(name)) name = `${c.widgetName}-${n++}`;
    used.add(name);
    return { ...c, widgetName: name };
  });
}

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

/** The selector arg is a string literal or union of them; take the first tag selector. */
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

/** The input-map arg is `{ "name": …; … }`; return the member names. */
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

function widgetNameFor(selector: string | null, className: string): string {
  const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '');
  if (selector && /^[a-zA-Z]/.test(selector)) return kebab(selector);
  return kebab(className.replace(/Component$/i, ''));
}

function* walkDts(dir: string): Generator<string> {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walkDts(p);
    else if (e.name.endsWith('.d.ts')) yield p;
  }
}
