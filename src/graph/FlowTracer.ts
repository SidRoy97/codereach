import { CodeGraph, CodeNode } from './CodeGraphTypes';
import type { ListRow } from './ListPanel';

// One step in a traced flow: a symbol and how deep it sits in the call chain.
interface FlowStep {
  node:  CodeNode;
  depth: number;
}

// I follow what a symbol calls, downward, to show how a flow moves through code.
export class FlowTracer {
  constructor(private readonly getGraph: () => CodeGraph) {}

  // I return the flow as clickable rows, ordered top-down by call depth.
  trace(startId: string): ListRow[] {
    return this.walkDown(startId).map(step => this.toRow(step));
  }

  // I walk callees breadth-first, never revisiting, capped at depth six.
  private walkDown(startId: string): FlowStep[] {
    const graph = this.getGraph();
    const start = graph.nodes.find(n => n.id === startId);
    if (!start) return [];

    const steps: FlowStep[] = [];
    const seen = new Set<string>([startId]);
    let frontier = [{ id: startId, depth: 0 }];

    while (frontier.length > 0) {
      const next: Array<{ id: string; depth: number }> = [];
      for (const item of frontier) {
        const node = graph.nodes.find(n => n.id === item.id);
        if (node) steps.push({ node, depth: item.depth });
        if (item.depth >= 6) continue;
        for (const calleeId of this.calleesOf(graph, item.id)) {
          if (seen.has(calleeId)) continue;
          seen.add(calleeId);
          next.push({ id: calleeId, depth: item.depth + 1 });
        }
      }
      frontier = next;
    }
    return steps;
  }

  // I list the symbols a given symbol calls.
  private calleesOf(graph: CodeGraph, id: string): string[] {
    return graph.edges.filter(e => e.from === id && e.relation === 'calls').map(e => e.to);
  }

  // I turn one step into a row, using indentation to show its depth.
  private toRow(step: FlowStep): ListRow {
    const indent = '› '.repeat(step.depth);
    return {
      label:  `${indent}${step.node.name}`,
      detail: `${step.node.kind} · ${step.node.file}:${step.node.line + 1}`,
      file:   step.node.file,
      line:   step.node.line,
      badge:  step.depth === 0 ? 'start' : `depth ${step.depth}`,
      tone:   'normal',
    };
  }
}
