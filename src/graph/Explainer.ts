import { CodeGraph, CodeNode } from './CodeGraphTypes';
import { ImpactAnalyzer } from './ImpactAnalyzer';
import type { ListRow } from './ListPanel';

// I summarize a symbol's immediate neighbourhood: who calls it and what it calls.
export class Explainer {
  constructor(private readonly getGraph: () => CodeGraph) {}

  // I return the symbol, its callers, and its callees as clickable rows.
  explain(nodeId: string): ListRow[] {
    const graph = this.getGraph();
    const impact = new ImpactAnalyzer(graph).analyze(nodeId);
    if (!impact) return [];

    const rows: ListRow[] = [ this.toRow(impact.target, 'this symbol', 'normal') ];
    for (const caller of impact.directCallers) rows.push(this.toRow(caller, 'called by', 'normal'));
    for (const callee of impact.directCallees) rows.push(this.toRow(callee, 'calls', 'normal'));
    return rows;
  }

  // I turn one symbol into a row tagged by its relationship to the focus symbol.
  private toRow(node: CodeNode, badge: string, tone: 'normal' | 'danger'): ListRow {
    return {
      label:  node.name,
      detail: `${node.kind} · ${node.file}:${node.line + 1}`,
      file:   node.file,
      line:   node.line,
      badge,
      tone,
    };
  }
}
