import { CodeGraph, CodeNode } from './CodeGraphTypes';

// I have one job: given a file and a line, find the symbol the cursor is in.
// Both the live-impact bar and the flow tracer need this, so it lives once here.
export class SymbolLocator {
  constructor(private readonly getGraph: () => CodeGraph) {}

  // I return the symbol whose definition is the last one at or before the line
  // in the same file. That is the symbol the cursor is currently inside.
  findEnclosing(relFile: string, line: number): CodeNode | null {
    const inFile = this.getGraph().nodes.filter(n => n.file === relFile);

    let best: CodeNode | null = null;
    for (const node of inFile) {
      // I keep the closest definition that starts at or above the cursor line.
      if (node.line <= line) {
        if (!best || node.line > best.line) best = node;
      }
    }
    return best;
  }
}