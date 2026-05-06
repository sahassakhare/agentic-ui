import { describe, expect, it } from 'vitest';

import {
  CompositionExpressionError,
  MAX_EXPRESSION_DEPTH,
  MAX_EXPRESSION_LENGTH,
  evaluateCompositionExpression,
  parseCompositionExpression,
} from './composition-expression';

const eval_ = evaluateCompositionExpression;

describe('composition-expression — plan reference scenarios', () => {
  // §9.1.3 of docs/plans/ediscovery-dynamic-ui-plan.md
  const matter = { type: 'securities', metadata: { priority: 'high' } };

  it("matter.type === 'securities'", () => {
    expect(eval_('matter.type === "securities"', { matter })).toBe(true);
    expect(eval_('matter.type === "securities"', { matter: { type: 'employment' } })).toBe(false);
  });

  it("persona !== 'lead-counsel'", () => {
    expect(eval_('persona !== "lead-counsel"', { persona: 'paralegal' })).toBe(true);
    expect(eval_('persona !== "lead-counsel"', { persona: 'lead-counsel' })).toBe(false);
  });

  it("department === 'Finance'", () => {
    expect(eval_('department === "Finance"', { department: 'Finance' })).toBe(true);
    expect(eval_('department === "Finance"', { department: 'Engineering' })).toBe(false);
  });

  it('nested dotted access works', () => {
    expect(eval_('matter.metadata.priority === "high"', { matter })).toBe(true);
    expect(eval_('matter.metadata.priority === "low"', { matter })).toBe(false);
  });
});

describe('composition-expression — literals', () => {
  it('string literal, double-quoted', () => {
    expect(eval_('"x" === "x"', {})).toBe(true);
    expect(eval_('"x" === "y"', {})).toBe(false);
  });

  it('string literal, single-quoted', () => {
    expect(eval_("'x' === 'x'", {})).toBe(true);
  });

  it('number literal, integer and decimal', () => {
    expect(eval_('a === 1', { a: 1 })).toBe(true);
    expect(eval_('a === 1.5', { a: 1.5 })).toBe(true);
    expect(eval_('a === 0', { a: 0 })).toBe(true);
  });

  it('boolean literal', () => {
    expect(eval_('a === true', { a: true })).toBe(true);
    expect(eval_('a === false', { a: false })).toBe(true);
    expect(eval_('a === true', { a: false })).toBe(false);
  });

  it('string escape sequences', () => {
    expect(eval_('a === "line\\nbreak"', { a: 'line\nbreak' })).toBe(true);
    expect(eval_('a === "tab\\there"', { a: 'tab\there' })).toBe(true);
    expect(eval_('a === "quote\\"here"', { a: 'quote"here' })).toBe(true);
    expect(eval_("a === 'apos\\'here'", { a: "apos'here" })).toBe(true);
    expect(eval_('a === "back\\\\slash"', { a: 'back\\slash' })).toBe(true);
  });
});

describe('composition-expression — operator precedence', () => {
  it('|| has lower precedence than &&', () => {
    // Parsed as `a || (b && c)` — when a is truthy the result is a (truthy).
    expect(eval_('a || b && c', { a: true, b: false, c: false })).toBe(true);
    // When a is false, evaluate b && c. Both falsy → false.
    expect(eval_('a || b && c', { a: false, b: false, c: true })).toBe(false);
    // When a is false, b true, c true → true.
    expect(eval_('a || b && c', { a: false, b: true, c: true })).toBe(true);
  });

  it('parentheses override precedence', () => {
    // `(a || b) && c`: when a truthy, c falsy → false.
    expect(eval_('(a || b) && c', { a: true, b: false, c: false })).toBe(false);
    expect(eval_('(a || b) && c', { a: true, b: false, c: true })).toBe(true);
  });

  it('=== has higher precedence than &&', () => {
    expect(eval_('a === 1 && b === 2', { a: 1, b: 2 })).toBe(true);
    expect(eval_('a === 1 && b === 2', { a: 1, b: 3 })).toBe(false);
  });

  it('multi-clause boolean expression', () => {
    const ctx = { matter: { type: 'securities' }, persona: 'paralegal', department: 'Finance' };
    const expr =
      'matter.type === "securities" && persona !== "lead-counsel" && department === "Finance"';
    expect(eval_(expr, ctx)).toBe(true);
    expect(eval_(expr, { ...ctx, persona: 'lead-counsel' })).toBe(false);
  });

  it('parens around equality', () => {
    expect(eval_('(a === 1) && (b === 2)', { a: 1, b: 2 })).toBe(true);
  });
});

