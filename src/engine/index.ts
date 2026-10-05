// Public API of the math engine. The UI and plot layers should import from here (or from
// types.ts for types only), not from parser or compiler internals.

export {
  BUILTIN_CONSTANTS,
  BUILTIN_FUNCTION_NAMES,
  BUILTIN_FUNCTIONS,
  type BuiltinFunctionName,
  isBuiltinFunction,
  PLOT_VARIABLES,
  PREFIXABLE_FUNCTIONS,
} from './builtinNames';
export { DocumentEngine } from './document';
export { applyFix, errorFixes, sliderFixNames } from './errors';
export { formatCoordinate, formatPlain, formatSliderValue, formatValue } from './format';
export type { NameContext } from './names';
export {
  BP_ADD,
  BP_IMPLICIT_ARG,
  BP_MUL,
  BP_POSTFIX,
  BP_POW,
  BP_POW_RIGHT,
  BP_PREFIX,
  type ParseResult,
  parse,
} from './parser';
export { printNode, printStatement } from './print';
export type {
  DocAnalysis,
  ExplicitInequality,
  Fn0,
  Fn1,
  Fn2,
  MathError,
  PlotItem,
  QuickFix,
  RowInput,
  RowKind,
  RowResult,
  Span,
  UnknownUse,
} from './types';
