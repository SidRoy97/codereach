import { CodeGraph, CodeNode } from './CodeGraphTypes';
import { ImpactAnalyzer } from './ImpactAnalyzer';
import type { ListRow } from './ListPanel';

// The downstream fallout of a set of changed files.
export interface DiffImpactResult {
  changedSymbols:  CodeNode[];
  impactedSymbols: CodeNode[];
  impactedFiles:   string[];
}

// I compute what a set of changed files would break elsewhere in the codebase.
export class DiffImpact {
  constructor(private readonly getGraph: () => CodeGraph) {}

  // I collect every downstream symbol (in other files) that depends on the changes.
  analyze(changedFiles: Set<string>): DiffImpactResult {
    const graph = this.getGraph();
    const analyzer = new ImpactAnalyzer(graph);
    const changedSymbols = graph.nodes.filter(n => changedFiles.has(n.file));

    const impacted = new Map<string, CodeNode>();
    for (const symbol of changedSymbols) {
      const result = analyzer.analyze(symbol.id);
      if (!result) continue;
      for (const node of result.affected) {
        if (!changedFiles.has(node.file)) impacted.set(node.id, node);
      }
    }

    const impactedSymbols = Array.from(impacted.values());
    const impactedFiles = Array.from(new Set(impactedSymbols.map(n => n.file))).sort();
    return { changedSymbols, impactedSymbols, impactedFiles };
  }

  // I turn the downstream impact into rows, ordered by file, flagged as risky.
  toRows(result: DiffImpactResult): ListRow[] {
    return result.impactedSymbols
      .slice()
      .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
      .map(node => ({
        label:  node.name,
        detail: `${node.kind} · ${node.file}:${node.line + 1}`,
        file:   node.file,
        line:   node.line,
        badge:  'impacted',
        tone:   'danger' as const,
      }));
  }
}
