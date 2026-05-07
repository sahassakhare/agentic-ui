export {
  CompositionExpressionError,
  MAX_EXPRESSION_DEPTH,
  MAX_EXPRESSION_LENGTH,
  evaluateCompositionExpression,
  parseCompositionExpression,
} from './composition-expression';
export type {
  CompiledPredicate,
  CompositionContext,
} from './composition-expression';
export { COMPOSITION_SLOT, CompositionStore } from './composition-store';