describe('composition-expression — short-circuit semantics', () => {
  it('&& short-circuits on falsy left', () => {
    // Even though `nope.deep` would resolve to undefined (which would be
    // permissible), the right side should not be reached when left is false.
    expect(eval_('a && nope.deep === "x"', { a: false })).toBe(false);
  });

  it('|| short-circuits on truthy left', () => {
    expect(eval_('a || nope.deep === "x"', { a: true })).toBe(true);
  });
});

describe('composition-expression — whitespace tolerance', () => {
  it('extra spaces, tabs, newlines', () => {
    expect(eval_('  a   ===   1  ', { a: 1 })).toBe(true);
    expect(eval_('a\n===\n1', { a: 1 })).toBe(true);
    expect(eval_('a\t===\t1', { a: 1 })).toBe(true);
  });
});

describe('composition-expression — registration-time validation (AC-F1-3)', () => {
  it('throws CompositionExpressionError with source + position on bad input', () => {
    try {
      parseCompositionExpression('a +++ b');
    } catch (e) {
      expect(e).toBeInstanceOf(CompositionExpressionError);
      const err = e as CompositionExpressionError;
      expect(err.source).toBe('a +++ b');
      expect(err.position).toBeGreaterThanOrEqual(0);
      return;
    }
    throw new Error('expected throw');
  });

  it('rejects empty string', () => {
    expect(() => parseCompositionExpression('')).toThrow(CompositionExpressionError);
  });

  it('rejects whitespace-only', () => {
    expect(() => parseCompositionExpression('   ')).toThrow(CompositionExpressionError);
  });

  it('rejects non-string source', () => {
    // @ts-expect-error — runtime defense for callers without strict typing.
    expect(() => parseCompositionExpression(undefined)).toThrow(CompositionExpressionError);
    // @ts-expect-error
    expect(() => parseCompositionExpression(null)).toThrow(CompositionExpressionError);
    // @ts-expect-error
    expect(() => parseCompositionExpression(42)).toThrow(CompositionExpressionError);
  });
});

describe('composition-expression — out-of-grammar features rejected', () => {
  const cases: Array<[string, string]> = [
    ['arithmetic', 'a + b'],
    ['greater-than comparison', 'a > b'],
    ['less-than comparison', 'a < b'],
    ['loose equality', 'a == b'],
    ['loose inequality', 'a != b'],
    ['unary not', '!a'],
    ['unary minus', '-a'],
    ['function call', 'f(x)'],
    ['bracket access', 'a["b"]'],
    ['array literal', '[1, 2, 3]'],
    ['object literal', '{a: 1}'],
    ['template literal', '`hello`'],
    ['regex literal', '/x/'],
    ['assignment', 'a = b'],
    ['increment', 'a++'],
    ['ternary', 'a ? b : c'],
    ['bitwise and', 'a & b'],
    ['bitwise or', 'a | b'],
    ['typeof', 'typeof a === "string"'],
    ['void operator', 'void a'],
    ['comma operator', 'a, b'],
    ['null literal', 'null'],
    ['undefined literal', 'undefined'],
    ['NaN literal', 'NaN'],
    ['Infinity literal', 'Infinity'],
    ['this keyword', 'this.a'],
  ];
  for (const [label, src] of cases) {
    it(`rejects ${label}: ${src}`, () => {
      expect(() => parseCompositionExpression(src)).toThrow(CompositionExpressionError);
    });
  }
});

describe('composition-expression — chained equality is rejected', () => {
  it('rejects a === b === c', () => {
    expect(() => parseCompositionExpression('a === b === c')).toThrow(
      /Chained equality is not allowed/,
    );
  });

  it('rejects a !== b !== c', () => {
    expect(() => parseCompositionExpression('a !== b !== c')).toThrow(CompositionExpressionError);
  });

  it('accepts (a === b) === c (explicit grouping)', () => {
    expect(eval_('(a === b) === c', { a: 1, b: 1, c: true })).toBe(true);
    expect(eval_('(a === b) === c', { a: 1, b: 2, c: false })).toBe(true);
  });
});

describe('composition-expression — string and number lex errors', () => {
  it('rejects unterminated string', () => {
    expect(() => parseCompositionExpression('a === "open')).toThrow(/Unterminated string/);
  });

  it('rejects newline inside string', () => {
    expect(() => parseCompositionExpression('a === "line\n"')).toThrow(/Unterminated string/);
  });

  it('rejects bad string escape', () => {
    expect(() => parseCompositionExpression('a === "bad\\q"')).toThrow(/Invalid string escape/);
  });

  it('rejects multi-decimal number', () => {
    expect(() => parseCompositionExpression('a === 1.2.3')).toThrow(CompositionExpressionError);
  });

  it('rejects number with no fractional after decimal', () => {
    expect(() => parseCompositionExpression('a === 1.')).toThrow(/fractional digits/);
  });

  it('rejects identifier glued to number', () => {
    expect(() => parseCompositionExpression('a === 1abc')).toThrow(CompositionExpressionError);
  });
});

