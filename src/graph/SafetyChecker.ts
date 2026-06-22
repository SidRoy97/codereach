import { CodeGraph, CodeNode } from './CodeGraphTypes';
import { ImpactAnalyzer } from './ImpactAnalyzer';
import { ListRow } from './ListPanel';

// I have one job: before a symbol is changed, list every place that would be
// affected, ranked by risk so the most dangerous call sites show first.
export class SafetyChecker {
  constructor(private readonly getGraph: () => CodeGraph) {}

  // I return affected call sites as rows, highest risk first.
  check(targetId: string): ListRow[] {
    const graph = this.getGraph();
    const target = graph.nodes.find(n => n.id === targetId);
    if (!target) return [];

    const impact = new ImpactAnalyzer(graph).analyze(targetId);
    if (!impact) return [];

    // I treat a caller in a different file as higher risk than a same-file one,
    // because cross-file changes are the ones easy to miss and break in review.
    const ranked = impact.directCallers
      .map(caller => ({ caller, crossFile: caller.file !== target.file }))
      .sort((a, b) => Number(b.crossFile) - Number(a.crossFile));

    return ranked.map(item => this.toRow(item.caller, item.crossFile));
  }

  // I turn one affected caller into a row, tinting cross-file ones as risky.
  private toRow(caller: CodeNode, crossFile: boolean): ListRow {
    return {
      label: caller.name,
      detail: `${caller.kind} · ${caller.file}:${caller.line + 1}`,
      file: caller.file,
      line: caller.line,
      badge: crossFile ? 'cross-file' : 'same-file',
      tone: crossFile ? 'danger' : 'normal',
    };
  }
}