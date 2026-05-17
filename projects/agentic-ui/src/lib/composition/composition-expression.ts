/**
 * Closed-AST expression DSL for `FormRegistry` composition `if` predicates.
 *
 * Grammar (BNF, lowest-to-highest precedence):
 *
 *   expr      ::= or
 *   or        ::= and ( '||' and )*
 *   and       ::= equality ( '&&' equality )*
 *   equality  ::= primary ( ( '===' | '!==' ) primary )?     // non-chaining
 *   primary   ::= literal | path | '(' expr ')'
 *   literal   ::= string | number | boolean
 *   path      ::= identifier ( '.' identifier )*
 *   identifier::= [A-Za-z_][A-Za-z_0-9]*
 *
 * Deliberate non-features (closed AST per ADR-001):
 *   - no function calls, no regex, no arithmetic, no unary operators
 *   - no comparison operators other than `===` and `!==`
 *   - no array / object literals, no template strings
 *   - no chained equality: `a === b === c` is rejected at parse time;
 *     use parentheses to make intent explicit
 *   - path access is restricted to own enumerable properties: `__proto__`,
 *     `constructor`, `toString`, etc. always evaluate to `undefined`
 *
 * If your predicate needs more than the grammar above, use the
 * `predicate: (ctx) => boolean` escape hatch on the composition entry instead.
 *
 * @see docs/plans/ediscovery-dynamic-ui-plan.md §9.1 (Capability F1)
 */

/** Bag of values the predicate is evaluated against (matter, persona, partial form values). */
export type CompositionContext = Readonly<Record<string, unknown>>;

/** A parsed predicate that can be cheaply re-applied per context change. */
export type CompiledPredicate = (ctx: CompositionContext) => boolean;

/** Maximum source length accepted; bounds DoS surface for malformed input. */
export const MAX_EXPRESSION_LENGTH = 1024;

/** Maximum primary-rule recursion; bounds stack depth on adversarial nesting. */
export const MAX_EXPRESSION_DEPTH = 32;

/** Thrown for any malformed input. Carries the original source + offset for IDE underlining. */
export class CompositionExpressionError extends Error {
  constructor(
    message: string,
    public readonly source: string,
    public readonly position: number,
  ) {
    super(`${message} (at position ${position} in ${JSON.stringify(source)})`);
    this.name = 'CompositionExpressionError';
  }
}

// ─── AST ────────────────────────────────────────────────────────────────────

type LiteralNode = { readonly kind: 'literal'; readonly value: string | number | boolean };
type PathNode = { readonly kind: 'path'; readonly segments: readonly string[] };
type BinaryOp = '===' | '!==' | '&&' | '||';
type BinaryNode = { readonly kind: 'binary'; readonly op: BinaryOp; readonly left: Node; readonly right: Node };
type Node = LiteralNode | PathNode | BinaryNode;

// ─── Lexer ──────────────────────────────────────────────────────────────────

type OpPunct = '===' | '!==' | '&&' | '||' | '.' | '(' | ')';

type Token =
  | { readonly kind: 'string'; readonly value: string; readonly pos: number }
  | { readonly kind: 'number'; readonly value: number; readonly pos: number }
  | { readonly kind: 'boolean'; readonly value: boolean; readonly pos: number }
  | { readonly kind: 'ident'; readonly value: string; readonly pos: number }
  | { readonly kind: 'op'; readonly value: OpPunct; readonly pos: number }
  | { readonly kind: 'eof'; readonly pos: number };

const PROHIBITED_KEYWORDS = new Set(['null', 'undefined', 'NaN', 'Infinity', 'this']);

function isIdentStart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}
function isIdentCont(ch: string): boolean {
  return isIdentStart(ch) || (ch >= '0' && ch <= '9');
}
function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}
function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

