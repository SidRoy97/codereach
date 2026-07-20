import type { Node } from 'web-tree-sitter';

// Function node types per language — the units we compare for duplication.
const functionNodes: Record<string, Set<string>> = {
  javascript: new Set(['function_declaration', 'method_definition', 'arrow_function', 'function_expression']),
  typescript: new Set(['function_declaration', 'method_definition', 'arrow_function', 'function_expression']),
  python:     new Set(['function_definition']),
  java:       new Set(['method_declaration', 'constructor_declaration']),
};

// One function pulled from the tree: its name, start line, and source text.
export interface ExtractedFunction {
  name: string;
  line: number;
  text: string;
}

// I pull each top-level function and method out of a parsed tree.
export function extractFunctions(root: Node, grammar: string): ExtractedFunction[] {
  const functions = functionNodes[grammar];
  if (!functions) return [];
  const out: ExtractedFunction[] = [];
  walk(root, functions, out);
  return out;
}

// I record each function I meet without descending into its nested functions.
function walk(node: Node, functions: Set<string>, out: ExtractedFunction[]): void {
  if (functions.has(node.type)) {
    out.push({ name: functionName(node), line: node.startPosition.row, text: node.text });
    return;
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) walk(child, functions, out);
  }
}

// I find a function's name, falling back to its variable or a placeholder.
function functionName(node: Node): string {
  const own = node.childForFieldName('name')?.text;
  if (own) return own;
  const parent = node.parent;
  if (parent?.type === 'variable_declarator') return parent.childForFieldName('name')?.text ?? '(anonymous)';
  if (parent?.type === 'pair') return parent.childForFieldName('key')?.text ?? '(anonymous)';
  return '(anonymous)';
}
