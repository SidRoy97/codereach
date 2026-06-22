import { CodeGraph, CodeNode } from './CodeGraphTypes';
import { ListRow } from './ListPanel';

// One step in a traced flow: a symbol plus how deep it sits in the chain.
interface FlowStep {
  node: CodeNode;
  depth: number;
}

// I have one job: starting from a symbol, follow what it calls (its callees)
// downward to show how a flow moves through the codebase, layer by layer.
export class FlowTracer {
  constructor(private readonly getGraph: () => CodeGraph) {}

  // I return the flow as clickable rows, ordered top-down by call depth.
  trace(startId: string): ListRow[] {
    const steps = this.walkDown(startId);
    return steps.map(step => this.toRow(step));
  }

  // I walk callees breadth-first so the chain reads in execution order. I stop
  // at a sensible depth and never revisit a symbol, so cycles cannot loop.
  private walkDown(startId: string): FlowStep[] {
    const graph = this.getGraph();
    const start = graph.nodes.find(n => n.id === startId);
    if (!start) return [];

    const steps: FlowStep[] = [];
    const seen = new Set<string>([startId]);
    let frontier: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];

    // I cap depth at 6 so very large graphs stay readable.
    while (frontier.length > 0) {
      const next: Array<{ id: string; depth: number }> = [];

      for (const item of frontier) {
        const node = graph.nodes.find(n => n.id === item.id);
        if (node) steps.push({ node, depth: item.depth });

        if (item.depth >= 6) continue;

        // I follow every "calls" edge out of this symbol to its callees.
        const callees = graph.edges
          .filter(e => e.from === item.id && e.relation === 'calls')
          .map(e => e.to);

        for (const calleeId of callees) {
          if (seen.has(calleeId)) continue;
          seen.add(calleeId);
          next.push({ id: calleeId, depth: item.depth + 1 });
        }
      }
      frontier = next;
    }
    return steps;
  }

  // I turn one step into a row, using indentation to show its depth.
  private toRow(step: FlowStep): ListRow {
    const indent = '› '.repeat(step.depth);
    return {
      label: `${indent}${step.node.name}`,
      detail: `${step.node.kind} · ${step.node.file}:${step.node.line + 1}`,
      file: step.node.file,
      line: step.node.line,
      badge: step.depth === 0 ? 'start' : `depth ${step.depth}`,
      tone: 'normal',
    };
  }
}