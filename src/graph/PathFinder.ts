import { CodeGraph, CodeNode } from './CodeGraphTypes';
import type { ListRow } from './ListPanel';

// One hop along a path: the symbol reached and how it connects to the one before.
interface Hop {
  node:      CodeNode;
  direction: 'start' | 'calls' | 'called by';
}

// I find the shortest connection between two symbols, following calls either way.
export class PathFinder {
  constructor(private readonly getGraph: () => CodeGraph) {}

  // I return the path from one symbol to another as clickable rows.
  find(fromId: string, toId: string): ListRow[] {
    const hops = this.shortestPath(fromId, toId);
    return hops.map(hop => this.toRow(hop));
  }

  // I breadth-first search the graph, treating each call edge as two-way.
  private shortestPath(fromId: string, toId: string): Hop[] {
    const graph = this.getGraph();
    if (fromId === toId) return [];

    const cameFrom = new Map<string, { prevId: string; direction: Hop['direction'] }>();
    const visited  = new Set<string>([fromId]);
    let frontier   = [fromId];

    while (frontier.length > 0) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const step of this.neighbours(graph, id)) {
          if (visited.has(step.id)) continue;
          visited.add(step.id);
          cameFrom.set(step.id, { prevId: id, direction: step.direction });
          if (step.id === toId) return this.rebuild(graph, fromId, toId, cameFrom);
          next.push(step.id);
        }
      }
      frontier = next;
    }
    return [];
  }

  // I list every symbol one call-edge away, tagged by which way the call goes.
  private neighbours(graph: CodeGraph, id: string): Array<{ id: string; direction: Hop['direction'] }> {
    const out: Array<{ id: string; direction: Hop['direction'] }> = [];
    for (const edge of graph.edges) {
      if (edge.relation !== 'calls') continue;
      if (edge.from === id) out.push({ id: edge.to,   direction: 'calls' });
      if (edge.to === id)   out.push({ id: edge.from, direction: 'called by' });
    }
    return out;
  }

  // I walk the parent links backwards to build the path front to back.
  private rebuild(graph: CodeGraph, fromId: string, toId: string, cameFrom: Map<string, { prevId: string; direction: Hop['direction'] }>): Hop[] {
    const ids: Array<{ id: string; direction: Hop['direction'] }> = [];
    let current = toId;
    while (current !== fromId) {
      const step = cameFrom.get(current)!;
      ids.unshift({ id: current, direction: step.direction });
      current = step.prevId;
    }
    ids.unshift({ id: fromId, direction: 'start' });
    return ids
      .map(entry => ({ node: this.nodeById(graph, entry.id), direction: entry.direction }))
      .filter((hop): hop is Hop => hop.node !== null);
  }

  // I look up one node by its id.
  private nodeById(graph: CodeGraph, id: string): CodeNode | null {
    return graph.nodes.find(node => node.id === id) ?? null;
  }

  // I turn one hop into a clickable row.
  private toRow(hop: Hop): ListRow {
    return {
      label:  hop.node.name,
      detail: `${hop.node.kind} · ${hop.node.file}:${hop.node.line + 1}`,
      file:   hop.node.file,
      line:   hop.node.line,
      badge:  hop.direction,
      tone:   'normal',
    };
  }
}
