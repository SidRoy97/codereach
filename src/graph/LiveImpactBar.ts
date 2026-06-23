import * as vscode from 'vscode';
import { CodeGraph } from './CodeGraphTypes';
import { ImpactAnalyzer } from './ImpactAnalyzer';
import { SymbolLocator } from './SymbolLocator';

// I have one job: show the impact of the symbol under the cursor in the status
// bar, and keep it updated as the cursor moves. No clicks needed.
export class LiveImpactBar {
  private item: vscode.StatusBarItem;
  private locator: SymbolLocator;

  constructor(
    private readonly getGraph: () => CodeGraph,
    private readonly getRoot: () => string | undefined,
  ) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'codereach.showImpactForCursor';
    this.locator = new SymbolLocator(getGraph);
  }

  // I refresh the bar for the symbol the cursor is currently inside.
  update(editor: vscode.TextEditor | undefined): void {
    const root = this.getRoot();
    if (!editor || !root || editor.document.uri.scheme !== 'file') {
      this.item.hide();
      return;
    }

    const relFile = this.toRelative(root, editor.document.uri.fsPath);
    const line    = editor.selection.active.line;
    const node    = this.locator.findEnclosing(relFile, line);
    if (!node) { this.item.hide(); return; }

    const impact = new ImpactAnalyzer(this.getGraph()).analyze(node.id);
    if (!impact) { this.item.hide(); return; }

    // I count how many distinct files the affected symbols span, since a change
    // that crosses many files is riskier than one contained to a single file.
    const files = new Set(impact.affected.map(n => n.file));
    const callers = impact.directCallers.length;

    this.item.text = this.buildText(callers, impact.affected.length, files.size);
    this.item.tooltip = `Changing ${node.name}() affects ${impact.affected.length} symbol(s) across ${files.size} file(s). Click to see the graph.`;
    this.item.backgroundColor = this.colorFor(files.size);
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }

  // I build a short label: callers, affected count, and a cross-file warning.
  private buildText(callers: number, affected: number, files: number): string {
    if (callers === 0) return '$(check) no callers';
    const warn = files > 3 ? ' $(warning)' : '';
    return `$(zap) ${callers} caller(s) · ${affected} affected · ${files} file(s)${warn}`;
  }

  // I tint the bar by how many files a change would reach.
  private colorFor(files: number): vscode.ThemeColor | undefined {
    if (files > 6) return new vscode.ThemeColor('statusBarItem.errorBackground');
    if (files > 3) return new vscode.ThemeColor('statusBarItem.warningBackground');
    return undefined;
  }

  // I turn an absolute path into a workspace-relative one to match node ids.
  private toRelative(root: string, fsPath: string): string {
    return fsPath.startsWith(root) ? fsPath.slice(root.length + 1) : fsPath;
  }
}