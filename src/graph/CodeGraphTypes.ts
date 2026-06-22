// The shared data contract for the whole code graph feature.
// This file has zero logic and zero imports on purpose: every other
// graph file depends only on these shapes, never on each other's code.
// That keeps the layers independent — a change to parsing or to the UI
// never forces a change anywhere else.

// One function, class, or method found in the codebase.
export interface CodeNode {
  // Unique identifier: file path + "::" + symbol name.
  // Example: "src/auth.ts::validateToken"
  id: string;

  // The bare symbol name, e.g. "validateToken".
  name: string;

  // What kind of symbol this is.
  kind: 'function' | 'class' | 'method';

  // Workspace-relative file path, e.g. "src/auth.ts".
  file: string;

  // Zero-based line where the symbol is defined.
  line: number;

  // Zero-based character offset of the symbol's name on its line. Used by the
  // precise call-hierarchy resolver to position on the name exactly.
  nameColumn: number;
}

// One directed relationship: `from` uses `to`.
export interface CodeEdge {
  // Id of the node that does the calling or importing.
  from: string;

  // Id of the node being called or imported.
  to: string;

  // The kind of relationship.
  relation: 'calls' | 'imports';
}

// The complete graph: every symbol and every relationship between them.
// This is also exactly what gets written to codescape.json — the
// in-memory graph and the shareable file are the same shape, so no
// conversion step is ever needed.
export interface CodeGraph {
  nodes: CodeNode[];
  edges: CodeEdge[];
}

// The result of asking "what is affected if I change this symbol".
// Returned by ImpactAnalyzer, consumed by the panel and the CodeLens.
export interface ImpactResult {
  // The symbol the developer is changing.
  target: CodeNode;

  // Symbols that directly call or import the target.
  directCallers: CodeNode[];

  // Symbols the target directly calls or imports.
  directCallees: CodeNode[];

  // Every symbol affected transitively if the target changes,
  // following caller relationships recursively.
  affected: CodeNode[];
}