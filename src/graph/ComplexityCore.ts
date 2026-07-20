import type { Node } from 'web-tree-sitter';

// Function node types per language — each one opens its own complexity scope.
const functionNodes: Record<string, Set<string>> = {
  javascript: new Set(['function_declaration', 'method_definition', 'arrow_function', 'function_expression']),
  typescript: new Set(['function_declaration', 'method_definition', 'arrow_function', 'function_expression']),
  python:     new Set(['function_definition']),
  java:       new Set(['method_declaration', 'constructor_declaration']),
};

// Branch node types per language — each one adds a path through the function.
const branchNodes: Record<string, Set<string>> = {
  javascript: new Set(['if_statement', 'for_statement', 'for_in_statement', 'while_statement', 'do_statement', 'switch_case', 'catch_clause', 'ternary_expression']),
  typescript: new Set(['if_statement', 'for_statement', 'for_in_statement', 'while_statement', 'do_statement', 'switch_case', 'catch_clause', 'ternary_expression']),
  python:     new Set(['if_statement', 'elif_clause', 'for_statement', 'while_statement', 'except_clause', 'conditional_expression', 'for_in_clause', 'if_clause', 'case_clause', 'boolean_operator']),
  java:       new Set(['if_statement', 'for_statement', 'enhanced_for_statement', 'while_statement', 'do_statement', 'catch_clause', 'ternary_expression']),
};

// The two boolean operators that each add a branch (comparisons and ?? do not).
const branchOperators = new Set(['&&', '||']);

export interface FunctionScore {
  name:   string;
  line:   number;
  column: number;
  score:  number;
}

// I score every function in a parsed tree, returning one result per function.
export function scoreFunctions(root: Node, grammar: string): FunctionScore[] {
  const functions = functionNodes[grammar];
  if (!functions) return [];
  const out: FunctionScore[] = [];
  collectFunctions(root, grammar, functions, out);
  return out;
}

// I walk the tree and score every function I find, top level or nested.
function collectFunctions(node: Node, grammar: string, functions: Set<string>, out: FunctionScore[]): void {
  if (functions.has(node.type)) {
    out.push({
      name:   functionName(node),
      line:   node.startPosition.row,
      column: node.startPosition.column,
      score:  scoreFunction(node, grammar, functions),
    });
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) collectFunctions(child, grammar, functions, out);
  }
}

// I count one plus every branch in this function, ignoring nested functions.
function scoreFunction(fn: Node, grammar: string, functions: Set<string>): number {
  const branches = branchNodes[grammar] ?? new Set<string>();
  let score = 1;

  const visit = (node: Node): void => {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) continue;
      if (functions.has(child.type)) continue;
      if (isBranch(child, grammar, branches)) score++;
      visit(child);
    }
  };

  visit(fn);
  return score;
}

// I decide whether a single node adds a branch to the current function.
function isBranch(node: Node, grammar: string, branches: Set<string>): boolean {
  if (branches.has(node.type)) return true;
  if (node.type === 'binary_expression') {
    const operator = node.childForFieldName('operator')?.text ?? '';
    return branchOperators.has(operator);
  }
  if (grammar === 'java' && node.type === 'switch_label') {
    return !/^\s*default\b/.test(node.text);
  }
  return false;
}

// I find the name of a function, falling back to its variable or a placeholder.
function functionName(node: Node): string {
  const own = node.childForFieldName('name')?.text;
  if (own) return own;
  const parent = node.parent;
  if (parent?.type === 'variable_declarator') return parent.childForFieldName('name')?.text ?? '(anonymous)';
  if (parent?.type === 'pair') return parent.childForFieldName('key')?.text ?? '(anonymous)';
  return '(anonymous)';
}