function tokenize(source: string): readonly Token[] {
  const tokens: Token[] = [];
  const n = source.length;
  let i = 0;

  const fail = (msg: string, pos: number): never => {
    throw new CompositionExpressionError(msg, source, pos);
  };

  while (i < n) {
    const ch = source[i];

    if (isWhitespace(ch)) {
      i++;
      continue;
    }

    // String literal — single OR double quoted, with minimal escape support.
    if (ch === '"' || ch === "'") {
      const start = i;
      const quote = ch;
      i++;
      let value = '';
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\') {
          if (i + 1 >= n) fail('Unterminated string escape', start);
          const esc = source[i + 1];
          switch (esc) {
            case '\\': value += '\\'; break;
            case '"':  value += '"';  break;
            case "'":  value += "'";  break;
            case 'n':  value += '\n'; break;
            case 't':  value += '\t'; break;
            case 'r':  value += '\r'; break;
            default: fail(`Invalid string escape \\${esc}`, i + 1);
          }
          i += 2;
        } else if (source[i] === '\n') {
          fail('Unterminated string literal (newline before close)', start);
        } else {
          value += source[i];
          i++;
        }
      }
      if (i >= n) fail('Unterminated string literal', start);
      i++;
      tokens.push({ kind: 'string', value, pos: start });
      continue;
    }

    if (isDigit(ch)) {
      const start = i;
      let raw = '';
      while (i < n && isDigit(source[i])) {
        raw += source[i];
        i++;
      }
      if (i < n && source[i] === '.') {
        raw += '.';
        i++;
        let any = false;
        while (i < n && isDigit(source[i])) {
          raw += source[i];
          i++;
          any = true;
        }
        if (!any) fail('Number missing fractional digits after decimal point', start);
      }
      if (i < n && source[i] === '.') {
        fail('Invalid number literal (multiple decimal points)', start);
      }
      if (i < n && isIdentStart(source[i])) {
        fail('Invalid number literal (identifier immediately follows digits)', start);
      }
      const value = Number(raw);
      if (!Number.isFinite(value)) fail('Invalid number literal', start);
      tokens.push({ kind: 'number', value, pos: start });
      continue;
    }

    if (isIdentStart(ch)) {
      const start = i;
      let raw = '';
      while (i < n && isIdentCont(source[i])) {
        raw += source[i];
        i++;
      }
      if (raw === 'true' || raw === 'false') {
        tokens.push({ kind: 'boolean', value: raw === 'true', pos: start });
      } else if (PROHIBITED_KEYWORDS.has(raw)) {
        fail(`Unsupported keyword '${raw}'`, start);
      } else {
        tokens.push({ kind: 'ident', value: raw, pos: start });
      }
      continue;
    }

    if (ch === '=' && source[i + 1] === '=' && source[i + 2] === '=') {
      tokens.push({ kind: 'op', value: '===', pos: i });
      i += 3;
      continue;
    }
    if (ch === '!' && source[i + 1] === '=' && source[i + 2] === '=') {
      tokens.push({ kind: 'op', value: '!==', pos: i });
      i += 3;
      continue;
    }
    if (ch === '&' && source[i + 1] === '&') {
      tokens.push({ kind: 'op', value: '&&', pos: i });
      i += 2;
      continue;
    }
    if (ch === '|' && source[i + 1] === '|') {
      tokens.push({ kind: 'op', value: '||', pos: i });
      i += 2;
      continue;
    }
    if (ch === '.') {
      tokens.push({ kind: 'op', value: '.', pos: i });
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ kind: 'op', value: '(', pos: i });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'op', value: ')', pos: i });
      i++;
      continue;
    }

    fail(`Unexpected character ${JSON.stringify(ch)}`, i);
  }

  tokens.push({ kind: 'eof', pos: n });
  return tokens;
}

// ─── Parser ─────────────────────────────────────────────────────────────────

function describe(t: Token): string {
  switch (t.kind) {
    case 'string':  return `string ${JSON.stringify(t.value)}`;
    case 'number':  return `number ${t.value}`;
    case 'boolean': return `boolean ${t.value}`;
    case 'ident':   return `identifier '${t.value}'`;
    case 'op':      return `'${t.value}'`;
    case 'eof':     return 'end of input';
  }
}

