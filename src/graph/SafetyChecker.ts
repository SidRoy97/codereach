import { CodeGraph, CodeNode } from './CodeGraphTypes';
import { ImpactAnalyzer } from './ImpactAnalyzer';
import type { ListRow } from './ListPanel';

// I list every call site a symbol change would affect, riskiest first.
export class SafetyChecker {
  constructor(private readonly getGraph: () => CodeGraph) {}

  // I return affected callers as rows, cross-file ones ranked highest.
  check(targetId: string): ListRow[] {
    const graph = this.getGraph();
    const target = graph.nodes.find(n => n.id === targetId);
    if (!target) return [];

    const impact = new ImpactAnalyzer(graph).analyze(targetId);
    if (!impact) return [];

    return impact.directCallers
      .map(caller => ({ caller, crossFile: caller.file !== target.file }))
      .sort((a, b) => Number(b.crossFile) - Number(a.crossFile))
      .map(item => this.toRow(item.caller, item.crossFile));
  }

  // I turn one affected caller into a row, marking cross-file ones as risky.
  private toRow(caller: CodeNode, crossFile: boolean): ListRow {
    return {
      label:  caller.name,
      detail: `${caller.kind} · ${caller.file}:${caller.line + 1}`,
      file:   caller.file,
      line:   caller.line,
      badge:  crossFile ? 'cross-file' : 'same-file',
      tone:   crossFile ? 'danger' : 'normal',
    };
  }
}
