import * as vscode from 'vscode';
import * as path from 'path';
import { CodeGraph } from './CodeGraphTypes';
import { ImpactAnalyzer } from './ImpactAnalyzer';

// Single job: put a clickable "N callers · M affected" line above each
// function in the editor. Clicking it opens the graph panel for that symbol.
// It reads the graph and matches symbols to lines — no parsing, no I/O.
export class ImpactCodeLens implements vscode.CodeLensProvider {
  private changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;

  constructor(private readonly getGraph: () => CodeGraph) {}

  // Tell VS Code to refresh the lenses (called after the graph rebuilds).
  refresh(): void {
    this.changed.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return [];

    const relFile  = path.relative(root, document.uri.fsPath);
    const graph    = this.getGraph();
    const analyzer = new ImpactAnalyzer(graph);

    const lenses: vscode.CodeLens[] = [];

    // One lens per symbol declared in this file.
    for (const node of graph.nodes) {
      if (node.file !== relFile) continue;

      const impact = analyzer.analyze(node.id);
      if (!impact) continue;

      const range = new vscode.Range(node.line, 0, node.line, 0);
      const callerCount   = impact.directCallers.length;
      const affectedCount = impact.affected.length;

      lenses.push(new vscode.CodeLens(range, {
        title: `${callerCount} caller(s) · ${affectedCount} affected if changed`,
        command: 'codescape.showImpact',
        arguments: [node.id],
      }));
    }

    return lenses;
  }
}