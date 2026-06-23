import * as vscode from 'vscode';
import { FileAnalysisResult, Issue, toVsCodeSeverity, IssueCategory } from '../types';
import { IResultPresenter } from '../interfaces';

// Icon per category shown in the Problems panel message
const ICONS: Record<IssueCategory, string> = {
  'code-smell': '🧹', security: '🔒', complexity: '📊', duplicate: '📋', ai: '🤖',
};

// Single job: take a FileAnalysisResult and show squiggles in the editor
export class DiagnosticsPublisher implements IResultPresenter, vscode.Disposable {

  // One collection per extension — named "CodeReach" in the Problems panel
  private collection = vscode.languages.createDiagnosticCollection('CodeReach');

  // Push issues for one file into the Problems panel
  present(result: FileAnalysisResult): void {
    const diags = result.issues.map(i => this.toDiagnostic(i, result.uri));
    this.collection.set(result.uri, diags);
  }

  // Remove squiggles for a single file
  clear(uri: vscode.Uri): void {
    this.collection.delete(uri);
  }

  // Remove all squiggles across every file
  clearAll(): void {
    this.collection.clear();
  }

  // Convert our Issue shape to the vscode.Diagnostic shape
  private toDiagnostic(issue: Issue, docUri: vscode.Uri): vscode.Diagnostic {
    // Look up the open document to clamp line numbers safely
    const doc    = vscode.workspace.textDocuments.find(d => d.uri.toString() === docUri.toString());
    const maxL   = doc ? doc.lineCount - 1 : issue.line;
    const line   = Math.min(issue.line, maxL);
    const lineLen = doc ? doc.lineAt(line).text.length : 200;

    const range = new vscode.Range(
      line, Math.min(issue.column, lineLen),
      Math.min(issue.endLine ?? line, maxL), Math.min(issue.endColumn ?? lineLen, lineLen),
    );

    // Suggestion goes on a second line so it's visible without clicking
    const msg  = `${ICONS[issue.category]} ${issue.message}${issue.suggestion ? `\n💡 ${issue.suggestion}` : ''}`;
    const diag = new vscode.Diagnostic(range, msg, toVsCodeSeverity(issue.severity));

    // Source label shown in Problems panel — AI issues get a different label
    diag.source = issue.source === 'ai' ? 'CodeReach (AI)' : 'CodeReach';
    diag.code   = issue.rule;
    return diag;
  }

  dispose(): void {
    this.collection.dispose();
  }
}