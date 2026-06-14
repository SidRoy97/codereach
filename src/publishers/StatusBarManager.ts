import * as vscode from 'vscode';
import { IResultStore } from '../interfaces';

// Single job: count issues in the store and update the status bar text + color
export class StatusBarManager implements vscode.Disposable {

  private item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);

  constructor(private readonly store: IResultStore) {
    // Clicking the status bar opens the dashboard
    this.item.command = 'codescape.openDashboard';
    this.item.show();
    this.render();
  }

  // Recalculate and redraw after every analysis
  render(): void {
    const all      = this.store.getAll();
    const errors   = all.reduce((n, r) => n + r.issues.filter(i => i.severity === 'error').length,   0);
    const warnings = all.reduce((n, r) => n + r.issues.filter(i => i.severity === 'warning').length, 0);
    const total    = all.reduce((n, r) => n + r.issues.length, 0);

    if (total === 0) {
      // Green checkmark when the workspace is clean
      this.item.text             = '$(check) Codescape';
      this.item.backgroundColor  = undefined;
      this.item.tooltip          = 'Codescape: No issues found';
      return;
    }

    const parts: string[] = [];
    if (errors   > 0) parts.push(`$(error) ${errors}`);
    if (warnings > 0) parts.push(`$(warning) ${warnings}`);
    this.item.text            = `Codescape: ${parts.join('  ')}`;
    this.item.tooltip         = `Codescape: ${total} issue(s) — click to open dashboard`;
    this.item.backgroundColor = errors > 0
      ? new vscode.ThemeColor('statusBarItem.errorBackground')
      : new vscode.ThemeColor('statusBarItem.warningBackground');
  }

  dispose(): void { this.item.dispose(); }
}