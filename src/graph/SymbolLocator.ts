import { CodeGraph, CodeNode } from './CodeGraphTypes';

// I find which symbol the cursor sits inside, given a file and a line.
export class SymbolLocator {
  constructor(private readonly getGraph: () => CodeGraph) {}

  // I return the closest symbol defined at or above the given line in the file.
  findEnclosing(relFile: string, line: number): CodeNode | null {
    const inFile = this.getGraph().nodes.filter(n => n.file === relFile);
    let best: CodeNode | null = null;
    for (const node of inFile) {
      if (node.line <= line && (!best || node.line > best.line)) best = node;
    }
    return best;
  }
}