describe('composition-expression — paren / structural errors', () => {
  it('rejects unbalanced opening paren', () => {
    expect(() => parseCompositionExpression('(a === 1')).toThrow(CompositionExpressionError);
  });

  it('rejects unbalanced closing paren', () => {
    expect(() => parseCompositionExpression('a === 1)')).toThrow(CompositionExpressionError);
  });

  it('rejects empty parens', () => {
    expect(() => parseCompositionExpression('()')).toThrow(CompositionExpressionError);
  });

  it('rejects trailing junk', () => {
    expect(() => parseCompositionExpression('a === 1 b')).toThrow(/trailing input/);
  });

  it('rejects dangling dot', () => {
    expect(() => parseCompositionExpression('a. === 1')).toThrow(CompositionExpressionError);
  });

  it('rejects leading dot', () => {
    expect(() => parseCompositionExpression('.a === 1')).toThrow(CompositionExpressionError);
  });
});

describe('composition-expression — security boundary on path access', () => {
  it('does not walk into __proto__', () => {
    const ctx = {} as Record<string, unknown>;
    expect(eval_('__proto__ === "anything"', ctx)).toBe(false);
    expect(eval_('a.__proto__.toString === "anything"', { a: { x: 1 } })).toBe(false);
  });

  it('does not walk into constructor', () => {
    expect(eval_('a.constructor === "anything"', { a: { x: 1 } })).toBe(false);
  });

  it('does not surface inherited methods', () => {
    expect(eval_('a.toString === "anything"', { a: { x: 1 } })).toBe(false);
    expect(eval_('a.hasOwnProperty === "anything"', { a: { x: 1 } })).toBe(false);
  });

  it('null mid-path resolves to undefined silently (no throw)', () => {
    expect(eval_('a.b.c === "x"', { a: null })).toBe(false);
    expect(eval_('a.b.c !== "x"', { a: null })).toBe(true);
  });

  it('non-object mid-path resolves to undefined silently', () => {
    expect(eval_('a.b === "x"', { a: 'a string' })).toBe(false);
    expect(eval_('a.b === "x"', { a: 42 })).toBe(false);
  });
});

describe('composition-expression — DoS bounds', () => {
  it('rejects source longer than MAX_EXPRESSION_LENGTH', () => {
    const long = `a === ${'"x"'.repeat(MAX_EXPRESSION_LENGTH)}`;
    expect(() => parseCompositionExpression(long)).toThrow(/maximum length/);
  });

  it('rejects expression nested deeper than MAX_EXPRESSION_DEPTH', () => {
    const opens = '('.repeat(MAX_EXPRESSION_DEPTH + 5);
    const closes = ')'.repeat(MAX_EXPRESSION_DEPTH + 5);
    expect(() => parseCompositionExpression(`${opens}a === 1${closes}`)).toThrow(
      /too deeply nested/,
    );
  });
});

describe('composition-expression — predicate is pure and re-usable', () => {
  it('caches AST; multiple calls return consistent results', () => {
    const pred = parseCompositionExpression('matter.type === "securities"');
    expect(pred({ matter: { type: 'securities' } })).toBe(true);
    expect(pred({ matter: { type: 'employment' } })).toBe(false);
    expect(pred({ matter: { type: 'securities' } })).toBe(true);
  });

  it('returns Boolean (never undefined / falsy non-boolean)', () => {
    const pred = parseCompositionExpression('a && b');
    const result = pred({ a: 'truthy-string', b: 1 });
    expect(typeof result).toBe('boolean');
    expect(result).toBe(true);
  });
});

describe('composition-expression — edge cases on equality', () => {
  it('strict equality semantics: no type coercion', () => {
    expect(eval_('a === 1', { a: '1' })).toBe(false);
    expect(eval_('a === true', { a: 1 })).toBe(false);
    expect(eval_('a === false', { a: 0 })).toBe(false);
    expect(eval_('a === ""', { a: false })).toBe(false);
  });

  it('NaN never equals NaN (JS strict-equality semantics)', () => {
    expect(eval_('a === a', { a: Number.NaN })).toBe(false);
    expect(eval_('a !== a', { a: Number.NaN })).toBe(true);
  });

  it('undefined path !== string literal', () => {
    expect(eval_('missing === "x"', {})).toBe(false);
    expect(eval_('missing !== "x"', {})).toBe(true);
  });
});
