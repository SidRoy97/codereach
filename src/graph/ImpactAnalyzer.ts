import { CodeGraph, CodeNode, ImpactResult } from './CodeGraphTypes';

// Symbols the runtime or VS Code invokes, so they must never count as unused.
const entryPoints = new Set([
  'activate', 'deactivate', 'constructor',
  'provideCodeActions', 'provideCodeLenses', 'resolveWebviewView', 'dispose',
]);

// I answer impact questions by reading an existing graph — no parsing, no I/O.
export class ImpactAnalyzer {
  constructor(private readonly graph: CodeGraph) {}

  // I return a symbol's callers, callees, and everything it transitively affects.
  analyze(nodeId: string): ImpactResult | null {
    const target = this.findNode(nodeId);
    if (!target) return null;
    return {
      target,
      directCallers: this.callersOf(nodeId),
      directCallees: this.calleesOf(nodeId),
      affected:      this.affectedBy(nodeId),
    };
  }

  // I count how many other files a change to this file would reach.
  blastRadiusForFile(file: string): number {
    const fileNodeIds = this.graph.nodes.filter(n => n.file === file).map(n => n.id);
    const affectedFiles = new Set<string>();
    for (const id of fileNodeIds) {
      for (const node of this.affectedBy(id)) {
        if (node.file !== file) affectedFiles.add(node.file);
      }
    }
    return affectedFiles.size;
  }

  // I list symbols nothing else calls, skipping classes and framework entries.
  findUnusedSymbols(): CodeNode[] {
    const calledIds = new Set(this.graph.edges.map(e => e.to));
    return this.graph.nodes.filter(node => {
      if (node.kind === 'class') return false;
      if (node.name === 'constructor') return false;
      if (calledIds.has(node.id)) return false;
      if (entryPoints.has(node.name)) return false;
      return true;
    });
  }

  // I list the symbols that directly call the given symbol.
  private callersOf(nodeId: string): CodeNode[] {
    const ids = this.graph.edges.filter(e => e.to === nodeId).map(e => e.from);
    return this.nodesByIds(ids);
  }

  // I list the symbols the given symbol directly calls.
  private calleesOf(nodeId: string): CodeNode[] {
    const ids = this.graph.edges.filter(e => e.from === nodeId).map(e => e.to);
    return this.nodesByIds(ids);
  }

  // I walk callers recursively to find everything a change would break.
  private affectedBy(nodeId: string): CodeNode[] {
    const affected = new Set<string>();
    const queue = [nodeId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of this.graph.edges) {
        if (edge.to === current && !affected.has(edge.from)) {
          affected.add(edge.from);
          queue.push(edge.from);
        }
      }
    }
    return this.nodesByIds(Array.from(affected));
  }

  // I look up one node by its id.
  private findNode(nodeId: string): CodeNode | null {
    return this.graph.nodes.find(n => n.id === nodeId) ?? null;
  }

  // I turn a list of ids into their unique nodes.
  private nodesByIds(ids: string[]): CodeNode[] {
    const unique = Array.from(new Set(ids));
    const result: CodeNode[] = [];
    for (const id of unique) {
      const node = this.findNode(id);
      if (node) result.push(node);
    }
    return result;
  }
}