function parse(source: string, tokens: readonly Token[]): Node {
  let pos = 0;
  let depth = 0;

  const peek = (): Token => tokens[pos];
  const advance = (): Token => tokens[pos++];

  const fail = (msg: string, t: Token = peek()): never => {
    throw new CompositionExpressionError(msg, source, t.pos);
  };

  const expectOp = (op: OpPunct): Token => {
    const t = peek();
    if (t.kind !== 'op' || t.value !== op) fail(`Expected '${op}' but got ${describe(t)}`);
    return advance();
  };

  const enter = (): void => {
    depth++;
    if (depth > MAX_EXPRESSION_DEPTH) fail('Expression too deeply nested');
  };
  const leave = (): void => {
    depth--;
  };

  const parseExpr = (): Node => parseOr();

  const parseOr = (): Node => {
    let node = parseAnd();
    while (true) {
      const t = peek();
      if (t.kind === 'op' && t.value === '||') {
        advance();
        const right = parseAnd();
        node = { kind: 'binary', op: '||', left: node, right };
      } else {
        break;
      }
    }
    return node;
  };

  const parseAnd = (): Node => {
    let node = parseEquality();
    while (true) {
      const t = peek();
      if (t.kind === 'op' && t.value === '&&') {
        advance();
        const right = parseEquality();
        node = { kind: 'binary', op: '&&', left: node, right };
      } else {
        break;
      }
    }
    return node;
  };

  const parseEquality = (): Node => {
    const left = parsePrimary();
    const t = peek();
    if (t.kind === 'op' && (t.value === '===' || t.value === '!==')) {
      const op = t.value;
      advance();
      const right = parsePrimary();
      // Reject chained equality so `a === b === c` is not silently
      // re-interpreted JS-style as `(a === b) === c`.
      const next = peek();
      if (next.kind === 'op' && (next.value === '===' || next.value === '!==')) {
        fail("Chained equality is not allowed; wrap in parentheses to disambiguate", next);
      }
      return { kind: 'binary', op, left, right };
    }
    return left;
  };

  const parsePrimary = (): Node => {
    enter();
    try {
      const t = peek();
      if (t.kind === 'op' && t.value === '(') {
        advance();
        const inner = parseExpr();
        expectOp(')');
        return inner;
      }
      if (t.kind === 'string' || t.kind === 'number' || t.kind === 'boolean') {
        advance();
        return { kind: 'literal', value: t.value };
      }
      if (t.kind === 'ident') {
        advance();
        const segments: string[] = [t.value];
        while (true) {
          const dot = peek();
          if (dot.kind === 'op' && dot.value === '.') {
            advance();
            const seg = peek();
            if (seg.kind !== 'ident') fail(`Expected identifier after '.', got ${describe(seg)}`);
            advance();
            segments.push((seg as { value: string }).value);
          } else {
            break;
          }
        }
        return { kind: 'path', segments };
      }
      return fail(`Unexpected ${describe(t)}`);
    } finally {
      leave();
    }
  };

  const root = parseExpr();
  const tail = peek();
  if (tail.kind !== 'eof') {
    throw new CompositionExpressionError(
      `Unexpected trailing input ${describe(tail)}`,
      source,
      tail.pos,
    );
  }
  return root;
}

// ─── Evaluator ──────────────────────────────────────────────────────────────

function resolvePath(ctx: CompositionContext, segments: readonly string[]): unknown {
  let cur: unknown = ctx;
  for (const seg of segments) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    // Own-property only: blocks `__proto__`, `constructor`, inherited methods.
    if (!Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function evalNode(node: Node, ctx: CompositionContext): unknown {
  switch (node.kind) {
    case 'literal':
      return node.value;
    case 'path':
      return resolvePath(ctx, node.segments);
    case 'binary': {
      switch (node.op) {
        case '===':
          return evalNode(node.left, ctx) === evalNode(node.right, ctx);
        case '!==':
          return evalNode(node.left, ctx) !== evalNode(node.right, ctx);
        case '&&': {
          const l = evalNode(node.left, ctx);
          return l ? evalNode(node.right, ctx) : l;
        }
        case '||': {
          const l = evalNode(node.left, ctx);
          return l ? l : evalNode(node.right, ctx);
        }
      }
    }
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Parse + validate a composition `if` expression.
 *
 * Throws {@link CompositionExpressionError} on any malformed or out-of-grammar
 * input. Use at registration time so authoring errors surface before any UI
 * mounts (per AC-F1-3).
 *
 * Returned predicate is pure and safe to memoize.
 */
export function parseCompositionExpression(source: string): CompiledPredicate {
  if (typeof source !== 'string') {
    throw new CompositionExpressionError(
      'Expression source must be a string',
      String(source),
      0,
    );
  }
  if (source.length > MAX_EXPRESSION_LENGTH) {
    throw new CompositionExpressionError(
      `Expression exceeds maximum length of ${MAX_EXPRESSION_LENGTH} characters`,
      source,
      0,
    );
  }
  if (source.trim().length === 0) {
    throw new CompositionExpressionError('Expression is empty', source, 0);
  }
  const tokens = tokenize(source);
  const ast = parse(source, tokens);
  return (ctx) => Boolean(evalNode(ast, ctx));
}

/**
 * Convenience for one-shot evaluation. Prefer {@link parseCompositionExpression}
 * + a cached predicate when the same expression is evaluated repeatedly.
 */
export function evaluateCompositionExpression(
  source: string,
  ctx: CompositionContext,
): boolean {
  return parseCompositionExpression(source)(ctx);
}
